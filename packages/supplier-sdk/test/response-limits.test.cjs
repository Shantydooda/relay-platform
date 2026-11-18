'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { createSupplierClient } = require('../src/index.cjs');
const config = { origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43) };

for (const declared of [false, true]) test(`oversized ${declared ? 'declared' : 'streamed'} response is cancelled without retry`, async () => {
  let calls = 0, cancelled = false;
  const client = createSupplierClient({ ...config, maxResponseBytes: 16, fetchImpl: async () => {
    calls++;
    return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(17))); },
      cancel() { cancelled = true; }
    }), { headers: declared ? { 'content-length': '1000000000' } : {} });
  } });
  await assert.rejects(client.assignments(), { code: 'SUPPLIER_RESPONSE_TOO_LARGE' });
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
});

test('byte boundary accepts valid JSON including multibyte text', async () => {
  const body = JSON.stringify({ name: '€' });
  const client = createSupplierClient({ ...config, maxResponseBytes: Buffer.byteLength(body), fetchImpl: async () => new Response(body) });
  assert.deepEqual(await client.assignments(), { name: '€' });
  for (const limit of [0, -1, 1.5, Infinity, 32 * 1024 * 1024 + 1]) {
    assert.throws(() => createSupplierClient({ ...config, maxResponseBytes: limit }), { code: 'INVALID_RESPONSE_LIMIT' });
  }
});

test('malformed successful bodies fail closed and never expose content', async () => {
  for (const body of ['null', '[]', '"private"', '{private', new Uint8Array([0xff])]) {
    let calls = 0;
    const client = createSupplierClient({ ...config, fetchImpl: async () => { calls++; return new Response(body); } });
    await assert.rejects(client.assignments(), { code: 'INVALID_SUPPLIER_RESPONSE' });
    assert.equal(calls, 1);
  }
});

test('a stalled HTTP body is covered by the timeout and bounded retries', async t => {
  let calls = 0;
  const server = createServer((req, res) => { calls++; res.writeHead(200); res.write('{'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createSupplierClient({ ...config, origin: `http://127.0.0.1:${server.address().port}`, timeoutMs: 50 });
  await assert.rejects(client.assignments(), { code: 'SUPPLIER_CONNECTION_FAILED' });
  assert.equal(calls, 3);
});

test('caller cancellation interrupts body consumption without retry', async t => {
  let calls = 0;
  const controller = new AbortController();
  const server = createServer((req, res) => {
    calls++;
    res.writeHead(200);
    res.write('{');
    controller.abort();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const client = createSupplierClient({ ...config, origin: `http://127.0.0.1:${server.address().port}`, signal: controller.signal });
  await assert.rejects(client.assignments(), { code: 'ABORTED' });
  assert.equal(calls, 1);
});

test('malformed transient server responses retain command identity on retry', async () => {
  const calls = [];
  const client = createSupplierClient({ ...config, fetchImpl: async (url, options) => {
    calls.push(options);
    return calls.length === 1 ? new Response('private server failure', { status: 503 }) : new Response('{}');
  } });
  await client.message('00000000-0000-0000-0000-000000000000', { body: 'Hello' }, 'stable-command-key');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
});

test('tiny chunks and split UTF-8 sequences preserve exact response content', async () => {
  const expected = { text: '€'.repeat(6000) };
  const encoded = new TextEncoder().encode(JSON.stringify(expected));
  let offset = 0;
  const client = createSupplierClient({ ...config, maxResponseBytes: encoded.length, fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset === encoded.length) controller.close();
      else controller.enqueue(encoded.subarray(offset, ++offset));
    }
  })) });
  assert.deepEqual(await client.assignments(), expected);
});
