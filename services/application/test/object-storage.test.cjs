'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { localObjects } = require('../../storage/src/local-objects.cjs');
const { snapshotObjects, verifyObjects } = require('../../storage/src/backup.cjs');
const { clamScanner } = require('../../storage/src/scanner.cjs');
const { validateType } = require('../../storage/src/types.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');

test('private objects survive restart and verified restore; traversal, symlinks and corruption fail closed', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-objects-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = localObjects(join(root, 'objects')), bytes = Buffer.alloc(1024 * 1024, 'x');
  const key = store.put(bytes); assert.equal(store.put(bytes), key);
  assert.deepEqual(localObjects(store.root).read(key), bytes);
  assert.throws(() => store.read('../secret'));
  const manifest = snapshotObjects(store.root, join(root, 'backup'));
  verifyObjects(join(root, 'backup'), manifest);
  fs.unlinkSync(join(store.root, key)); assert.throws(() => store.read(key));
  const recovered = localObjects(join(root, 'recovered'));
  assert.equal(recovered.put(localObjects(join(root, 'backup')).read(key)), key);
  assert.deepEqual(recovered.read(key), bytes);
  fs.writeFileSync(join(root, 'backup', key), 'corrupt');
  assert.throws(() => verifyObjects(join(root, 'backup'), manifest));
  fs.symlinkSync(join(recovered.root, key), join(store.root, key));
  assert.throws(() => store.read(key));
});

test('larger delivery stays quarantined until scanning; blocked/missing bytes cannot download or be accepted', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-delivery-store-')), db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const repository = createSqliteRepository(db), objectStore = localObjects(root);
  let verdict = 'scan_error';
  const fileScanner = { name: 'explicit test fixture', scan: async () => ({ status: verdict, reason: `Fixture verdict: ${verdict}` }) };
  const f = await fixture(repository, { objectStore, fileScanner });
  const job = await f.task(), claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  const bytes = Buffer.alloc(1024 * 1024, 'a');
  const submission = await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'One MiB fixture', files: [{ filename: 'large.txt', mime: 'text/plain', base64: bytes.toString('base64') }] }, randomUUID());
  const detail = () => f.app.detail(f.buyer, job.taskId);
  const file = (await detail()).submissions[0].files[0];
  const artifact = await repository.read(repo => repo.get('artifact', file.id));
  assert.equal(artifact.base64, undefined); assert.equal(artifact.objectKey, file.sha256);
  const download = () => f.app.download(f.buyer, job.taskId, submission.submissionId, file.id);
  const accept = async () => f.app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', { expectedVersion: (await detail()).task.version, submissionId: submission.submissionId }, randomUUID());
  const scan = async () => { await f.app.scanFile(f.builder, job.taskId, submission.submissionId, file.id, {}, randomUUID()); await f.app.reconcileFileScans(); };
  await assert.rejects(download(), { code: 'FILE_QUARANTINED' });
  await assert.rejects(accept(), { code: 'FILE_QUARANTINED' });
  await assert.rejects(f.app.scanFile(f.other, job.taskId, submission.submissionId, file.id, {}, randomUUID()), { code: 'NOT_FOUND' });
  await scan(); await assert.rejects(download(), { code: 'FILE_QUARANTINED' });
  verdict = 'clean'; await scan(); assert.deepEqual((await download()).bytes, bytes);
  const backup = join(root, 'safe-copy'); snapshotObjects(root, backup);
  fs.unlinkSync(join(root, artifact.objectKey));
  await assert.rejects(download(), { code: 'FILE_UNAVAILABLE' });
  await assert.rejects(accept(), { code: 'FILE_UNAVAILABLE' });
  objectStore.put(localObjects(backup).read(artifact.objectKey));
  verdict = 'blocked'; await scan(); await assert.rejects(download(), { code: 'FILE_QUARANTINED' });
  verdict = 'clean'; await assert.rejects(scan(), { code: 'FILE_BLOCKED' });
});

test('unconfigured scanner never reports clean and declared binary types require signatures', async () => {
  assert.equal((await clamScanner().scan(Buffer.from('safe-looking'))).status, 'quarantined');
  assert.equal((await clamScanner('/nonexistent/relay-scanner').scan(Buffer.from('data'))).status, 'scan_error');
  assert.throws(() => validateType('file.pdf', 'application/pdf', Buffer.from('not a PDF')), { code: 'INVALID_FILE' });
  assert.throws(() => validateType('file.html', 'text/plain', Buffer.from('text')), { code: 'INVALID_FILE' });
  validateType('file.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nfixture'));
});

test('automatic scans release transaction locks, fence competing workers and recover expired claims', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-scan-worker-')), db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const repository = createSqliteRepository(db), objectStore = localObjects(root);
  let finishScan, entered, calls = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const fileScanner = { name: 'controlled test', scan: async () => {
    calls++; entered();
    return new Promise(resolve => { finishScan = resolve; });
  } };
  const f = await fixture(repository, { objectStore, fileScanner });
  const job = await f.task(), claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Controlled test', files: [{ filename: 'result.txt', mime: 'text/plain', base64: Buffer.from('hello').toString('base64') }] }, randomUUID());
  const first = f.app.reconcileFileScans(); await started;
  const detail = await f.app.detail(f.buyer, job.taskId);
  assert.equal(detail.submissions[0].files[0].scan.status, 'scanning');
  await f.app.reconcileFileScans(); assert.equal(calls, 1);
  const file = detail.submissions[0].files[0], submission = detail.submissions[0];
  await assert.rejects(f.app.download(f.buyer, job.taskId, submission.id, file.id), { code: 'FILE_QUARANTINED' });
  // A restarted service cannot take a live lease, but can reclaim an expired one.
  f.advance(120001);
  const recoveryTime = Date.now() + 120001;
  const restarted = require('../src/service.cjs').createApplication({ repository, objectStore, fileScanner, now: () => recoveryTime });
  const oldFinish = finishScan;
  const second = restarted.reconcileFileScans();
  while (calls < 2) await new Promise(resolve => setImmediate(resolve));
  finishScan({ status: 'blocked', reason: 'test blocked' }); await second;
  oldFinish({ status: 'clean', reason: 'stale clean' }); await first;
  assert.equal((await f.app.detail(f.buyer, job.taskId)).submissions[0].files[0].scan.status, 'blocked');
  await f.app.reconcileFileScans(); assert.equal(calls, 2);
});

test('automatic scanner failures back off durably and recover without a user retry', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-scan-retry-')), db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const repository = createSqliteRepository(db), objectStore = localObjects(root);
  let calls = 0;
  const f = await fixture(repository, { objectStore, fileScanner: { name:'test', scan: async () => ({ status: ++calls === 1 ? 'scan_error' : 'clean', reason: 'test' }) } });
  const job = await f.task(), claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence:'test', files:[{filename:'result.txt',mime:'text/plain',base64:Buffer.from('hello').toString('base64')}] }, randomUUID());
  await f.app.reconcileFileScans(); await f.app.reconcileFileScans(); assert.equal(calls, 1);
  f.advance(10001); await f.app.reconcileFileScans();
  assert.equal((await f.app.detail(f.buyer, job.taskId)).submissions[0].files[0].scan.status,'clean');
  assert.equal(calls,2);
});

test('scanner rejects a zero exit without an explicit complete clean report', async t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-scanner-adapter-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const executable = join(root, 'scanner');
  fs.writeFileSync(executable, '#!/bin/sh\ncat >/dev/null\nexit 0\n', { mode: 0o700 });
  assert.equal((await clamScanner(executable).scan(Buffer.from('data'))).status, 'scan_error');
  fs.writeFileSync(executable, '#!/bin/sh\ncat >/dev/null\nprintf "stdin: OK\\n"\n');
  assert.equal((await clamScanner(executable).scan(Buffer.from('data'))).status, 'clean');
  fs.writeFileSync(executable, '#!/bin/sh\ncat >/dev/null\nprintf "stdin: OK\\n"\nprintf "scan skipped\\n" >&2\n');
  assert.equal((await clamScanner(executable).scan(Buffer.from('data'))).status, 'scan_error');
});
