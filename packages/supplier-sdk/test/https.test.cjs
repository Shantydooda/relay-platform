'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createSupplierClient } = require('../src/index.cjs');
const token = 'a'.repeat(43);

test('HTTPS commands stay on the configured origin with bounded identical retries', async () => {
  const calls = [];
  const client = createSupplierClient({ origin: 'https://pilot.relay.example', token, fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (calls.length === 1) throw new Error('TLS/network private detail');
    return new Response(JSON.stringify({ accepted: true }));
  } });
  const key = randomUUID();
  await client.submit(randomUUID(), { evidence: 'test' }, key);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.url.startsWith('https://pilot.relay.example/v1/supplier/tasks/')));
  assert.ok(calls.every(call => call.redirect === 'error' && call.headers.Authorization === `Bearer ${token}` && call.headers['Idempotency-Key'] === key));
  assert.equal(calls[0].body, calls[1].body);
});

test('HTTPS redirect response never forwards credentials or falls back to HTTP', async () => {
  const urls = [];
  const client = createSupplierClient({ origin: 'https://pilot.relay.example', token, fetchImpl: async (url, options) => {
    urls.push(url);
    assert.equal(options.redirect, 'error');
    return new Response('{}', { status: 302, headers: { Location: 'http://untrusted.example/' } });
  } });
  await assert.rejects(client.assignments(), error => error.status === 302);
  assert.deepEqual(urls, ['https://pilot.relay.example/v1/supplier/assignments?after=&limit=50']);
});

test('HTTPS auth failures do not retry or expose provider details', async () => {
  for (const status of [401, 403, 409, 429]) {
    let count = 0;
    const client = createSupplierClient({ origin: 'https://pilot.relay.example', token, fetchImpl: async () => {
      count++;
      return new Response(JSON.stringify({ error: { code: 'DENIED', message: token } }), { status });
    } });
    await assert.rejects(client.assignments(), error => error.status === status && !String(error).includes(token));
    assert.equal(count, 1);
  }
});

test('invalid origin input is sanitized before any network operation', () => {
  for (const origin of ['not a url', 'https://pilot.relay.example/', 'https://pilot.relay.example:443', 'ftp://pilot.relay.example', 'https://user:password@pilot.relay.example']) {
    assert.throws(() => createSupplierClient({ origin, token }), error => error.code === 'INVALID_SUPPLIER_ORIGIN' && !String(error).includes('password'));
  }
});

test('real TLS rejects an untrusted certificate without sending the supplier credential', async t => {
  const fs = require('node:fs/promises');
  const { join } = require('node:path');
  const { tmpdir } = require('node:os');
  const { execFileSync } = require('node:child_process');
  const https = require('node:https');
  const directory = await fs.mkdtemp(join(tmpdir(), 'relay-tls-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const key = join(directory, 'key.pem'), cert = join(directory, 'cert.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  let receivedRequests = 0;
  const server = https.createServer({ key: await fs.readFile(key), cert: await fs.readFile(cert) }, (_request, response) => {
    receivedRequests++;
    response.end('{}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const client = createSupplierClient({ origin: `https://127.0.0.1:${server.address().port}`, token, timeoutMs: 1000 });
  await assert.rejects(client.assignments(), error => error.code === 'SUPPLIER_CONNECTION_FAILED' && !String(error).includes(token));
  assert.equal(receivedRequests, 0);
});
