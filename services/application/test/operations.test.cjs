'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createOperations } = require('../src/operations.cjs');
async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const app = createOperations({
    repository,
    now: () => 1000000,
    localExecution: true,
    paymentRecoveryUserIds: ['ops'],
  });
  return { repository, app, actor: { user: { id: 'ops' } } };
}
test('operations access is explicit, not company ownership or recovery sessions', async (t) => {
  const { app, actor } = await fixture(t);
  for (const denied of [
    null,
    { user: { id: 'owner' }, memberships: [{ role: 'owner' }] },
    { ...actor, recoveryRequired: true },
  ])
    await assert.rejects(app.operationsBacklog(denied), { code: 'FORBIDDEN' });
  assert.equal((await app.operationsBacklog(actor)).partial, false);
});
test('saved-state alerts classify waits, stale leases, scanner errors and provider review without writes or secrets', async (t) => {
  const { app, actor, repository } = await fixture(t);
  const rows = [
    [
      'task',
      {
        id: 'wait',
        assignment: { status: 'running', permissionWait: {}, startedAt: 100 },
      },
    ],
    [
      'task',
      {
        id: 'stale',
        assignment: { status: 'running', leaseUntil: 200, startedAt: 100 },
      },
    ],
    [
      'artifact',
      {
        id: 'file',
        objectKey: 'private-key',
        scan: { status: 'scan_error', reason: 'SECRET', checkedAt: 500 },
      },
    ],
    [
      'payment-job',
      { id: 'pay', status: 'review', errorCode: 'SECRET', nextAt: 100 },
    ],
    ['scoping-job', {id:'reply',status:'running',expiresAt:100,createdAt:50,snapshot:{private:'SECRET'}}],
    ['schedule', { id: 'sched', status: 'paused', updatedAt: 100 }],
    [
      'workspace-app',
      { id: 'app', status: 'active', calendar: {}, nextAt: 100 },
    ],
  ];
  for (const [, row] of rows) row.ownerId = 'ops';
  await repository.transaction('seed', async (repo) => {
    for (const [kind, row] of rows) await repo.save(kind, row);
  });
  const result = await app.operationsBacklog(actor);
  assert.equal(result.groups[0].counts.waiting_permission, 1);
  assert.equal(result.groups[0].counts.overdue, 1);
  assert.equal(result.groups[1].counts.scan_error, 1);
  assert.equal(result.groups[2].counts.needs_review, 1);
  assert.equal(result.groups[3].counts.paused, 1);
  assert.equal(result.groups[4].counts.overdue, 1);
  assert.equal(result.groups.find(group => group.kind === 'scoping-job').counts.needs_attention, 1);
  assert.ok(!JSON.stringify(result).includes('SECRET'));
  assert.ok(!JSON.stringify(result).includes('private-key'));
  await repository.read(async (repo) => {
    for (const [kind, row] of rows)
      assert.deepEqual(await repo.get(kind, row.id), row);
  });
});
test('bounded metrics label truncation and cap alerts without claiming full totals', async (t) => {
  const { app, actor, repository } = await fixture(t);
  await repository.transaction('seed', async (repo) => {
    for (let i = 0; i < 1001; i++)
      await repo.save('schedule', {
        id: String(i).padStart(5, '0'),
        ownerId: 'ops',
        status: 'paused',
      });
  });
  const result = await app.operationsBacklog(actor),
    group = result.groups.find((g) => g.kind === 'schedule');
  assert.equal(result.partial, true);
  assert.equal(group.inspected, 1000);
  assert.equal(group.alerts.length, 20);
  assert.equal(group.counts.paused, 1000);
});
