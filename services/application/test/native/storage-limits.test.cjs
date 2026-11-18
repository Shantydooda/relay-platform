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

test('native PostgreSQL: storage admission across competing uploads and restart', async (t) => {
  const config = readConfig(),
    database = 'relay_storage_test_' + randomUUID().replaceAll('-', '');
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
  const admit = require('../../src/storage-limits.cjs').storageAdmission(60);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) => {
      const repository = i % 2 ? first.repository : second.repository;
      return repository.transaction('upload-' + i, async (repo) => {
        await admit(repo, 'team', 10);
        await repo.save('artifact', {
          id: randomUUID(),
          ownerId: 'owner',
          tenantId: 'team',
          size: 10,
        });
      });
    }),
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 6);
  assert.ok(
    outcomes
      .filter((r) => r.status === 'rejected')
      .every((r) => r.reason.code === 'WORKSPACE_STORAGE_LIMIT'),
  );
  await second.close();
  second = await openLocalPostgres(qa.runtime);
  await assert.rejects(
    second.repository.transaction('restarted', (repo) =>
      admit(repo, 'team', 1),
    ),
    { code: 'WORKSPACE_STORAGE_LIMIT' },
  );
  await second.repository.transaction('other', (repo) =>
    admit(repo, 'other', 60),
  );
  const saved = await first.repository.read((repo) =>
    repo.list('artifact', 'tenant_id', 'team'),
  );
  assert.equal(
    saved.reduce((sum, item) => sum + item.size, 0),
    60,
  );
});
