'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkConnection } = require('../src/diagnostics.cjs');
const config = { origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43) };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('diagnostic reads bounded feeds without heartbeat, writes or private data in the report', async () => {
  const calls = [];
  const result = await checkConnection({ ...config, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const field = url.includes('/opportunities') ? 'tasks' : url.includes('/assignments') ? 'assignments' : 'events';
    return response({ [field]: [{ brief: 'private customer context' }], hasMore: true, nextCursor: 'private-cursor' });
  } });
  assert.equal(result.ok, true);
  assert.equal(result.checks.length, 3);
  assert.ok(calls.every(({ url, options }) => options.method === 'GET' && url.endsWith('limit=1') && options.redirect === 'error'));
  assert.doesNotMatch(JSON.stringify(result), /private customer|private-cursor|aaaaaaa/);
  assert.match(result.message, /does not verify/);
});
test('revocation, forbidden access and throttling stop diagnostics without retrying or leaking errors', async () => {
  for (const status of [401, 403, 429]) {
    let calls = 0;
    const result = await checkConnection({ ...config, fetchImpl: async () => {
      calls++;
      return response({ error: { code: 'PRIVATE_SUPPLIER_NAME', message: config.token } }, status);
    } });
    assert.equal(result.ok, false);
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SUPPLIER_NAME|aaaaaaa/);
    assert.match(result.message, status === 401 ? /Credential rejected/ : status === 403 ? /Access denied/ : /limiting requests/);
  }
});
test('invalid success payload and remote origin never pass the diagnostic', async () => {
  const malformed = await checkConnection({ ...config, fetchImpl: async () => response({ tasks: [] }) });
  assert.equal(malformed.ok, false);
  assert.match(malformed.message, /unexpected response/);
  let calls = 0;
  const remote = await checkConnection({ ...config, origin: 'https://example.com', fetchImpl: async () => { calls++; } });
  assert.equal(remote.ok, false);
  assert.equal(calls, 0);
});

test('diagnostic completes against localhost HTTP and sends credentials only in headers', async t => {
  const http = require('node:http');
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    const field = req.url.includes('/opportunities') ? 'tasks' : req.url.includes('/assignments') ? 'assignments' : 'events';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ [field]: [], hasMore: false, nextCursor: '' }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await checkConnection({ ...config, origin: `http://127.0.0.1:${server.address().port}` });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 3);
  assert.ok(seen.every(req => req.method === 'GET' && req.authorization === `Bearer ${config.token}` && !req.url.includes(config.token)));
});

test('CLI rejects shared, missing and malformed configuration without printing its contents', async () => {
  const fs = require('node:fs/promises');
  const os = require('node:os');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'relay-diagnostic-'));
  const file = path.join(directory, 'connection.json');
  const cli = require.resolve('../src/check-connection.cjs');
  try {
    for (const [contents, mode] of [[JSON.stringify(config), 0o644], ['private-invalid-json', 0o600]]) {
      await fs.writeFile(file, contents, { mode });
      await fs.chmod(file, mode);
      const result = spawnSync(process.execPath, [cli, '--config', file], { encoding: 'utf8' });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /private connection file/);
      assert.doesNotMatch(result.stdout + result.stderr, /private-invalid-json|aaaaaaa/);
    }
    const missing = spawnSync(process.execPath, [cli, '--config', path.join(directory, 'missing')], { encoding: 'utf8' });
    assert.equal(missing.status, 1);
    assert.doesNotMatch(missing.stderr, /ENOENT|relay-diagnostic-/);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
