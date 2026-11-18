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

test('native PostgreSQL: Drive operations across competing tasks and restart', async (t) => {
  const config = readConfig(),
    database = 'relay_drive_budget_' + Date.now();
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
  const budget = require('../../src/drive-budget.cjs').driveBudget(6);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? first : second).repository.transaction('attempt-' + i, (repo) =>
        budget(repo, 'team', 1000),
      ),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === 'fulfilled').length, 6);
  assert.ok(
    outcomes
      .filter((r) => r.status === 'rejected')
      .every((r) => r.reason.code === 'DRIVE_WORKSPACE_LIMIT'),
  );
  await second.close();
  second = await openLocalPostgres(qa.runtime);
  await assert.rejects(
    second.repository.transaction('restart', (repo) =>
      budget(repo, 'team', 1001),
    ),
    { code: 'DRIVE_WORKSPACE_LIMIT' },
  );
  await second.repository.transaction('other', (repo) =>
    budget(repo, 'other', 1001),
  );
  await second.repository.transaction('reset', (repo) =>
    budget(repo, 'team', 3601000),
  );
  assert.equal(
    (await first.repository.read((repo) => repo.get('drive-usage', 'team')))
      .count,
    1,
  );
});
