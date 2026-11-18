'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
test('workspace limit is shared, durable, replay-safe and resets without blocking existing work', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  let time = 1000;
  const options = {
    repository,
    now: () => time,
    localExecution: true,
    conversationsPerHour: 2,
  };
  const actor = (id) => ({
    user: { id, name: id },
    memberships: [{ id: 'team', role: 'owner' }],
  });
  const body = { tenantId: 'team', title: 'Test', brief: 'A test task' };
  let app = createApplication(options);
  const key = randomUUID(),
    one = await app.createTask(actor('a'), body, key);
  const result = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      app.createTask(actor('b'), body, randomUUID()),
    ),
  );
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(
    result
      .filter((r) => r.status === 'rejected')
      .every((r) => r.reason.code === 'WORKSPACE_REQUEST_LIMIT'),
  );
  app = createApplication(options);
  assert.deepEqual(await app.createTask(actor('a'), body, key), one);
  await assert.rejects(app.createTask(actor('a'), body, randomUUID()), {
    code: 'WORKSPACE_REQUEST_LIMIT',
  });
  await app.mutateTask(
    actor('a'),
    one.taskId,
    'messages',
    { expectedVersion: 1, body: 'Still usable' },
    randomUUID(),
  );
  time += 3600000;
  await app.createTask(actor('b'), body, randomUUID());
  const usage = await repository.read((repo) =>
    repo.get('workspace-creation-usage', 'team'),
  );
  assert.equal(usage.count, 1);
});
test('failed authorization and invalid input do not charge workspace usage', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const app = createApplication({ repository, conversationsPerHour: 1 });
  const actor = {
    user: { id: 'a', name: 'A' },
    memberships: [{ id: 'team', role: 'owner' }],
  };
  await assert.rejects(
    app.createTask(
      actor,
      { tenantId: 'other', title: 'Test', brief: 'test' },
      randomUUID(),
    ),
  );
  await assert.rejects(
    app.createTask(
      actor,
      { tenantId: 'team', title: '', brief: 'test' },
      randomUUID(),
    ),
  );
  assert.equal(
    await repository.read((repo) =>
      repo.get('workspace-creation-usage', 'team'),
    ),
    null,
  );
  await app.createTask(
    actor,
    { tenantId: 'team', title: 'Test', brief: 'test' },
    randomUUID(),
  );
});

test('receipt failure rolls back the task and its quota charge', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const failing = {
    ...repository,
    transaction: (key, work) =>
      repository.transaction(key, (repo) =>
        work({
          ...repo,
          saveReceipt: async () => {
            throw new Error('Injected receipt failure');
          },
        }),
      ),
  };
  const actor = {
    user: { id: 'a', name: 'A' },
    memberships: [{ id: 'team', role: 'owner' }],
  };
  const body = { tenantId: 'team', title: 'Test', brief: 'test' };
  await assert.rejects(
    createApplication({
      repository: failing,
      conversationsPerHour: 1,
    }).createTask(actor, body, randomUUID()),
    /Injected receipt failure/,
  );
  assert.equal(
    await repository.read((repo) =>
      repo.get('workspace-creation-usage', 'team'),
    ),
    null,
  );
  assert.deepEqual(await repository.read((repo) => repo.scan('task')), []);
  await createApplication({ repository, conversationsPerHour: 1 }).createTask(
    actor,
    body,
    randomUUID(),
  );
});
