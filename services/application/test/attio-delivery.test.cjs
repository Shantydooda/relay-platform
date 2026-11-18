'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const {
  createAttioDelivery,
  companyRows,
} = require('../src/attio-delivery.cjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');

test('CSV mapping rejects malformed, ambiguous, duplicate and oversized company data', () => {
  assert.deepEqual(
    companyRows(
      Buffer.from('company,website\nExample,https://www.example.com/about'),
    ),
    [{ domain: 'example.com', name: 'Example' }],
  );
  for (const text of [
    '',
    'company,website\nOne',
    'website,website\na.com,b.com',
    'website\nlocalhost',
    'website\na.com\nwww.a.com',
    'website\nhttps://user:pass@example.com',
  ])
    assert.throws(() => companyRows(Buffer.from(text)));
  assert.throws(() => companyRows(Buffer.alloc(256 * 1024 + 1)), {
    code: 'ATTIO_FILE_LIMIT',
  });
});
for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} Attio authorization, partial failure, concurrent retry and stale connection`, async (t) => {
    const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
    t.after(() => db.close());
    const repository = postgres
      ? await createPostgresRepository(db, { initialize: true })
      : createSqliteRepository(db);
    let clock = 1000,
      failSecond = true,
      role = 'owner';
    const actor = { user: { id: 'buyer' } },
      calls = [];
    const bytes = Buffer.from(
      'company,website\nFirst,first.com\nSecond,second.com',
    );
    const file = { id: 'file', filename: 'companies.csv', sha256: hash(bytes) };
    const task = {
      id: 'task',
      ownerId: 'buyer',
      tenantId: 'tenant',
      submissions: [{ id: 'submission', status: 'accepted', files: [file] }],
    };
    await repository.transaction('seed', async (repo) => {
      await repo.save('task', task);
      await repo.save('artifact', {
        id: 'file',
        ownerId: 'buyer',
        submissionId: 'submission',
      });
    });
    const app = createAttioDelivery({
      repository,
      now: () => clock,
      hash,
      localExecution: true,
      resolveActor: async () => ({
        memberships: [{ id: 'tenant', role, accessEpoch: 1 }],
      }),
      taskFor: (repo, user, id) => repo.get('task', id),
      verifiedBytes: () => bytes,
      attioProvider: {
        tenantId: 'tenant',
        workspaceLabel: 'Test CRM',
        assertCompany: async (row) => {
          calls.push(row.domain);
          if (row.domain === 'second.com' && failSecond)
            throw new Error('timeout');
          return { recordId: row.domain };
        },
      },
    });
    const prepare = () =>
      app.prepareAttio(actor, {
        taskId: 'task',
        submissionId: 'submission',
        fileId: 'file',
      });
    await assert.rejects(prepare(), { code: 'ATTIO_CONNECT' });
    await app.controlAttio(actor, { tenantId: 'tenant', action: 'connect' });
    let job = await prepare();
    const send = () =>
      app.sendAttio(actor, {
        id: job.id,
        consent: 'upsert-reviewed-companies',
      });
    await assert.rejects(app.sendAttio(actor, { id: job.id }), {
      code: 'CONSENT_REQUIRED',
    });
    assert.equal((await send()).status, 'sending');
    assert.equal((await send()).status, 'failed');
    assert.equal((await prepare()).completed, 1);
    const failedReceipt = (await app.attioDeliveries(actor, 'task'))
      .receipts[0];
    assert.equal(failedReceipt.completed, 1);
    assert.equal(failedReceipt.canContinue, false);
    assert.match(failedReceipt.blockedReason, /minute/);
    await assert.rejects(send(), { code: 'ATTIO_RETRY_WAIT' });
    clock += 60001;
    failSecond = false;
    const results = await Promise.all([send(), send()]);
    assert.ok(results.every((result) => result.status === 'sent'));
    assert.deepEqual(calls, ['first.com', 'second.com', 'second.com']);
    const callCount = calls.length;
    assert.equal(
      (await app.attioDeliveries(actor, 'task')).receipts[0].status,
      'sent',
    );
    assert.equal(
      calls.length,
      callCount,
      'receipt reads never contact provider',
    );
    role = 'member';
    await assert.rejects(app.attioDeliveries(actor, 'task'), {
      code: 'ADMIN_REQUIRED',
    });
    await assert.rejects(send(), { code: 'ADMIN_REQUIRED' });
    role = 'owner';
    await app.controlAttio(actor, { tenantId: 'tenant', action: 'disconnect' });
    await assert.rejects(send(), { code: 'ATTIO_CONNECT' });
    assert.equal(
      (await app.attioDeliveries(actor, 'task')).receipts[0].completed,
      2,
    );
    await app.controlAttio(actor, { tenantId: 'tenant', action: 'connect' });
    await assert.rejects(send(), { code: 'ATTIO_REVIEW_REQUIRED' });
    const fresh = await prepare();
    assert.notEqual(fresh.id, job.id);
    job = fresh;
    failSecond = true;
    assert.equal((await send()).completed, 1);
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await send()).status, 'failed');
      clock += 60001;
    }
    const beforeBlockedRetry = calls.length;
    await assert.rejects(send(), { code: 'ATTIO_RETRY_LIMIT' });
    assert.equal(calls.length, beforeBlockedRetry);
    const exhausted = (await app.attioDeliveries(actor, 'task')).receipts[0];
    assert.equal(exhausted.canContinue, false);
    assert.equal(exhausted.completed, 1);
    assert.match(exhausted.blockedReason, /Retry limit/);
    assert.equal(
      (await prepare()).id,
      job.id,
      'preparing again cannot reset the retry budget',
    );
    await repository.transaction('task', async (repo) => {
      task.submissions[0].status = 'ready';
      await repo.save('task', task);
    });
    await assert.rejects(prepare(), { code: 'ATTIO_DELIVERY' });
  });
