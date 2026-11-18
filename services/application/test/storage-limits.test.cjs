'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');
const { storageAdmission } = require('../src/storage-limits.cjs');

test('delivery capacity rejects before object writes, preserves prior downloads and allows retry after capacity changes', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const f = await fixture(repository, { storageLimitBytes: 5 });
  const one = await f.task(),
    claim = await f.app.claim(
      f.principal,
      one.taskId,
      { assignmentId: one.assignmentId },
      randomUUID(),
    );
  const body = {
    leaseToken: claim.leaseToken,
    evidence: 'Fixture',
    files: [
      {
        filename: 'result.txt',
        mime: 'text/plain',
        base64: Buffer.from('hello').toString('base64'),
      },
    ],
  };
  const key = randomUUID();
  const delivery = await f.app.submit(f.principal, one.taskId, body, key);
  assert.deepEqual(
    await f.app.submit(f.principal, one.taskId, body, key),
    delivery,
  );
  const two = await f.task(),
    second = await f.app.claim(
      f.principal,
      two.taskId,
      { assignmentId: two.assignmentId },
      randomUUID(),
    );
  let writes = 0;
  const options = {
    repository,
    localExecution: true,
    storageLimitBytes: 5,
    objectStore: {
      put: () => {
        writes++;
        return 'unused';
      },
    },
  };
  const app = require('../src/service.cjs').createApplication(options);
  const secondBody = { ...body, leaseToken: second.leaseToken };
  await assert.rejects(
    app.submit(f.principal, two.taskId, secondBody, randomUUID()),
    { code: 'WORKSPACE_STORAGE_LIMIT' },
  );
  assert.equal(writes, 0);
  const detail = await f.app.detail(f.buyer, one.taskId),
    file = detail.submissions[0].files[0];
  assert.equal(
    (
      await f.app.download(f.buyer, one.taskId, delivery.submissionId, file.id)
    ).bytes.toString(),
    'hello',
  );
  const recovered = require('../src/service.cjs').createApplication({
    repository,
    localExecution: true,
    storageLimitBytes: 10,
  });
  await recovered.submit(f.principal, two.taskId, secondBody, randomUUID());
});

test('storage admission includes legacy artifacts and rollback releases capacity', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db),
    admit = storageAdmission(10);
  const artifact = {
    id: 'legacy',
    ownerId: 'owner',
    tenantId: 'team',
    size: 6,
    base64: 'fixture',
  };
  await repository.transaction('seed', (repo) =>
    repo.save('artifact', artifact),
  );
  await assert.rejects(
    repository.transaction('test', (repo) => admit(repo, 'team', 5)),
    { code: 'WORKSPACE_STORAGE_LIMIT' },
  );
  await assert.rejects(
    repository.transaction('test', async (repo) => {
      await admit(repo, 'team', 4);
      await repo.save('artifact', { ...artifact, id: 'rollback', size: 4 });
      throw new Error('Injected failure');
    }),
    /Injected failure/,
  );
  await repository.transaction('test', async (repo) => {
    await admit(repo, 'team', 4);
    await repo.save('artifact', { ...artifact, id: 'valid', size: 4 });
  });
  await repository.transaction('other', (repo) => admit(repo, 'other', 10));
});

test('full storage leaves input scope unchanged and pauses scheduled input copies', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const f = await require('./helpers/recurring.cjs').recurringFixture(
    repository,
  );
  await f.create();
  const app = require('../src/service.cjs').createApplication({
    ...f.options,
    storageLimitBytes: 1,
  });
  const draft = await app.createTask(
    f.buyer,
    {
      tenantId: f.buyer.memberships[0].id,
      title: 'Input test',
      brief: 'Normalize CSV',
    },
    randomUUID(),
  );
  await assert.rejects(
    app.addInput(
      f.buyer,
      draft.taskId,
      {
        expectedVersion: 1,
        filename: 'test.csv',
        base64: Buffer.from('name\nExample\n').toString('base64'),
        notes: 'Keep these notes',
      },
      randomUUID(),
    ),
    { code: 'WORKSPACE_STORAGE_LIMIT' },
  );
  assert.equal((await app.detail(f.buyer, draft.taskId)).task.version, 1);
  f.setTime('2026-10-29T09:00Z');
  await app.reconcileSchedules();
  const schedule = (await app.listSchedules(f.buyer, f.buyer.memberships[0].id))
    .schedules[0];
  assert.equal(schedule.status, 'paused');
  assert.equal(schedule.runCount, 0);
});
