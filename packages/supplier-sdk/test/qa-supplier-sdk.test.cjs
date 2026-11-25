'use strict';
// Adversarial QA of the supplier SDK transport and the sample agent (Nov 2026).
// Passing tests document verified behaviour; `todo` tests reproduce confirmed
// bugs (BUG-SUP-<n>) without breaking the suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSupplierClient } = require('../src/index.cjs');
const { createTransport } = require('../src/transport.cjs');
const { createSampleAgent } = require('../examples/sample-agent/run.cjs');
const { supplierApi } = require('../../../services/poc-api/src/supplier-api.cjs');
const { createApplication } = require('../../../services/application/src/service.cjs');
const { createSqliteRepository } = require('../../../services/application/src/repository.cjs');

const TOKEN = 'a'.repeat(43);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function listen(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

// The real application behind the real Supplier API router, on an ephemeral port.
async function relay(t, { startAt }) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = person('Bea Buyer'), builder = person('Bo Builder');
  let time = startAt;
  const app = createApplication({ repository, now: () => time, localExecution: true, resolveOperator: async id => [buyer, builder].find(a => a.user.id === id) });
  let origin;
  origin = await listen(t, async (req, res) => {
    try {
      const handled = await supplierApi({ req, store: app, origin, url: new URL(req.url, origin),
        jsonBody: async request => { let raw = ''; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {}; },
        send: (status, result) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); } });
      if (!handled) { res.writeHead(404); res.end('{}'); }
    } catch (error) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: error.code || 'INTERNAL', message: 'hidden' } }));
    }
  });
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'QA writer', purpose: 'Write notes', kind: 'general', integration: 'api', capabilities: [{ category: 'Writing', task: 'Write release notes' }] }, randomUUID());
  await app.marketplace.configure(builder, agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const { token } = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 2, expiresInSeconds: 30 * 86400 }, randomUUID());
  async function post() {
    const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Release notes', brief: 'Write release notes for search.' }, randomUUID());
    await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
    return taskId;
  }
  const liveOffers = async taskId => (await repository.read(repo => repo.get('task', taskId))).offers.filter(offer => offer.agentId === agentId && offer.expiresAt > time);
  return { app, origin, agentId, token, post, liveOffers, advance: ms => { time += ms; } };
}

const writer = {
  name: 'QA writer', version: '1',
  fits: () => true,
  quote: () => ({ amountMinor: 100, deliveryMinutes: 10, proposal: 'Release notes as a text file. Unpaid integration run.' }),
  async work() { return { evidence: 'Wrote the notes.', files: [{ filename: 'notes.txt', mime: 'text/plain', content: 'Notes' }] }; },
};

// ---- Transport -----------------------------------------------------------------

test('transport: only a canonical loopback or https origin and known endpoints ever receive the key', async () => {
  for (const origin of ['http://localhost:4180', 'http://127.0.0.1:4180/', 'http://10.0.0.5', 'https://u:p@relay.example', 'ftp://relay.example', 'not a url'])
    assert.throws(() => createTransport({ origin, token: TOKEN }), { code: 'INVALID_SUPPLIER_ORIGIN' }, origin);
  assert.throws(() => createTransport({ origin: 'https://relay.example', token: 'short' }), { code: 'INVALID_CREDENTIAL' });
  const calls = [];
  const request = createTransport({ origin: 'https://relay.example', token: TOKEN, fetchImpl: async (url, init) => { calls.push({ url, init }); return json(200, {}); } });
  for (const path of ['/../admin', '/tasks/../../api/agents', '//evil.example/x', '/heartbeat?x=1', `/tasks/${randomUUID()}/offers?after=x`])
    await assert.rejects(request(path, {}, 'k'.repeat(16)), { code: 'INVALID_ENDPOINT' }, path);
  await assert.rejects(request(`/tasks/${randomUUID()}/claim`, {}, 'short'), { code: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.equal(calls.length, 0);
  await request('/heartbeat', { runtimeName: 'x', runtimeVersion: '1' });
  assert.equal(calls[0].init.redirect, 'error', 'redirects never carry the key elsewhere');
});

test('transport: 5xx and lost connections retry with identical bytes and key; 4xx and oversized answers do not', async () => {
  const seen = [];
  let mode = 'flaky';
  const request = createTransport({ origin: 'https://relay.example', token: TOKEN, maxResponseBytes: 1024, fetchImpl: async (url, init) => {
    seen.push({ body: init.body, key: init.headers['Idempotency-Key'] });
    if (mode === 'flaky') { if (seen.length === 1) throw new Error('socket hang up'); if (seen.length === 2) return json(503, {}); return json(200, { ok: true }); }
    if (mode === 'conflict') return json(409, { error: { code: 'LEASE_BUSY', message: 'secret detail' } });
    return new Response('x'.repeat(4096), { status: 200, headers: { 'Content-Length': '4096' } });
  } });
  const key = randomUUID();
  assert.deepEqual(await request(`/tasks/${randomUUID()}/submit`, { leaseToken: 'x', files: [] }, key), { ok: true });
  assert.equal(seen.length, 3);
  assert.ok(seen.every(call => call.key === key && call.body === seen[0].body));
  mode = 'conflict'; seen.length = 0;
  await assert.rejects(request(`/tasks/${randomUUID()}/claim`, {}, key), error => error.code === 'LEASE_BUSY' && error.status === 409 && !error.message.includes('secret'));
  assert.equal(seen.length, 1, 'a 409 is not retried');
  mode = 'huge'; seen.length = 0;
  await assert.rejects(request('/events?after=&limit=1'), { code: 'SUPPLIER_RESPONSE_TOO_LARGE' });
});

test('BUG-SUP-6 check: the SDK can call the buyer-connection endpoints the Supplier API contract publishes', async () => {
    const request = createTransport({ origin: 'https://relay.example', token: TOKEN, fetchImpl: async () => json(200, {}) });
    const client = createSupplierClient({ origin: 'https://relay.example', token: TOKEN, fetchImpl: async () => json(200, {}) });
    for (const action of ['access-requests', 'access-read', 'blocked'])
      await request(`/tasks/${randomUUID()}/${action}`, {}, randomUUID());
    assert.equal(typeof client.readAccess, 'function');
  });

// ---- Sample agent ----------------------------------------------------------------

test('sample agent against the real router: quotes once per scope and never twice on one poll', async t => {
  const r = await relay(t, { startAt: Date.now() });
  const runner = createSampleAgent({ origin: r.origin, token: r.token, expectedAgentId: r.agentId, agent: writer, log: () => {} });
  const taskId = await r.post();
  await runner.tick();
  await runner.tick();
  assert.equal((await r.liveOffers(taskId)).length, 1);
});

test('BUG-SUP-5 check: the sample agent offers again after its earlier offer expired', async t => {
    // Relay's clock starts 25 h behind, so the first offer is already expired by the
    // sample agent's own Date.now() once Relay's clock catches up.
    const r = await relay(t, { startAt: Date.now() - 25 * 3600000 });
    const log = [];
    const runner = createSampleAgent({ origin: r.origin, token: r.token, expectedAgentId: r.agentId, agent: writer, log: line => log.push(line) });
    const taskId = await r.post();
    await runner.tick();
    assert.equal((await r.liveOffers(taskId)).length, 1, 'first offer made');
    r.advance(25 * 3600000);
    assert.equal((await r.liveOffers(taskId)).length, 0, 'the offer expired');
    await runner.tick();
    assert.equal(log.filter(line => line.startsWith('Quoted')).length, 2, 'the agent believes it quoted again');
    assert.equal((await r.liveOffers(taskId)).length, 1, `a fresh offer exists. Log:\n${log.join('\n')}`);
  });

test('BUG-SUP-7 check: a refused offer doesn’t stop the sample agent from doing work the buyer already authorized', async t => {
    const taskId = randomUUID(), assignmentId = randomUUID(), agentId = randomUUID();
    const calls = [];
    const origin = await listen(t, async (req, res) => {
      const path = req.url.split('?')[0].replace('/v1/supplier', '');
      calls.push(`${req.method} ${path}`);
      const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
      if (path === '/heartbeat') return reply(200, { agentId, automaticRequested: true, minimumPayout: 100, capabilities: [{ id: randomUUID() }] });
      if (path === '/qualifications') return reply(200, { jobs: [] });
      if (path === '/opportunities') return reply(200, { tasks: [{ id: randomUUID(), title: 'Other request', version: 2, scopeVersion: 1, myOffers: [] }], hasMore: false, nextCursor: '' });
      if (path.endsWith('/offers')) return reply(403, { error: { code: 'ORG_PUBLISHING_OFF', message: 'Org blocks offers' } });
      if (path === '/assignments') return reply(200, { assignments: [{ taskId, assignmentId, status: 'queued', next: { action: 'claim' } }], hasMore: false, nextCursor: '' });
      if (path === `/tasks/${taskId}`) return reply(200, { taskId, submissions: [], attempt: 0 });
      if (path === `/tasks/${taskId}/claim`) return reply(200, { exhausted: true });
      return reply(404, { error: { code: 'NOT_FOUND' } });
    });
    const log = [];
    const runner = createSampleAgent({ origin, token: TOKEN, expectedAgentId: agentId, agent: writer, log: line => log.push(line), pollMs: 10 });
    const exit = await Promise.race([runner.run(), new Promise(resolve => setTimeout(() => { runner.stop(); resolve('kept running'); }, 300))]);
    assert.ok(calls.includes(`POST /tasks/${taskId}/claim`), `authorized work was claimed. Calls: ${calls.join(', ')}`);
    assert.equal(exit, 'kept running', `the runner stopped: ${log.join(' | ')}`);
  });
