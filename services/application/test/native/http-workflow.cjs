'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { stopChild, eventually } = require('./lifecycle.cjs');
const { join } = require('node:path');
const { openDatabase } = require('../../../poc-api/src/database.cjs');
const { createStore } = require('../../../poc-api/src/store.cjs');
const { paths, savePrivate, stopCluster, startCluster } = require('../../scripts/local-postgres.cjs');

async function httpWorkflow(config, identityPath, port) {
  const origin = `http://127.0.0.1:${port}`;
  const db = openDatabase(identityPath), identity = createStore(db, Date.now, { identityOnly: true });
  const identities = [];
  for (const workspace of ['buyer', 'builder']) {
    const token = await identity.register({ name: `HTTP ${workspace}`, email: `${workspace}@native-http.test`, password: 'disposable native HTTP test passphrase', workspace }, workspace);
    identities.push({ token, actor: identity.principal(token) });
  }
  db.close();
  const [buyer, builder] = identities;
  const p = paths(config.home);
  savePrivate(p.enabled, { backend: 'postgres', identityPath });
  const scannerFixture = join(config.home, 'scanner-fixture.sh');
  require('node:fs').writeFileSync(scannerFixture, '#!/bin/sh\ncat >/dev/null\nprintf \"stdin: OK\\n\"\nexit 0\n', { mode: 0o700 });
  let child;
  let databaseStopped = false;
  function launch() {
    child = fork(join(__dirname, '../../../poc-api/src/server.cjs'), [], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      env: { ...process.env, NODE_ENV: 'test', RELAY_CLAMSCAN_PATH: scannerFixture, RELAY_POC_PORT: String(port), RELAY_DATABASE_PATH: identityPath, RELAY_LOCAL_PG_HOME: config.home }
    });
  }
  async function stop() {
    const current = child;
    child = null;
    await stopChild(current, { name: 'Recovery HTTP server' });
  }
  async function request(path, who, body, key = randomUUID(), method) {
    return fetch(`${origin}${path}`, { method: method || (body ? 'POST' : 'GET'), headers: {
      ...(who ? { Cookie: `relay_local_session_${port}=${who.token}` } : {}), Origin: origin,
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': who.actor.csrf, 'Idempotency-Key': key } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000) });
  }
  async function json(path, who, body, method) {
    const response = await request(path, who, body, randomUUID(), method);
    assert.ok(response.ok, `${path} returned ${response.status}`);
    return response.json();
  }
  try {
    launch();
    const health = await eventually(() => json('/health'), value => value.storage === 'postgres');
    assert.equal(health.storage, 'postgres');
    const agent = await json('/api/agents', builder, { name: 'HTTP native CSV', kind: 'general', purpose: 'Clean supplied CSV', integration: 'api', capabilities: [{ category: 'Data', task: 'CSV normalization' }] });
    await json(`/api/agents/${agent.agentId}`, builder, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, 'PATCH');
    await json(`/api/agents/${agent.agentId}/connect-local`, builder, { expectedVersion: 2 });
    const task = await json('/api/tasks', buyer, { tenantId: buyer.actor.memberships[0].id, title: 'Native HTTP cleanup', brief: 'Clean supplied CSV and return a file and report.' });
    await json(`/api/tasks/${task.taskId}/input`, buyer, { expectedVersion: 1, filename: 'contacts.csv', notes: 'Only supplied data.', base64: Buffer.from('name,city\nZeta,London\nAcme,Paris\nAcme,Paris\n').toString('base64') });
    await json(`/api/tasks/${task.taskId}/post`, buyer, { expectedVersion: 2 });
    const offers = await eventually(() => json(`/api/tasks/${task.taskId}/offers`, buyer), value => value.offers.length > 0);
    await json(`/api/tasks/${task.taskId}/select`, buyer, { expectedVersion: 3, offerId: offers.offers[0].id });
    await json(`/api/tasks/${task.taskId}/authorize-local`, buyer, { expectedVersion: 4, mode: 'local-unpaid' });
    const delivered = await eventually(() => json(`/api/tasks/${task.taskId}`, buyer), value => value.task.status === 'buyer_review');
    const submission = delivered.submissions[0], file = submission.files.find(item => item.filename === 'normalized.csv');
    const downloadPath = `/api/tasks/${task.taskId}/submissions/${submission.id}/files/${file.id}`;
    // Quarantine is asserted before worker scheduling in runtime-http.test.cjs.
    for (let attempt = 0; attempt < 100; attempt++) {
      const current = await json(`/api/tasks/${task.taskId}`, buyer);
      if (current.submissions.at(-1).files.every(file => file.scan?.status === 'clean')) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await (await request(downloadPath, buyer)).text(), 'name,city\r\nAcme,Paris\r\nZeta,London\r\n');
    console.info('Recovery phase: restart application');
    await stop(); launch();
    await eventually(() => json('/health'), value => value.status === 'ok');
    assert.equal((await json(`/api/tasks/${task.taskId}`, buyer)).task.status, 'buyer_review');
    // Existing browser sessions and exact-submission acceptance survive restart.
    await json(`/api/tasks/${task.taskId}/accept-delivery`, buyer, { expectedVersion: (await json(`/api/tasks/${task.taskId}`, buyer)).task.version, submissionId: submission.id });
    console.info('Recovery phase: database outage');
    stopCluster(config.home);
    databaseStopped = true;
    assert.equal((await request('/health')).status, 503);
    assert.equal((await request('/health/live')).status, 200);
    const down = await request(`/api/tasks/${task.taskId}`, buyer);
    assert.equal(down.status, 503);
    assert.equal((await down.json()).error.code, 'DATABASE_UNAVAILABLE');
    console.info('Recovery phase: database restore');
    startCluster(config.home);
    databaseStopped = false;
    await eventually(() => json('/health'), value => value.status === 'ok');
    assert.equal((await json(`/api/tasks/${task.taskId}`, buyer)).task.status, 'accepted');
    assert.equal(await (await request(downloadPath, buyer)).text(), 'name,city\r\nAcme,Paris\r\nZeta,London\r\n');
    console.info('Recovery phase: link supplier');
    await require('./link-http.cjs').linkHttp({ origin, home: config.home, buyer, builder, request, json, eventually });
    const { externalHttp } = require('./external-http.cjs');
    console.info('Recovery phase: external supplier');
    await externalHttp({ origin, home: config.home, buyer, builder, request, json, eventually, restart: async () => { await stop(); launch(); await eventually(() => json('/health'), value => value.status === 'ok'); } });
  } finally {
    // An assertion during the outage must not strand cleanup against a down DB.
    try { if (databaseStopped) startCluster(config.home); }
    finally { await stop(); }
  }
}
module.exports = { httpWorkflow };
