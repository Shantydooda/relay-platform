'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
} = require('../../application/src/repository.cjs');
const {
  createAccessBoundary,
} = require('../../application/src/access-boundary.cjs');
const {
  createMembershipAuthority,
} = require('../src/membership-authority.cjs');
const { createMembershipFeed } = require('../src/membership-feed.cjs');
const { createMembershipProducer } = require('../src/membership-producer.cjs');
const {
  createMembershipProviderStream,
  localProviderReader,
} = require('../src/membership-provider-stream.cjs');
const { createMembershipMonitor } = require('../src/membership-monitor.cjs');
const migration = readFileSync(
  resolve(
    __dirname,
    '../../../supabase/migrations/202611010001_membership_changes.sql',
  ),
  'utf8',
);
async function fixture(t) {
  const db = await PGlite.create();
  const source = new DatabaseSync(':memory:'),
    receiver = new DatabaseSync(':memory:');
  t.after(async () => {
    source.close();
    receiver.close();
    await db.close();
  });
  const userId = randomUUID(),
    tenantId = randomUUID();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.relay_tenants(id uuid primary key);
    create table public.relay_memberships(user_id uuid,tenant_id uuid references public.relay_tenants(id) on delete cascade,role text,primary key(user_id,tenant_id));`);
  await db.query('insert into relay_tenants values($1)', [tenantId]);
  await db.query("insert into relay_memberships values($1,$2,'approver')", [
    userId,
    tenantId,
  ]);
  await db.exec(migration);
  await db.exec(
    readFileSync(
      resolve(
        __dirname,
        '../../../supabase/migrations/202611020001_membership_retention.sql',
      ),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      resolve(
        __dirname,
        '../../../supabase/migrations/202611020002_membership_retirement.sql',
      ),
      'utf8',
    ),
  );
  const repository = createSqliteRepository(source),
    target = createSqliteRepository(receiver);
  let time = Date.now();
  const now = () => time,
    issuer = 'local-provider';
  const boundary = createAccessBoundary(target);
  const authority = createMembershipAuthority({
    repository: boundary.repository,
    boundary,
    now,
  });
  const key = randomBytes(32);
  const feed = createMembershipFeed({
    repository: target,
    boundary,
    authority,
    now,
    issuer,
    keys: { current: key },
  });
  const readPage = localProviderReader({
    options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
    query: (...args) => db.query(...args),
  });
  let stream,
    offline = false;
  const producer = createMembershipProducer({
    repository,
    issuer,
    key,
    keyId: 'current',
    now,
    send: (event) => feed.receive(event),
    readReceiverRecord: (id) =>
      target.read((repo) => repo.get('managed-membership', id)),
    beforeRefresh: () => stream.sync(),
  });
  const options = {
    repository,
    producer,
    issuer,
    now,
    readPage: (after) => {
      if (offline) throw new Error('private provider error');
      return readPage(after);
    },
  };
  stream = createMembershipProviderStream(options);
  return {
    db,
    repository,
    producer,
    authority,
    userId,
    tenantId,
    options,
    readPage,
    monitor: createMembershipMonitor({ repository, issuer, now }),
    offline: () => {
      offline = true;
    },
    advance: (ms) => {
      time += ms;
    },
    restart: () => {
      stream = createMembershipProviderStream(options);
    },
  };
}
test('SQL capture preserves bootstrap, intervening role changes, company changes and revocation', async (t) => {
  const f = await fixture(t);
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].accessEpoch,
    1,
  );
  await f.db.exec(
    "begin; update relay_memberships set role='employee'; update relay_memberships set role='approver'; commit;",
  );
  f.restart();
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].accessEpoch,
    3,
  );
  await f.db.exec('update relay_tenants set company=true');
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].company,
    true,
  );
  await f.db.exec('delete from relay_tenants');
  await f.producer.tick();
  await assert.rejects(f.authority.resolve(f.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  const health = await f.monitor.summary();
  assert.equal(health.sources, 1);
  assert.equal(health.provider.state, 'current');
  assert.equal(health.provider.pendingChanges, 0);
  assert.equal(JSON.stringify(health).includes(f.userId), false);
});
test('provider outage stops refresh and reports unhealthy expired access', async (t) => {
  const f = await fixture(t);
  await f.producer.tick();
  assert.equal((await f.monitor.summary()).healthy, true);
  f.offline();
  f.advance(240001);
  await assert.rejects(f.producer.tick());
  await assert.rejects(f.authority.resolve(f.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  const health = await f.monitor.summary();
  assert.equal(health.healthy, false);
  assert.equal(health.expired, 1);
  assert.equal(health.provider.state, 'unavailable');
  assert.equal(
    JSON.stringify(health).includes('private provider error'),
    false,
  );
});
test('capture rolls back without gaps and is inaccessible to browser roles', async (t) => {
  const f = await fixture(t);
  await f.db.exec(
    "begin; update relay_memberships set role='employee'; rollback;",
  );
  assert.equal((await f.readPage(0)).highWater, 1);
  await assert.rejects(
    f.db.exec('truncate relay_memberships'),
    /MEMBERSHIP_TRUNCATE_FORBIDDEN/,
  );
  await f.db.exec("update relay_memberships set role='employee'");
  assert.deepEqual(
    (await f.readPage(0)).events.map((e) => e.sequence),
    [1, 2],
  );
  for (const role of ['anon', 'authenticated']) {
    await f.db.exec('set role ' + role);
    await assert.rejects(f.db.query('select * from relay_membership_changes'), {
      code: '42501',
    });
    await assert.rejects(
      f.db.query('select relay_capture_membership($1)', [f.userId]),
      { code: '42501' },
    );
    await f.db.exec('reset role');
  }
  await f.db.exec('set role service_role');
  assert.equal(
    (await f.db.query('select * from relay_membership_changes')).rows.length,
    2,
  );
  await assert.rejects(f.db.query('delete from relay_membership_changes'), {
    code: '42501',
  });
});
test('checkpoint crash replays safely; gaps and mismatched event content are rejected', async (t) => {
  const f = await fixture(t);
  const page = await f.readPage(0),
    event = page.events[0];
  await f.producer.applyProviderChange({
    eventId: event.eventId,
    userId: event.userId,
    revision: event.revision,
    memberships: event.memberships,
  });
  // Equivalent to crash after producer commit but before cursor commit.
  await f.producer.tick();
  assert.equal((await f.producer.inspect(f.userId)).version, 1);
  await assert.rejects(
    f.producer.applyProviderChange({
      eventId: event.eventId,
      userId: event.userId,
      revision: event.revision,
      memberships: [],
    }),
    { code: 'SOURCE_COMMAND_CONFLICT' },
  );
  const gap = createMembershipProviderStream({
    ...f.options,
    readPage: async () => ({
      highWater: 3,
      streamId: page.streamId,
      events: [{ ...event, sequence: 3 }],
    }),
  });
  await assert.rejects(gap.sync(), { code: 'PROVIDER_SEQUENCE_GAP' });
  assert.equal((await f.monitor.summary()).provider.state, 'unavailable');
});
test('local provider transport rejects hosted databases', () => {
  assert.throws(() =>
    localProviderReader({
      options: { host: 'example.com', database: 'relay_provider_fixture_test' },
    }),
  );
  assert.throws(() =>
    localProviderReader({
      options: { host: '127.0.0.1', database: 'relay_staging' },
    }),
  );
});

test('provider-owned sources cannot be manually overwritten or refreshed without capture', async (t) => {
  const f = await fixture(t);
  await f.producer.tick();
  await assert.rejects(
    f.producer.update(
      { userId: f.userId, expectedVersion: 1, memberships: [] },
      randomUUID(),
    ),
    { code: 'PROVIDER_OWNS_SOURCE' },
  );
  const standalone = createMembershipProducer({
    repository: f.repository,
    issuer: 'local-provider',
    key: randomBytes(32),
    keyId: 'current',
    send: async () => {
      throw new Error('must not send');
    },
  });
  await assert.rejects(standalone.tick(), {
    code: 'PROVIDER_CAPTURE_REQUIRED',
  });
});

test('large provider backlog is drained in bounded pages before any access is refreshed', async (t) => {
  const f = await fixture(t);
  await f.db.exec(
    `do $$ begin for i in 1..101 loop update relay_memberships set role=case when mod(i,2)=0 then 'approver' else 'employee' end; end loop; end $$;`,
  );
  await assert.rejects(f.producer.tick(), { code: 'PROVIDER_BACKLOG' });
  await assert.rejects(f.authority.resolve(f.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  const first = await f.monitor.summary();
  assert.equal(first.provider.pendingChanges, 2);
  assert.equal(first.healthy, false);
  f.restart();
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].accessEpoch,
    102,
  );
  assert.equal((await f.monitor.summary()).healthy, true);
});

test('recovery revocation can drain while provider capture is blocked by the conflict', async (t) => {
  const f = await fixture(t);
  await f.authority.apply({
    userId: f.userId,
    revision: 9,
    expiresAt: f.options.now() + 240000,
    memberships: [
      { id: f.tenantId, role: 'approver', company: false, accessEpoch: 40 },
    ],
  });
  await f.producer.tick();
  await f.db.exec("update relay_memberships set role='employee'");
  await assert.rejects(f.producer.tick(), {
    code: 'SOURCE_RECONCILIATION_REQUIRED',
  });
  await f.producer.reconcileRevocation(
    {
      userId: f.userId,
      expectedVersion: 1,
      expectedRevision: 1,
      receiverRevision: 9,
      operatorId: randomUUID(),
    },
    randomUUID(),
  );
  // Capture is still blocked, but the empty recovery envelope must be delivered.
  await assert.rejects(f.producer.tick(), {
    code: 'SOURCE_RECONCILIATION_REQUIRED',
  });
  await assert.rejects(f.authority.resolve(f.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  await f.producer.tick();
  const access = await f.authority.resolve(f.userId);
  assert.equal(access.memberships[0].role, 'employee');
  assert.equal(access.memberships[0].accessEpoch, 41);
});

test('provider retention waits for all durable consumers, preserves replay boundary and rejects stale restores', async (t) => {
  const f = await fixture(t);
  const {
    createLocalProviderRetention,
  } = require('../src/membership-retention.cjs');
  const pool = {
    options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
    query: (...args) => f.db.query(...args),
  };
  const retention = createLocalProviderRetention({
    pool,
    repository: f.repository,
    issuer: 'local-provider',
    consumerId: 'primary',
  });
  await f.db.exec(
    "select relay_register_membership_consumer('primary'); select relay_register_membership_consumer('standby');",
  );
  await assert.rejects(retention.acknowledge(), /DURABLE_CURSOR_REQUIRED/);
  await f.db.exec(
    `do $$ begin for i in 1..204 loop update relay_memberships set role=case when mod(i,2)=0 then 'approver' else 'employee' end; end loop; end $$;`,
  );
  await f.db.exec(
    "update relay_membership_changes set created_at=clock_timestamp()-interval '31 days'",
  );
  assert.equal((await retention.prune()).removed, 0);
  for (let i = 0; i < 2; i++)
    await assert.rejects(f.producer.tick(), { code: 'PROVIDER_BACKLOG' });
  await f.producer.tick();
  await retention.acknowledge();
  assert.equal((await retention.prune()).removed, 0); // standby has not processed anything
  await assert.rejects(
    f.db.query("select relay_ack_membership_consumer('standby',999)"),
    /INVALID_WATERMARK/,
  );
  await f.db.query("select relay_ack_membership_consumer('standby',205)");
  assert.equal((await retention.prune()).removed, 100);
  assert.equal((await retention.prune()).removed, 5);
  assert.equal((await retention.prune()).removed, 0);
  await assert.rejects(f.readPage(0), { code: 'PROVIDER_BOOTSTRAP_REQUIRED' });
  assert.equal((await f.readPage(105)).events[0].sequence, 106);
  await assert.rejects(
    f.db.query("select relay_register_membership_consumer('new')"),
    /BOOTSTRAP_REQUIRED/,
  );
  await f.db.exec('set role service_role');
  await assert.rejects(retention.prune(), { code: '42501' });
  await f.db.exec('reset role');
  // Restart from the intact durable cursor works after cleanup.
  f.restart();
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].accessEpoch,
    205,
  );
});

test('1001-change backlog drains across restart boundaries without losing intermediate generations', async (t) => {
  const f = await fixture(t);
  const started = performance.now();
  await f.db.exec(
    `do $$ begin for i in 1..1000 loop update relay_memberships set role=case when mod(i,2)=0 then 'approver' else 'employee' end; end loop; end $$;`,
  );
  let batches = 0;
  for (;;) {
    batches++;
    try {
      await f.producer.tick();
      break;
    } catch (error) {
      assert.equal(error.code, 'PROVIDER_BACKLOG');
    }
    assert.ok(batches <= 11);
    f.restart();
  }
  assert.equal(batches, 11);
  assert.equal(
    (await f.authority.resolve(f.userId)).memberships[0].accessEpoch,
    1001,
  );
  const elapsedMs = Math.round(performance.now() - started);
  t.diagnostic(
    `1001 provider changes: ${batches} batches, ${elapsedMs}ms local fixture elapsed (not a production throughput guarantee)`,
  );
});

test('a slow backlog expires old access instead of extending stale permissions', async (t) => {
  const f = await fixture(t);
  await f.producer.tick();
  await f.db.exec(
    `do $$ begin for i in 1..201 loop update relay_memberships set role=case when mod(i,2)=0 then 'approver' else 'employee' end; end loop; end $$;`,
  );
  for (let i = 0; i < 2; i++) {
    await assert.rejects(f.producer.tick(), { code: 'PROVIDER_BACKLOG' });
    f.advance(121000);
  }
  await assert.rejects(f.authority.resolve(f.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  f.restart();
  await f.producer.tick();
  const membership = (await f.authority.resolve(f.userId)).memberships[0];
  assert.equal(membership.role, 'employee');
  assert.ok(membership.accessEpoch > 202);
});

test('a changed provider database cannot reuse a cursor or acknowledge retention', async (t) => {
  const f = await fixture(t);
  await f.producer.tick();
  await f.db.exec(
    'update relay_membership_clock set stream_id=gen_random_uuid()',
  );
  await assert.rejects(f.producer.tick(), { code: 'PROVIDER_STREAM_CHANGED' });
  const {
    createLocalProviderRetention,
  } = require('../src/membership-retention.cjs');
  const retention = createLocalProviderRetention({
    pool: {
      options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
      query: (...args) => f.db.query(...args),
    },
    repository: f.repository,
    issuer: 'local-provider',
    consumerId: 'primary',
  });
  await assert.rejects(retention.acknowledge(), /PROVIDER_STREAM_CHANGED/);
});

test('reviewed retirement requires a current replacement and cannot resurrect a retired consumer', async (t) => {
  const f = await fixture(t);
  const {
    createLocalMembershipRecovery,
  } = require('../src/membership-recovery.cjs');
  const pool = {
    options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
    query: (...args) => f.db.query(...args),
  };
  const recovery = createLocalMembershipRecovery({
    pool,
    repository: f.repository,
    issuer: 'local-provider',
    consumerId: 'old',
  });
  await f.db.exec(
    "select relay_register_membership_consumer('old'); select relay_register_membership_consumer('replacement');",
  );
  assert.equal(
    (await recovery.review()).restoreStatus,
    'consistent-backup-required',
  );
  await f.producer.tick();
  const observed = await recovery.review();
  assert.equal(observed.restoreStatus, 'replay-required');
  const command = {
    review: observed,
    replacement: 'replacement',
    operatorId: randomUUID(),
    reason: 'Replacement consumer verified locally',
    requestId: randomUUID(),
  };
  await assert.rejects(recovery.retire(command), /REPLACEMENT_NOT_CURRENT/);
  await f.db.exec("select relay_ack_membership_consumer('replacement',1)");
  const result = await recovery.retire(command);
  assert.equal(result.status, 'retired');
  assert.deepEqual(await recovery.retire(command), result);
  await assert.rejects(
    recovery.retire({ ...command, reason: 'Another reviewed reason' }),
    /RETIREMENT_REQUEST_CONFLICT/,
  );
  assert.equal((await recovery.review()).restoreStatus, 'consumer-retired');
  await assert.rejects(
    f.db.exec("select relay_ack_membership_consumer('old',1)"),
    /CONSUMER_NOT_REGISTERED/,
  );
  await assert.rejects(
    f.db.exec("select relay_register_membership_consumer('old')"),
    /CONSUMER_RETIRED/,
  );
  assert.equal(
    (
      await f.db.query(
        'select count(*)::int as n from relay_membership_retirement_audit',
      )
    ).rows[0].n,
    1,
  );
  await f.db.exec('set role service_role');
  await assert.rejects(recovery.retire(command), { code: '42501' });
  await f.db.exec('reset role');
});

test('retirement refuses stale review and rollback preserves the retention blocker', async (t) => {
  const f = await fixture(t);
  const {
    createLocalMembershipRecovery,
  } = require('../src/membership-recovery.cjs');
  const recovery = createLocalMembershipRecovery({
    pool: {
      options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
      query: (...a) => f.db.query(...a),
    },
    repository: f.repository,
    issuer: 'local-provider',
    consumerId: 'old',
  });
  await f.db.exec(
    "select relay_register_membership_consumer('old'); select relay_register_membership_consumer('replacement'); select relay_ack_membership_consumer('replacement',1);",
  );
  const command = {
    review: await recovery.review(),
    replacement: 'replacement',
    operatorId: randomUUID(),
    reason: 'Retire old isolated fixture consumer',
    requestId: randomUUID(),
  };
  await f.db.exec("update relay_memberships set role='employee'");
  await assert.rejects(recovery.retire(command), /STALE_RETIREMENT_REVIEW/);
  command.review = await recovery.review();
  await f.db.exec("select relay_ack_membership_consumer('replacement',2)");
  await f.db.exec('begin');
  await recovery.retire(command);
  await f.db.exec('rollback');
  assert.equal(
    (
      await f.db.query(
        "select retired_at from relay_membership_consumers where consumer_id='old'",
      )
    ).rows[0].retired_at,
    null,
  );
  assert.equal(
    (
      await f.db.query(
        'select count(*)::int as n from relay_membership_retirement_audit',
      )
    ).rows[0].n,
    0,
  );
});

test('restore assessment reports mismatched, pruned and ahead-of-provider cursors without modifying them', async (t) => {
  const f = await fixture(t);
  const {
    createLocalMembershipRecovery,
  } = require('../src/membership-recovery.cjs');
  await f.db.exec("select relay_register_membership_consumer('review')");
  const stream = (await f.readPage(0)).streamId;
  let cursor;
  const recovery = createLocalMembershipRecovery({
    pool: {
      options: { host: '127.0.0.1', database: 'relay_provider_fixture_test' },
      query: (...a) => f.db.query(...a),
    },
    repository: { read: (work) => work({ get: async () => cursor }) },
    issuer: 'local-provider',
    consumerId: 'review',
  });
  cursor = { sequence: 1, streamId: randomUUID() };
  assert.equal((await recovery.review()).restoreStatus, 'stream-mismatch');
  cursor = { sequence: -1, streamId: stream };
  assert.equal(
    (await recovery.review()).restoreStatus,
    'invalid-source-cursor',
  );
  cursor = { sequence: 2, streamId: stream };
  assert.equal(
    (await recovery.review()).restoreStatus,
    'provider-behind-source',
  );
  await f.db.exec('update relay_membership_clock set retained_through=1');
  cursor = { sequence: 0, streamId: stream };
  assert.equal((await recovery.review()).restoreStatus, 'history-pruned');
  assert.deepEqual(cursor, { sequence: 0, streamId: stream });
});
