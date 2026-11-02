'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHmac } = require('node:crypto');
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
const {
  createLocalMembershipFeedServer,
} = require('../src/membership-feed-http.cjs');
function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db),
    boundary = createAccessBoundary(repository);
  let time = Date.now(),
    failReconcile = false;
  const authority = createMembershipAuthority({
    repository: boundary.repository,
    boundary,
    now: () => time,
    reconcile: async () => {
      if (failReconcile) throw new Error('private fixture detail');
    },
  });
  const issuer = 'local-test',
    key = randomBytes(32),
    keys = { current: key };
  const options = {
    issuer,
    keys,
    repository: boundary.repository,
    boundary,
    authority,
    now: () => time,
  };
  const snapshot = {
    userId: randomUUID(),
    revision: 1,
    expiresAt: time + 300000,
    memberships: [
      { id: randomUUID(), role: 'employee', company: true, accessEpoch: 1 },
    ],
  };
  function signed(
    value = snapshot,
    eventId = randomUUID(),
    keyId = 'current',
    signingKey = key,
  ) {
    const body = Buffer.from(JSON.stringify(value)),
      timestamp = String(Math.floor(time / 1000));
    return {
      body,
      eventId,
      timestamp,
      keyId,
      signature: createHmac('sha256', signingKey)
        .update(`relay-membership-v1\n${issuer}\n${eventId}\n${timestamp}\n`)
        .update(body)
        .digest('hex'),
    };
  }
  return {
    repository,
    authority,
    options,
    snapshot,
    signed,
    feed: createMembershipFeed(options),
    advance: (ms) => (time += ms),
    fail: (value) => (failReconcile = value),
  };
}
test('signed feed applies, deduplicates across receiver restart, and rejects conflicting event IDs', async (t) => {
  const f = fixture(t),
    event = f.signed();
  assert.equal((await f.feed.receive(event)).status, 'applied');
  const restarted = createMembershipFeed(f.options);
  assert.equal((await restarted.receive(event)).replayed, true);
  await assert.rejects(
    restarted.receive(
      f.signed({ ...f.snapshot, revision: 2, memberships: [] }, event.eventId),
    ),
    { code: 'ACCESS_EVENT_CONFLICT' },
  );
  assert.equal(
    (await f.authority.resolve(f.snapshot.userId)).memberships.length,
    1,
  );
  const receipts = await f.repository.read((repo) =>
    repo.scan('managed-feed-receipt', { limit: 10 }),
  );
  assert.equal(receipts.length, 1);
  assert.ok(!JSON.stringify(receipts).includes(event.signature));
});
test('tampering, expired signatures, unknown keys and oversized bodies cannot change access', async (t) => {
  const f = fixture(t),
    event = f.signed();
  for (const changed of [
    { ...event, body: Buffer.from('{}') },
    { ...event, eventId: randomUUID() },
    { ...event, keyId: 'unknown' },
    { ...event, signature: '0'.repeat(64) },
  ])
    await assert.rejects(f.feed.receive(changed), {
      code: 'ACCESS_SIGNATURE_INVALID',
    });
  await assert.rejects(
    f.feed.receive({ ...event, body: Buffer.alloc(65537) }),
    { code: 'ACCESS_BODY_LIMIT' },
  );
  f.advance(301000);
  await assert.rejects(f.feed.receive(event), {
    code: 'ACCESS_SIGNATURE_EXPIRED',
  });
  await assert.rejects(f.authority.resolve(f.snapshot.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
});
test('newer snapshots supersede late delivery without re-granting removed access', async (t) => {
  const f = fixture(t);
  await f.feed.receive(
    f.signed({ ...f.snapshot, revision: 2, memberships: [] }),
  );
  assert.equal((await f.feed.receive(f.signed())).status, 'superseded');
  await assert.rejects(f.authority.resolve(f.snapshot.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
});
test('a failure after membership commit can retry reconciliation without another transition', async (t) => {
  const f = fixture(t),
    event = f.signed();
  f.fail(true);
  await assert.rejects(f.feed.receive(event));
  assert.equal(
    (
      await f.repository.read((r) =>
        r.scan('managed-feed-receipt', { limit: 10 }),
      )
    ).length,
    0,
  );
  f.fail(false);
  assert.equal(
    (await createMembershipFeed(f.options).receive(event)).status,
    'applied',
  );
  assert.equal(
    (
      await f.repository.read((r) =>
        r.scan('managed-access-audit', { limit: 10 }),
      )
    ).length,
    1,
  );
});
test('key rotation accepts overlap then rejects a retired key; receipt replay does not extend expiry', async (t) => {
  const f = fixture(t),
    next = randomBytes(32),
    event = f.signed();
  const overlap = createMembershipFeed({
    ...f.options,
    keys: { current: f.options.keys.current, next },
  });
  await overlap.receive(event);
  const rotated = createMembershipFeed({ ...f.options, keys: { next } });
  await assert.rejects(rotated.receive(event), {
    code: 'ACCESS_SIGNATURE_INVALID',
  });
  f.advance(300001);
  assert.equal(
    (await rotated.receive(f.signed(f.snapshot, event.eventId, 'next', next)))
      .replayed,
    true,
  );
  await assert.rejects(f.authority.resolve(f.snapshot.userId), {
    code: 'OPERATOR_UNAVAILABLE',
  });
});
test('loopback HTTP feed authenticates raw bytes and does not expose internal errors', async (t) => {
  const f = fixture(t),
    server = createLocalMembershipFeedServer(f.feed);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const url = `http://127.0.0.1:${server.address().port}/internal/access-updates`;
  async function send(event, extra = {}) {
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-relay-event-id': event.eventId,
        'x-relay-timestamp': event.timestamp,
        'x-relay-key-id': event.keyId,
        'x-relay-signature': event.signature,
        ...extra,
      },
      body: event.body,
    });
  }
  assert.equal((await send({ ...f.signed(), signature: 'bad' })).status, 401);
  assert.equal(
    (await send(f.signed(), { Origin: 'https://external.example' })).status,
    415,
  );
  f.fail(true);
  let r = await send(f.signed());
  assert.equal(r.status, 503);
  assert.doesNotMatch(await r.text(), /private fixture/);
  f.fail(false);
  r = await send(f.signed());
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, 'applied');
});

test('HTTP feed bounds concurrent processing and rejects oversized declared bodies', async (t) => {
  let release, ready;
  const gate = new Promise((r) => (release = r)),
    started = new Promise((r) => (ready = r));
  let count = 0;
  const server = createLocalMembershipFeedServer({
    receive: async () => {
      if (++count === 8) ready();
      await gate;
      return { status: 'fixture' };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    release();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/internal/access-updates`;
  const send = (body) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  assert.equal((await send('x'.repeat(65537))).status, 413);
  assert.equal(count, 0);
  const active = Array.from({ length: 8 }, () => send('{}'));
  await started;
  const busy = await send('{}');
  assert.equal(busy.status, 503);
  assert.equal((await busy.json()).error, 'ACCESS_FEED_BUSY');
  release();
  for (const response of await Promise.all(active))
    assert.equal(response.status, 200);
});
