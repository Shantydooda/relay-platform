'use strict';
// Relay's fee (docs/Build-Order.md, step 7; Decisions-Needed.md §1, option B):
// the buyer pays the builder's quote plus a tiered fee, the builder is
// transferred exactly their quote, and the ledger records Relay's share.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createPricing } = require('../src/pricing.cjs');

const OPTION_B = '100000:2000,1000000:1200,*:800';

test('the tiered schedule prices a $5 and a $10,000 quote as agreed', () => {
  const { price, charging } = createPricing(OPTION_B);
  assert.equal(charging, true);
  assert.deepEqual({ ...price(500) }, { ...price(500), payoutMinor: 500, feeMinor: 125, totalMinor: 625 });
  assert.equal(price(1000000).totalMinor, 1147727, '$10,000 payout costs the buyer $11,477.27');
  assert.equal(createPricing('').charging, false, 'no schedule means no fee');
  assert.equal(createPricing('').price(500).totalMinor, 500);
});

for (const adapter of ['sqlite', 'postgres']) test(`${adapter}: the buyer is charged the total; the builder is transferred and paid out their quote; the fee is its own ledger entry`, async t => {
  const f = await fixture(t, adapter, null, { feeSchedule: OPTION_B, offer: { feeMinor: 125, totalMinor: 625 } });
  const ops = {};
  for (const method of ['checkout', 'transfer', 'payout']) {
    const original = f.provider[method];
    f.provider[method] = async op => { ops[method] = { amountMinor: op.amountMinor, chargeAmountMinor: op.chargeAmountMinor }; return original(op); };
  }
  await f.begin('fund');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  assert.equal(ops.checkout.amountMinor, 625, 'checkout charges the all-in total');
  const funded = (await f.get()).settlement;
  assert.deepEqual([funded.amountMinor, funded.payoutMinor, funded.feeMinor], [625, 500, 125]);

  await f.accept();
  await f.begin('transfer', f.builder);
  assert.deepEqual(ops.transfer, { amountMinor: 500, chargeAmountMinor: 625 }, 'the builder gets their quote, checked against the full charge');
  await f.begin('payout', f.builder);
  await f.app.reconcilePayment(f.builder, f.taskId);
  assert.equal(ops.payout.amountMinor, 500);

  const settled = (await f.get()).settlement;
  assert.equal(settled.status, 'paid');
  assert.deepEqual(settled.ledger.map(e => [e.debit, e.credit, e.amountMinor]), [
    ['provider_cash', 'buyer_funds', 625],
    ['buyer_funds', 'operator_balance', 500],
    ['buyer_funds', 'relay_fees', 125],
    ['operator_balance', 'sandbox_payout', 500],
  ]);
  const history = await f.app.spendingHistory(f.buyer, f.buyer.memberships[0].id);
  assert.equal(history.totals.fundedMinor, 625);
  assert.equal(history.totals.releasedMinor, 625, 'the fee leaves held funds with the builder’s share');
  assert.equal(history.totals.heldMinor, 0);
});

test('a refund before transfer returns the whole total', async t => {
  const f = await fixture(t, 'sqlite', null, { feeSchedule: OPTION_B, offer: { feeMinor: 125, totalMinor: 625 } });
  let refunded;
  const original = f.provider.refund;
  f.provider.refund = async op => { refunded = op.amountMinor; return original(op); };
  await f.begin('fund'); await f.app.reconcilePayment(f.buyer, f.taskId);
  await f.begin('refund');
  assert.equal(refunded, 625);
});

test('offers freeze the fee when made; buyers see the total and builders keep their quote', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = person('Bea'), builder = person('Bo');
  let time = Date.now();
  const repository = createSqliteRepository(db);
  const make = feeSchedule => createApplication({ repository, now: () => time, localExecution: true, feeSchedule, resolveOperator: async id => [buyer, builder].find(a => a.user.id === id) });
  const app = make(OPTION_B);
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'Dedupe', purpose: 'Deduplicate vendors', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Deduplicate vendors' }] }, randomUUID());
  const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Dedupe', brief: 'Deduplicate vendors.' }, randomUUID());
  await app.addInput(buyer, taskId, { expectedVersion: 1, filename: 'v.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Input.' }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const capabilityId = (await app.marketplace.agents(builder))[0].capabilities[0].id;
  await app.marketplace.quote(builder, taskId, { agentId, capabilityId, expectedVersion: 3, amountMinor: 200000, deliveryMinutes: 60, proposal: 'Done in an hour.' }, randomUUID());
  const [offer] = await app.marketplace.offers(buyer, taskId);
  // $1,000 at 20% plus $1,000 at 12%.
  assert.deepEqual([offer.amountMinor, offer.feeMinor, offer.totalMinor], [200000, 25000 + 13636, 238636]);
  // A later schedule change doesn't reprice an offer already made.
  const unchanged = (await make('').marketplace.offers(buyer, taskId))[0];
  assert.equal(unchanged.totalMinor, 238636);
});

test('the Stripe sandbox adapter transfers the builder’s share of a charge that includes the fee', async () => {
  const { createStripeSandbox } = require('../../payments/src/stripe-sandbox.cjs');
  const sent = [];
  const stripe = (charge) => createStripeSandbox({ secretKey: 'sk_test_fixture', origin: 'http://127.0.0.1:4180', fetchImpl: async (url, options) => {
    const body = Object.fromEntries(new URLSearchParams(options?.body || ''));
    if (url.includes('/charges/')) return { ok: true, json: async () => ({ id: 'ch_1', livemode: false, currency: 'usd', amount: charge, balance_transaction: { currency: 'usd' } }) };
    sent.push(body);
    return { ok: true, json: async () => ({ id: 'tr_1', livemode: false, amount: Number(body.amount), currency: 'usd', destination: 'acct_1', source_transaction: 'ch_1' }) };
  } });
  const operation = { id: 'op_1', currency: 'USD', accountId: 'acct_1', chargeId: 'ch_1', amountMinor: 500, chargeAmountMinor: 625 };
  assert.deepEqual(await stripe(625).transfer(operation), { transferId: 'tr_1' });
  assert.equal(sent[0].amount, '500', 'the builder’s share is transferred, not the whole charge');
  await assert.rejects(stripe(500).transfer(operation), { code: 'SETTLEMENT_CURRENCY_MISMATCH' }, 'a charge that doesn’t match the agreed total is refused');
});

test('a scheduled run can’t pick an offer whose all-in price is above the per-run limit', () => {
  const src = require('node:fs').readFileSync(require.resolve('../src/recurring.cjs'), 'utf8');
  assert.match(src, /buyerTotal\(o\) <= schedule\.perRunLimitMinor/, 'the per-run limit is the buyer’s, so it caps the total');
  assert.doesNotMatch(src, /o\.amountMinor <= schedule\.perRunLimitMinor/);
});
