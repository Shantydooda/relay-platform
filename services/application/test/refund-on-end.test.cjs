'use strict';
// Ending paid work refunds the buyer (sandbox only, behind refundOnEnd).
// "End as unmet" on funded work, and ending a plan with a funded milestone that
// hasn't started, start a full refund in the same step. Nothing reaches the builder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createPricing } = require('../src/pricing.cjs');
const { priceMilestones } = require('../src/engagements.cjs');
const { taskOutcome } = require('../src/outcome-ledger.cjs');
const { fixture } = require('./fixtures/payment-fixture.cjs');

const SCHEDULE = '100000:2000,1000000:1200,*:800';

// Funded work that has had two rounds of changes, so the buyer may end it.
async function fundedInReview(f) {
  await f.begin('fund'); await f.app.reconcilePayment(f.buyer, f.taskId);
  assert.equal((await f.get()).settlement.status, 'funded');
  await f.repository.transaction('fixture', async repo => {
    const task = await repo.get('task', f.taskId, true);
    task.assignment = { id: randomUUID(), agentId: 'agent-fixture', operatorId: f.builder.user.id, mode: 'stripe-sandbox',
      status: 'buyer_review', offerId: task.selectedOfferId, agreement: { acceptanceCriteria: [{ id: 'c1', text: 'Rows are clean' }] } };
    task.submissions = [{ id: randomUUID(), status: 'revision_requested', files: [] }, { id: randomUUID(), status: 'revision_requested', files: [] },
      { id: randomUUID(), status: 'ready', files: [] }];
    await repo.save('agent', { id: 'agent-fixture', ownerId: f.builder.user.id });
    await repo.save('task', task);
  });
}
const end = async (f, key = randomUUID()) => f.app.endUnmet(f.buyer, f.taskId, { expectedVersion: (await f.get()).version, reason: 'Totals still disagree.' }, key);

test('with the switch off, ending paid work is still refused and no money moves', async t => {
  const f = await fixture(t, 'sqlite', null, { offer: { totalMinor: 500, feeMinor: 0 } });
  await fundedInReview(f);
  await assert.rejects(end(f), { code: 'REFUND_REQUIRED' });
  assert.equal(f.calls.filter(call => call[0] === 'refund').length, 0);
  assert.equal((await f.get()).assignment.status, 'buyer_review');
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: ending paid work as unmet refunds the buyer’s full charge once, and the builder can’t be paid`, async t => {
    const pricing = createPricing(SCHEDULE), price = pricing.price(500);
    const f = await fixture(t, adapter, null, { feeSchedule: SCHEDULE, refundOnEnd: true, offer: { feeMinor: price.feeMinor, totalMinor: price.totalMinor } });
    await fundedInReview(f);
    const before = await f.get();
    const lifecycle = (await f.app.detail(f.buyer, f.taskId)).actions.execution.end;
    assert.equal(lifecycle.allowed, true, 'the buyer is offered "End as unmet"');

    const key = randomUUID();
    const result = await end(f, key);
    assert.equal(result.refund, 'started');
    let task = await f.get();
    assert.equal(task.assignment.status, 'failed');
    assert.equal(task.assignment.error, 'BUYER_ENDED_UNMET');
    assert.equal(task.settlement.id, before.settlement.id, 'the same payment is refunded, not a new one');
    assert.equal(task.settlement.status, 'refund_pending', 'the refund is requested from the provider straight away');
    await f.app.reconcilePayment(f.buyer, f.taskId);
    task = await f.get();
    assert.equal(task.settlement.status, 'refunded');
    const refund = task.settlement.ledger.find(entry => entry.debit === 'buyer_funds' && entry.credit === 'provider_cash');
    assert.equal(refund.amountMinor, price.totalMinor, 'the buyer gets back everything they paid, fee included');
    assert.ok(task.events.some(item => item.type === 'sandbox.refund.requested'));

    // A retried request returns the first answer and doesn't refund twice.
    await f.app.endUnmet(f.buyer, f.taskId, { expectedVersion: before.version, reason: 'Totals still disagree.' }, key);
    await f.app.reconcilePayment(f.buyer, f.taskId);
    assert.equal(f.calls.filter(call => call[0] === 'refund').length, 1);
    await assert.rejects(end(f), { code: 'STATE_CONFLICT' });
    await assert.rejects(f.begin('transfer', f.builder), { code: 'DELIVERY_NOT_ACCEPTED' });
    assert.equal(f.calls.filter(call => call[0] === 'transfer').length, 0);
    task = await f.get();
    assert.equal(task.settlement.ledger.filter(entry => entry.credit === 'operator_balance').length, 0);
  });
}

test('if the provider call fails, the work stays ended and the reconciler retries the same refund', async t => {
  const f = await fixture(t, 'sqlite', null, { refundOnEnd: true, offer: { totalMinor: 500, feeMinor: 0 } });
  await fundedInReview(f);
  f.provider.refund = async () => { throw new Error('provider unavailable'); };
  const result = await end(f);
  assert.equal(result.refund, 'started');
  const task = await f.get();
  assert.equal(task.assignment.status, 'failed');
  assert.equal(task.settlement.status, 'creating_refund', 'the refund waits for the reconciler to retry with the same reference');
  const operation = task.settlement.operationId;
  f.provider.refund = async op => { f.calls.push(['refund', op.id]); return { refundId: 're_retry', status: 'pending' }; };
  await f.app.reconcilePayment(f.buyer, f.taskId); await f.app.reconcilePayment(f.buyer, f.taskId);
  const settled = await f.get();
  assert.equal(settled.settlement.status, 'refunded');
  assert.deepEqual(f.calls.filter(call => call[0] === 'refund'), [['refund', operation]], 'the retry reuses the original operation');
});

test('payment still being set up, or paused for review, blocks ending rather than guessing', async t => {
  const f = await fixture(t, 'sqlite', null, { refundOnEnd: true, offer: { totalMinor: 500, feeMinor: 0 } });
  await fundedInReview(f);
  await f.repository.transaction('fixture', async repo => {
    const task = await repo.get('task', f.taskId, true); task.settlement.status = 'awaiting_payment'; await repo.save('task', task);
  });
  await assert.rejects(end(f), { code: 'REFUND_REQUIRED' });
  await f.repository.transaction('fixture', async repo => {
    const task = await repo.get('task', f.taskId, true); task.settlement.status = 'funded'; await repo.save('task', task);
    await repo.save('payment-job', { ...(await repo.get('payment-job', `task:${f.taskId}`)), status: 'review' });
  });
  await assert.rejects(end(f), { code: 'RECONCILIATION_REQUIRED' });
  assert.equal(f.calls.filter(call => call[0] === 'refund').length, 0);
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: ending a plan refunds a paid milestone that hasn’t started, and leaves accepted ones alone`, async t => {
    const milestones = priceMilestones([{ title: 'Mapping', criteria: ['Mapped'], amountMinor: 200, deliveryMinutes: 60 },
      { title: 'Full load', criteria: ['Loaded'], amountMinor: 300, deliveryMinutes: 60 }], createPricing('').price);
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    const f = await fixture(t, adapter, repository, { refundOnEnd: true,
      offer: { amountMinor: 500, totalMinor: 500, feeMinor: 0, deliveryMinutes: 120, milestones, agentName: 'Agent', operatorName: 'Builder' } });
    const read = id => f.repository.read(repo => repo.get('task', id));
    const pay = async (id, action) => f.app.sandboxPayment(f.buyer, id, action, { expectedVersion: (await read(id)).version }, randomUUID());
    const { milestoneIds: [m1, m2] } = await f.app.marketplace.accept(f.buyer, f.taskId, { offerId: 'offer-fixture', expectedVersion: (await f.get()).version }, randomUUID());
    await pay(m1, 'fund'); await f.app.reconcilePayment(f.buyer, m1);
    await f.repository.transaction('fixture', async repo => {
      const task = await repo.get('task', m1, true);
      task.assignment = { id: randomUUID(), agentId: 'agent-fixture', operatorId: f.builder.user.id, mode: 'stripe-sandbox', status: 'accepted', offerId: task.selectedOfferId };
      task.submissions = [{ id: randomUUID(), status: 'accepted', files: [] }];
      await repo.save('task', task);
    });
    await pay(m2, 'fund'); await f.app.reconcilePayment(f.buyer, m2);

    const result = await f.app.endEngagement(f.buyer, f.taskId, { expectedVersion: (await f.get()).version }, randomUUID());
    assert.deepEqual(result.refunds, [m2]);
    assert.equal((await read(m2)).settlement.status, 'refund_pending');
    await f.app.reconcilePayment(f.buyer, m2);
    const second = await read(m2);
    assert.equal(second.status, 'cancelled');
    assert.equal(second.settlement.status, 'refunded');
    assert.equal((await read(m1)).settlement.status, 'funded', 'the accepted milestone’s payment is untouched');
    assert.deepEqual(f.calls.filter(call => call[0] === 'refund').map(call => call[1]), [second.settlement.operationId]);
  });
}

test('work paid for days before it’s ended still refunds; and the run stays a failure on the agent’s record', async t => {
  const f = await fixture(t, 'sqlite', null, { refundOnEnd: true, offer: { totalMinor: 500, feeMinor: 0, expiresAt: Date.now() + 30 * 86400000 } });
  await fundedInReview(f);
  f.advance(3 * 86400000);
  assert.equal((await end(f)).refund, 'started');
  assert.equal((await f.get()).settlement.status, 'refund_pending', 'the provider was asked, not left waiting on an old funding time');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  const task = await f.get();
  assert.equal(task.settlement.status, 'refunded');
  assert.equal(taskOutcome(task).outcome, 'failed');
});

test('only the workspace owner can end paid work, as with a manual refund, and the page says so before submitting', async t => {
  const f = await fixture(t, 'sqlite', null, { refundOnEnd: true, offer: { totalMinor: 500, feeMinor: 0 } });
  await fundedInReview(f);
  const employee = { user: { id: randomUUID(), name: 'Employee' }, memberships: [{ id: f.buyer.memberships[0].id, role: 'employee' }] };
  await f.repository.transaction('fixture', async repo => { const task = await repo.get('task', f.taskId, true); task.ownerId = employee.user.id; await repo.save('task', task); });
  assert.equal((await f.app.detail(employee, f.taskId)).actions.execution.end.allowed, false);
  await assert.rejects(f.app.endUnmet(employee, f.taskId, { expectedVersion: (await f.get()).version, reason: 'Totals still disagree.' }, randomUUID()), { code: 'APPROVAL_REQUIRED' });
  assert.equal(f.calls.filter(call => call[0] === 'refund').length, 0);
});

test('a payment paused for review hides "End as unmet" instead of failing on submit', async t => {
  const f = await fixture(t, 'sqlite', null, { refundOnEnd: true, offer: { totalMinor: 500, feeMinor: 0 } });
  await fundedInReview(f);
  await f.repository.transaction('fixture', async repo => {
    await repo.save('payment-job', { ...(await repo.get('payment-job', `task:${f.taskId}`)), status: 'review' });
  });
  const end = (await f.app.detail(f.buyer, f.taskId)).actions.execution.end;
  assert.equal(end.allowed, false);
});

test('ending a plan days after paying for a milestone still refunds it, and an open checkout gets a plain reason', async t => {
  const milestones = priceMilestones([{ title: 'Mapping', criteria: ['Mapped'], amountMinor: 200, deliveryMinutes: 60 },
    { title: 'Full load', criteria: ['Loaded'], amountMinor: 300, deliveryMinutes: 60 }], createPricing('').price);
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const f = await fixture(t, 'sqlite', createSqliteRepository(db), { refundOnEnd: true,
    offer: { amountMinor: 500, totalMinor: 500, feeMinor: 0, deliveryMinutes: 120, milestones, agentName: 'Agent', operatorName: 'Builder' } });
  const read = id => f.repository.read(repo => repo.get('task', id));
  const { milestoneIds: [m1] } = await f.app.marketplace.accept(f.buyer, f.taskId, { offerId: 'offer-fixture', expectedVersion: (await f.get()).version }, randomUUID());
  await f.app.sandboxPayment(f.buyer, m1, 'fund', { expectedVersion: (await read(m1)).version }, randomUUID());
  const endPlan = async () => f.app.endEngagement(f.buyer, f.taskId, { expectedVersion: (await f.get()).version }, randomUUID());
  await assert.rejects(endPlan(), error => error.code === 'REFUND_REQUIRED' && /checkout/i.test(error.message));
  await f.app.reconcilePayment(f.buyer, m1);
  f.advance(3 * 86400000);
  await endPlan();
  assert.equal((await read(m1)).settlement.status, 'refund_pending');
});
