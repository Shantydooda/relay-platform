'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createSupplierClient } = require('../src/index.cjs');
const config = { origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43) };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });

test('SDK rejects remote origins, URL credentials, invalid keys and page injection', () => {
  for (const origin of ['https://relay.example', 'http://localhost:4180', 'http://127.0.0.1:4180/', 'http://user@127.0.0.1:4180']) {
    assert.throws(() => createSupplierClient({ ...config, origin }));
  }
  assert.throws(() => createSupplierClient({ ...config, token: 'secret' }));
  const client = createSupplierClient(config);
  assert.throws(() => client.events({ after: '../secret' }));
  assert.throws(() => client.opportunities({ limit: 101 }));
  assert.throws(() => client.task('../../auth'));
});

test('SDK retries ambiguous commands with exactly the same key and bytes', async () => {
  const calls = [];
  const client = createSupplierClient({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (calls.length === 1) throw new Error(`connection lost ${config.token}`);
    if (calls.length === 2) return json({ error: { code: 'UNAVAILABLE' } }, 503);
    return json({ offerId: 'saved-once' });
  } });
  const key = randomUUID();
  const body = { amountMinor: 100 };
  assert.deepEqual(await client.quote(randomUUID(), body, key), { offerId: 'saved-once' });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => call.headers['Idempotency-Key'] === key && call.body === JSON.stringify(body) && call.redirect === 'error'));
  await assert.rejects(client.quote(randomUUID(), body), /IDEMPOTENCY_KEY_REQUIRED/);
});

test('revoked credentials and stale leases are not retried; remote messages stay private', async () => {
  for (const status of [401, 403, 409, 429]) {
    let calls = 0;
    const client = createSupplierClient({ ...config, fetchImpl: async () => {
      calls++;
      return json({ error: { code: 'ACCESS_DENIED', message: config.token } }, status);
    } });
    await assert.rejects(client.progress(randomUUID(), { leaseToken: 'expired' }, randomUUID()), error => error.status === status && !String(error).includes(config.token));
    assert.equal(calls, 1);
  }
});

test('SDK bounds transport failures, redacts error details and aborts promptly', async () => {
  let calls = 0;
  const client = createSupplierClient({ ...config, fetchImpl: async () => { calls++; throw new Error(config.token); } });
  await assert.rejects(client.assignments(), error => error.code === 'SUPPLIER_CONNECTION_FAILED' && !String(error).includes(config.token));
  assert.equal(calls, 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createSupplierClient({ ...config, signal: controller.signal }).assignments(), /ABORTED/);
});

test('named SDK commands use the supplier contract, including qualification and delivery', async () => {
  const paths = [];
  const client = createSupplierClient({ ...config, fetchImpl: async (url, options) => { paths.push([new URL(url).pathname, options.method]); return json({}); } });
  const taskId = randomUUID(), key = randomUUID();
  await client.heartbeat({ runtimeName: 'Test', runtimeVersion: '1' });
  await client.qualifications();
  await client.submitQualification(taskId, { round: 1 }, key);
  await client.claim(taskId, { assignmentId: taskId }, key);
  await client.submit(taskId, { files: [] }, key);
  await client.fail(taskId, { code: 'INPUT_UNSUPPORTED' }, key);
  assert.deepEqual(paths.map(item => item[0].split('/').at(-1)), ['heartbeat', 'qualifications', taskId, 'claim', 'submit', 'fail']);
});

test('permission requests and scoped tool reads use authenticated task endpoints', async () => {
  const calls = [];
  const client = createSupplierClient({ ...config, fetchImpl: async (url, options) => { calls.push({url,options}); return json({status:'pending'}); } });
  const taskId=randomUUID();
  await client.requestPermission(taskId,{sourceId:randomUUID(),operation:'read',reason:'Selected task context'},randomUUID());
  await client.readTool(taskId,{grantId:randomUUID(),leaseToken:'x'.repeat(43)},randomUUID());
  assert.ok(calls[0].url.endsWith('/permission-requests'));
  assert.ok(calls[1].url.endsWith('/tool-read'));
});
