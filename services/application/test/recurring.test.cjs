'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { recurringFixture } = require('./helpers/recurring.cjs');
const { validateCalendar, nextOccurrence } = require('../src/calendar.cjs');
async function fixture(t, adapter = 'sqlite') {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  return { repository, ...await recurringFixture(repository) };
}
const isoNext = (calendar, time) => new Date(nextOccurrence(validateCalendar(calendar), Date.parse(time))).toISOString();
test('calendar handles DST gaps, repeated times, short months and weekdays', () => {
  const c = { cadence: 'daily', time: '02:30', timezone: 'Europe/Berlin', day: 1 };
  assert.equal(isoNext(c, '2026-03-28T12:00Z'), '2026-03-30T00:30:00.000Z');
  assert.equal(isoNext(c, '2026-10-24T12:00Z'), '2026-10-25T00:30:00.000Z');
  assert.equal(isoNext(c, '2026-10-25T00:31Z'), '2026-10-26T01:30:00.000Z');
  assert.equal(isoNext({ ...c, cadence: 'monthly', day: 31 }, '2026-04-01T00:00Z'), '2026-05-31T00:30:00.000Z');
  assert.equal(isoNext({ ...c, cadence: 'weekly', day: 1 }, '2026-10-29T00:00Z'), '2026-11-02T01:30:00.000Z');
  assert.throws(() => validateCalendar({ ...c, timezone: 'Not/AZone' }), { code: 'INVALID_SCHEDULE' });
});
for (const adapter of ['sqlite', 'postgres']) test(`${adapter}: concurrent scheduler ticks, fresh bidding, real delivery and restart retain one run`, async t => {
  const f = await fixture(t, adapter), { app } = f;
  const { scheduleId } = await f.create();
  f.setTime('2026-10-29T09:00Z');
  await Promise.all([app.reconcileSchedules(), createApplication(f.options).reconcileSchedules()]);
  let schedule = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(schedule.runCount, 1); assert.equal(schedule.runs.length, 1);
  const id = schedule.latestTaskId;
  assert.equal((await app.detail(f.buyer, id)).task.status, 'posted');
  await assert.rejects(app.mutateTask(f.buyer, id, 'scope', { expectedVersion: 1, title: 'Changed', brief: 'Different work' }, randomUUID()), { code: 'SCHEDULE_MANAGED' });
  await f.quote(id);
  await Promise.all([app.reconcileSchedules(), app.reconcileSchedules()]);
  assert.equal((await app.detail(f.buyer, id)).execution.status, 'queued');
  assert.equal((await app.marketplace.work(f.builder)).find(task=>task.id===id).status, 'queued');
  await f.finish(id);
  assert.equal((await app.detail(f.buyer, id)).task.status, 'accepted');
  schedule = (await createApplication(f.options).listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(schedule.id, scheduleId); assert.equal(schedule.reservedMinor, 100);
  assert.equal(schedule.runs[0].status, 'accepted');
  const key = randomUUID(), body = { expectedVersion: schedule.version, action: 'pause' };
  assert.deepEqual(await app.updateSchedule(f.buyer, schedule.id, body, key), await app.updateSchedule(f.buyer, schedule.id, body, key));
  f.setTime('2026-10-30T09:00Z'); await app.reconcileSchedules();
  assert.equal((await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0].runCount, 1);
});
test('limits, missed slots, isolation, active overlap and access epochs fail closed', async t => {
  const f = await fixture(t), { app } = f;
  await assert.rejects(app.createSchedule(f.outsider, f.taskId, f.config, randomUUID()), { code: 'NOT_FOUND' });
  await assert.rejects(app.createSchedule(f.buyer, f.taskId, { ...f.config, consent: '' }, randomUUID()), { code: 'CONSENT_REQUIRED' });
  await f.create();
  f.setTime('2026-10-29T11:00Z'); await app.reconcileSchedules();
  let schedule = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(schedule.runCount, 0); assert.equal(schedule.history.at(-1).action, 'missed_slot_skipped');
  f.setTime('2026-10-30T09:00Z'); await app.reconcileSchedules();
  schedule = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  await f.quote(schedule.latestTaskId, 101); await app.reconcileSchedules();
  assert.equal((await app.detail(f.buyer, schedule.latestTaskId)).execution, null);
  f.buyer.memberships[0].accessEpoch++;
  await app.reconcileSchedules();
  schedule = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(schedule.status, 'paused');
  await assert.rejects(app.updateSchedule(f.buyer, schedule.id, { expectedVersion: schedule.version, action: 'resume' }, randomUUID()), { code: 'SCHEDULE_ACCESS_CHANGED' });
});

test('monthly caps and waiting-for-review prevent additional automatic starts', async t => {
  const f = await fixture(t), { app } = f;
  await f.create();
  for (const day of [29, 30, 31]) {
    f.setTime(`2026-10-${day}T09:00Z`); await app.reconcileSchedules();
    const s = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
    await f.quote(s.latestTaskId); await app.reconcileSchedules();
    if (day === 31) {
      const result = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
      assert.equal(result.status, 'paused'); assert.match(result.reason, /limit/);
      assert.equal((await app.detail(f.buyer, s.latestTaskId)).execution, null);
    } else {
      await app.reconcileSchedules();
      assert.equal((await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0].runCount, day - 28);
      await f.finish(s.latestTaskId);
    }
  }
});
test('recovering a failed run fences old leases and preserves a bounded retry history', async t => {
  const f = await fixture(t), { app } = f;
  const { taskId } = await app.createTask(f.buyer, { tenantId: f.buyer.memberships[0].id, title: 'Retry test', brief: 'Normalize supplied data' }, randomUUID());
  await app.mutateTask(f.buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
  const offer = await f.quote(taskId);
  await app.marketplace.accept(f.buyer, taskId, { expectedVersion: 2, offerId: offer.offerId }, randomUUID());
  const authorization = await app.authorizeLocal(f.buyer, taskId, { expectedVersion: 3, mode: 'local-unpaid' }, randomUUID());
  const claim = await app.claim(f.principal, taskId, { assignmentId: authorization.assignmentId }, randomUUID());
  await app.failExecution(f.principal, taskId, { leaseToken: claim.leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  const task = (await app.detail(f.buyer, taskId)).task;
  assert.equal((await app.executionQueue(f.buyer)).items.find(i=>i.taskId===taskId).canRetry, true);
  assert.equal((await app.executionQueue(f.outsider)).items.length, 0);
  const body = { expectedVersion: task.version, reason: 'Verified no external side effects; fixed input handling.' }, key = randomUUID();
  const result = await app.retryExecution(f.buyer, taskId, body, key);
  assert.deepEqual(await app.retryExecution(f.buyer, taskId, body, key), result);
  await assert.rejects(app.progress(f.principal, taskId, { leaseToken: claim.leaseToken, message: 'old worker' }, randomUUID()), { code: 'LEASE_EXPIRED' });
  const next = await app.claim(f.principal, taskId, { assignmentId: authorization.assignmentId }, randomUUID());
  assert.equal(next.attempt, 2);
  await assert.rejects(app.retryExecution(f.buyer, taskId, { ...body, expectedVersion: (await app.detail(f.buyer, taskId)).task.version }, randomUUID()), { code: 'RECOVERY_BLOCKED' });
});
test('company runs require a fresh exact-offer approval and never inherit the trial approval', async t => {
  const f = await fixture(t), { app } = f, tenantId = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  await app.configureBudget(f.buyer, tenantId, { limitMinor: 1000, expectedVersion: 0 }, randomUUID());
  await f.create(); f.setTime('2026-10-29T09:00Z'); await app.reconcileSchedules();
  let s = (await app.listSchedules(f.buyer, tenantId)).schedules[0], id = s.latestTaskId;
  await f.quote(id); await app.reconcileSchedules();
  let d = await app.detail(f.buyer, id);
  assert.equal(d.execution, null); assert.equal(d.approval.status, 'required');
  await app.requestApproval(f.buyer, id, { expectedVersion: d.task.version, note: 'Approve recurring run only' }, randomUUID());
  d = await app.detail(f.buyer, id);
  await app.decideApproval(f.buyer, id, { approvalId: d.approval.id, expectedVersion: d.approval.version, decision: 'declined', note: 'Review the requested output' }, randomUUID());
  await app.reconcileSchedules(); assert.equal((await app.detail(f.buyer, id)).execution, null);
  d = await app.detail(f.buyer, id);
  await app.requestApproval(f.buyer, id, { expectedVersion: d.task.version, note: 'Resubmit this exact offer' }, randomUUID());
  d = await app.detail(f.buyer, id);
  await app.decideApproval(f.buyer, id, { approvalId: d.approval.id, expectedVersion: d.approval.version, decision: 'approved', note: 'Approved for this run only' }, randomUUID());
  await app.reconcileSchedules(); await f.finish(id);
  f.setTime('2026-10-30T09:00Z'); await app.reconcileSchedules();
  s = (await app.listSchedules(f.buyer, tenantId)).schedules[0];
  assert.notEqual(s.latestTaskId, id); await f.quote(s.latestTaskId); await app.reconcileSchedules();
  d = await app.detail(f.buyer, s.latestTaskId);
  assert.equal(d.execution, null); assert.equal(d.approval.status, 'required');
});
test('resume closes unstarted work, preserves history and waits for the next calendar slot', async t => {
  const f = await fixture(t), { app } = f;
  await f.create(); f.setTime('2026-10-29T09:00Z'); await app.reconcileSchedules();
  let s = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  const old = s.latestTaskId;
  await app.updateSchedule(f.buyer, s.id, { expectedVersion: s.version, action: 'pause' }, randomUUID());
  await f.quote(old); await app.reconcileSchedules();
  assert.equal((await app.detail(f.buyer, old)).execution, null);
  s = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  await app.updateSchedule(f.buyer, s.id, { expectedVersion: s.version, action: 'resume' }, randomUUID());
  await app.reconcileSchedules();
  s = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(s.runCount, 1); assert.equal(s.runs[0].status, 'cancelled');
  assert.equal((await app.detail(f.buyer, old)).task.status, 'cancelled');
});


test('recurring work starts from an explicit request, never an accepted delivery', async t => {
  const f = await fixture(t);
  await assert.rejects(f.app.createSchedule(f.buyer, f.taskId, f.config, randomUUID()), { code: 'RECURRING_REQUEST_REQUIRED' });
  const id = await f.prepareRecurring();
  await assert.rejects(f.app.authorizeLocal(f.buyer, id, { expectedVersion: 4, mode: 'local-unpaid' }, randomUUID()), { code: 'SCHEDULE_REQUIRED' });
  await assert.rejects(f.app.createSchedule(f.buyer, id, { ...f.config, expectedVersion: 4, calendar: { ...f.config.calendar, cadence: 'weekly' } }, randomUUID()), { code: 'CADENCE_CHANGED' });
  const result = await f.app.createSchedule(f.buyer, id, { ...f.config, expectedVersion: 4 }, randomUUID());
  const detail = await f.app.detail(f.buyer, id);
  assert.equal(detail.task.status, 'scheduled');
  assert.equal(detail.task.recurringScheduleId, result.scheduleId);
  assert.equal(detail.execution, null);
  await assert.rejects(f.app.mutateTask(f.buyer, id, 'cancel', { expectedVersion: detail.task.version }, randomUUID()), { code: 'SCHEDULE_MANAGED' });
});
