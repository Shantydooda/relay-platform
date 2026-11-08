'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/database.cjs');
const { openApplicationDatabase } = require('../../application/src/sqlite.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createApp } = require('../src/app.cjs');
test('Attio routes preserve authentication, CSRF and workspace binding', async (t) => {
  const authDb = openDatabase(':memory:'),
    applicationDb = openApplicationDatabase(':memory:');
  const attioProvider = {
    tenantId: 'pending',
    workspaceLabel: 'Fixture CRM',
    connectionKey: 'fixture',
    assertCompany: async () => {
      throw Error('Must not send');
    },
  };
  const store = await createUnifiedLocalStore({
    authDb,
    applicationDb,
    localExecution: true,
    attioProvider,
  });
  const origin = 'http://127.0.0.1:4198',
    server = createApp({ store, origin });
  await new Promise((resolve) => server.listen(4198, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    applicationDb.close();
    authDb.close();
  });
  const registration = await fetch(origin + '/api/auth/register', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'QA',
      email: 'attio@example.test',
      password: 'Disposable connector fixture only!',
      workspace: 'buyer',
    }),
  });
  assert.equal(registration.status, 201);
  const actor = await registration.json(),
    cookie = registration.headers.get('set-cookie').split(';')[0];
  attioProvider.tenantId = actor.memberships[0].id;
  const control = (tenantId, csrf) =>
    fetch(origin + '/api/attio/control', {
      method: 'POST',
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        ...(csrf ? { 'x-csrf-token': actor.csrf } : {}),
      },
      body: JSON.stringify({ tenantId, action: 'connect' }),
    });
  assert.equal((await control(attioProvider.tenantId, false)).status, 403);
  assert.equal((await control('someone-else', true)).status, 403);
  assert.equal((await control(attioProvider.tenantId, true)).status, 200);
  const status = await fetch(
    origin + '/api/attio/status?tenantId=' + attioProvider.tenantId,
    { headers: { cookie } },
  ).then((r) => r.json());
  assert.equal(status.connected, true);
  assert.equal(status.destination, 'Fixture CRM');
  assert.equal(
    (
      await fetch(
        origin + '/api/attio/status?tenantId=' + attioProvider.tenantId,
      )
    ).status,
    401,
  );
  const prepare = await fetch(origin + '/api/attio/prepare', {
    method: 'POST',
    headers: {
      origin,
      cookie,
      'content-type': 'application/json',
      'x-csrf-token': actor.csrf,
    },
    body: JSON.stringify({}),
  });
  assert.equal(prepare.status, 400);
  const created = await fetch(origin + '/api/tasks', {
    method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'x-csrf-token': actor.csrf, 'idempotency-key': require('node:crypto').randomUUID() },
    body: JSON.stringify({ tenantId: attioProvider.tenantId, title: 'Company research', brief: 'Find companies and deliver a CSV.' }),
  });
  assert.equal(created.status, 201);
  const { taskId } = await created.json();
  const receiptsUrl = origin + '/api/tasks/' + taskId + '/delivery-destinations';
  assert.deepEqual(await fetch(receiptsUrl, { headers: { cookie } }).then(r => r.json()), { receipts: [] });
  assert.equal((await fetch(receiptsUrl)).status, 401);

});
