'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../src/database.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(t) {
  const authDb = openDatabase(':memory:'), dataDb = openDatabase(':memory:');
  t.after(() => { authDb.close(); dataDb.close(); });
  const repository = createSqliteRepository(dataDb);
  const store = await createUnifiedLocalStore({ authDb, repository, localExecution: true });
  const actors = {};
  for (const name of ['owner', 'employee', 'approver']) {
    const session = await store.register({ name, email: `${name}@example.test`, password: 'local access test password only', workspace: 'buyer' }, name);
    actors[name] = store.principal(session);
  }
  const { tenantId } = store.createTeam(actors.owner, { name: 'Access test' }, randomUUID());
  for (const role of ['employee', 'approver']) {
    const invite = store.inviteTeamMember(actors.owner, tenantId, { email: `${role}@example.test`, role });
    await store.acceptTeamInvite(actors[role], { token: invite.token });
  }
  const { taskId } = await store.createTask(actors.employee, { tenantId, title: 'Supplied data', brief: 'Clean supplied CSV' }, randomUUID());
  await repository.transaction('fixture', async repo => {
    const task = await repo.get('task', taskId);
    task.status = 'posted'; task.selectedOfferId = 'offer';
    task.offers = [{ id: 'offer', agentName: 'CSV agent', amountMinor: 100, currency: 'USD', expiresAt: Date.now() + 3600000, scopeVersion: 1 }];
    await repo.save('task', task);
  });
  await store.configureBudget(actors.owner, tenantId, { limitMinor: 1000, expectedVersion: 0 }, randomUUID());
  const get = () => store.detail(actors.employee, taskId);
  assert.equal((await get()).actions.execution.startLocal.code, 'RUNTIME_REQUIRED', 'an offer without a runtime must remain readable and blocked');
  const request = async () => store.requestApproval(actors.employee, taskId, { expectedVersion: (await get()).task.version, note: 'Needed for sales' }, randomUUID());
  const approve = async () => store.decideApproval(actors.approver, taskId, { approvalId: (await get()).approval.id, expectedVersion: 1, decision: 'approved', note: 'Within allowance' }, randomUUID());
  return { authDb, repository, store, actors, tenantId, taskId, get, request, approve };
}
test('demotion and re-promotion permanently stale approval and release its reservation', async t => {
  const f = await fixture(t); await f.request(); await f.approve();
  const old = (await f.get()).approval;
  await f.store.changeTeamRole(f.actors.owner, f.tenantId, { memberId: f.actors.approver.user.id, expectedRole: 'approver', role: 'employee' });
  assert.equal((await f.get()).approval.status, 'stale');
  assert.equal((await f.store.companyBudget(f.actors.owner, f.tenantId)).budget.reservedMinor, 0);
  await f.store.changeTeamRole(f.actors.owner, f.tenantId, { memberId: f.actors.approver.user.id, expectedRole: 'employee', role: 'approver' });
  assert.equal((await f.get()).approval.status, 'stale');
  await assert.rejects(f.store.decideApproval(f.actors.approver, f.taskId, { approvalId: old.id, expectedVersion: old.version, decision: 'approved', note: 'Reuse old decision' }, randomUUID()), { code: 'APPROVAL_STALE' });
  await f.request(); await f.approve();
  const fresh = (await f.get()).approval;
  assert.notEqual(fresh.id, old.id); assert.ok(fresh.reviewerEpoch > old.reviewerEpoch);
  assert.equal(fresh.status, 'approved');
});
test('active action finishes before removal; queued commands, replay and reads recheck access', async t => {
  const f = await fixture(t), entered = deferred(), release = deferred();
  const original = f.repository.transaction;
  let block = true;
  f.repository.transaction = (key, work) => original(key, async repo => {
    if (block && key.includes(':')) { block = false; entered.resolve(); await release.promise; }
    return work(repo);
  });
  // A fresh adapter picks up the controlled transaction for a deterministic race.
  const store = await createUnifiedLocalStore({ authDb: f.authDb, repository: f.repository, localExecution: true });
  const key = randomUUID(), body = { expectedVersion: 1, body: 'Action already in flight' };
  const active = store.mutateTask(f.actors.employee, f.taskId, 'messages', body, key);
  await entered.promise;
  let removed = false;
  const removal = store.removeTeamAccess(f.actors.owner, f.tenantId, { memberId: f.actors.employee.user.id }).then(() => { removed = true; });
  const queued = store.mutateTask(f.actors.employee, f.taskId, 'messages', { expectedVersion: 2, body: 'Must not commit' }, randomUUID());
  const queuedResult = assert.rejects(queued, { code: 'NOT_FOUND' });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(removed, false);
  release.resolve(); await active; await removal; await queuedResult;
  await assert.rejects(store.mutateTask(f.actors.employee, f.taskId, 'messages', body, key), { code: 'NOT_FOUND' });
  await assert.rejects(store.detail(f.actors.employee, f.taskId), { code: 'NOT_FOUND' });
  const task = await store.detail(f.actors.owner, f.taskId);
  assert.ok(task.messages.some(m => m.body === body.body));
  assert.ok(!task.messages.some(m => m.body === 'Must not commit'));
});
test('removal and re-invitation cannot revive a pending request, including after restart', async t => {
  const f = await fixture(t); await f.request();
  const old = (await f.get()).approval;
  await f.store.removeTeamAccess(f.actors.owner, f.tenantId, { memberId: f.actors.employee.user.id });
  const invitation = f.store.inviteTeamMember(f.actors.owner, f.tenantId, { email: 'employee@example.test', role: 'employee' });
  await f.store.acceptTeamInvite(f.actors.employee, { token: invitation.token });
  const restarted = await createUnifiedLocalStore({ authDb: f.authDb, repository: f.repository, localExecution: true });
  assert.equal((await restarted.detail(f.actors.employee, f.taskId)).approval.status, 'stale');
  await assert.rejects(restarted.decideApproval(f.actors.approver, f.taskId, { approvalId: old.id, expectedVersion: 1, decision: 'approved', note: 'Old request' }, randomUUID()), { code: 'APPROVAL_STALE' });
});
test('restart repairs invalidation after identity committed, while retaining active commitments', async t => {
  const f = await fixture(t); await f.request(); await f.approve();
  await f.repository.transaction('fixture-running', async repo => {
    const task = await repo.get('task', f.taskId);
    task.assignment = { id: randomUUID(), status: 'running' };
    await require('../../application/src/approvals.cjs').syncApproval(repo, task);
    await repo.save('task', task);
  });
  // Simulate process loss after the durable identity write but before cleanup.
  f.authDb.prepare("UPDATE memberships SET role='employee' WHERE user_id=? AND tenant_id=?").run(f.actors.approver.user.id, f.tenantId);
  f.authDb.prepare("UPDATE memberships SET role='approver' WHERE user_id=? AND tenant_id=?").run(f.actors.approver.user.id, f.tenantId);
  const restarted = await createUnifiedLocalStore({ authDb: f.authDb, repository: f.repository, localExecution: true });
  const detail = await restarted.detail(f.actors.owner, f.taskId);
  assert.equal(detail.approval.status, 'stale');
  const budget = (await restarted.companyBudget(f.actors.owner, f.tenantId)).budget;
  assert.equal(budget.committedMinor, 100);
  assert.equal(budget.availableMinor, 900);
});

test('replaying a once-successful decision cannot report an invalidated approval as approved', async t => {
  const f = await fixture(t); await f.request();
  const approval = (await f.get()).approval;
  const key = randomUUID();
  const body = { approvalId: approval.id, expectedVersion: 1, decision: 'approved', note: 'Original decision' };
  await f.store.decideApproval(f.actors.approver, f.taskId, body, key);
  await f.store.changeTeamRole(f.actors.owner, f.tenantId, { memberId: f.actors.approver.user.id, expectedRole: 'approver', role: 'employee' });
  await f.store.changeTeamRole(f.actors.owner, f.tenantId, { memberId: f.actors.approver.user.id, expectedRole: 'employee', role: 'approver' });
  await assert.rejects(f.store.decideApproval(f.actors.approver, f.taskId, body, key), { code: 'APPROVAL_STALE' });
});
