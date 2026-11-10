'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');

// Independent command oracle. Delivery acceptance is a prerequisite fixture;
// every payment state, including uncertainty, is reached through commands.
const matrix = {
  none: { fund: 'awaiting_payment' },
  creating_checkout: { reconcile: 'awaiting_payment' },
  awaiting_payment: { reconcile: 'funded' },
  expired: { fund: 'awaiting_payment', reconcile: 'expired' },
  funded: { refund: 'refund_pending', reconcile: 'funded' },
  accepted: { transfer: 'transferred', reconcile: 'funded' },
  creating_refund: { reconcile: 'refund_pending' },
  refund_pending: { reconcile: 'refunded' },
  refund_failed: { reconcile: 'refund_failed' },
  refunded: { fund: 'awaiting_payment', reconcile: 'refunded' },
  creating_transfer: { reconcile: 'transferred' },
  transferred: { payout: 'payout_pending', reconcile: 'transferred' },
  creating_payout: { reconcile: 'payout_pending' },
  payout_pending: { reconcile: 'paid' },
  payout_failed: { reconcile: 'payout_failed' },
  paid: { reconcile: 'paid' },
};
const actions = ['fund', 'refund', 'transfer', 'payout', 'reconcile'];
async function reach(t, repository, state) {
  const f = await fixture(t, 'sqlite', repository);
  const reconcile = () => f.app.reconcilePayment(f.buyer, f.taskId);
  const uncertain = async (action, method, actor) => {
    const original = f.provider[method];
    f.provider[method] = async () => { throw new Error('Fixture lost provider response'); };
    await assert.rejects(f.begin(action, actor), /Fixture lost provider response/);
    f.provider[method] = original;
  };
  if (state === 'creating_checkout') await uncertain('fund', 'checkout', f.buyer);
  else if (state !== 'none') {
    await f.begin('fund');
    if (state === 'expired') f.provider.funding = async () => ({ status: 'expired' });
    if (state !== 'awaiting_payment') await reconcile();
    if (['creating_refund', 'refund_pending', 'refunded', 'refund_failed'].includes(state)) {
      if (state === 'creating_refund') await uncertain('refund', 'refund', f.buyer);
      else {
        await f.begin('refund');
        if (state === 'refund_failed') f.provider.refundStatus = async () => ({ status: 'failed' });
        if (state !== 'refund_pending') await reconcile();
      }
    }
    if (['accepted', 'creating_transfer', 'transferred', 'creating_payout', 'payout_pending', 'payout_failed', 'paid'].includes(state)) {
      await f.accept();
      if (state === 'creating_transfer') await uncertain('transfer', 'transfer', f.builder);
      else if (state !== 'accepted') {
        await f.begin('transfer', f.builder);
        if (state === 'creating_payout') await uncertain('payout', 'payout', f.builder);
        else if (state !== 'transferred') {
          await f.begin('payout', f.builder);
          if (state === 'payout_failed') f.provider.payoutStatus = async () => ({ status: 'failed' });
          if (state !== 'payout_pending') await reconcile();
        }
      }
    }
  }
  assert.equal((await f.get()).settlement?.status || 'none', state === 'accepted' ? 'funded' : state);
  return { ...f, run: action => action === 'reconcile' ? reconcile() : f.begin(action, ['transfer', 'payout'].includes(action) ? f.builder : f.buyer) };
}
function rejection(state, action) {
  if (['refund_failed', 'payout_failed'].includes(state)) return 'RECONCILIATION_REQUIRED';
  if (state === 'none') return action === 'refund' ? 'REFUND_UNAVAILABLE' : 'NOT_FOUND';
  return { fund: 'FUNDING_LOCKED', refund: 'REFUND_UNAVAILABLE', transfer: 'DELIVERY_NOT_ACCEPTED', payout: 'PAYOUT_UNAVAILABLE' }[action];
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: payment command matrix preserves money and rejects conflicting transitions`, async t => {
    const base = await fixture(t, adapter);
    for (const [state, allowed] of Object.entries(matrix)) for (const action of actions) {
      await t.test(`${state} / ${action}`, async () => {
        const f = await reach(t, base.repository, state);
        const before = await f.get(), calls = structuredClone(f.calls);
        const job = () => f.repository.read(r => r.get('payment-job', `task:${f.taskId}`));
        const beforeJob = await job();
        if (action !== 'reconcile') {
          const actor = ['transfer', 'payout'].includes(action) ? f.builder : f.buyer;
          const eligibility = await f.repository.read(r => f.app.paymentActions(r, actor, before));
          assert.equal(eligibility[action].allowed, !!allowed[action]);
          assert.equal(eligibility[action].code, allowed[action] ? null : rejection(state, action));
          assert.deepEqual(await f.get(), before, 'availability must not write state');
          assert.deepEqual(f.calls, calls, 'availability must not call a provider');
        }
        if (!allowed[action]) {
          await assert.rejects(f.run(action), { code: rejection(state, action) });
          assert.deepEqual(await f.get(), before);
          assert.deepEqual(await job(), beforeJob);
          assert.deepEqual(f.calls, calls, 'rejection cannot create a provider operation');
          return;
        }
        await f.run(action);
        const after = await f.get(), p = after.settlement;
        assert.equal(p.status, allowed[action]);
        assert.equal((await f.app.taskPayment(f.buyer, f.taskId)).status, p.status);
        assert.equal((await f.app.taskPayment(f.builder, f.taskId)).status, p.status);
        assert.equal(p.amountMinor, 500);
        assert.equal(new Set(p.ledger.map(e => e.reference)).size, p.ledger.length);
        assert.ok(p.ledger.every(e => e.amountMinor === 500 && e.currency === 'USD'));
        const ledgerCounts = { awaiting_payment: 0, funded: 1, expired: 0, refund_pending: 1, refund_failed: 1, refunded: 2, transferred: 2, payout_pending: 2, payout_failed: 2, paid: 3 };
        assert.equal(p.ledger.length, ledgerCounts[p.status]);
        if (action === 'fund' && before.settlement) {
          assert.notEqual(p.id, before.settlement.id);
          const archived = await f.repository.read(r => r.get('sandbox-settlement-history', before.settlement.id));
          assert.deepEqual(archived.ledger, before.settlement.ledger);
        }
      });
    }
  });
  test(`${adapter}: simultaneous financial commands reserve one durable operation`, async t => {
    const base = await fixture(t, adapter);
    for (const [state, action] of [['none', 'fund'], ['funded', 'refund'], ['accepted', 'transfer'], ['transferred', 'payout']]) {
      const f = await reach(t, base.repository, state), before = await f.get();
      const actor = ['transfer', 'payout'].includes(action) ? f.builder : f.buyer;
      const results = await Promise.allSettled([0, 1].map(() => f.app.sandboxPayment(actor, f.taskId, action, { expectedVersion: before.version }, randomUUID())));
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(results.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
      const operation = action === 'fund' ? 'checkout' : action;
      assert.equal(f.calls.filter(([name]) => name === operation).length, 1);
      assert.equal((await f.get()).settlement.status, matrix[state][action]);
    }
  });
}
