'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { pilotObjects, PROJECT, BUCKET, MAX_BYTES } = require('../../storage/src/pilot-objects.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function storage() {
  const objects = new Map();
  let publicBucket = false;
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith(`https://${PROJECT}.supabase.co/storage/v1/`));
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    if (url.includes('/bucket/')) return Response.json({ id: BUCKET, public: publicBucket, file_size_limit: MAX_BYTES });
    const key = url.split('/').at(-1);
    if (options.method === 'POST') {
      assert.equal(options.headers['x-upsert'], 'false');
      if (objects.has(key)) return new Response(null, { status: 409 });
      objects.set(key, Buffer.from(options.body));
      return new Response(null, { status: 200 });
    }
    return objects.has(key) ? new Response(objects.get(key)) : new Response(null, { status: 404 });
  };
  const connect = () => pilotObjects({ projectRef: PROJECT, secret: 'fixture-only-secret-not-a-provider-key', fetchImpl });
  return { objects, connect, expose: () => { publicBucket = true; } };
}
test('private pilot objects survive client restart and concurrent retry without overwrites', async () => {
  const f = storage(), bytes = Buffer.from('private delivery');
  await f.connect().verifyBucket();
  const keys = await Promise.all([f.connect().put(bytes), f.connect().put(bytes)]);
  assert.equal(keys[0], keys[1]);
  assert.deepEqual(await f.connect().read(keys[0]), bytes);
  assert.equal(f.objects.size, 1);
  f.objects.set(keys[0], Buffer.from('damaged'));
  await assert.rejects(f.connect().read(keys[0]), /INTEGRITY/);
  await assert.rejects(f.connect().put(bytes), /UNCONFIRMED/);
  f.expose(); await assert.rejects(f.connect().verifyBucket(), /PRIVATE_BUCKET/);
  await assert.rejects(f.connect().read('../other'), /INVALID_OBJECT_KEY/);
  assert.throws(() => pilotObjects({ projectRef: 'staging', secret: 'x'.repeat(40) }), /CONFIGURATION/);
});
test('remote downloads enforce a streaming size limit and conceal provider errors', async () => {
  const store = pilotObjects({ projectRef: PROJECT, secret: 'x'.repeat(40), fetchImpl: async () => new Response(Buffer.alloc(MAX_BYTES + 1)) });
  await assert.rejects(store.read('a'.repeat(64)), /INVALID_OBJECT_SIZE/);
  const offline = pilotObjects({ projectRef: PROJECT, secret: 'x'.repeat(40), fetchImpl: async () => { throw new Error('sensitive-provider-response'); } });
  await assert.rejects(offline.read('a'.repeat(64)), { message: 'PILOT_STORAGE_UNAVAILABLE' });
});
test('async private storage stays quarantined until scanning and supports verified delivery', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const storageFixture = storage();
  const f = await fixture(createSqliteRepository(db), { objectStore: storageFixture.connect(),
    fileScanner: { name: 'explicit fixture scanner', scan: async () => ({ status: 'clean' }) } });
  const job = await f.task();
  const claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  const bytes = Buffer.from('company,website\nExample,https://example.com\n');
  const result = await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Fixture output',
    files: [{ filename: 'companies.csv', mime: 'text/csv', base64: bytes.toString('base64') }] }, randomUUID());
  const detail = () => f.app.detail(f.buyer, job.taskId);
  const file = (await detail()).submissions[0].files[0];
  const download = () => f.app.download(f.buyer, job.taskId, result.submissionId, file.id);
  await assert.rejects(download(), { code: 'FILE_QUARANTINED' });
  await f.app.reconcileFileScans();
  assert.deepEqual((await download()).bytes, bytes);
  await assert.rejects(f.app.download(f.other, job.taskId, result.submissionId, file.id), { code: 'NOT_FOUND' });
  storageFixture.objects.set(hash(bytes), Buffer.from('tampered'));
  await assert.rejects(download(), { code: 'FILE_UNAVAILABLE' });
});
test('async storage admission retries only contention and preserves hard failures', async () => {
  const { putWithRetry } = require('../../storage/src/local-objects.cjs');
  let attempts = 0;
  assert.equal(await putWithRetry({ put: async () => {
    if (++attempts < 3) throw Object.assign(new Error('busy'), { code: 'OBJECT_STORAGE_BUSY' });
    return 'stored';
  } }, Buffer.from('file')), 'stored');
  assert.equal(attempts, 3);
  let hardAttempts = 0;
  await assert.rejects(putWithRetry({ put: async () => {
    hardAttempts++; throw new Error('integrity failure');
  } }, Buffer.from('file')), /integrity failure/);
  assert.equal(hardAttempts, 1);
});
test('buyer revision, scanner outage, application restart and acceptance retain the same supplier task', async t => {
  const { createApplication } = require('../src/service.cjs');
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = createSqliteRepository(db), stored = storage();
  let scannerAvailable = true;
  const fileScanner = { name: 'explicit journey fixture', scan: async () => ({
    status: scannerAvailable ? 'clean' : 'scan_error', reason: 'Fixture scanner state',
  }) };
  const f = await fixture(repository, { objectStore: stored.connect(), fileScanner });
  const job = await f.task();
  const deliver = async (app, content) => {
    const claim = await app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
    const request = { leaseToken: claim.leaseToken, evidence: 'Requested release notes supplied',
      files: [{ filename: 'release-notes.txt', mime: 'text/plain', base64: Buffer.from(content).toString('base64') }] };
    const retryKey = randomUUID();
    const result = await app.submit(f.principal, job.taskId, request, retryKey);
    assert.deepEqual(await app.submit(f.principal, job.taskId, request, retryKey), result);
    return result;
  };
  const first = await deliver(f.app, 'Search is available.');
  await f.app.reconcileFileScans();
  let detail = await f.app.detail(f.buyer, job.taskId);
  await f.app.reviewDelivery(f.buyer, job.taskId, 'request-revision', {
    expectedVersion: detail.task.version, submissionId: first.submissionId, notes: 'Add a title and a shorter summary.',
  }, randomUUID());
  scannerAvailable = false;
  const final = await deliver(f.app, 'Task search\nFind your work faster.');
  await f.app.reconcileFileScans();
  detail = await f.app.detail(f.buyer, job.taskId);
  await assert.rejects(f.app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', {
    expectedVersion: detail.task.version, submissionId: final.submissionId,
  }, randomUUID()), { code: 'FILE_QUARANTINED' });

  // Reconstruct the application and remote storage client over persisted records.
  // This is a fixture restart, not a claim of hosted-process verification.
  const app = createApplication({ repository, localExecution: true, objectStore: stored.connect(), fileScanner,
    resolveOperator: async id => [f.builder, f.buyer, f.other].find(actor => actor.user.id === id) });
  const file = detail.submissions.find(item => item.id === final.submissionId).files[0];
  scannerAvailable = true;
  await app.scanFile(f.builder, job.taskId, final.submissionId, file.id, {}, randomUUID());
  await app.reconcileFileScans();
  detail = await app.detail(f.buyer, job.taskId);
  const body = { expectedVersion: detail.task.version, submissionId: final.submissionId }, key = randomUUID();
  const accepted = await app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', body, key);
  assert.deepEqual(await app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', body, key), accepted);
  const principal = await app.runtimePrincipal(f.credential.token, { kind: 'supplier-api' });
  assert.equal((await app.supplierAssignment(principal, job.taskId)).status, 'accepted');
  assert.equal((await app.download(f.buyer, job.taskId, final.submissionId, file.id)).bytes.toString(), 'Task search\nFind your work faster.');
  await assert.rejects(app.download(f.other, job.taskId, final.submissionId, file.id), { code: 'NOT_FOUND' });
  const task = await repository.read(repo => repo.get('task', job.taskId));
  assert.equal(task.assignment.id, job.assignmentId);
  assert.equal(task.assignment.operatorId, f.builder.user.id);
  assert.equal(task.submissions.length, 2);
});
