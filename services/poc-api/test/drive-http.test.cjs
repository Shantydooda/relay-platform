'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/database.cjs');
const { openApplicationDatabase } = require('../../application/src/sqlite.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createApp } = require('../src/app.cjs');
const http = require('node:http');
function navigation(url) {
  return new Promise((resolve, reject) => {
    http
      .get(
        url,
        {
          headers: {
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': 'navigate',
            'sec-fetch-dest': 'document',
          },
        },
        (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode,
              text: () => Buffer.concat(chunks).toString(),
            }),
          );
        },
      )
      .on('error', reject);
  });
}

test('Drive callback is public navigation only; connector operations keep session, origin and CSRF gates', async (t) => {
  const authDb = openDatabase(':memory:'),
    applicationDb = openApplicationDatabase(':memory:');
  const store = await createUnifiedLocalStore({
    authDb,
    applicationDb,
    localExecution: true,
  });
  const server = createApp({ store, origin: 'http://127.0.0.1:4199' });
  await new Promise((resolve) => server.listen(4199, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    applicationDb.close();
    authDb.close();
  });
  const origin = 'http://127.0.0.1:4199';
  const callback = await navigation(origin + '/drive/callback?code=test');
  assert.equal(callback.status, 200);
  assert.match(await callback.text(), /Bring your context/);
  const cross = await fetch(origin + '/api/drive/status', {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(cross.status, 403);
  const login = await fetch(origin + '/api/auth/register', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Drive tester',
      email: 'drive@example.test',
      password: 'disposable connector test password',
      workspace: 'buyer',
    }),
  });
  assert.equal(login.status, 201);
  const account = await login.json(),
    cookie = login.headers.get('set-cookie').split(';')[0];
  const body = { tenantId: account.memberships[0].id };
  const request = (headers) =>
    fetch(origin + '/api/drive/begin', {
      method: 'POST',
      headers: {
        origin,
        'content-type': 'application/json',
        cookie,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  assert.equal((await request({})).status, 403);
  const unconfigured = await request({ 'x-csrf-token': account.csrf });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error.code, 'DRIVE_NOT_CONFIGURED');
  const status = await fetch(
    origin + '/api/drive/status?tenantId=' + body.tenantId,
    { headers: { cookie } },
  );
  assert.deepEqual(await status.json(), {
    configured: false,
    connected: false,
    version: 0,
    tenantId: body.tenantId,
  });
  assert.equal(
    (
      await fetch(origin + '/api/drive/picker', {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    ).status,
    401,
  );
});
