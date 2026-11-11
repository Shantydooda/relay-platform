'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { createStripeSandbox } = require('../../payments/src/stripe-sandbox.cjs');

const { fixture } = require('./fixtures/payment-fixture.cjs');
for(const adapter of ['sqlite','postgres']) {
  test(`${adapter}: funding, accepted delivery, transfer and payout survive restart without duplicate settlement`,async t=>{
    const f=await fixture(t,adapter);
    const body={expectedVersion:(await f.get()).version},key=randomUUID();
    await Promise.all([f.app.sandboxPayment(f.buyer,f.taskId,'fund',body,key),f.app.sandboxPayment(f.buyer,f.taskId,'fund',body,key)]);
    assert.equal(f.unique.size,1);
    const restart=createApplication(f.options);
    await restart.reconcilePayment(f.buyer,f.taskId);
    assert.equal((await f.get()).settlement.status,'funded');
    await assert.rejects(f.begin('transfer',f.builder),{code:'DELIVERY_NOT_ACCEPTED'});
    await assert.rejects(f.begin('payout',f.builder),{code:'PAYOUT_UNAVAILABLE'});
    await f.accept();
    await f.begin('transfer',f.builder);
    await assert.rejects(f.begin('refund'),{code:'REFUND_UNAVAILABLE'});
    await f.begin('payout',f.builder);
    assert.equal((await f.get()).settlement.status,'payout_pending');
    await Promise.all([restart.reconcilePayment(f.builder,f.taskId),restart.reconcilePayment(f.builder,f.taskId)]);
    const p=(await f.get()).settlement;
    assert.equal(p.status,'paid');assert.equal(p.ledger.length,3);
    assert.deepEqual(p.ledger.map(e=>e.amountMinor),[500,500,500]);
    assert.equal(f.calls.filter(c=>c[0]==='transfer').length,1);
  });
}
test('lost provider response reuses durable key; old uncertain operations stop before provider call',async t=>{
  const f=await fixture(t);f.lose();
  await assert.rejects(f.begin('fund'),/Lost response/);
  const restart=createApplication(f.options);
  await restart.reconcilePayment(f.buyer,f.taskId);
  assert.equal(f.unique.size,1);
  const g=await fixture(t);g.lose();await assert.rejects(g.begin('fund'));
  g.advance(24*3600000);
  await assert.rejects(g.app.reconcilePayment(g.buyer,g.taskId),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(g.calls.filter(c=>c[0]==='checkout').length,1);
});
test('refund stays pending until confirmed and cannot race transfer; agreement cannot change or run unpaid',async t=>{
  const f=await fixture(t);await f.begin('fund');await f.app.reconcilePayment(f.buyer,f.taskId);
  const task=await f.get();
  await assert.rejects(f.app.marketplace.accept(f.buyer,f.taskId,{offerId:'other',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await assert.rejects(f.app.mutateTask(f.buyer,f.taskId,'scope',{title:'Changed',brief:'Changed scope',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await assert.rejects(f.app.authorizeLocal(f.buyer,f.taskId,{mode:'local-unpaid',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await f.begin('refund');assert.equal((await f.get()).settlement.status,'refund_pending');
  await assert.rejects(f.begin('transfer',f.builder),{code:'DELIVERY_NOT_ACCEPTED'});
  await f.app.reconcilePayment(f.buyer,f.taskId);
  assert.equal((await f.get()).settlement.status,'refunded');
  assert.equal((await f.get()).settlement.ledger.length,2);
});
test('foreign users, employees and stale operator readiness cannot fund; live mode stays off',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.app.taskPayment(f.stranger,f.taskId),{code:'NOT_FOUND'});
  const employee={...f.buyer,memberships:[{...f.buyer.memberships[0],role:'employee'}]};
  await assert.rejects(f.begin('fund',employee),{code:'APPROVAL_REQUIRED'});
  f.advance(300001);await assert.rejects(f.begin('fund'),{code:'OPERATOR_NOT_READY'});
  const disconnected=createApplication({...f.options,paymentProvider:undefined});
  assert.equal((await disconnected.paymentStatus(f.builder)).livePayments,false);
  await assert.rejects(disconnected.sandboxPayment(f.buyer,f.taskId,'fund',{expectedVersion:1},randomUUID()),{code:'SANDBOX_NOT_CONNECTED'});
  assert.throws(()=>createStripeSandbox({secretKey:'sk_live_forbidden',origin:'http://127.0.0.1:4180'}),/live keys/);
  assert.throws(()=>createStripeSandbox({secretKey:'sk_test_fixture',origin:'https://relay.example.com'}),/localhost/);
});
test('late funding response cannot regress refund state; failed payout never reports paid',async t=>{
  const f=await fixture(t);await f.begin('fund');
  let release,entered;
  const wait=new Promise(resolve=>entered=resolve);
  f.provider.funding=async()=>{entered();await new Promise(resolve=>release=resolve);return{status:'awaiting_payment'};};
  const late=f.app.reconcilePayment(f.buyer,f.taskId);await wait;
  f.provider.funding=async()=>({status:'funded',intentId:'pi_fixture',chargeId:'ch_fixture'});
  await f.app.reconcilePayment(f.buyer,f.taskId);await f.begin('refund');release();await late;
  assert.equal((await f.get()).settlement.status,'refund_pending');
  const g=await fixture(t);await g.begin('fund');await g.app.reconcilePayment(g.buyer,g.taskId);await g.accept();await g.begin('transfer',g.builder);await g.begin('payout',g.builder);
  g.provider.payoutStatus=async()=>({status:'failed'});await g.app.reconcilePayment(g.builder,g.taskId);
  assert.equal((await g.get()).settlement.status,'payout_failed');assert.equal((await g.get()).settlement.ledger.length,2);
  await assert.rejects(g.begin('payout',g.builder),{code:'RECONCILIATION_REQUIRED'});
});
test('Stripe adapter verifies refund intent without nonexistent livemode field and blocks mismatched amounts',async()=>{
  let bad=false;
  const adapter=createStripeSandbox({secretKey:'sk_test_fixture',origin:'http://127.0.0.1:4180',fetchImpl:async(url,options)=>{
    assert.ok(url.startsWith('https://api.stripe.com/v1/refunds'));
    assert.equal(options.headers.Authorization,'Bearer sk_test_fixture');
    return{ok:true,json:async()=>({id:'re_fixture',amount:bad?999:500,currency:'usd',payment_intent:'pi_fixture',status:'succeeded'})};
  }});
  assert.equal((await adapter.refund({id:'operation',amountMinor:500,intentId:'pi_fixture'})).status,'succeeded');
  bad=true;await assert.rejects(adapter.refundStatus({refundId:'re_fixture',amountMinor:500,intentId:'pi_fixture'}),{code:'REFUND_MISMATCH'});
});

for (const adapter of ['sqlite', 'postgres']) test(`${adapter}: spending history counts confirmed funding once, includes archived refunds, and isolates workspaces`, async t => {
  const f = await fixture(t, adapter);
  const tenant = f.buyer.memberships[0].id;
  let history = await f.app.spendingHistory(f.buyer, tenant);
  assert.equal(history.items.length, 1);
  assert.equal(history.totals.netMinor, 0);
  await f.begin('fund');
  assert.equal((await f.app.spendingHistory(f.buyer, tenant)).totals.netMinor, 0);
  await f.app.reconcilePayment(f.buyer, f.taskId);
  await f.begin('refund');
  assert.equal((await f.app.spendingHistory(f.buyer, tenant)).totals.netMinor, 500);
  await f.app.reconcilePayment(f.buyer, f.taskId);
  f.provider.checkout = async () => ({sessionId:'cs_test_second',url:'https://checkout.stripe.com/fixture'});
  f.provider.funding = async () => ({status:'funded',intentId:'pi_second',chargeId:'ch_second'});
  await f.begin('fund');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  history = await f.app.spendingHistory(f.buyer, tenant);
  assert.equal(history.totals.fundedMinor,1000);
  assert.equal(history.totals.refundedMinor,500);
  assert.equal(history.totals.heldMinor,500);
  assert.equal(history.totals.releasedMinor,0);
  assert.equal(history.items[0].transactions.length, 3);
  await f.accept(); await f.begin('transfer',f.builder); await f.begin('payout',f.builder);
  await f.app.reconcilePayment(f.builder,f.taskId);
  const paid = (await f.app.spendingHistory(f.buyer,tenant)).totals;
  assert.equal(paid.netMinor,500);
  assert.equal(paid.releasedMinor,500);
  assert.equal(paid.heldMinor,0);
  await assert.rejects(f.app.spendingHistory(f.stranger,tenant), {code:'NOT_FOUND'});
  const colleague = {...f.buyer,user:{...f.buyer.user,id:'colleague'},memberships:[{id:tenant,role:'employee'}]};
  assert.equal((await f.app.spendingHistory(colleague,tenant)).items.length,0);
});

test('Connect v2 creation and manual payout setup retry with stable independent keys', async () => {
  const calls = [];
  let failSettings = true;
  const provider = createStripeSandbox({ secretKey: 'sk_test_fixture', origin: 'http://127.0.0.1:4180',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/v2/core/accounts')) {
        assert.equal(options.headers['Stripe-Version'], '2026-10-28.endive');
        const body = JSON.parse(options.body);
        assert.equal(body.contact_email, 'builder@example.com');
        assert.equal(body.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested, true);
        return { ok: true, json: async () => ({ id: 'acct_test', livemode: false }) };
      }
      assert.equal(url, 'https://api.stripe.com/v1/accounts/acct_test');
      assert.equal(new URLSearchParams(options.body).get('settings[payouts][schedule][interval]'), 'manual');
      if (failSettings) { failSettings = false; return { ok: false }; }
      return { ok: true, json: async () => ({ id: 'acct_test' }) };
    }
  });
  const operation = { id: 'stable-operation', ownerId: 'builder', country: 'DE', contactEmail: 'builder@example.com' };
  await assert.rejects(provider.createOperator(operation), { code: 'SANDBOX_PROVIDER_ERROR' });
  assert.deepEqual(await provider.createOperator(operation), { accountId: 'acct_test' });
  assert.deepEqual(calls.map(c => c.options.headers['Idempotency-Key']),
    ['stable-operation', 'stable-operation:manual-payouts', 'stable-operation', 'stable-operation:manual-payouts']);
});

test('Connect v2 rejects live account responses before setting payout configuration', async () => {
  let calls = 0;
  const provider = createStripeSandbox({ secretKey: 'sk_test_fixture', origin: 'http://127.0.0.1:4180',
    fetchImpl: async () => { calls++; return { ok: true, json: async () => ({ id: 'acct_live', livemode: true }) }; }
  });
  await assert.rejects(provider.createOperator({ id: 'op', ownerId: 'builder', country: 'DE', contactEmail: 'builder@example.com' }), { code: 'LIVE_MODE_FORBIDDEN' });
  assert.equal(calls, 1);
});

test('unsupported settlement currency blocks funding before reserving a payment', async t => {
  const f = await fixture(t);
  f.provider.assertFundingSupported = async () => {
    const error = new Error('Unsupported currency'); error.code = 'SANDBOX_CURRENCY_UNSUPPORTED'; throw error;
  };
  await assert.rejects(f.begin('fund'), { code: 'SANDBOX_CURRENCY_UNSUPPORTED' });
  assert.equal((await f.get()).settlement, undefined);
  assert.equal(f.calls.filter(call => call[0] === 'checkout').length, 0);
});

test('Stripe settlement preflight rejects platform or recipient FX and permits USD pairs', async () => {
  for (const currencies of [['eur','usd'], ['usd','eur'], ['usd','usd']]) {
    let calls = 0;
    const provider = createStripeSandbox({secretKey:'sk_test_fixture',origin:'http://127.0.0.1:4180',
      fetchImpl: async () => ({ok:true,json:async()=>({default_currency:currencies[calls++]})})});
    if (currencies.includes('eur')) await assert.rejects(provider.assertFundingSupported('acct_test'), {code:'SANDBOX_CURRENCY_UNSUPPORTED'});
    else await provider.assertFundingSupported('acct_test');
  }
});

test('unfinished legacy operator creation requires reconciliation before changing API generations', async t => {
  const f = await fixture(t);
  await f.options.repository.transaction('legacy-operator', async repo => {
    await repo.save('sandbox-operator', {id:f.builder.user.id,ownerId:f.builder.user.id,country:'US',operationId:'legacy-operation',createdAt:Date.now(),status:'creating'});
  });
  const before = f.calls.length;
  await assert.rejects(f.app.onboardOperator(f.builder,{country:'US'},randomUUID()), {code:'OPERATOR_MIGRATION_REVIEW'});
  assert.equal(f.calls.length,before);
});

test('EUR agreement survives funding, restart, payout and currency-separated reporting', async t => {
  const f = await fixture(t);
  await f.repository.transaction('eur-fixture', async repo => {
    const task = await repo.get('task', f.taskId);
    task.offers[0].currency = 'EUR';
    await repo.save('task', task);
  });
  let checked;
  f.provider.assertFundingSupported = async (account, currency) => { checked = currency; };
  await f.begin('fund');
  assert.equal(checked, 'EUR');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  await f.accept();
  await f.begin('transfer', f.builder);
  await f.begin('payout', f.builder);
  const restarted = createApplication(f.options);
  await restarted.reconcilePayment(f.builder, f.taskId);
  const task = await f.get();
  assert.equal(task.settlement.currency, 'EUR');
  assert.deepEqual(task.settlement.ledger.map(entry => entry.currency), ['EUR', 'EUR', 'EUR']);
  const eur = await restarted.spendingHistory(f.buyer, f.buyer.memberships[0].id, { currency: 'EUR' });
  const usd = await restarted.spendingHistory(f.buyer, f.buyer.memberships[0].id, { currency: 'USD' });
  assert.equal(eur.totals.releasedMinor, 500);
  assert.equal(usd.totals.releasedMinor, 0);
  assert.ok(eur.csv.includes('EUR'));
  const page = await restarted.spendingHistory(f.buyer, f.buyer.memberships[0].id, { snapshot: eur.snapshotId });
  assert.equal(page.currency, 'EUR');
  assert.equal(page.csv, eur.csv);
});

test('EUR Stripe operations preserve amount and currency; FX transfer is blocked before writing', async () => {
  const calls = [];
  let wrongCurrency = false;
  const provider = createStripeSandbox({ secretKey: 'sk_test_fixture', origin: 'http://127.0.0.1:4180', fetchImpl: async (url, options) => {
    const body = options.body ? Object.fromEntries(new URLSearchParams(options.body)) : {};
    calls.push({ url, body, method: options.method });
    let value;
    if (url.endsWith('/account') || url.includes('/accounts/')) value = { default_currency: 'eur' };
    else if (url.includes('/charges/')) value = { livemode: false, amount: 100, currency: 'eur', balance_transaction: { currency: wrongCurrency ? 'usd' : 'eur' } };
    else if (url.endsWith('/transfers')) value = { livemode: false, id: 'tr_eur', amount: 100, currency: 'eur', destination: 'acct_eur', source_transaction: 'ch_eur' };
    else if (url.includes('/payouts')) value = { livemode: false, id: 'po_eur', amount: 100, currency: 'eur', status: 'paid' };
    else if (url.includes('/refunds')) value = { id: 're_eur', amount: 100, currency: 'eur', payment_intent: 'pi_eur', status: 'succeeded' };
    else if (options.method === 'POST') value = { livemode: false, id: 'cs_eur', url: 'https://checkout.stripe.com/test' };
    else value = { livemode: false, amount_total: 100, currency: 'eur', client_reference_id: 'op_eur', payment_status: 'paid', payment_intent: { livemode: false, status: 'succeeded', amount_received: 100, currency: 'eur', latest_charge: 'ch_eur', id: 'pi_eur' } };
    return { ok: true, json: async () => value };
  }});
  const op = { id: 'op_eur', operationId: 'op_eur', amountMinor: 100, currency: 'EUR', accountId: 'acct_eur', taskId: randomUUID(), createdAt: Date.now(), sessionId: 'cs_eur', intentId: 'pi_eur', chargeId: 'ch_eur', refundId: 're_eur', payoutId: 'po_eur' };
  await provider.assertFundingSupported(op.accountId, 'EUR');
  await assert.rejects(provider.assertFundingSupported(op.accountId, 'USD'), { code: 'SANDBOX_CURRENCY_UNSUPPORTED' });
  await provider.checkout(op);
  assert.equal(calls.at(-1).body['line_items[0][price_data][currency]'], 'eur');
  assert.equal((await provider.funding(op)).status, 'funded');
  await provider.refund(op);
  await provider.refundStatus(op);
  await provider.transfer(op);
  assert.equal(calls.at(-1).body.currency, 'eur');
  await provider.payout(op);
  assert.equal(calls.at(-1).body.currency, 'eur');
  await provider.payoutStatus(op);
  wrongCurrency = true;
  const writes = calls.filter(call => call.method === 'POST').length;
  await assert.rejects(provider.transfer(op), { code: 'SETTLEMENT_CURRENCY_MISMATCH' });
  assert.equal(calls.filter(call => call.method === 'POST').length, writes);
});
