'use strict';
const { createHash } = require('node:crypto');
const {
  exactKeys,
  fail,
} = require('../../../packages/contracts/src/input.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Trusted adapter API, never a browser endpoint. Membership epochs must come
// from an authoritative change stream, including changes between observations.
function createMembershipAuthority({
  repository,
  boundary,
  now = Date.now,
  reconcile = async () => {},
}) {
  async function resolve(userId) {
    return repository.read(async (repo) => {
      const record = await repo.get('managed-membership', userId);
      if (!record || record.expiresAt <= now() || !record.memberships.length)
        fail(
          403,
          'OPERATOR_UNAVAILABLE',
          'Current workspace access is unavailable.',
        );
      return { user: { id: userId }, memberships: record.memberships };
    });
  }
  async function apply(snapshot) {
    exactKeys(snapshot, ['userId', 'revision', 'expiresAt', 'memberships']);
    if (
      !UUID.test(snapshot.userId) ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 1 ||
      !Number.isSafeInteger(snapshot.expiresAt) ||
      snapshot.expiresAt <= now() ||
      snapshot.expiresAt > now() + 300000 ||
      !Array.isArray(snapshot.memberships) ||
      snapshot.memberships.length > 100
    )
      fail(
        400,
        'INVALID_ACCESS_SNAPSHOT',
        'Provide a bounded authoritative access snapshot.',
      );
    const ids = new Set();
    for (const m of snapshot.memberships) {
      exactKeys(m, ['id', 'role', 'company', 'accessEpoch']);
      if (
        !UUID.test(m.id) ||
        ids.has(m.id) ||
        !['owner', 'employee', 'approver'].includes(m.role) ||
        typeof m.company !== 'boolean' ||
        !Number.isSafeInteger(m.accessEpoch) ||
        m.accessEpoch < 1
      )
        fail(
          400,
          'INVALID_ACCESS_SNAPSHOT',
          'Memberships require unique workspaces and positive access generations.',
        );
      ids.add(m.id);
    }
    const value = {
      userId: snapshot.userId,
      revision: snapshot.revision,
      expiresAt: snapshot.expiresAt,
      memberships: snapshot.memberships.map((m) => ({
        id: m.id,
        role: m.role,
        company: m.company,
        accessEpoch: m.accessEpoch,
      })),
    };
    value.memberships.sort((a, b) => a.id.localeCompare(b.id));
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(value))
      .digest('hex');
    return boundary.run(async () => {
      if (value.expiresAt <= now())
        fail(
          409,
          'ACCESS_SNAPSHOT_EXPIRED',
          'Request a fresh authoritative access snapshot.',
        );
      const result = await repository.transaction(
        `managed-membership:${value.userId}`,
        async (repo) => {
          const previous = await repo.get(
            'managed-membership',
            value.userId,
            true,
          );
          if (previous?.revision > value.revision)
            fail(
              409,
              'STALE_ACCESS_SNAPSHOT',
              'A newer access revision is already applied.',
            );
          if (previous?.revision === value.revision) {
            if (previous.fingerprint !== fingerprint)
              fail(
                409,
                'ACCESS_REVISION_CONFLICT',
                'This revision already has different content.',
              );
            return { revision: previous.revision, replayed: true };
          }
          const history = previous?.history || {};
          for (const m of value.memberships) {
            const old = history[m.id];
            const changed =
              old &&
              (!old.active ||
                previous.expiresAt <= now() ||
                old.role !== m.role ||
                old.company !== m.company);
            if (
              old &&
              (m.accessEpoch < old.accessEpoch ||
                (changed && m.accessEpoch <= old.accessEpoch))
            )
              fail(
                409,
                'ACCESS_EPOCH_REQUIRED',
                'Access changes require a fresh membership generation.',
              );
          }
          for (const old of Object.values(history)) old.active = false;
          for (const m of value.memberships)
            history[m.id] = { ...m, active: true };
          await repo.save('managed-membership', {
            id: value.userId,
            ownerId: value.userId,
            version: value.revision,
            ...value,
            history,
            fingerprint,
          });
          await repo.save('managed-access-audit', {
            id: `${value.userId}:${value.revision}`,
            ownerId: value.userId,
            version: value.revision,
            revision: value.revision,
            createdAt: now(),
            fingerprint,
          });
          return { revision: value.revision, replayed: false };
        },
      );
      // A crash after membership commit cannot revive approvals: every guarded
      // action repeats this reconciliation before it can authorize work.
      await reconcile();
      return result;
    });
  }
  return { resolve, apply };
}
module.exports = { createMembershipAuthority };
