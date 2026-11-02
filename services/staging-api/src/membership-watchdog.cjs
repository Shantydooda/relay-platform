'use strict';
const DAY = 86400000;
function createMembershipWatchdog({
  repository,
  issuer,
  now = Date.now,
  maxEvents = 100000,
  maxRecords = 200000,
  maxBytes = 100 * 1024 * 1024,
}) {
  if (
    !/^[a-z0-9_-]{1,64}$/.test(issuer) ||
    ![maxEvents, maxRecords, maxBytes].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new TypeError('Invalid watchdog configuration');
  async function check() {
    return repository.transaction(
      `membership-watchdog:${issuer}`,
      async (repo) => {
        const time = now();
        const heartbeat = await repo.get('membership-alert-state', issuer);
        const metrics = await repo.membershipOperationsStats(issuer);
        const events = metrics
          .filter((row) => row.kind.endsWith('-event'))
          .reduce((sum, row) => sum + row.count, 0);
        const records = metrics.reduce((sum, row) => sum + row.count, 0);
        const bytes = metrics.reduce((sum, row) => sum + row.bytes, 0);
        const codes = [];
        if (!heartbeat) codes.push('WORKER_UNOBSERVED');
        else if (heartbeat.observedAt > time)
          codes.push('WORKER_CLOCK_INVALID');
        else if (time - heartbeat.observedAt >= 120000)
          codes.push('WORKER_STALE');
        if (events >= maxEvents || records >= maxRecords || bytes >= maxBytes)
          codes.push('MEMBERSHIP_CAPACITY_HIGH');
        const previous = await repo.get(
          'membership-watchdog-state',
          issuer,
          true,
        );
        if (previous && previous.observedAt > time)
          throw new Error('WATCHDOG_CLOCK_INVALID');
        let sequence = previous?.sequence || 0;
        for (const code of [
          ...new Set([...(previous?.active || []), ...codes]),
        ].sort()) {
          if ((previous?.active || []).includes(code) === codes.includes(code))
            continue;
          sequence++;
          await repo.save('membership-watchdog-event', {
            id: `${issuer}:${String(sequence).padStart(16, '0')}`,
            ownerId: issuer,
            version: sequence,
            code,
            status: codes.includes(code) ? 'opened' : 'resolved',
            observedAt: time,
          });
        }
        const status = {
          id: issuer,
          ownerId: issuer,
          version: (previous?.version || 0) + 1,
          sequence,
          observedAt: time,
          active: codes,
          workerAgeMs: heartbeat
            ? Math.max(0, time - heartbeat.observedAt)
            : null,
          capacity: { events, records, bytes, maxEvents, maxRecords, maxBytes },
        };
        await repo.save('membership-watchdog-state', status);
        const { id, ownerId, version, ...publicStatus } = status;
        return publicStatus;
      },
    );
  }
  async function prune() {
    // Serialized with watchdog event creation and other retention batches.
    // DELETE predicates protect current state and all other issuers regardless.
    return repository.transaction(
      `membership-watchdog:${issuer}`,
      async (repo) => ({
        removed: await repo.pruneMembershipEvents(issuer, now() - 30 * DAY),
        retentionDays: 30,
        keepNewestPerStream: 100,
      }),
    );
  }
  return { check, prune };
}
module.exports = { createMembershipWatchdog };
