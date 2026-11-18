'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { filePreview, PREVIEW_CHARACTERS } = require('../src/file-preview.cjs');
const { fixture } = require('./fixtures/payment-fixture.cjs');

test('bounded text previews never interpret markup and preserve original hash', () => {
  const bytes = Buffer.from('<script>alert("test")</script>\n' + 'x'.repeat(20000));
  const preview = filePreview({ filename: 'notes.txt', mime: 'text/plain', bytes, sha256: 'original-hash' });
  assert.equal(preview.text.length, PREVIEW_CHARACTERS);
  assert.equal(preview.truncated, true);
  assert.ok(preview.text.startsWith('<script>'));
  assert.equal(preview.sha256, 'original-hash');
  assert.match(preview.notice, /not a malware scan/);
  const json = filePreview({ filename: 'report.json', mime: 'application/json', bytes: Buffer.from('{"rows":2}'), sha256: 'json-hash' });
  assert.equal(json.formatted, true); assert.match(json.text, /\n/);
  assert.equal(filePreview({ filename: 'bad.json', mime: 'application/json', bytes: Buffer.from('not JSON') }).formatted, false);
  assert.throws(() => filePreview({ mime: 'text/html', bytes }), { code: 'PREVIEW_UNSUPPORTED' });
  assert.throws(() => filePreview({ mime: 'text/plain', bytes: Buffer.from([255]) }), { code: 'PREVIEW_UNAVAILABLE' });
});
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: preview uses exact delivery authorization and refuses corrupted bytes or metadata`, async t => {
    const f = await fixture(t, adapter);
    const submissionId = randomUUID(), fileId = randomUUID(), bytes = Buffer.from('company,city\nAcme,Paris\n');
    const metadata = { id: fileId, filename: 'result.csv', mime: 'text/csv', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    await f.repository.transaction('fixture-delivery', async repo => {
      const task = await repo.get('task', f.taskId);
      task.assignment = { operatorId: f.builder.user.id, status: 'buyer_review' };
      task.submissions = [{ id: submissionId, version: 1, status: 'ready', files: [metadata] }];
      await repo.save('task', task);
      await repo.save('artifact', { ...metadata, ownerId: f.buyer.user.id, taskId: f.taskId, submissionId, base64: bytes.toString('base64') });
    });
    const preview = await f.app.previewFile(f.buyer, f.taskId, submissionId, fileId);
    assert.equal(preview.text, bytes.toString());
    assert.equal((await f.app.previewFile(f.builder, f.taskId, submissionId, fileId)).sha256, metadata.sha256);
    await assert.rejects(f.app.previewFile(f.stranger, f.taskId, submissionId, fileId), { code: 'NOT_FOUND' });
    await assert.rejects(f.app.previewFile(f.buyer, f.taskId, randomUUID(), fileId), { code: 'NOT_FOUND' });
    await f.repository.transaction('corrupt', async repo => { const a = await repo.get('artifact', fileId); a.base64 = Buffer.from('changed').toString('base64'); await repo.save('artifact', a); });
    await assert.rejects(f.app.previewFile(f.buyer, f.taskId, submissionId, fileId), { code: 'FILE_UNAVAILABLE' });
    await f.repository.transaction('wrong-type', async repo => { const a = await repo.get('artifact', fileId); a.base64 = bytes.toString('base64'); a.mime = 'text/html'; await repo.save('artifact', a); });
    await assert.rejects(f.app.previewFile(f.buyer, f.taskId, submissionId, fileId), { code: 'FILE_UNAVAILABLE' });
    await assert.rejects(f.app.reviewDelivery(f.buyer, f.taskId, 'accept-delivery', { expectedVersion: (await f.get()).version, submissionId }, randomUUID()), { code: 'FILE_UNAVAILABLE' });
  });
}
