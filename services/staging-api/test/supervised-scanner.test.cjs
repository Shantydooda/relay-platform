'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID, createHash } = require('node:crypto');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { fixture } = require('../../application/test/helpers/supplier-workflow.cjs');
const { startSupervisedScanner, verifyScanner } = require('../../pilot-api/src/supervised-scanner.cjs');

test('scanner startup refuses unavailable or ineffective threat detection', async () => {
  await assert.rejects(verifyScanner({ scan: async () => ({ status: 'scan_error' }) }), /CLEAN_SELF_TEST/);
  await assert.rejects(verifyScanner({ scan: async () => ({ status: 'clean' }) }), /DETECTION_SELF_TEST/);
  let called = false;
  await assert.rejects(startSupervisedScanner({ objectStore: { verifyBucket: async () => { throw new Error('public bucket'); } },
    fileScanner: { scan: async () => { called = true; } } }), /public bucket/);
  assert.equal(called, false);
});
test('supervised worker resumes quarantined pilot files without creating execution or changing ownership', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = createSqliteRepository(db), objects = new Map();
  const objectStore = {
    verifyBucket: async () => {},
    put: async bytes => { const key = createHash('sha256').update(bytes).digest('hex'); objects.set(key, bytes); return key; },
    read: async key => objects.get(key),
  };
  const scanner = { name: 'explicit test scanner', scan: async bytes => ({ status: bytes.toString().includes('EICAR') ? 'blocked' : 'clean' }) };
  const f = await fixture(repository, { objectStore, fileScanner: scanner });
  const job = await f.task();
  const claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  const result = await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Supervised worker fixture',
    files: [{ filename: 'report.txt', mime: 'text/plain', base64: Buffer.from('A delivery').toString('base64') }] }, randomUUID());
  const before = await f.app.detail(f.buyer, job.taskId), file = before.submissions[0].files[0];
  const download = () => f.app.download(f.buyer, job.taskId, result.submissionId, file.id);
  await assert.rejects(download(), { code: 'FILE_QUARANTINED' });
  const worker = await startSupervisedScanner({ repository, objectStore, fileScanner: scanner,
    workerOptions: { schedule: () => 1, unschedule() {} } });
  t.after(() => worker.stop());
  await worker.done();
  assert.equal(worker.health().status, 'healthy');
  assert.equal((await download()).bytes.toString(), 'A delivery');
  const stored = await repository.read(repo => repo.get('task', job.taskId));
  assert.equal(stored.assignment.id, job.assignmentId);
  assert.equal(stored.ownerId, f.buyer.user.id);
  worker.stop(); await worker.done();
  assert.equal(worker.health().status, 'stopped');
});
test('supervised configuration rejects missing keys and shared-readable credential files', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { supervisedConfig } = require('../../pilot-api/src/supervised-config.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-pilot-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, 'render.env'), 'RELAY_ENVIRONMENT=private-pilot\n', { mode: 0o600 });
  const file = path.join(directory, 'storage-secret.txt');
  fs.writeFileSync(file, '', { mode: 0o600 });
  assert.throws(() => supervisedConfig(directory), /STORAGE_SECRET/);
  fs.writeFileSync(file, 'fixture-only'); fs.chmodSync(file, 0o644);
  assert.throws(() => supervisedConfig(directory), /PRIVATE_PILOT_FILE/);
  fs.unlinkSync(file); fs.symlinkSync(path.join(directory, 'render.env'), file);
  assert.throws(() => supervisedConfig(directory), /PRIVATE_PILOT_FILE/);
});
