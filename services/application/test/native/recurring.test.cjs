'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readConfig, adminPool, migrateLocal } = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createApplication } = require('../../src/service.cjs');
const { saveTask } = require('../../src/supplier-feed.cjs');
const { recurringFixture } = require('../helpers/recurring.cjs');

test('native PostgreSQL: scheduler competition, restart, waiting queue capacity and recovery', async t => {
  const config = readConfig(), database = 'relay_queue_test_' + Date.now();
  const admin = adminPool(config);
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = { ...config, runtime: { ...config.runtime, database }, migrator: { ...config.migrator, database } };
  let first, second;
  t.after(async () => { await first?.close(); await second?.close(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); });
  await migrateLocal(qa);
  first = await openLocalPostgres(qa.runtime); second = await openLocalPostgres(qa.runtime);
  const f = await recurringFixture(first.repository);
  const other = createApplication({ ...f.options, repository: second.repository });
  await f.create(); f.setTime('2026-10-29T09:00Z');
  await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? other : f.app).reconcileSchedules()));
  const s = (await f.app.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0];
  assert.equal(s.runCount, 1);
  await f.quote(s.latestTaskId);
  await Promise.all([f.app.reconcileSchedules(), other.reconcileSchedules()]);
  const d = await f.app.detail(f.buyer, s.latestTaskId);
  assert.equal(d.execution.status, 'queued');
  await second.close(); second = await openLocalPostgres(qa.runtime);
  const restarted = createApplication({ ...f.options, repository: second.repository });
  await restarted.reconcileSchedules();
  assert.equal((await restarted.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0].reservedMinor, 100);
  const claim = await restarted.claim(f.principal, s.latestTaskId, { assignmentId: d.execution.id }, randomUUID());
  // More queued records than a page must never hide an already running worker.
  const ids = [];
  await first.repository.transaction('queue-load-fixture', async repo => {
    const source = await repo.get('task', s.latestTaskId);
    for (let i = 0; i < 105; i++) {
      const id = randomUUID(), task = structuredClone(source);
      task.id = id; task.scheduleId = null; task.assignment.id = '00000000-' + String(i).padStart(28, '0');
      task.assignment.status = 'queued'; task.assignment.leaseHash = null; task.assignment.attempt = 0;
      ids.push({ id, assignmentId: task.assignment.id }); await saveTask(repo, task);
    }
  });
  const claims = await Promise.allSettled(ids.slice(0, 6).map(item => restarted.claim(f.principal, item.id, { assignmentId: item.assignmentId }, randomUUID())));
  assert.ok(claims.every(result => result.status === 'rejected' && result.reason.code === 'CAPACITY_LIMIT'));
  await first.repository.transaction('stale-leases-fixture', async repo => {
    for (const item of ids.slice(0, 100)) {
      const task = await repo.get('task', item.id, true);
      task.assignment.status = 'running'; task.assignment.leaseUntil = Date.parse('2026-10-29T08:59Z');
      await saveTask(repo, task);
    }
  });
  await assert.rejects(restarted.claim(f.principal, ids[104].id, { assignmentId: ids[104].assignmentId }, randomUUID()), { code: 'CAPACITY_LIMIT' });
  assert.equal((await f.app.detail(f.buyer, s.latestTaskId)).execution.attempt, 1);
  await restarted.failExecution(f.principal, s.latestTaskId, { leaseToken: claim.leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  await restarted.reconcileSchedules();
  assert.equal((await restarted.listSchedules(f.buyer, f.buyer.memberships[0].id)).schedules[0].status, 'paused');
});
