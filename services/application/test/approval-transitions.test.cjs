'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');

const matrix = {
  required: { request: 'pending' },
  pending: { approve: 'approved', decline: 'declined' },
  declined: { request: 'pending' },
  approved: { fund: 'approved' },
  stale: { request: 'pending' },
  expired: {},
  committed: {},
};
async function reach(t, repository, state) {
  const f = await fixture(t, 'sqlite', repository), tenantId = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  const member = role => ({ user: { id: randomUUID(), name: role }, memberships: [{ id: tenantId, role, company: true, accessEpoch: 'initial' }] });
  const employee = member('employee'), approver = member('approver');
  const actors = [f.buyer, employee, approver, f.builder];
  const app = createApplication({ ...f.options, resolveOperator: async id => actors.find(a => a.user.id === id) });
  // Initial identities and quoted offers are fixture inputs, not state outcomes.
  await repository.transaction('fixture', async r => {
    const task = await r.get('task', f.taskId, true);
    task.ownerId = employee.user.id; task.companyApprovalRequired = true;
    task.offers.push({ ...task.offers[0], id: 'alternative', amountMinor: 600 });
    await r.save('task', task);
  });
  await app.configureBudget(f.buyer, tenantId, { limitMinor: 750, expectedVersion: 0 }, randomUUID());
  const run = async (action, key = randomUUID()) => {
    const task = await f.get();
    if (action === 'request') return app.requestApproval(employee, f.taskId, { expectedVersion: task.version, note: 'Research for our sales team.' }, key);
    if (action === 'fund') return app.sandboxPayment(employee, f.taskId, 'fund', { expectedVersion: task.version }, key);
    return app.decideApproval(approver, f.taskId, { approvalId: task.approval?.id || randomUUID(), expectedVersion: task.approval?.version || 1, decision: action === 'approve' ? 'approved' : 'declined', note: 'Reviewed against the team allowance.' }, key);
  };
  if (state !== 'required') await run('request');
  if (state === 'declined') await run('decline');
  if (['approved', 'stale', 'expired', 'committed'].includes(state)) await run('approve');
  if (state === 'stale') await app.marketplace.accept(employee, f.taskId, { expectedVersion: (await f.get()).version, offerId: 'alternative' }, randomUUID());
  if (state === 'expired') f.advance(3600001);
  if (state === 'committed') await run('fund');
  const view = () => app.detail(employee, f.taskId);
  const budget = async () => (await app.companyBudget(f.buyer, tenantId)).budget;
  assert.equal((await view()).approval.status, state === 'expired' ? 'stale' : state === 'committed' ? 'approved' : state);
  return { ...f, app, employee, approver, tenantId, run, view, budget };
}
function rejection(state, action) {
  if (action === 'request') return state === 'committed' ? 'TASK_COMMITTED' : state === 'expired' ? 'OFFER_UNAVAILABLE' : 'APPROVAL_EXISTS';
  if (action === 'fund') return state === 'committed' ? 'FUNDING_LOCKED' : state === 'expired' ? 'OFFER_UNAVAILABLE' : 'APPROVAL_REQUIRED';
  return 'APPROVAL_STALE';
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: approval command matrix binds decisions and reservations to current offers`, async t => {
    const base = await fixture(t, adapter);
    for (const [state, allowed] of Object.entries(matrix)) for (const action of ['request', 'approve', 'decline', 'fund']) {
      await t.test(`${state} / ${action}`, async () => {
        const f = await reach(t, base.repository, state);
        const before = await f.get(), budget = await f.budget(), calls = structuredClone(f.calls);
        const requests = () => f.app.companyBudget(f.buyer, f.tenantId);
        const beforeRequests = await requests();
        const actor = ['approve', 'decline'].includes(action) ? f.approver : f.employee;
        const eligibility = await f.repository.read(r => f.app.approvalActions(r, actor, before));
        if (action !== 'fund') {
          assert.equal(eligibility[action].allowed, !!allowed[action]);
          assert.equal(eligibility[action].code, allowed[action] ? null : rejection(state, action));
        } else {
          const payments = await f.repository.read(r => f.app.paymentActions(r, actor, before));
          assert.equal(payments.fund.allowed, !!allowed[action]);
          assert.equal(payments.fund.code, allowed[action] ? null : rejection(state, action));
        }
        assert.deepEqual(await f.get(), before, 'availability must not mutate the task');
        if (!allowed[action]) {
          await assert.rejects(f.run(action), { code: rejection(state, action) });
          assert.deepEqual(await f.get(), before);
          assert.deepEqual(await requests(), beforeRequests);
          assert.deepEqual(f.calls, calls);
          return;
        }
        await f.run(action);
        const after = await f.get(), funds = await f.budget();
        assert.equal((await f.view()).approval.status, allowed[action]);
        assert.equal(after.approval.agreement.offerId, after.selectedOfferId);
        assert.equal(after.approval.agreement.amountMinor, state === 'stale' ? 600 : 500);
        assert.equal(funds.reservedMinor, action === 'approve' ? 500 : 0);
        assert.equal(funds.committedMinor, action === 'fund' ? 500 : 0);
        assert.equal(funds.availableMinor + funds.reservedMinor + funds.committedMinor, 750);
        if (action === 'request') {
          assert.notEqual(after.approval.id, before.approval?.id);
          assert.equal(funds.availableMinor, budget.availableMinor);
        }
      });
    }
  });
  test(`${adapter}: competing decisions and stale approval identities cannot allocate twice`, async t => {
    const base = await fixture(t, adapter);
    const f = await reach(t, base.repository, 'pending'), pending = (await f.get()).approval;
    const body = { approvalId: pending.id, expectedVersion: pending.version, decision: 'approved', note: 'Within the allowance.' };
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(keys.map(key => f.app.decideApproval(f.approver, f.taskId, body, key)));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'APPROVAL_STALE');
    const before = await f.get(), funds = await f.budget();
    await f.app.decideApproval(f.approver, f.taskId, body, keys[results.findIndex(r => r.status === 'fulfilled')]);
    assert.deepEqual(await f.get(), before); assert.deepEqual(await f.budget(), funds);
    await f.app.marketplace.accept(f.employee, f.taskId, { expectedVersion: before.version, offerId: 'alternative' }, randomUUID());
    await f.run('request');
    await assert.rejects(f.app.decideApproval(f.approver, f.taskId, body, randomUUID()), { code: 'APPROVAL_STALE' });
    await assert.rejects(f.run('fund'), { code: 'APPROVAL_REQUIRED' });
    assert.equal((await f.budget()).reservedMinor, 0);
    await f.run('approve'); await f.run('fund');
    assert.equal((await f.budget()).committedMinor, 600);
    assert.equal((await f.get()).settlement.offerId, 'alternative');
  });
}
