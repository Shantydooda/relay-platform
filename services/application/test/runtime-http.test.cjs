'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { fork } = require('node:child_process');
const { openDatabase } = require('../../poc-api/src/database.cjs');
const { createUnifiedLocalStore } = require('../../poc-api/src/unified-store.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');

async function availablePort() {
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  return port;
}
async function eventually(read, condition) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read();
    if (condition(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.fail('Runtime did not reach the expected state');
}

test('separate runtime process bids and delivers over authenticated HTTP; input, bytes and acceptance persist', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'relay-runtime-test-'));
  const authDb = openDatabase(join(directory, 'auth.sqlite'));
  const applicationFile = join(directory, 'app.sqlite');
  const applicationDb = openDatabase(applicationFile);
  const objectStore = require('../../storage/src/local-objects.cjs').localObjects(join(directory, 'objects'));
  const fileScanner = { name: 'HTTP test fixture only', scan: async () => ({ status: 'clean', reason: 'Fixture clean verdict' }) };
  const store = await createUnifiedLocalStore({ authDb, applicationDb, objectStore, fileScanner, localExecution: true });
  const credentials = [];
  for (const name of ['Buyer', 'Builder', 'Other']) {
    const token = await store.register({ name, email: `${name.toLowerCase()}@example.test`, password: 'isolated runtime fixture passphrase', workspace: name === 'Builder' ? 'builder' : 'buyer' }, name);
    credentials.push({ token, actor: store.principal(token) });
  }
  const [buyer, builder, other] = credentials;
  const port = await availablePort(), origin = `http://127.0.0.1:${port}`;
  const server = createApp({ store, origin, logger: { error: value => assert.fail(value) } });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  let worker;
  t.after(async () => {
    worker?.kill('SIGTERM');
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    applicationDb.close(); authDb.close(); rmSync(directory, { recursive: true, force: true });
  });
  async function request(path, identity, body, key = randomUUID()) {
    return fetch(`${origin}${path}`, { method: body ? 'POST' : 'GET', headers: {
      Cookie: `relay_local_session_${port}=${identity.token}`, Origin: origin,
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': identity.actor.csrf, 'Idempotency-Key': key } : {})
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  assert.equal((await (await request('/api/payments/status', buyer)).json()).configured, false);
  const disabled = await request('/api/payments/operator', builder, { country: 'US' });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).error.code, 'SANDBOX_NOT_CONNECTED');
  const agent = await store.marketplace.addAgent(builder.actor, { name: 'Connected CSV agent', purpose: 'Normalize supplied CSVs', domain: '', kind: 'general', integration: 'api', capabilities: [{ category: 'Data', task: 'Normalize CSV files' }] }, randomUUID());
  await store.marketplace.configure(builder.actor, agent.agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 200, concurrency: 1 }, randomUUID());
  const key = randomUUID();
  const connection = await store.issueCredential(builder.actor, agent.agentId, { expectedVersion: 2 }, key);
  assert.equal((await store.issueCredential(builder.actor, agent.agentId, { expectedVersion: 2 }, key)).token, null);
  assert.equal((await fetch(`${origin}/api/runtime/assignments`, { headers: { Cookie: `relay_local_session_${port}=${builder.token}` } })).status, 401);
  worker = fork(join(__dirname, '../../agent-runtime/src/worker.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} });
  worker.send({ origin, token: connection.token, pollMs: 50 });
  const connected = (await eventually(() => store.marketplace.agents(builder.actor), agents => agents[0].runtime.connected))[0];
  const assessmentPath = `/api/agents/${agent.agentId}/qualifications`;
  const assessmentBody = { expectedVersion: connected.version, capabilityId: connected.capabilities[0].id, rubric: 'csv-normalize-v1' };
  assert.equal((await request(assessmentPath, other, assessmentBody)).status, 404);
  assert.equal((await fetch(origin + assessmentPath, { method: 'POST', headers: { Cookie: `relay_local_session_${port}=${builder.token}`, Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify(assessmentBody) })).status, 403);
  assert.equal((await request(assessmentPath, builder, assessmentBody)).status, 201);
  const qualified = (await eventually(() => store.marketplace.agents(builder.actor), agents => agents[0].capabilities[0].qualification === 'qualified'))[0];
  assert.equal(qualified.capabilities[0].assessment.submissions.length, 2);
  const task = await store.createTask(buyer.actor, { tenantId: buyer.actor.memberships[0].id, title: 'Normalize supplier list', brief: 'Clean this supplied CSV. Return the normalized file and report.' }, randomUUID());
  const bytes = Buffer.from('name,region\nZeta,UK\nAcme,US\nAcme,US\n');
  assert.equal((await request(`/api/tasks/${task.taskId}/input`, buyer, { expectedVersion: 1, filename: 'source.csv', notes: 'Use only the supplied data.', base64: bytes.toString('base64') })).status, 200);
  await store.mutateTask(buyer.actor, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const offers = await eventually(() => store.marketplace.offers(buyer.actor, task.taskId), value => value.length === 1);
  assert.equal(offers[0].runtimeBid, true);
  assert.equal(offers[0].qualification, 'qualified');
  assert.equal(offers[0].qualificationCurrent, true);
  assert.equal(offers[0].qualificationEvidence.submissions.length, 2);
  const selected = await request(`/api/tasks/${task.taskId}/select`, buyer, { expectedVersion: 3, offerId: offers[0].id });
  assert.equal(selected.status, 200);
  assert.equal((await store.detail(buyer.actor, task.taskId)).execution, null);
  assert.equal((await request(`/api/tasks/${task.taskId}/authorize-local`, other, { expectedVersion: 4, mode: 'local-unpaid' })).status, 404);
  assert.equal((await request(`/api/tasks/${task.taskId}/authorize-local`, buyer, { expectedVersion: 4, mode: 'local-unpaid' })).status, 200);
  const delivered = await eventually(() => store.detail(buyer.actor, task.taskId), value => value.task.status === 'buyer_review');
  assert.equal(delivered.submissions.length, 1);
  const submission = delivered.submissions[0], file = submission.files.find(item => item.filename === 'normalized.csv');
  const path = `/api/tasks/${task.taskId}/submissions/${submission.id}/files/${file.id}`;
  assert.equal((await request(path, buyer)).status, 409);
  assert.equal((await request(path + '/scan', other, {})).status, 404);
  for (const deliveredFile of submission.files) {
    const scanPath = `/api/tasks/${task.taskId}/submissions/${submission.id}/files/${deliveredFile.id}/scan`;
    assert.equal((await request(scanPath, builder, {})).status, 200);
  }
  await store.reconcileFileScans();
  assert.equal((await request(path, other)).status, 404);
  assert.equal((await request(path + '/preview', other)).status, 404);
  const previewResponse = await request(path + '/preview', buyer);
  assert.equal(previewResponse.status, 200);
  assert.match(previewResponse.headers.get('content-type'), /application\/json/);
  assert.match(previewResponse.headers.get('cache-control'), /no-store/);
  const preview = await previewResponse.json();
  assert.equal(preview.sha256, file.sha256);
  assert.equal(preview.text, 'name,region\r\nAcme,US\r\nZeta,UK\r\n');
  assert.equal((await request(path + '/preview', builder)).status, 200);
  const download = await request(path, buyer);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  const deliveredBytes = Buffer.from(await download.arrayBuffer());
  assert.equal(createHash('sha256').update(deliveredBytes).digest('hex'), file.sha256);
  assert.equal(deliveredBytes.toString(), 'name,region\r\nAcme,US\r\nZeta,UK\r\n');
  const accepted = await request(`/api/tasks/${task.taskId}/accept-delivery`, buyer, { expectedVersion: (await store.detail(buyer.actor, task.taskId)).task.version, submissionId: submission.id });
  assert.equal(accepted.status, 200);
  assert.equal((await store.detail(buyer.actor, task.taskId)).task.status, 'accepted');
  const bad=await store.createTask(buyer.actor,{tenantId:buyer.actor.memberships[0].id,title:'Malformed CSV',brief:'Normalize supplied CSV'},randomUUID());
  await store.addInput(buyer.actor,bad.taskId,{expectedVersion:1,filename:'bad.csv',notes:'Invalid column counts should fail clearly',base64:Buffer.from('a,b\nonly-one-column\n').toString('base64')},randomUUID());
  await store.mutateTask(buyer.actor,bad.taskId,'post',{expectedVersion:2},randomUUID());
  const badOffers=await eventually(()=>store.marketplace.offers(buyer.actor,bad.taskId),value=>value.length===1);
  await store.marketplace.accept(buyer.actor,bad.taskId,{expectedVersion:3,offerId:badOffers[0].id},randomUUID());
  await store.authorizeLocal(buyer.actor,bad.taskId,{expectedVersion:4,mode:'local-unpaid'},randomUUID());
  const failed=await eventually(()=>store.detail(buyer.actor,bad.taskId),value=>value.task.status==='failed');
  assert.equal(failed.submissions.length,0);assert.equal(failed.execution.error,'CSV_INVALID');
  worker.kill('SIGTERM'); worker = null;
  await store.revokeCredential(builder.actor, agent.agentId, { expectedVersion: qualified.version }, randomUUID());
  assert.equal((await fetch(`${origin}/api/runtime/assignments`, { headers: { Authorization: `Bearer ${connection.token}` } })).status, 401);
  const restoredDb = openDatabase(applicationFile);
  const restored = await createUnifiedLocalStore({ authDb, applicationDb: restoredDb, objectStore, fileScanner, localExecution: true });
  try {
    assert.equal((await restored.detail(buyer.actor, task.taskId)).task.status, 'accepted');
    assert.deepEqual((await restored.download(buyer.actor, task.taskId, submission.id, file.id)).bytes, deliveredBytes);
  } finally { restoredDb.close(); }
});
