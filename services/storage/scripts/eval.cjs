'use strict';
// Explicit integration evaluation: requires installed ClamAV and official CVDs.
// EICAR is a harmless antivirus test string, never executable malware.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { clamScanner } = require('../src/scanner.cjs');
(async () => {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../../.poc-data/scanner.json'), 'utf8'));
  const scanner = clamScanner(config.executable, config);
  assert.equal((await scanner.scan(Buffer.from('name,city\nAcme,Paris\n'))).status, 'clean');
  const harmlessTest = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  assert.equal((await scanner.scan(harmlessTest)).status, 'blocked');
  assert.equal((await clamScanner(config.executable, { ...config, databaseDirectory: '/nonexistent/relay-cvd' }).scan(Buffer.from('hello'))).status, 'scan_error');
  assert.equal((await clamScanner(config.executable, { ...config, timeoutMs: 100 }).scan(Buffer.alloc(8 * 1024 * 1024, 'x'))).status, 'scan_error');
  const { DatabaseSync } = require('node:sqlite');
  const { mkdtempSync, rmSync } = require('node:fs');
  const { tmpdir } = require('node:os');
  const { join } = require('node:path');
  const { randomUUID } = require('node:crypto');
  const directory = mkdtempSync(join(tmpdir(), 'relay-real-clamav-eval-'));
  const db = new DatabaseSync(':memory:');
  try {
    const repository = require('../../application/src/repository.cjs').createSqliteRepository(db);
    const objectStore = require('../src/local-objects.cjs').localObjects(directory);
    const f = await require('../../application/test/helpers/supplier-workflow.cjs').fixture(repository, { objectStore, fileScanner: scanner });
    const job = await f.task();
    const claim = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
    await f.app.submit(f.principal, job.taskId, { leaseToken: claim.leaseToken, evidence: 'Harmless antivirus evaluation only', files: [
      { filename: 'clean.txt', mime: 'text/plain', base64: Buffer.from('Hello Relay').toString('base64') },
      { filename: 'antivirus-test.txt', mime: 'text/plain', base64: harmlessTest.toString('base64') }
    ] }, randomUUID());
    await f.app.reconcileFileScans();
    const detail = await f.app.detail(f.buyer, job.taskId), submission = detail.submissions[0];
    const clean = submission.files.find(file => file.filename === 'clean.txt');
    const blocked = submission.files.find(file => file.filename === 'antivirus-test.txt');
    assert.equal(clean.scan.status, 'clean');
    assert.equal(blocked.scan.status, 'blocked');
    assert.equal((await f.app.download(f.buyer, job.taskId, submission.id, clean.id)).bytes.toString(), 'Hello Relay');
    await assert.rejects(f.app.download(f.buyer, job.taskId, submission.id, blocked.id), { code: 'FILE_QUARANTINED' });
    await assert.rejects(f.app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', { submissionId: submission.id, expectedVersion: detail.task.version }, randomUUID()), { code: 'FILE_QUARANTINED' });
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  console.log('Real ClamAV evaluation passed: clean CSV, harmless EICAR detection, missing database, timeout, automatic application scanning and blocked download/acceptance.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
