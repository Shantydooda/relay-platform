'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const {
  createSqliteRepository,
} = require('../../application/src/repository.cjs');
const { createUnifiedManagedStore } = require('../src/unified-managed.cjs');
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  let time = Date.now();
  const now = () => time,
    tenantId = randomUUID(),
    users = {},
    sessions = new Map();
  for (const role of ['owner', 'employee', 'approver'])
    users[role] = {
      id: randomUUID(),
      email: role + '@managed.test',
      email_confirmed_at: new Date(time).toISOString(),
    };
  const provider = {
    limit: async () => {},
    eligibleEmail: async () => true,
    signIn: async (email) => ({
      data: {
        session: {
          access_token: email,
          expires_at: Math.floor(time / 1000) + 3600,
        },
      },
    }),
    identity: async (access) => ({
      data: { user: Object.values(users).find((u) => u.email === access) },
    }),
    bootstrap: async () => {},
    profile: async () => ({ name: 'Managed member', workspace: 'buyer' }),
    memberships: async () => assert.fail('must use authoritative ledger'),
    saveSession: async (row) => sessions.set(row.token_hash, { ...row }),
    session: async (hash) => sessions.get(hash),
    deleteSession: async (hash) => sessions.delete(hash),
    touchSession: async () => {},
  };
  const options = { provider, sessionKey: randomBytes(32), repository, now };
  let composition = createUnifiedManagedStore(options);
  const snapshots = {},
    actors = {};
  for (const role of Object.keys(users)) {
    snapshots[role] = {
      userId: users[role].id,
      revision: 1,
      expiresAt: time + 300000,
      memberships: [{ id: tenantId, role, company: true, accessEpoch: 1 }],
    };
    await composition.access.apply(snapshots[role]);
    const session = await composition.store.login(
      { email: users[role].email, password: 'local fixture only' },
      'local',
    );
    actors[role] = await composition.store.principal(session);
  }
  return {
    repository,
    actors,
    tenantId,
    snapshots,
    options,
    store: composition.store,
    access: composition.access,
    now,
    advance: (ms) => (time += ms),
  };
}
async function approvalFixture(f) {
  const { taskId } = await f.store.createTask(
    f.actors.employee,
    {
      tenantId: f.tenantId,
      title: 'Supplied data',
      brief: 'Clean supplied CSV',
    },
    randomUUID(),
  );
  await f.repository.transaction('fixture', async (repo) => {
    const task = await repo.get('task', taskId);
    task.status = 'posted';
    task.selectedOfferId = 'offer';
    task.offers = [
      {
        id: 'offer',
        agentName: 'Fixture agent',
        amountMinor: 100,
        currency: 'USD',
        expiresAt: f.now() + 3600000,
        scopeVersion: 1,
      },
    ];
    await repo.save('task', task);
  });
  await f.store.configureBudget(
    f.actors.owner,
    f.tenantId,
    { limitMinor: 1000, expectedVersion: 0 },
    randomUUID(),
  );
  const get = () => f.store.detail(f.actors.employee, taskId);
  await f.store.requestApproval(
    f.actors.employee,
    taskId,
    { expectedVersion: (await get()).task.version, note: 'Needed for work' },
    randomUUID(),
  );
  const body = {
      approvalId: (await get()).approval.id,
      expectedVersion: 1,
      decision: 'approved',
      note: 'Within allowance',
    },
    key = randomUUID();
  await f.store.decideApproval(f.actors.approver, taskId, body, key);
  return { taskId, get, body, key };
}
for (const adapter of ['sqlite']) {
  test(`managed ${adapter}: generations invalidate approval through demotion/re-promotion and restart`, async (t) => {
    const f = await fixture(t, adapter),
      a = await approvalFixture(f);
    assert.equal(
      (await f.store.companyBudget(f.actors.owner, f.tenantId)).budget
        .reservedMinor,
      100,
    );
    const demoted = {
      ...f.snapshots.approver,
      revision: 2,
      memberships: [
        { id: f.tenantId, role: 'employee', company: true, accessEpoch: 2 },
      ],
    };
    await f.access.apply(demoted);
    assert.equal((await a.get()).approval.status, 'stale');
    assert.equal(
      (await f.store.companyBudget(f.actors.owner, f.tenantId)).budget
        .reservedMinor,
      0,
    );
    const restarted = createUnifiedManagedStore(f.options);
    await restarted.access.apply({
      ...demoted,
      revision: 3,
      memberships: [
        { id: f.tenantId, role: 'approver', company: true, accessEpoch: 3 },
      ],
    });
    await assert.rejects(
      f.store.decideApproval(f.actors.approver, a.taskId, a.body, a.key),
      { code: 'APPROVAL_STALE' },
    );
    await f.store.requestApproval(
      f.actors.employee,
      a.taskId,
      { expectedVersion: (await a.get()).task.version, note: 'Fresh request' },
      randomUUID(),
    );
    assert.notEqual((await a.get()).approval.id, a.body.approvalId);
    await f.store.decideApproval(
      f.actors.approver,
      a.taskId,
      {
        approvalId: (await a.get()).approval.id,
        expectedVersion: 1,
        decision: 'approved',
        note: 'Fresh decision',
      },
      randomUUID(),
    );
    assert.equal((await a.get()).approval.reviewerEpoch, 3);
  });
  test(`managed ${adapter}: snapshots reject old revisions, reused generations and expired access`, async (t) => {
    const f = await fixture(t, adapter);
    assert.equal((await f.access.apply(f.snapshots.employee)).replayed, true);
    const original = f.snapshots.employee;
    assert.equal(
      (
        await f.access.apply({
          memberships: original.memberships.map((m) => ({
            accessEpoch: m.accessEpoch,
            company: m.company,
            role: m.role,
            id: m.id,
          })),
          expiresAt: original.expiresAt,
          revision: original.revision,
          userId: original.userId,
        })
      ).replayed,
      true,
    );
    await assert.rejects(
      f.access.apply({ ...f.snapshots.employee, memberships: [] }),
      { code: 'ACCESS_REVISION_CONFLICT' },
    );
    await f.access.apply({
      ...f.snapshots.employee,
      revision: 2,
      memberships: [],
    });
    await assert.rejects(f.access.apply(f.snapshots.employee), {
      code: 'STALE_ACCESS_SNAPSHOT',
    });
    await assert.rejects(
      f.access.apply({ ...f.snapshots.employee, revision: 3 }),
      { code: 'ACCESS_EPOCH_REQUIRED' },
    );
    await assert.rejects(f.store.list(f.actors.employee, f.tenantId), {
      code: 'ACCESS_DENIED',
    });
    await f.access.apply({
      ...f.snapshots.employee,
      revision: 3,
      memberships: [{ ...f.snapshots.employee.memberships[0], accessEpoch: 2 }],
    });
    f.advance(300001);
    await assert.rejects(
      f.access.apply({
        ...f.snapshots.owner,
        revision: 2,
        expiresAt: f.now() + 300000,
      }),
      { code: 'ACCESS_EPOCH_REQUIRED' },
    );
    await assert.rejects(f.access.resolve(f.snapshots.employee.userId), {
      code: 'OPERATOR_UNAVAILABLE',
    });
  });
}
test('managed revocation waits for an admitted action and fences the queued action', async (t) => {
  const f = await fixture(t),
    started = deferred(),
    release = deferred();
  const active = f.repository.accessGuard(async () => {
    started.resolve();
    await release.promise;
  });
  await started.promise;
  let revoked = false;
  const removal = f.access
    .apply({ ...f.snapshots.employee, revision: 2, memberships: [] })
    .then(() => (revoked = true));
  const later = f.store.createTask(
    f.actors.employee,
    {
      tenantId: f.tenantId,
      title: 'Queued after removal',
      brief: 'Must not be written',
    },
    randomUUID(),
  );
  const rejection = assert.rejects(later, { code: 'ACCESS_DENIED' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(revoked, false);
  release.resolve();
  await active;
  await removal;
  await rejection;
  assert.equal((await f.store.list(f.actors.owner, f.tenantId)).length, 0);
});
test('reconciliation repairs a membership commit interrupted before approval invalidation', async (t) => {
  const f = await fixture(t),
    a = await approvalFixture(f);
  await f.repository.transaction('interrupted-change', async (repo) => {
    const row = await repo.get(
      'managed-membership',
      f.snapshots.approver.userId,
    );
    row.memberships[0].accessEpoch++;
    await repo.save('managed-membership', row);
  });
  const restarted = createUnifiedManagedStore(f.options);
  // The existing store uses the same persistent authority, not cached role state.
  assert.equal((await a.get()).approval.status, 'stale');
  assert.equal(
    (await f.store.companyBudget(f.actors.owner, f.tenantId)).budget
      .reservedMinor,
    0,
  );
  assert.equal(
    (await restarted.access.resolve(f.snapshots.approver.userId)).memberships[0]
      .accessEpoch,
    2,
  );
});

test('signed managed update invalidates the same approval and releases its reservation', async (t) => {
  const f = await fixture(t),
    a = await approvalFixture(f);
  const issuer = 'approval-fixture',
    key = randomBytes(32);
  const { feed } = createUnifiedManagedStore({
    ...f.options,
    membershipFeed: { issuer, keys: { current: key } },
  });
  const snapshot = {
    ...f.snapshots.approver,
    revision: 2,
    memberships: [
      {
        ...f.snapshots.approver.memberships[0],
        role: 'employee',
        accessEpoch: 2,
      },
    ],
  };
  const body = Buffer.from(JSON.stringify(snapshot)),
    eventId = randomUUID(),
    timestamp = String(Math.floor(f.now() / 1000));
  const signature = require('node:crypto')
    .createHmac('sha256', key)
    .update(`relay-membership-v1\n${issuer}\n${eventId}\n${timestamp}\n`)
    .update(body)
    .digest('hex');
  const event = { body, eventId, timestamp, keyId: 'current', signature };
  assert.equal((await feed.receive(event)).status, 'applied');
  assert.equal((await a.get()).approval.status, 'stale');
  assert.equal(
    (await f.store.companyBudget(f.actors.owner, f.tenantId)).budget
      .reservedMinor,
    0,
  );
  assert.equal((await feed.receive(event)).replayed, true);
  assert.equal((await a.get()).approval.status, 'stale');
});
