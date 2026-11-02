'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../../application/src/repository.cjs');
const { createMembershipWatchdog } = require('../src/membership-watchdog.cjs');
for (const postgres of [false, true]) {
  async function fixture(t) {
    const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
    t.after(() => db.close());
    const repository = postgres
      ? await createPostgresRepository(db, { initialize: true })
      : createSqliteRepository(db);
    let time = Date.now();
    const options = { repository, issuer: 'test', now: () => time };
    return {
      repository,
      options,
      watchdog: createMembershipWatchdog(options),
      advance: (ms) => (time += ms),
      heartbeat: (stamp) =>
        repository.transaction('beat', (repo) =>
          repo.save('membership-alert-state', {
            id: 'test',
            ownerId: 'test',
            version: 1,
            observedAt: stamp ?? time,
          }),
        ),
    };
  }
  test(`${postgres ? 'postgres' : 'sqlite'} independent watchdog detects stop, clock error and recovery without writing worker heartbeat`, async (t) => {
    const f = await fixture(t);
    assert.deepEqual((await f.watchdog.check()).active, ['WORKER_UNOBSERVED']);
    await f.heartbeat();
    assert.deepEqual((await f.watchdog.check()).active, []);
    f.advance(120001);
    assert.deepEqual((await f.watchdog.check()).active, ['WORKER_STALE']);
    await createMembershipWatchdog(f.options).check();
    const events = await f.repository.read((r) =>
      r.list('membership-watchdog-event', 'owner_id', 'test'),
    );
    assert.equal(events.length, 3);
    await f.heartbeat(f.options.now() + 1000);
    assert.deepEqual((await f.watchdog.check()).active, [
      'WORKER_CLOCK_INVALID',
    ]);
    f.advance(1001);
    await f.heartbeat();
    assert.deepEqual((await f.watchdog.check()).active, []);
  });
  test(`${postgres ? 'postgres' : 'sqlite'} bounded retention preserves newest events, foreign issuers, receipts and state`, async (t) => {
    const f = await fixture(t),
      old = f.options.now() - 31 * 86400000;
    await f.repository.transaction('seed', async (r) => {
      for (let i = 1; i <= 205; i++)
        await r.save('membership-alert-event', {
          id: `test:${String(i).padStart(16, '0')}`,
          ownerId: 'test',
          version: i,
          observedAt: old,
        });
      await r.save('membership-alert-event', {
        id: 'other:1',
        ownerId: 'other',
        version: 1,
        observedAt: old,
      });
      await r.save('membership-source-command', {
        id: 'test:user:receipt',
        ownerId: 'user',
        version: 1,
        observedAt: old,
      });
    });
    await assert.rejects(
      f.repository.transaction('rollback-prune', async (repo) => {
        await repo.pruneMembershipEvents(
          'test',
          f.options.now() - 30 * 86400000,
        );
        throw new Error('rollback');
      }),
      /rollback/,
    );
    const before = await f.repository.read((repo) =>
      repo.membershipOperationsStats('test'),
    );
    assert.equal(
      before.find((row) => row.kind === 'membership-alert-event').count,
      205,
    );
    await assert.rejects(
      f.repository.read((repo) => repo.pruneMembershipEvents('test', old)),
      /Invalid retention command/,
    );
    await f.heartbeat();
    const constrained = createMembershipWatchdog({
      ...f.options,
      maxEvents: 200,
    });
    assert.deepEqual((await constrained.check()).active, [
      'MEMBERSHIP_CAPACITY_HIGH',
    ]);
    assert.equal((await f.watchdog.prune()).removed, 100);
    assert.equal((await f.watchdog.prune()).removed, 5);
    assert.equal((await f.watchdog.prune()).removed, 0);
    const stats = await f.repository.read((r) =>
      r.membershipOperationsStats('test'),
    );
    assert.equal(
      stats.find((s) => s.kind === 'membership-alert-event').count,
      100,
    );
    assert.equal(
      stats.find((s) => s.kind === 'membership-source-command').count,
      1,
    );
    assert.ok(
      await f.repository.read((r) =>
        r.get('membership-alert-event', 'other:1'),
      ),
    );
    assert.ok(
      await f.repository.read((r) => r.get('membership-alert-state', 'test')),
    );
    assert.deepEqual((await constrained.check()).active, []);
  });
}
