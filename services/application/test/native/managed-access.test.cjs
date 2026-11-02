'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
const {
  readConfig,
  adminPool,
  migrateLocal,
} = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createAccessBoundary } = require('../../src/access-boundary.cjs');
const {
  createMembershipAuthority,
} = require('../../../staging-api/src/membership-authority.cjs');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
test(
  'native managed access: two pools order active work, revocation and fresh generations',
  { timeout: 30000 },
  async (t) => {
    const config = readConfig(),
      database = 'relay_membership_source_' + randomUUID().replaceAll('-', ''),
      admin = adminPool(config);
    let first, second;
    await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
    t.after(async () => {
      await first?.close();
      await second?.close();
      try {
        await admin.query(`DROP DATABASE ${database}`);
      } finally {
        await admin.end();
      }
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
    const b1 = createAccessBoundary(first.repository),
      b2 = createAccessBoundary(second.repository);
    const a1 = createMembershipAuthority({
        repository: b1.repository,
        boundary: b1,
      }),
      a2 = createMembershipAuthority({
        repository: b2.repository,
        boundary: b2,
      });
    const userId = randomUUID(),
      tenantId = randomUUID(),
      snapshot = {
        userId,
        revision: 1,
        expiresAt: Date.now() + 300000,
        memberships: [
          { id: tenantId, role: 'approver', company: true, accessEpoch: 1 },
        ],
      };
    await a1.apply(snapshot);
    const started = deferred(),
      release = deferred();
    const active = b1.run(async () => {
      await b1.repository.transaction('active', async (repo) => {
        assert.equal((await a1.resolve(userId)).memberships[0].accessEpoch, 1);
        started.resolve();
        await release.promise;
        await repo.save('fixture-result', {
          id: randomUUID(),
          ownerId: userId,
        });
      });
    });
    await started.promise;
    let finished = false;
    const revoke = a2
      .apply({ ...snapshot, revision: 2, memberships: [] })
      .then(() => (finished = true));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(finished, false);
    release.resolve();
    await active;
    await revoke;
    await assert.rejects(
      b1.run(() => a1.resolve(userId)),
      { code: 'OPERATOR_UNAVAILABLE' },
    );
    await second.close();
    second = await openLocalPostgres(qa.runtime);
    const b3 = createAccessBoundary(second.repository),
      a3 = createMembershipAuthority({
        repository: b3.repository,
        boundary: b3,
      });
    await assert.rejects(a3.apply({ ...snapshot, revision: 3 }), {
      code: 'ACCESS_EPOCH_REQUIRED',
    });
    await a3.apply({
      ...snapshot,
      revision: 3,
      memberships: [{ ...snapshot.memberships[0], accessEpoch: 2 }],
    });
    assert.equal((await a1.resolve(userId)).memberships[0].accessEpoch, 2);
    const competing = await Promise.allSettled([
      a1.apply({ ...snapshot, revision: 4, memberships: [] }),
      a3.apply({
        ...snapshot,
        revision: 4,
        memberships: [{ ...snapshot.memberships[0], accessEpoch: 3 }],
      }),
    ]);
    assert.equal(competing.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal(
      competing.find((x) => x.status === 'rejected').reason.code,
      'ACCESS_REVISION_CONFLICT',
    );

    const {
      createMembershipFeed,
    } = require('../../../staging-api/src/membership-feed.cjs');
    const issuer = 'native-fixture',
      key = randomBytes(32),
      keys = { current: key };
    const feed1 = createMembershipFeed({
      issuer,
      keys,
      repository: b1.repository,
      boundary: b1,
      authority: a1,
    });
    const feed2 = createMembershipFeed({
      issuer,
      keys,
      repository: b3.repository,
      boundary: b3,
      authority: a3,
    });
    const body = Buffer.from(
        JSON.stringify({ ...snapshot, userId: randomUUID() }),
      ),
      eventId = randomUUID(),
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', key)
      .update(`relay-membership-v1\n${issuer}\n${eventId}\n${timestamp}\n`)
      .update(body)
      .digest('hex');
    const event = { body, eventId, timestamp, keyId: 'current', signature };
    const receipts = await Promise.all([
      feed1.receive(event),
      feed2.receive(event),
    ]);
    assert.equal(receipts.filter((r) => r.replayed).length, 1);
    const restartedFeed = createMembershipFeed({
      issuer,
      keys,
      repository: b3.repository,
      boundary: b3,
      authority: a3,
    });
    assert.equal((await restartedFeed.receive(event)).replayed, true);
    assert.equal(
      (
        await first.repository.read((repo) =>
          repo.scan('managed-feed-receipt', { limit: 10 }),
        )
      ).length,
      1,
    );

    const {
      createMembershipProducer,
    } = require('../../../staging-api/src/membership-producer.cjs');
    let sends = 0;
    const send = async (e) => {
      sends++;
      return feed1.receive(e);
    };
    const producerOptions = { issuer, keyId: 'current', key, send };
    const producer1 = createMembershipProducer({
      ...producerOptions,
      repository: first.repository,
    });
    const producer2 = createMembershipProducer({
      ...producerOptions,
      repository: second.repository,
    });
    const initial = {
      userId: randomUUID(),
      requestId: randomUUID(),
      memberships: [{ id: tenantId, role: 'employee', company: true }],
    };
    await producer1.bootstrap([initial]);
    await Promise.all([producer1.tick(), producer2.tick()]);
    assert.equal(sends, 1);
    await second.close();
    second = await openLocalPostgres(qa.runtime);
    const producerRestarted = createMembershipProducer({
      ...producerOptions,
      repository: second.repository,
    });
    await producerRestarted.bootstrap([initial]);
    await producerRestarted.tick();
    assert.equal(sends, 1);
    const source = await first.repository.read((repo) =>
      repo.get('membership-source', `${issuer}:${initial.userId}`),
    );
    assert.equal(source.version, 1);
    assert.equal(source.revision, 1);
    assert.equal(
      (await a1.resolve(initial.userId)).memberships[0].role,
      'employee',
    );
    const {
      createMembershipAlerts,
    } = require('../../../staging-api/src/membership-alerts.cjs');
    const observedAt = Date.now();
    const alerts1 = createMembershipAlerts({
      repository: first.repository,
      issuer,
      now: () => observedAt,
    });
    const alerts2 = createMembershipAlerts({
      repository: second.repository,
      issuer,
      now: () => observedAt,
    });
    await Promise.all([alerts1.unavailable(), alerts2.unavailable()]);
    assert.equal((await alerts1.read()).events.length, 1);
    await second.close();
    second = await openLocalPostgres(qa.runtime);
    const restartedAlerts = createMembershipAlerts({
      repository: second.repository,
      issuer,
      now: () => observedAt + 1,
    });
    await restartedAlerts.unavailable();
    assert.equal((await restartedAlerts.read()).events.length, 1);
    assert.deepEqual((await restartedAlerts.read()).active, [
      'MONITOR_UNAVAILABLE',
    ]);
    const {
      createMembershipWatchdog,
    } = require('../../../staging-api/src/membership-watchdog.cjs');
    const watchdogTime = observedAt + 120002;
    const watch1 = createMembershipWatchdog({
      repository: first.repository,
      issuer,
      now: () => watchdogTime,
    });
    const watch2 = createMembershipWatchdog({
      repository: second.repository,
      issuer,
      now: () => watchdogTime,
    });
    await Promise.all([watch1.check(), watch2.check()]);
    const transitions = await first.repository.read((repo) =>
      repo.list('membership-watchdog-event', 'owner_id', issuer),
    );
    assert.equal(transitions.length, 1);
    assert.equal(transitions[0].code, 'WORKER_STALE');
    assert.equal((await restartedAlerts.read()).observedAt, observedAt + 1);
    // Retention operates on the native SQL adapter and cannot remove worker state.
    await first.repository.transaction(
      'seed-watchdog-history',
      async (repo) => {
        for (let i = 1; i <= 205; i++)
          await repo.save('membership-alert-event', {
            id: `retention:${String(i).padStart(16, '0')}`,
            ownerId: 'retention',
            version: i,
            observedAt: watchdogTime - 31 * 86400000,
          });
      },
    );
    const retention = createMembershipWatchdog({
      repository: second.repository,
      issuer: 'retention',
      now: () => watchdogTime,
    });
    assert.equal((await retention.prune()).removed, 100);
    assert.equal((await retention.prune()).removed, 5);
    assert.equal((await retention.prune()).removed, 0);
    assert.equal((await restartedAlerts.read()).observedAt, observedAt + 1);
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const { spawnSync } = require('node:child_process');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-watchdog-'));
    try {
      const file = path.join(directory, 'config.json');
      fs.writeFileSync(
        file,
        JSON.stringify({ issuer: 'cli-check', sourceDatabase: database }),
        { mode: 0o600 },
      );
      const script = path.resolve(
        __dirname,
        '../../../staging-api/scripts/membership-watchdog.cjs',
      );
      const checked = spawnSync(
        process.execPath,
        [script, '--config', file, '--once'],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(checked.status, 2, checked.stderr);
      assert.deepEqual(JSON.parse(checked.stdout).active, [
        'WORKER_UNOBSERVED',
      ]);
      const pruned = spawnSync(
        process.execPath,
        [script, '--config', file, '--prune'],
        { encoding: 'utf8', timeout: 15000 },
      );
      assert.equal(pruned.status, 0, pruned.stderr);
      assert.equal(JSON.parse(pruned.stdout).removed, 0);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
);
