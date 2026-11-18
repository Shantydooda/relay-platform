'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createApplication } = require('../../src/service.cjs');
function actor(name) { return { user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] }; }
async function fixture(repository, storageOptions = {}) {
  let time = Date.now();
  const buyer = actor('Buyer'), builder = actor('Builder'), other = actor('Other');
  const actors = [buyer, builder, other];
  const app = createApplication({ ...storageOptions, repository, now: () => time, localExecution: true, resolveOperator: async id => actors.find(item => item.user.id === id) });
  const agent = await app.marketplace.addAgent(builder, { name: 'Supplier-owned writer', purpose: 'Write release notes', kind: 'general', integration: 'api', capabilities: [{ category: 'Writing', task: 'Write release notes from a supplied brief' }] }, randomUUID());
  await app.marketplace.configure(builder, agent.agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const key = randomUUID(), body = { expectedVersion: 2, expiresInSeconds: 3600 };
  const credential = await app.issueSupplierCredential(builder, agent.agentId, body, key);
  assert.equal((await app.issueSupplierCredential(builder, agent.agentId, body, key)).token, null);
  let principal = await app.runtimePrincipal(credential.token, { kind: 'supplier-api' });
  await app.heartbeat(principal, { runtimeName: 'Fixture writer', runtimeVersion: '1.0' });
  const capability = (await app.marketplace.agents(builder))[0].capabilities[0];
  async function task() {
    const created = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Release notes', brief: 'Write clear release notes for the new search feature.' }, randomUUID());
    await app.mutateTask(buyer, created.taskId, 'post', { expectedVersion: 1 }, randomUUID());
    const offered = await app.marketplace.quote(builder, created.taskId, { agentId: agent.agentId, capabilityId: capability.id, expectedVersion: 2, amountMinor: 100, deliveryMinutes: 1, proposal: 'A concise text file of release notes. Unpaid integration run.' }, randomUUID(), principal);
    await app.marketplace.accept(buyer, created.taskId, { expectedVersion: 2, offerId: offered.offerId }, randomUUID());
    const authorization = await app.authorizeLocal(buyer, created.taskId, { expectedVersion: 3, mode: 'local-unpaid' }, randomUUID());
    return { taskId: created.taskId, assignmentId: authorization.assignmentId };
  }
  return { app, buyer, builder, other, agentId: agent.agentId, credential, principal, task, advance: value => { time += value; }, setPrincipal: value => { principal = value; } };
}
async function exercise(repository) {
  const f = await fixture(repository), { app } = f;
  await assert.rejects(app.runtimePrincipal(f.credential.token, { kind: 'local-csv' }), { code: 'CREDENTIAL_TRANSPORT' });
  await assert.rejects(app.issueSupplierCredential(f.other, f.agentId, { expectedVersion: 3 }, randomUUID()), { code: 'NOT_FOUND' });
  const before = await app.supplierEvents(f.principal);
  assert.equal(before.events.length, 0);
  const job = await f.task();
  await assert.rejects(app.supplierAssignment(f.principal, randomUUID()), { code: 'NOT_FOUND' });
  const claim = await app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  assert.equal(claim.input, null);
  const result = await app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Release notes contain supplied search feature only.', files: [{ filename: 'release-notes.txt', mime: 'text/plain', base64: Buffer.from('New: search your saved tasks.').toString('base64') }] }, randomUUID());
  let detail = await app.detail(f.buyer, job.taskId);
  await app.reviewDelivery(f.buyer, job.taskId, 'request-revision', { expectedVersion: detail.task.version, submissionId: result.submissionId, notes: 'Use shorter sentences and add a title.' }, randomUUID());
  const revised = await app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  assert.equal(revised.revisionNotes, 'Use shorter sentences and add a title.');
  const final = await app.submit(f.principal, job.taskId, { leaseToken: revised.leaseToken, evidence: 'Requested shorter copy and title included.', files: [{ filename: 'release-notes.txt', mime: 'text/plain', base64: Buffer.from('Task search\nFind saved tasks faster.').toString('base64') }] }, randomUUID());
  detail = await app.detail(f.buyer, job.taskId);
  await app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: final.submissionId }, randomUUID());
  const first = await app.supplierEvents(f.principal, '', 2), second = await app.supplierEvents(f.principal, first.nextCursor, 100);
  const all = [...first.events, ...second.events];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  assert.ok(all.every((item, index) => item.sequence === index + 1));
  assert.equal(all.at(-1).status, 'accepted');
  assert.deepEqual(await app.supplierEvents(f.principal, first.nextCursor, 100), second);
  assert.ok(!JSON.stringify(all).includes('release notes for'));
  assert.ok(!JSON.stringify(await app.marketplace.agents(f.builder)).includes(f.credential.token));
  assert.equal((await app.supplierAssignment(f.principal, job.taskId)).status, 'accepted');
  await assert.rejects(app.supplierEvents(f.principal, `${randomUUID()}:00001`), { code: 'INVALID_CURSOR' });

  const cancelled = await f.task();
  const running = await app.claim(f.principal, cancelled.taskId, { assignmentId: cancelled.assignmentId }, randomUUID());
  const current = await app.detail(f.buyer, cancelled.taskId);
  await assert.rejects(app.cancelExecution(f.other, cancelled.taskId, { expectedVersion: current.task.version, reason: 'No access' }, randomUUID()), { code: 'NOT_FOUND' });
  await app.cancelExecution(f.buyer, cancelled.taskId, { expectedVersion: current.task.version, reason: 'No longer needed' }, randomUUID());
  await assert.rejects(app.progress(f.principal, cancelled.taskId, { leaseToken: running.leaseToken, message: 'Late progress' }, randomUUID()), { code: 'LEASE_EXPIRED' });
  assert.equal((await app.supplierAssignment(f.principal, cancelled.taskId)).status, 'cancelled');

  const recovery = await f.task();
  const old = await app.claim(f.principal, recovery.taskId, { assignmentId: recovery.assignmentId }, randomUUID());
  f.advance(30001);
  await app.reconcileExecutions();
  assert.equal((await app.supplierAssignment(f.principal, recovery.taskId)).status, 'queued');
  const next = await app.claim(f.principal, recovery.taskId, { assignmentId: recovery.assignmentId }, randomUUID());
  assert.notEqual(next.leaseToken, old.leaseToken);
  await assert.rejects(app.progress(f.principal, recovery.taskId, { leaseToken: old.leaseToken, message: 'Stale worker' }, randomUUID()), { code: 'LEASE_EXPIRED' });
  f.advance(30001); await app.reconcileExecutions();
  await app.claim(f.principal, recovery.taskId, { assignmentId: recovery.assignmentId }, randomUUID());
  f.advance(30001); await app.reconcileExecutions();
  assert.equal((await app.supplierAssignment(f.principal, recovery.taskId)).error, 'RETRY_EXHAUSTED');

  await app.heartbeat(f.principal, { runtimeName: 'Fixture writer', runtimeVersion: '1.0' });
  const noStart = await f.task();
  f.advance(120001); await app.reconcileExecutions();
  assert.equal((await app.supplierAssignment(f.principal, noStart.taskId)).error, 'SUPPLIER_UNAVAILABLE');
  await app.heartbeat(f.principal, { runtimeName: 'Fixture writer', runtimeVersion: '1.0' });
  const timeout = await f.task();
  await app.claim(f.principal, timeout.taskId, { assignmentId: timeout.assignmentId }, randomUUID());
  f.advance(420001); await app.reconcileExecutions();
  assert.equal((await app.supplierAssignment(f.principal, timeout.taskId)).error, 'EXECUTION_TIMEOUT');

  const rotated = await app.issueSupplierCredential(f.builder, f.agentId, { expectedVersion: 3, expiresInSeconds: 3600 }, randomUUID());
  await assert.rejects(app.heartbeat(f.principal, { runtimeName: 'Old', runtimeVersion: '1' }), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(app.runtimePrincipal(f.credential.token), { code: 'INVALID_AGENT_KEY' });
  const active = await app.runtimePrincipal(rotated.token, { kind: 'supplier-api' });
  f.advance(3600001);
  await assert.rejects(app.supplierEvents(active), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(app.runtimePrincipal(rotated.token), { code: 'INVALID_AGENT_KEY' });
  assert.equal((await app.marketplace.agents(f.builder))[0].runtime.connected, false);
  const fresh = await app.issueSupplierCredential(f.builder, f.agentId, { expectedVersion: 4, expiresInSeconds: 3600 }, randomUUID());
  await app.marketplace.configure(f.builder, f.agentId, { expectedVersion: 5, integration: 'sdk', setupStage: 2, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  await assert.rejects(app.runtimePrincipal(fresh.token), { code: 'INVALID_AGENT_KEY' });
}
module.exports = { exercise, fixture };
