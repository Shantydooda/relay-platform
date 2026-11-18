'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { recurringFixture } = require('./helpers/recurring.cjs');
const { fixture: supplierFixture } = require('./helpers/supplier-workflow.cjs');
async function repository(t, adapter) {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  return adapter === 'sqlite' ? createSqliteRepository(db) : createPostgresRepository(db, { initialize: true });
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: schedule guidance follows source, owner epochs and stale versions without writes`, async t => {
    const repo = await repository(t, adapter), f = await recurringFixture(repo);
    const id = await f.prepareRecurring();
    const before = await repo.read(r => r.get('task', id));
    const detail = await f.app.detail(f.buyer, id);
    assert.equal(detail.actions.scheduling.create.allowed, true);
    assert.equal(detail.actions.execution.startLocal.code, 'SCHEDULE_REQUIRED');
    assert.deepEqual(await repo.read(r => r.get('task', id)), before);
    const created = await f.app.createSchedule(f.buyer, id, { ...f.config, expectedVersion: before.version }, randomUUID());
    assert.equal((await f.app.detail(f.buyer, id)).actions.scheduling.create.code, 'SCHEDULE_EXISTS');
    const current = async () => (await f.app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
    let schedule = await current();
    assert.equal(schedule.actions.pause.allowed, true);
    await f.app.updateSchedule(f.buyer, created.scheduleId, { expectedVersion: schedule.version, action: 'pause' }, randomUUID());
    await assert.rejects(f.app.updateSchedule(f.buyer, created.scheduleId, { expectedVersion: schedule.version, action: 'resume' }, randomUUID()), { code: 'VERSION_CONFLICT' });
    schedule = await current();
    assert.equal(schedule.actions.resume.allowed, true);
    f.buyer.memberships[0].accessEpoch++;
    const snapshot = await repo.read(r => r.get('schedule', created.scheduleId));
    const changed = await current();
    assert.equal(changed.actions.resume.code, 'SCHEDULE_ACCESS_CHANGED');
    assert.equal(changed.actions.pause.allowed, true, 'pausing remains available after owner authority changes');
    await assert.rejects(f.app.updateSchedule(f.buyer, created.scheduleId, { expectedVersion: schedule.version, action: 'resume' }, randomUUID()), { code: 'SCHEDULE_ACCESS_CHANGED' });
    assert.deepEqual(await repo.read(r => r.get('schedule', created.scheduleId)), snapshot);
    await assert.rejects(f.app.listSchedules(f.outsider, f.buyer.memberships[0].id), { code: 'NOT_FOUND' });
  });
  test(`${adapter}: failed execution advertises fresh runtime requirements in detail and queue`, async t => {
    const repo = await repository(t, adapter), f = await supplierFixture(repo), job = await f.task();
    const claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
    await f.app.failExecution(f.principal, job.taskId, { leaseToken: claim.leaseToken, code: 'AGENT_ERROR' }, randomUUID());
    const detail = await f.app.detail(f.buyer, job.taskId);
    assert.equal(detail.actions.execution.retry.allowed, true);
    f.advance(120001);
    const stale = await f.app.detail(f.buyer, job.taskId);
    assert.equal(stale.actions.execution.retry.code, 'RUNTIME_REQUIRED');
    const queue = (await f.app.executionQueue(f.buyer)).items[0];
    assert.equal(queue.canRetry, false);
    assert.equal(queue.actions.retry.code, 'RUNTIME_REQUIRED');
    await assert.rejects(f.app.retryExecution(f.buyer, job.taskId, { expectedVersion: detail.task.version, reason: 'The supplier is ready again.' }, randomUUID()), { code: 'RUNTIME_REQUIRED' });
    await f.app.heartbeat(f.principal, { runtimeName: 'Fixture writer', runtimeVersion: '1' });
    assert.equal((await f.app.detail(f.buyer, job.taskId)).actions.execution.retry.allowed, true);
    await f.app.retryExecution(f.buyer, job.taskId, { expectedVersion: detail.task.version, reason: 'The supplier reconnected safely.' }, randomUUID());
  });
  test(`${adapter}: acceptance checks real bytes while revisions remain independently available`, async t => {
    const repo = await repository(t, adapter), f = await supplierFixture(repo), job = await f.task();
    const claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
    const submitted = await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Fixture release notes.', files: [{ filename: 'notes.txt', mime: 'text/plain', base64: Buffer.from('New search.').toString('base64') }] }, randomUUID());
    const detail = await f.app.detail(f.buyer, job.taskId);
    assert.equal(detail.actions.execution.accept.allowed, true);
    await repo.transaction('fixture-corruption', async r => {
      const artifact = await r.get('artifact', detail.submissions[0].files[0].id, true);
      artifact.base64 = Buffer.from('damaged').toString('base64');
      await r.save('artifact', artifact);
    });
    const damaged = await f.app.detail(f.buyer, job.taskId);
    assert.equal(damaged.actions.execution.accept.code, 'FILE_UNAVAILABLE');
    assert.equal(damaged.actions.execution.revise.allowed, true);
    await assert.rejects(f.app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: submitted.submissionId }, randomUUID()), { code: 'FILE_UNAVAILABLE' });
  });
}
