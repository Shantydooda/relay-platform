'use strict';
// Open evaluations over the real HTTP router: the builder starts a run in the
// browser API, a runtime answers it through the supplier SDK, and the score
// reaches the builder's agent view.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { openDatabase } = require('../../poc-api/src/database.cjs');
const { createUnifiedLocalStore } = require('../../poc-api/src/unified-store.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
const { createSupplierClient } = require('../../../packages/supplier-sdk/src/index.cjs');
const SUITES = require('../src/eval-suites.json');

async function availablePort() {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}

test('a builder starts a suite in the app, a runtime answers it with the SDK, and the score shows on the agent', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-eval-test-'));
  const authDb = openDatabase(join(directory, 'auth.sqlite'));
  const applicationDb = openDatabase(join(directory, 'app.sqlite'));
  const store = await createUnifiedLocalStore({ authDb, applicationDb, localExecution: true });
  const token = await store.register({ name: 'Builder', email: 'builder@example.test', password: 'isolated evaluation fixture passphrase', workspace: 'buyer' }, 'Builder');
  const identity = { token, actor: store.principal(token) };
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
  const server = createApp({ store, origin, logger: { error: value => assert.fail(value) } });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    applicationDb.close(); authDb.close(); rmSync(directory, { recursive: true, force: true });
  });
  const call = async (path, body) => {
    const res = await fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: { Cookie: `relay_local_session_${port}=${identity.token}`, Origin: origin,
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': identity.actor.csrf, 'Idempotency-Key': randomUUID() } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    assert.ok(res.ok, `${path}: ${JSON.stringify(data)}`);
    return data;
  };

  const { suites } = await call('/api/evaluations');
  assert.equal(suites[0].key, 'company-research-fields@1');
  const { agentId } = await call('/api/agents', { name: 'Research agent', kind: 'general', purpose: 'Company research', integration: 'api', capabilities: [{ category: 'Company research', task: 'Research company profiles and market data' }] });
  let agent = (await call('/api/agents')).agents.find(a => a.id === agentId);
  const credential = await call(`/api/agents/${agentId}/supplier-credentials`, { expectedVersion: agent.version, expiresInSeconds: 2592000 });
  const client = createSupplierClient({ origin, token: credential.token });
  await client.heartbeat({ runtimeName: 'HTTP fixture', runtimeVersion: '1' });
  agent = (await call('/api/agents')).agents.find(a => a.id === agentId);
  const { evaluationId } = await call(`/api/agents/${agentId}/evaluations`, { expectedVersion: agent.version, suite: 'company-research-fields@1' });

  const { jobs } = await client.evaluations();
  assert.equal(jobs[0].id, evaluationId);
  const answers = SUITES[0].items.map(item => ({ ...item.expected }));
  answers[4].founded = '2009';
  const result = await client.submitEvaluation(evaluationId, { answers }, randomUUID());
  assert.deepEqual(result.score, { correct: 24, total: 25, items: 5 });

  agent = (await call('/api/agents')).agents.find(a => a.id === agentId);
  assert.deepEqual(agent.evaluations.evidence.map(e => [e.correct, e.total, e.runtimeName]), [[24, 25, 'HTTP fixture']]);
  assert.equal((await call(`/api/agents/${agentId}/evaluations`)).runs[0].status, 'scored');
});
