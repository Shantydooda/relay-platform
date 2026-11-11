'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, cp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const http = require('node:http');
const execute = promisify(execFile);

test('standalone SDK checks a private connection without Relay server source or writes', async t => {
  const home = await mkdtemp(join(tmpdir(), 'relay-sdk-handoff-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  await cp(resolve(__dirname, '../src'), join(home, 'src'), { recursive: true });
  const calls = [];
  const server = http.createServer((request, response) => {
    calls.push(request.method);
    assert.equal(request.headers.authorization, `Bearer ${'a'.repeat(43)}`);
    const field = request.url.includes('opportunities') ? 'tasks' : request.url.includes('assignments') ? 'assignments' : 'events';
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ [field]: [], hasMore: false, nextCursor: '' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = join(home, 'connection.json');
  await writeFile(config, JSON.stringify({ origin: `http://127.0.0.1:${server.address().port}`, agentId: '11111111-1111-1111-1111-111111111111', token: 'a'.repeat(43) }), { mode: 0o600 });
  const { stdout, stderr } = await execute(process.execPath, [join(home, 'src/check-connection.cjs'), '--config', config], { cwd: home });
  assert.equal(stderr, '');
  assert.match(stdout, /PASS: Opportunity access/);
  assert.match(stdout, /PASS: Assignment access/);
  assert.match(stdout, /PASS: Event access/);
  assert.doesNotMatch(stdout, /aaaaaaa/);
  assert.deepEqual(calls, ['GET', 'GET', 'GET']);
});
