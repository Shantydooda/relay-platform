'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const {
  createSqliteRepository,
} = require('../../application/src/repository.cjs');
const { createMembershipAlerts } = require('../src/membership-alerts.cjs');
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  let time = Date.now();
  const options = { repository, issuer: 'test', now: () => time };
  return {
    options,
    alerts: createMembershipAlerts(options),
    advance: () => ++time,
    healthy: () => ({
      observedAt: time,
      complete: true,
      sources: 1,
      conflicts: 0,
      recoveryPending: 0,
      expired: 0,
      unacknowledged: 0,
      refreshOverdue: 0,
      deliveryBlocked: 0,
      deliveryFailed: 0,
      abandonedLeases: 0,
      provider: { state: 'current', lastCheckAgeMs: 0, pendingChanges: 0 },
    }),
  };
}
test('incident transitions deduplicate across retries and restart and preserve recovery history', async (t) => {
  const f = fixture(t);
  const bad = { ...f.healthy(), conflicts: 1, deliveryFailed: 1 };
  await Promise.all([f.alerts.evaluate(bad), f.alerts.evaluate(bad)]);
  assert.equal((await f.alerts.read()).events.length, 2);
  f.advance();
  await createMembershipAlerts(f.options).evaluate({
    ...bad,
    observedAt: f.options.now(),
  });
  assert.equal((await f.alerts.read()).events.length, 2);
  f.advance();
  await f.alerts.evaluate(f.healthy());
  const state = await f.alerts.read();
  assert.deepEqual(state.active, []);
  assert.equal(state.events.length, 4);
  assert.equal(state.events[0].status, 'resolved');
  await f.alerts.evaluate(bad);
  assert.deepEqual((await f.alerts.read()).active, []);
});
test('failed monitoring preserves known problems and records no arbitrary error or identity', async (t) => {
  const f = fixture(t);
  await f.alerts.evaluate({ ...f.healthy(), expired: 1 });
  f.advance();
  await f.alerts.unavailable();
  assert.deepEqual((await f.alerts.read()).active, [
    'ACCESS_NOT_CURRENT',
    'MONITOR_UNAVAILABLE',
  ]);
  f.advance();
  await f.alerts.unavailable();
  assert.equal((await f.alerts.read()).events.length, 2);
  f.advance();
  await f.alerts.evaluate(f.healthy());
  assert.equal((await f.alerts.read()).events.length, 4);
  assert.equal(
    JSON.stringify(await f.alerts.read()).includes('ownerId'),
    false,
  );
});
test('empty, incomplete and stale provider observations cannot look healthy', async (t) => {
  const f = fixture(t);
  assert.equal((await f.alerts.read()).stale, true);
  await f.alerts.evaluate({
    ...f.healthy(),
    sources: 0,
    complete: false,
    provider: { state: 'current', lastCheckAgeMs: 120000, pendingChanges: 0 },
  });
  assert.deepEqual((await f.alerts.read()).active, [
    'MONITOR_INCOMPLETE',
    'NO_SOURCES',
    'PROVIDER_NOT_CURRENT',
  ]);
  await assert.rejects(
    f.alerts.evaluate({ ...f.healthy(), observedAt: f.options.now() + 1 }),
    { code: 'INVALID_MONITOR_TIME' },
  );
  await assert.rejects(f.alerts.evaluate({}), {
    code: 'INVALID_MONITOR_SUMMARY',
  });
});

test('partial scans do not resolve previously observed incidents', async (t) => {
  const f = fixture(t);
  await f.alerts.evaluate({ ...f.healthy(), conflicts: 1 });
  f.advance();
  await f.alerts.evaluate({ ...f.healthy(), complete: false });
  assert.deepEqual((await f.alerts.read()).active, [
    'MONITOR_INCOMPLETE',
    'SOURCE_CONFLICT',
  ]);
  f.advance();
  await f.alerts.evaluate(f.healthy());
  assert.deepEqual((await f.alerts.read()).active, []);
});
