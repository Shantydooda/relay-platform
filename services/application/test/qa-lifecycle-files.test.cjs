'use strict';

// Adversarial QA: delivered-file quarantine, scan workflow and type boundaries,
// for both object storage (scanned) and inline storage (pilot-style).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { localObjects } = require('../../storage/src/local-objects.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');

async function setup(t, { stored = true, verdict = { status: 'clean', reason: 'fixture' }, autoAcceptAfterMs } = {}) {
  const db = new DatabaseSync(':memory:');
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-qa-life-'));
  t.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const repository = createSqliteRepository(db);
  const scanner = { name: 'qa fixture', verdict, scan: async () => scanner.verdict };
  const options = stored ? { objectStore: localObjects(root), fileScanner: scanner } : {};
  if (autoAcceptAfterMs) options.autoAcceptAfterMs = autoAcceptAfterMs;
  const f = await fixture(repository, options);
  const job = await f.task();
  const { leaseToken } = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID());
  const version = async () => (await f.app.detail(f.buyer, job.taskId)).task.version;
  const submit = files => f.app.submit(f.principal, job.taskId, { leaseToken, evidence: 'QA delivery.', files }, randomUUID());
  return { ...f, repository, job, scanner, version, submit };
}
const file = (filename, body = 'hello', mime = 'text/plain') => ({ filename, mime, base64: Buffer.from(body).toString('base64') });

test('object storage: download, preview and accept are refused while quarantined or scanning, allowed once clean', async t => {
  const s = await setup(t);
  const { submissionId } = await s.submit([file('result.txt')]);
  const fileId = (await s.app.detail(s.buyer, s.job.taskId)).submissions[0].files[0].id;
  const accept = async () => s.app.reviewDelivery(s.buyer, s.job.taskId, 'accept-delivery', { expectedVersion: await s.version(), submissionId }, randomUUID());
  await assert.rejects(s.app.download(s.buyer, s.job.taskId, submissionId, fileId), { code: 'FILE_QUARANTINED' });
  await assert.rejects(s.app.previewFile(s.buyer, s.job.taskId, submissionId, fileId), { code: 'FILE_QUARANTINED' });
  await assert.rejects(accept(), { code: 'FILE_QUARANTINED' });
  const actions = (await s.app.detail(s.buyer, s.job.taskId)).actions.execution;
  assert.equal(actions.accept.allowed, false);
  await s.app.reconcileFileScans();
  assert.equal((await s.app.download(s.buyer, s.job.taskId, submissionId, fileId)).bytes.toString(), 'hello');
  await accept();
});

test('object storage: auto-accept never accepts a quarantined delivery', async t => {
  const s = await setup(t, { autoAcceptAfterMs: 1000, verdict: { status: 'quarantined', reason: 'pending' } });
  await s.submit([file('result.txt')]);
  s.advance(5000);
  const result = await s.app.reconcileAutoAccept();
  assert.equal(result.changed, 0);
  assert.equal((await s.app.detail(s.buyer, s.job.taskId)).task.execution?.status ?? (await s.repository.read(repo => repo.get('task', s.job.taskId))).assignment.status, 'buyer_review');
});

test('object storage: extension must match the declared type', async t => {
  const s = await setup(t);
  for (const name of ['page.html', 'run.bat', 'image.svg', 'notes.txt.exe'])
    await assert.rejects(s.submit([file(name)]), { code: 'INVALID_FILE' }, name);
});

test('inline storage: delivered filename extension must match the declared type', { todo: 'BUG-LIFE-2: without an object store, submit accepts any extension (e.g. .html, .bat, .exe) for a text/plain file; download serves it as an attachment with that name' }, async t => {
  const s = await setup(t, { stored: false });
  for (const name of ['page.html', 'run.bat', 'invoice.exe'])
    await assert.rejects(s.submit([file(name, '<script>alert(1)</script>')]), { code: 'INVALID_FILE' }, name);
});

test('a scan request on an already-clean file must not put it back into quarantine', { todo: 'BUG-LIFE-3: scanFile on a clean artifact resets it to quarantined, so the builder (or buyer) can re-block download and acceptance of a cleared delivery' }, async t => {
  const s = await setup(t);
  const { submissionId } = await s.submit([file('result.txt')]);
  const fileId = (await s.app.detail(s.buyer, s.job.taskId)).submissions[0].files[0].id;
  await s.app.reconcileFileScans();
  await s.app.download(s.buyer, s.job.taskId, submissionId, fileId);
  // The supplier asks for a "rescan" of the cleared file.
  await s.app.scanFile(s.builder, s.job.taskId, submissionId, fileId, {}, randomUUID());
  await s.app.download(s.buyer, s.job.taskId, submissionId, fileId);
});

test('scan of a file from a different task or submission is NOT_FOUND', async t => {
  const s = await setup(t);
  const { submissionId } = await s.submit([file('result.txt')]);
  const fileId = (await s.app.detail(s.buyer, s.job.taskId)).submissions[0].files[0].id;
  await assert.rejects(s.app.scanFile(s.builder, s.job.taskId, randomUUID(), fileId, {}, randomUUID()), { code: 'NOT_FOUND' });
  await assert.rejects(s.app.download(s.buyer, s.job.taskId, submissionId, randomUUID()), { code: 'NOT_FOUND' });
});
