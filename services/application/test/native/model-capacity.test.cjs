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

test('native PostgreSQL: shared model capacity, restart, expiry and stale release', async (t) => {
  const config = readConfig(),
    database = 'relay_model_capacity_' + Date.now();
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

  const {
    claimCapacity,
    ownsCapacity,
    releaseCapacity,
  } = require('../../src/model-capacity.cjs');
  const candidates = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      (i % 2 ? first : second).repository.transaction(`job:${i}`, (repo) =>
        claimCapacity(repo, `job-${i}`, 1000),
      ),
    ),
  );
  const leases = candidates.filter(Boolean);
  assert.equal(leases.length, 1);
  await first.close();
  first = await openLocalPostgres(qa.runtime);
  assert.equal(
    await first.repository.transaction('after-restart', (repo) =>
      claimCapacity(repo, 'next', 2000),
    ),
    null,
  );
  const replacement = await second.repository.transaction('expired', (repo) =>
    claimCapacity(repo, 'replacement', 181000),
  );
  assert.ok(replacement);
  assert.equal(
    await first.repository.read((repo) =>
      ownsCapacity(repo, leases[0], 181001),
    ),
    false,
  );
  await releaseCapacity(first.repository, leases[0]);
  assert.equal(
    await second.repository.read((repo) =>
      ownsCapacity(repo, replacement, 181001),
    ),
    true,
  );
  await releaseCapacity(second.repository, replacement);
  assert.ok(
    await first.repository.transaction('released', (repo) =>
      claimCapacity(repo, 'last', 181002),
    ),
  );
  await require('../helpers/model-fairness.cjs').exerciseFairness(
    first.repository,
    second.repository,
  );
});
