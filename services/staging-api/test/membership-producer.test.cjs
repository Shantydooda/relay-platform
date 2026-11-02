'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
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
  localMembershipTransport,
} = require('../src/membership-producer-http.cjs');
const {
  createLocalMembershipFeedServer,
} = require('../src/membership-feed-http.cjs');
function fixture(t) {
  const db = new DatabaseSync(':memory:'),
    target = new DatabaseSync(':memory:');
  t.after(() => {
    db.close();
    target.close();
  });
  const repository = createSqliteRepository(db),
    receiver = createSqliteRepository(target),
    boundary = createAccessBoundary(receiver);
  let time = Date.now();
  const now = () => time;
  const authority = createMembershipAuthority({
      repository: boundary.repository,
      boundary,
      now,
    }),
    key = randomBytes(32),
    issuer = 'producer-test';
  const feed = createMembershipFeed({
    repository: boundary.repository,
    boundary,
    authority,
    now,
    issuer,
    keys: { current: key },
  });
  const options = {
    repository,
    issuer,
    keyId: 'current',
    key,
    now,
    send: (event) => feed.receive(event),
  };
  const body = {
    userId: randomUUID(),
    expectedVersion: 0,
    memberships: [{ id: randomUUID(), role: 'approver', company: true }],
  };
  const source = () =>
    repository.read((r) =>
      r.get('membership-source', `${issuer}:${body.userId}`),
    );
  const job = () =>
    repository.read((r) =>
      r.get('membership-outbox', `${issuer}:${body.userId}`),
    );
  return {
    repository,
    receiver,
    feed,
    authority,
    options,
    body,
    source,
    job,
    producer: createMembershipProducer(options),
    advance: (ms) => (time += ms),
  };
}
test('bootstrap and periodic refresh persist revisions without invalidating unchanged access', async (t) => {
  const f = fixture(t),
    requestId = randomUUID(),
    records = [{ ...f.body, requestId }];
  await f.producer.bootstrap(records);
  await f.producer.tick();
  assert.equal((await f.job()).status, 'delivered');
  await f.producer.bootstrap(records);
  assert.equal((await f.source()).revision, 1);
  f.advance(120001);
  await createMembershipProducer(f.options).tick();
  assert.equal((await f.source()).revision, 2);
  assert.equal(
    (await f.authority.resolve(f.body.userId)).memberships[0].accessEpoch,
    1,
  );
  assert.equal((await f.source()).version, 1);
});
test('intervening demotion/re-promotion advances epoch even when only final state is delivered', async (t) => {
  const f = fixture(t);
  await f.producer.update(f.body, randomUUID());
  await f.producer.tick();
  await f.producer.update(
    {
      ...f.body,
      expectedVersion: 1,
      memberships: [{ ...f.body.memberships[0], role: 'employee' }],
    },
    randomUUID(),
  );
  await f.producer.update({ ...f.body, expectedVersion: 2 }, randomUUID());
  await f.producer.tick();
  assert.equal(
    (await f.authority.resolve(f.body.userId)).memberships[0].accessEpoch,
    3,
  );
  await assert.rejects(
    f.producer.update({ ...f.body, expectedVersion: 1 }, randomUUID()),
    { code: 'SOURCE_VERSION_CONFLICT' },
  );
});
test('lost acknowledgment retries identical envelope after restart and does not reapply', async (t) => {
  const f = fixture(t);
  let lost = true;
  const p = createMembershipProducer({
    ...f.options,
    send: async (event) => {
      const result = await f.feed.receive(event);
      if (lost) {
        lost = false;
        throw new Error('lost response');
      }
      return result;
    },
  });
  await p.update(f.body, randomUUID());
  await p.tick();
  const first = await f.job();
  assert.equal(first.status, 'pending');
  f.advance(1001);
  await createMembershipProducer(f.options).tick();
  const next = await f.job();
  assert.equal(next.eventId, first.eventId);
  assert.equal(next.body, first.body);
  assert.equal(next.status, 'delivered');
});
test('expired receiver access recovers with fresh epochs instead of reviving approval versions', async (t) => {
  const f = fixture(t);
  await f.producer.update(f.body, randomUUID());
  await f.producer.tick();
  f.advance(240001);
  await assert.rejects(f.authority.resolve(f.body.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  await createMembershipProducer(f.options).tick();
  assert.equal(
    (await f.authority.resolve(f.body.userId)).memberships[0].accessEpoch,
    2,
  );
});
test('in-flight old completion cannot acknowledge a newer revocation', async (t) => {
  const f = fixture(t);
  let release, started;
  const gate = new Promise((r) => (release = r)),
    ready = new Promise((r) => (started = r));
  const p = createMembershipProducer({
    ...f.options,
    send: async (event) => {
      started();
      await gate;
      return f.feed.receive(event);
    },
  });
  await p.update(f.body, randomUUID());
  const tick = p.tick();
  await ready;
  await f.producer.update(
    { ...f.body, expectedVersion: 1, memberships: [] },
    randomUUID(),
  );
  const revoked = await f.job();
  release();
  await tick;
  assert.equal((await f.job()).eventId, revoked.eventId);
  assert.equal((await f.job()).status, 'pending');
  await f.producer.tick();
  await assert.rejects(f.authority.resolve(f.body.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
});
test('retries are bounded and receiver/source revision disagreement blocks automatic refresh', async (t) => {
  const f = fixture(t),
    p = createMembershipProducer({
      ...f.options,
      send: async () => {
        throw new Error('secret must not persist');
      },
    });
  await p.update(f.body, randomUUID());
  for (let i = 0; i < 5; i++) {
    await p.tick();
    f.advance(16001);
  }
  assert.equal((await f.job()).attempts, 5);
  assert.equal((await f.job()).status, 'blocked');
  assert.doesNotMatch(JSON.stringify(await f.job()), /secret must/);
  const conflict = createMembershipProducer({
    ...f.options,
    send: async (e) => ({
      eventId: e.eventId,
      revision: JSON.parse(e.body).revision,
      status: 'superseded',
    }),
  });
  f.advance(120001);
  await conflict.tick();
  assert.equal((await f.source()).status, 'conflict');
  f.advance(120001);
  await conflict.tick();
  assert.equal((await f.source()).status, 'conflict');
});
test('real loopback producer transport bootstraps and refreshes signed authority', async (t) => {
  const f = fixture(t),
    server = createLocalMembershipFeedServer(f.feed);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const send = localMembershipTransport(
      `http://127.0.0.1:${server.address().port}/internal/access-updates`,
    ),
    p = createMembershipProducer({ ...f.options, send });
  await p.bootstrap([{ ...f.body, requestId: randomUUID() }]);
  await p.tick();
  assert.equal((await f.job()).status, 'delivered');
  f.advance(120001);
  await p.tick();
  assert.equal((await f.source()).revision, 2);
  assert.equal((await f.job()).status, 'delivered');
  assert.throws(
    () =>
      localMembershipTransport('https://example.com/internal/access-updates'),
    /loopback/,
  );
});

test('abandoned lease is recovered and late worker cannot overwrite its acknowledgment', async (t) => {
  const f = fixture(t);
  let release, started;
  const gate = new Promise((r) => (release = r)),
    ready = new Promise((r) => (started = r));
  const slow = createMembershipProducer({
    ...f.options,
    send: async (event) => {
      started();
      await gate;
      return f.feed.receive(event);
    },
  });
  await slow.update(f.body, randomUUID());
  const oldTick = slow.tick();
  await ready;
  f.advance(31001);
  await createMembershipProducer(f.options).tick();
  assert.equal((await f.job()).status, 'delivered');
  assert.equal((await f.job()).attempts, 2);
  release();
  await oldTick;
  assert.equal((await f.job()).status, 'delivered');
});
test('source changes roll back when their transactional outbox cannot be saved', async (t) => {
  const f = fixture(t);
  const repository = {
    ...f.repository,
    transaction: (key, work) =>
      f.repository.transaction(key, (repo) =>
        work({
          ...repo,
          save: async (kind, value) => {
            if (kind === 'membership-outbox')
              throw new Error('injected outbox failure');
            return repo.save(kind, value);
          },
        }),
      ),
  };
  await assert.rejects(
    createMembershipProducer({ ...f.options, repository }).update(
      f.body,
      randomUUID(),
    ),
  );
  assert.ok(!(await f.source()));
  assert.ok(!(await f.job()));
});
test('producer configuration requires a private file, local endpoint and separate source database', async (t) => {
  const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
  const { configFrom } = require('../scripts/membership-producer.cjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-producer-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  const config = {
    endpoint: 'http://127.0.0.1:4186/internal/access-updates',
    issuer: 'local-test',
    keyId: 'current',
    keyBase64: randomBytes(32).toString('base64'),
    sourceDatabase: 'relay_membership_source_test',
  };
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  assert.equal(configFrom(file).key.length, 32);
  fs.chmodSync(file, 0o644);
  assert.throws(() => configFrom(file), /PRIVATE_FILE_REQUIRED/);
  fs.chmodSync(file, 0o600);
  fs.writeFileSync(
    file,
    JSON.stringify({ ...config, sourceDatabase: 'relay_local' }),
  );
  assert.throws(() => configFrom(file), /INVALID_PRODUCER_CONFIG/);
});

test('producer health reports freshness without exposing envelopes or credentials', async (t) => {
  const f = fixture(t);
  await f.producer.update(f.body, randomUUID());
  assert.equal(
    (await f.producer.inspect(f.body.userId)).state,
    'unacknowledged',
  );
  await f.producer.tick();
  const health = await f.producer.inspect(f.body.userId);
  assert.equal(health.state, 'current');
  assert.equal(health.acknowledgedAccessRemainingMs, 240000);
  assert.equal(JSON.stringify(health).includes('memberships'), false);
  assert.equal(JSON.stringify(health).includes('signature'), false);
  f.advance(120001);
  assert.equal(
    (await f.producer.inspect(f.body.userId)).state,
    'refresh-overdue',
  );
  f.advance(120000);
  assert.equal((await f.producer.inspect(f.body.userId)).state, 'expired');
});

test('conflict recovery revokes first, fences stale review and requires fresh grant generations', async (t) => {
  const f = fixture(t);
  await f.producer.update(f.body, randomUUID());
  await f.authority.apply({
    userId: f.body.userId,
    revision: 9,
    expiresAt: f.options.now() + 240000,
    memberships: [{ ...f.body.memberships[0], accessEpoch: 40 }],
  });
  await f.producer.tick();
  assert.equal((await f.producer.inspect(f.body.userId)).state, 'conflict');
  const producer = createMembershipProducer({
    ...f.options,
    readReceiverRecord: (id) =>
      f.receiver.read((repo) => repo.get('managed-membership', id)),
  });
  const input = {
    userId: f.body.userId,
    expectedVersion: 1,
    expectedRevision: 1,
    receiverRevision: 9,
    operatorId: randomUUID(),
  };
  await assert.rejects(
    producer.reconcileRevocation(
      { ...input, receiverRevision: 8 },
      randomUUID(),
    ),
    { code: 'RECEIVER_VERSION_CONFLICT' },
  );
  await assert.rejects(
    producer.reconcileRevocation(
      { ...input, expectedRevision: 2 },
      randomUUID(),
    ),
    { code: 'SOURCE_VERSION_CONFLICT' },
  );
  const requestId = randomUUID();
  const result = await producer.reconcileRevocation(input, requestId);
  assert.equal(result.revision, 10);
  assert.deepEqual(
    await producer.reconcileRevocation(input, requestId),
    result,
  );
  await assert.rejects(
    producer.reconcileRevocation(
      { ...input, operatorId: randomUUID() },
      requestId,
    ),
    { code: 'SOURCE_COMMAND_CONFLICT' },
  );
  assert.equal(
    (await producer.inspect(f.body.userId)).state,
    'revocation-pending',
  );
  await assert.rejects(
    producer.update({ ...f.body, expectedVersion: 2 }, randomUUID()),
    { code: 'SOURCE_RECONCILIATION_REQUIRED' },
  );
  await producer.tick();
  await assert.rejects(f.authority.resolve(f.body.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
  await producer.update({ ...f.body, expectedVersion: 2 }, randomUUID());
  await producer.tick();
  const resolved = await f.authority.resolve(f.body.userId);
  assert.equal(resolved.memberships[0].accessEpoch, 41);
  const audits = await f.repository.read((repo) =>
    repo.scan('membership-reconciliation', { limit: 100 }),
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].operatorId, input.operatorId);
});

test('receiver advancement after review blocks recovery delivery instead of granting access', async (t) => {
  const f = fixture(t);
  await f.producer.update(f.body, randomUUID());
  const apply = (revision) =>
    f.authority.apply({
      userId: f.body.userId,
      revision,
      expiresAt: f.options.now() + 240000,
      memberships: [{ ...f.body.memberships[0], accessEpoch: 20 }],
    });
  await apply(8);
  await f.producer.tick();
  const producer = createMembershipProducer({
    ...f.options,
    readReceiverRecord: (id) =>
      f.receiver.read((repo) => repo.get('managed-membership', id)),
  });
  await producer.reconcileRevocation(
    {
      userId: f.body.userId,
      expectedVersion: 1,
      expectedRevision: 1,
      receiverRevision: 8,
      operatorId: randomUUID(),
    },
    randomUUID(),
  );
  await apply(10);
  await producer.tick();
  assert.equal((await producer.inspect(f.body.userId)).state, 'conflict');
  await assert.rejects(
    producer.update({ ...f.body, expectedVersion: 2 }, randomUUID()),
    { code: 'SOURCE_RECONCILIATION_REQUIRED' },
  );
  assert.equal((await f.source()).memberships.length, 0);
});

test('worker observes failed cycles and isolates monitoring failures', async (t) => {
  const f = fixture(t),
    controller = new AbortController(),
    errors = [];
  const producer = createMembershipProducer({
    ...f.options,
    beforeRefresh: async () => {
      throw new Error('private failure');
    },
  });
  let observed = 0;
  await producer.run({
    signal: controller.signal,
    onError: (code) => errors.push(code),
    afterTick: async () => {
      observed++;
      controller.abort();
      throw new Error('private monitor failure');
    },
  });
  assert.equal(observed, 1);
  assert.deepEqual(errors, [
    'MEMBERSHIP_WORKER_RETRY',
    'MEMBERSHIP_MONITOR_RETRY',
  ]);
});
