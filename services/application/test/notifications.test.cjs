'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createNotifications } = require('../src/notifications.cjs');
async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const actor = {
    user: { id: 'buyer' },
    memberships: [{ id: 'team', role: 'employee' }],
  };
  const task = {
    id: 'task',
    ownerId: 'buyer',
    tenantId: 'team',
    title: 'Private task',
    selectedOfferId: 'offer',
    offers: [{ id: 'offer', operatorId: 'builder' }],
    events: [
      { sequence: 1, type: 'offer.received', createdAt: 1 },
      { sequence: 2, type: 'permission.requested', createdAt: 2 },
      { sequence: 3, type: 'approval.requested', createdAt: 3 },
      { sequence: 4, type: 'submission.received', createdAt: 4 },
      { sequence: 5, type: 'revision.requested', createdAt: 5 },
    ],
  };
  await repository.transaction('seed', async (repo) => {
    await repo.save('task', task);
    await repo.save('offer-index', {
      id: 'index',
      ownerId: 'builder',
      taskId: 'task',
    });
  });
  const app = createNotifications({
    repository,
    now: () => 10,
    resolveActor: async () => actor,
  });
  return { app, actor, task, repository };
}
test('feed is ordered, read receipts survive service restart and concurrent reads are idempotent', async (t) => {
  const f = await fixture(t);
  const feed = await f.app.notifications(f.actor);
  assert.equal(feed.unread, 5);
  assert.equal(feed.items[0].title, 'A revision was requested');
  await Promise.all([
    f.app.readNotifications(f.actor, { ids: [feed.items[0].id] }),
    f.app.readNotifications(f.actor, { ids: [feed.items[0].id] }),
  ]);
  const restarted = createNotifications({
    repository: f.repository,
    now: () => 20,
  });
  assert.equal((await restarted.notifications(f.actor)).unread, 4);
  await assert.rejects(
    () => f.app.readNotifications(f.actor, { ids: ['a'.repeat(64)] }),
    { code: 'NOT_FOUND' },
  );
});
test('revoked employees and unrelated users cannot read or mark notifications; approvers see approval events only', async (t) => {
  const f = await fixture(t);
  const id = (await f.app.notifications(f.actor)).items[0].id;
  f.actor.memberships = [];
  assert.equal((await f.app.notifications(f.actor)).items.length, 0);
  await assert.rejects(() => f.app.readNotifications(f.actor, { ids: [id] }), {
    code: 'NOT_FOUND',
  });
  const approver = {
    user: { id: 'approver' },
    memberships: [{ id: 'team', role: 'approver' }],
  };
  const app = createNotifications({ repository: f.repository, now: () => 20 });
  assert.deepEqual(
    (await app.notifications(approver)).items.map((i) => i.title),
    ['Budget approval requested'],
  );
  assert.equal(
    (await app.notifications({ user: { id: 'stranger' }, memberships: [] }))
      .unread,
    0,
  );
});
test('builders see their selected work, not other suppliers offers or buyer permission requests', async (t) => {
  const f = await fixture(t);
  const app = createNotifications({ repository: f.repository, now: () => 20 });
  const builder = { user: { id: 'builder' }, memberships: [] };
  assert.deepEqual(
    (await app.notifications(builder)).items.map((i) => i.title),
    ['A revision was requested'],
  );
  await f.repository.transaction('change', async (repo) => {
    f.task.selectedOfferId = null;
    await repo.save('task', f.task);
  });
  assert.equal((await app.notifications(builder)).items.length, 0);
});
test('marking visible items does not clear a later event and invalid input is rejected', async (t) => {
  const f = await fixture(t);
  const before = await f.app.notifications(f.actor);
  await f.repository.transaction('new', async (repo) => {
    f.task.events.push({
      sequence: 6,
      type: 'delivery.accepted',
      createdAt: 20,
    });
    await repo.save('task', f.task);
  });
  await f.app.readNotifications(f.actor, {
    ids: before.items.map((i) => i.id),
  });
  assert.equal((await f.app.notifications(f.actor)).unread, 1);
  await assert.rejects(() => f.app.readNotifications(f.actor, { ids: 'all' }), {
    code: 'INVALID_INPUT',
  });
});
