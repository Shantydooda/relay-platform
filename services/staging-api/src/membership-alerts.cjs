'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
const CONDITIONS = {
  SOURCE_CONFLICT: (s) => s.conflicts > 0,
  RECOVERY_PENDING: (s) => s.recoveryPending > 0,
  ACCESS_NOT_CURRENT: (s) => s.expired > 0 || s.unacknowledged > 0,
  REFRESH_OVERDUE: (s) => s.refreshOverdue > 0,
  DELIVERY_FAILED: (s) =>
    s.deliveryBlocked > 0 || s.deliveryFailed > 0 || s.abandonedLeases > 0,
  PROVIDER_NOT_CURRENT: (s) =>
    s.provider?.state !== 'current' ||
    s.provider.lastCheckAgeMs === null ||
    s.provider.lastCheckAgeMs >= 120000 ||
    s.provider.pendingChanges === null ||
    s.provider.pendingChanges > 0,
  MONITOR_INCOMPLETE: (s) => !s.complete,
  NO_SOURCES: (s) => s.sources === 0,
};
// Local operator feed only. No external sender and no automatic access repair.
function createMembershipAlerts({ repository, issuer, now = Date.now }) {
  if (!/^[a-z0-9_-]{1,64}$/.test(issuer))
    throw new TypeError('Invalid alert issuer');
  async function record(observedAt, codes, preserveActive = false) {
    if (
      !Number.isSafeInteger(observedAt) ||
      observedAt > now() ||
      observedAt < now() - 120000
    )
      fail(400, 'INVALID_MONITOR_TIME', 'Use a fresh monitoring observation.');
    return repository.transaction(
      `membership-alerts:${issuer}`,
      async (repo) => {
        const previous = await repo.get('membership-alert-state', issuer, true);
        if (previous && observedAt <= previous.observedAt)
          return { applied: false };
        const old = new Set(previous?.active || []);
        const active = new Set([...codes, ...(preserveActive ? old : [])]);
        let sequence = previous?.sequence || 0;
        for (const code of [...new Set([...old, ...active])].sort()) {
          if (old.has(code) === active.has(code)) continue;
          sequence++;
          const status = active.has(code) ? 'opened' : 'resolved';
          await repo.save('membership-alert-event', {
            id: `${issuer}:${String(sequence).padStart(16, '0')}`,
            ownerId: issuer,
            version: sequence,
            code,
            status,
            observedAt,
          });
        }
        await repo.save('membership-alert-state', {
          id: issuer,
          ownerId: issuer,
          version: (previous?.version || 0) + 1,
          sequence,
          observedAt,
          active: [...active].sort(),
        });
        return { applied: true };
      },
    );
  }
  async function evaluate(summary) {
    if (
      !summary ||
      typeof summary !== 'object' ||
      typeof summary.complete !== 'boolean' ||
      !summary.provider ||
      typeof summary.provider.state !== 'string' ||
      !['lastCheckAgeMs', 'pendingChanges'].every(
        (key) =>
          summary.provider[key] === null ||
          (Number.isSafeInteger(summary.provider[key]) &&
            summary.provider[key] >= 0),
      ) ||
      ![
        'sources',
        'conflicts',
        'recoveryPending',
        'expired',
        'unacknowledged',
        'refreshOverdue',
        'deliveryBlocked',
        'deliveryFailed',
        'abandonedLeases',
      ].every((key) => Number.isSafeInteger(summary[key]) && summary[key] >= 0)
    )
      fail(
        400,
        'INVALID_MONITOR_SUMMARY',
        'Provide a complete monitor summary.',
      );
    return record(
      summary.observedAt,
      Object.entries(CONDITIONS)
        .filter(([, test]) => test(summary))
        .map(([code]) => code),
      !summary.complete,
    );
  }
  async function unavailable() {
    // Unknown health must not resolve known incidents.
    return record(now(), ['MONITOR_UNAVAILABLE'], true);
  }
  async function read() {
    return repository.read(async (repo) => {
      const state = await repo.get('membership-alert-state', issuer);
      return {
        observedAt: state?.observedAt || null,
        stale: !state || now() - state.observedAt >= 120000,
        active: state?.active || [],
        events: (
          await repo.recent('membership-alert-event', 'owner_id', issuer, 50)
        ).map(({ code, status, observedAt, version }) => ({
          code,
          status,
          observedAt,
          sequence: version,
        })),
      };
    });
  }
  return { evaluate, unavailable, read };
}
module.exports = { createMembershipAlerts };
