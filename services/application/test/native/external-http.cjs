'use strict';

const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { writeFileSync, readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

async function externalHttp({ origin, home, buyer, builder, request, json, eventually, restart }) {
  const agent = await json('/api/agents', builder, { name: 'Independent CSV supplier', kind: 'general', purpose: 'Normalize supplied CSV data', integration: 'sdk', capabilities: [{ category: 'Data', task: 'CSV cleanup' }] });
  await json(`/api/agents/${agent.agentId}`, builder, { expectedVersion: 1, integration: 'sdk', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, 'PATCH');
  const denied = await request(`/api/agents/${agent.agentId}/supplier-credentials`, buyer, { expectedVersion: 2 });
  assert.equal(denied.status, 404);
  const issued = await json(`/api/agents/${agent.agentId}/supplier-credentials`, builder, { expectedVersion: 2, expiresInSeconds: 3600 });
  const configPath = join(home, 'external-agent.json'), statePath = join(home, 'external-state.json');
  writeFileSync(configPath, JSON.stringify({ origin, agentId: agent.agentId, token: issued.token }), { mode: 0o600 });
  const { createSupplierClient } = require('../../../../packages/supplier-sdk/src/index.cjs');
  const sdk = createSupplierClient({ origin, token: issued.token });
  let worker;
  async function stopWorker() {
    if (worker && worker.exitCode === null) { const done = once(worker, 'exit'); worker.kill('SIGTERM'); await done; }
    worker = null;
  }
  function launch() {
    worker = fork(join(__dirname, '../../../agent-runtime/src/cli.cjs'), ['--config', configPath, '--state', statePath], { stdio: ['ignore','ignore','ignore','ipc'], env: {} });
  }
  async function supplier(path, body, token = issued.token) {
    return fetch(`${origin}/v1/supplier${path}`, { method: body ? 'POST' : 'GET', headers: {
      Authorization: `Bearer ${token}`, Origin: origin,
      ...(body ? { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  }
  try {
    assert.equal((await fetch(`${origin}/v1/supplier/assignments`, { headers: { Cookie: `relay_local_session_${new URL(origin).port}=${builder.token}` } })).status, 401);
    assert.equal((await fetch(`${origin}/api/runtime/assignments`, { headers: { Authorization: `Bearer ${issued.token}`, 'X-Relay-Protocol': '1' } })).status, 403);
    const contract = await (await fetch(`${origin}/supplier-openapi.json`)).json();
    assert.equal(contract.info.version, '1.2.0');
    launch();
    await eventually(() => json('/api/agents', builder), value => value.agents.some(item => item.id === agent.agentId && item.runtime.connected));
    const task = await json('/api/tasks', buyer, { tenantId: buyer.actor.memberships[0].id, title: 'External CSV processing', brief: 'Normalize CSV supplied with this task and return files.' });
    await json(`/api/tasks/${task.taskId}/input`, buyer, { expectedVersion: 1, filename: 'source.csv', notes: 'Only this supplied sample.', base64: Buffer.from('name\nZeta\nAcme\nAcme\n').toString('base64') });
    await json(`/api/tasks/${task.taskId}/post`, buyer, { expectedVersion: 2 });
    const bids = await eventually(() => json(`/api/tasks/${task.taskId}/offers`, buyer), value => value.offers.some(item => item.agentId === agent.agentId));
    const offer = bids.offers.find(item => item.agentId === agent.agentId);
    assert.equal(offer.runtimeKind, 'supplier-hosted');
    await json(`/api/tasks/${task.taskId}/select`, buyer, { expectedVersion: 3, offerId: offer.id });
    await json(`/api/tasks/${task.taskId}/authorize-local`, buyer, { expectedVersion: 4, mode: 'local-unpaid' });
    const delivered = await eventually(() => json(`/api/tasks/${task.taskId}`, buyer), value => value.task.status === 'buyer_review');
    const submission = delivered.submissions[0], file = submission.files.find(item => item.filename === 'normalized.csv');
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await json(`/api/tasks/${task.taskId}`, buyer);
      if (current.submissions.at(-1).files.every(file => file.scan?.status === 'clean')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const downloaded = await request(`/api/tasks/${task.taskId}/submissions/${submission.id}/files/${file.id}`, buyer);
    assert.equal(await downloaded.text(), 'name\r\nAcme\r\nZeta\r\n');
    const page = await sdk.events({ limit: 1 });
    assert.equal(page.events.length, 1);
    const rest = await sdk.events({ after: page.nextCursor });
    assert.ok(rest.events.length >= 2);
    assert.equal((await supplier(`/tasks/${randomUUID()}`)).status, 404);
    assert.equal((await supplier('/events?limit=10000')).status, 400);
    await restart();
    // Builder-run worker is independent of the Relay process and reconnects.
    await json(`/api/tasks/${task.taskId}/accept-delivery`, buyer, { expectedVersion: (await json(`/api/tasks/${task.taskId}`, buyer)).task.version, submissionId: submission.id });
    await eventually(async () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {}, value => !!value.cursor);
    await stopWorker();
    const before = (await supplier('/events')).status; assert.equal(before, 200);
    launch();
    await eventually(async () => (await supplier(`/tasks/${task.taskId}`)).json(), value => value.status === 'accepted');
    const metadata = (await json('/api/agents', builder)).agents.find(item => item.id === agent.agentId);
    const rotated = await json(`/api/agents/${agent.agentId}/supplier-credentials`, builder, { expectedVersion: metadata.version, expiresInSeconds: 3600 });
    assert.equal((await supplier('/assignments')).status, 401);
    await assert.rejects(sdk.assignments(), error => error.status === 401);
    assert.equal((await supplier('/heartbeat', { runtimeName: 'Rotated reference', runtimeVersion: '1' }, rotated.token)).status, 200);
    const after = (await json('/api/agents', builder)).agents.find(item => item.id === agent.agentId);
    await json(`/api/agents/${agent.agentId}/disconnect`, builder, { expectedVersion: after.version });
    assert.equal((await supplier('/events', null, rotated.token)).status, 401);
  } finally { await stopWorker(); }
}
module.exports = { externalHttp };
