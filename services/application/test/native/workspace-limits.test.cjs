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
const { createApplication } = require('../../src/service.cjs');

test('native PostgreSQL: shared workspace quota under repeated competing requests, replay and restart', async (t) => {
  const config = readConfig(),
    database = 'relay_workspace_test_' + randomUUID().replaceAll('-', '');
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
  let time = Date.now();
  const options = { now: () => time, conversationsPerHour: 60 };
  const apps = [first, second].map((connection) =>
    createApplication({ ...options, repository: connection.repository }),
  );
  const actor = (id) => ({
    user: { id, name: id },
    memberships: [
      { id: 'team', role: 'owner' },
      { id: 'other', role: 'owner' },
    ],
  });
  const body = {
    tenantId: 'team',
    title: 'Load sample',
    brief: 'A disposable request',
  };
  const accepted = [],
    latencies = [],
    rejected = [];
  const start = performance.now();
  for (let batch = 0; batch < 40; batch++) {
    await Promise.all(
      Array.from({ length: 8 }, async (_, i) => {
        const key = randomUUID(),
          member = actor('member-' + (i % 2)),
          began = performance.now();
        try {
          const result = await apps[i % 2].createTask(member, body, key);
          accepted.push({ key, member, result });
        } catch (error) {
          rejected.push(error.code);
        }
        latencies.push(performance.now() - began);
      }),
    );
    // Exercise a second tenant during the busy tenant's workload.
    if (batch === 20)
      await apps[1].createTask(
        actor('other-member'),
        { ...body, tenantId: 'other' },
        randomUUID(),
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(accepted.length, 60);
  assert.equal(rejected.length, 260);
  assert.ok(rejected.every((code) => code === 'WORKSPACE_REQUEST_LIMIT'));
  for (const item of accepted.slice(0, 8))
    assert.deepEqual(
      await apps[1].createTask(item.member, body, item.key),
      item.result,
    );
  assert.equal(
    (
      await first.repository.read((repo) =>
        repo.get('workspace-creation-usage', 'team'),
      )
    ).count,
    60,
  );
  assert.equal(
    (
      await first.repository.read((repo) =>
        repo.list('task', 'tenant_id', 'team'),
      )
    ).length,
    60,
  );
  await second.close();
  second = await openLocalPostgres(qa.runtime);
  const restarted = createApplication({
    ...options,
    repository: second.repository,
  });
  await assert.rejects(
    restarted.createTask(actor('member-0'), body, randomUUID()),
    { code: 'WORKSPACE_REQUEST_LIMIT' },
  );
  time += 3600000;
  await restarted.createTask(actor('member-0'), body, randomUUID());
  latencies.sort((a, b) => a - b);
  t.diagnostic(
    JSON.stringify({
      requests: latencies.length,
      elapsedMs: Math.round(performance.now() - start),
      accepted: accepted.length,
      limited: rejected.length,
      p50Ms: Math.round(latencies[159]),
      p95Ms: Math.round(latencies[303]),
      maxMs: Math.round(latencies.at(-1)),
    }),
  );
});
