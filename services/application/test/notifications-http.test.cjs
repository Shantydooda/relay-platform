'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../../poc-api/src/database.cjs');
const {
  createUnifiedLocalStore,
} = require('../../poc-api/src/unified-store.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
test('notification HTTP routes require session and CSRF and persist reads', async (t) => {
  const authDb = openDatabase(':memory:'),
    applicationDb = new DatabaseSync(':memory:');
  const store = await createUnifiedLocalStore({
    authDb,
    applicationDb,
    localExecution: true,
  });
  const token = await store.register(
    {
      name: 'Buyer',
      email: 'notify@example.test',
      password: 'isolated notification test password',
      workspace: 'buyer',
    },
    'local',
  );
  const actor = store.principal(token);
  const reservation = require('node:net').createServer();
  await new Promise((r) => reservation.listen(0, '127.0.0.1', r));
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const origin = `http://127.0.0.1:${port}`,
    server = createApp({ store, origin });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => {
      server.close(r);
      server.closeAllConnections();
    });
    authDb.close();
    applicationDb.close();
  });
  const headers = {
    Cookie: `relay_local_session_${port}=${token}`,
    Origin: origin,
    'Content-Type': 'application/json',
    'X-CSRF-Token': actor.csrf,
  };
  assert.equal((await fetch(origin + '/api/notifications')).status, 401);
  const { taskId } = await store.createTask(
    actor,
    {
      tenantId: actor.memberships[0].id,
      title: 'Test notification',
      brief: 'Test request.',
    },
    randomUUID(),
  );
  await store.repository.transaction('fixture', async (repo) => {
    const task = await repo.get('task', taskId);
    task.events.push({
      sequence: 2,
      type: 'permission.requested',
      createdAt: Date.now(),
    });
    await repo.save('task', task);
  });
  let response = await fetch(origin + '/api/notifications', { headers });
  assert.equal(response.status, 200);
  const feed = await response.json();
  assert.equal(feed.unread, 1);
  const body = JSON.stringify({ ids: [feed.items[0].id] });
  assert.equal(
    (
      await fetch(origin + '/api/notifications/read', {
        method: 'POST',
        headers: { ...headers, 'X-CSRF-Token': 'wrong' },
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(origin + '/api/notifications/read', {
        method: 'POST',
        headers,
        body,
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await fetch(origin + '/api/notifications', { headers })).json())
      .unread,
    0,
  );
});
