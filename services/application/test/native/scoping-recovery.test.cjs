'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  readConfig,
  adminPool,
  migrateLocal,
} = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');

test('native PostgreSQL: restart and competing scoping recovery workers claim once', async (t) => {
  const config = readConfig(),
    database = 'relay_scoping_recovery_' + Date.now();
  const admin = adminPool(config);
  let first, second;
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  t.after(async () => {
    await first?.close();
    await second?.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  });
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = {
    ...config,
    runtime: { ...config.runtime, database },
    migrator: { ...config.migrator, database },
  };
  await migrateLocal(qa);
  first = await openLocalPostgres(qa.runtime);
  second = await openLocalPostgres(qa.runtime);

  const { createApplication } = require('../../src/service.cjs');
  const actor = {
    user: { id: randomUUID() },
    memberships: [{ id: randomUUID(), role: 'owner' }],
  };
  let calls = 0;
  const provider = {
    async propose() {
      calls++;
      throw new Error('fixture provider unavailable');
    },
  };
  const options = {
    scopingProvider: provider,
    resolveActor: async () => actor,
  };
  const a = createApplication({ ...options, repository: first.repository });
  const { taskId } = await a.createTask(
    actor,
    {
      tenantId: actor.memberships[0].id,
      title: 'Recovery fixture',
      brief: 'Research supplied material',
    },
    randomUUID(),
  );
  const jobId = randomUUID();
  await first.repository.transaction('seed', async (repo) => {
    const task = await repo.get('task', taskId);
    task.scoping = {
      id: jobId,
      status: 'pending',
      version: task.version,
      expiresAt: Date.now() + 180000,
    };
    await repo.save('task', task);
    await repo.save('scoping-job', {
      id: jobId,
      ownerId: actor.user.id,
      taskId,
      status: 'pending',
      version: task.version,
      expiresAt: task.scoping.expiresAt,
      snapshot: { title: task.title, brief: task.brief, messages: [] },
    });
  });
  await first.close();
  first = await openLocalPostgres(qa.runtime);
  const recovered = createApplication({
    ...options,
    repository: first.repository,
  });
  const competitor = createApplication({
    ...options,
    repository: second.repository,
  });
  await Promise.all([
    recovered.reconcileScoping(),
    competitor.reconcileScoping(),
  ]);
  await Promise.all([recovered.waitForScoping(), competitor.waitForScoping()]);
  assert.equal(calls, 1);
  assert.equal(
    (await recovered.detail(actor, taskId)).task.scoping.status,
    'failed',
  );
  assert.equal(
    (await first.repository.read((r) => r.get('scoping-job', jobId))).snapshot,
    undefined,
  );
});
