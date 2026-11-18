'use strict';
// Bounded, read-only aggregation. No user IDs, roles or signed envelopes escape.
function createMembershipMonitor({ repository, issuer, now = Date.now }) {
  async function summary() {
    const time = now();
    const result = {
      observedAt: time,
      sources: 0,
      conflicts: 0,
      recoveryPending: 0,
      unacknowledged: 0,
      expired: 0,
      refreshOverdue: 0,
      deliveryBlocked: 0,
      awaitingDelivery: 0,
      deliveryFailed: 0,
      abandonedLeases: 0,
      maxRefreshLagMs: 0,
      complete: false,
    };
    await repository.read(async (repo) => {
      let after = '';
      for (let pageNo = 0; pageNo < 100; pageNo++) {
        const page = await repo.scan('membership-source', {
          after,
          limit: 100,
        });
        for (const source of page) {
          if (source.issuer !== issuer) continue;
          result.sources++;
          if (source.status === 'conflict') result.conflicts++;
          if (source.recoveryPending) result.recoveryPending++;
          if (!source.ackExpiresAt) result.unacknowledged++;
          else if (source.ackExpiresAt <= time) result.expired++;
          const lag = Math.max(0, time - source.refreshAt);
          if (lag > 0) result.refreshOverdue++;
          result.maxRefreshLagMs = Math.max(result.maxRefreshLagMs, lag);
          const job = await repo.get('membership-outbox', source.id);
          if (['pending', 'sending'].includes(job?.status))
            result.awaitingDelivery++;
          if (job?.lastError) result.deliveryFailed++;
          if (job?.status === 'blocked') result.deliveryBlocked++;
          if (job?.status === 'sending' && job.leaseUntil <= time)
            result.abandonedLeases++;
        }
        if (page.length < 100) {
          result.complete = true;
          break;
        }
        after = page.at(-1).id;
      }
      const provider = await repo.get('membership-provider-cursor', issuer);
      result.provider = provider
        ? {
            state: provider.status,
            lastCheckAgeMs: provider.checkedAt
              ? Math.max(0, time - provider.checkedAt)
              : null,
            pendingChanges: Math.max(
              0,
              (provider.highWater || 0) - provider.sequence,
            ),
          }
        : {
            state: 'not-connected',
            lastCheckAgeMs: null,
            pendingChanges: null,
          };
    });
    result.healthy =
      result.complete &&
      result.sources > 0 &&
      ![
        'conflicts',
        'recoveryPending',
        'unacknowledged',
        'expired',
        'refreshOverdue',
        'deliveryBlocked',
        'deliveryFailed',
        'abandonedLeases',
      ].some((key) => result[key]) &&
      result.provider.state === 'current' &&
      result.provider.lastCheckAgeMs < 120000;
    return result;
  }
  return { summary };
}
module.exports = { createMembershipMonitor };
