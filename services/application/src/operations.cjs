'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');

// A bounded read projection, never a retry/approval command. Do not return raw
// provider errors, filenames, source content, tokens or payment references.
function createOperations({
  repository,
  now,
  localExecution,
  paymentRecoveryUserIds = [],
}) {
  const allowed = new Set(paymentRecoveryUserIds);
  async function operationsBacklog(actor) {
    if (
      !localExecution ||
      !actor?.user?.id ||
      actor.recoveryRequired ||
      !allowed.has(actor.user.id)
    ) {
      fail(403, 'FORBIDDEN', 'Operations access is required.');
    }
    const observedAt = now();
    return repository.read(async (repo) => {
      const groups = [];
      async function collect(kind, label, classify) {
        let after = '',
          inspected = 0,
          truncated = false;
        const counts = {},
          alerts = [];
        let oldestAt = null;
        while (inspected < 1000) {
          const rows = await repo.scan(kind, { after, limit: 100 });
          for (const row of rows) {
            inspected++;
            const result = classify(row);
            if (!result) continue;
            counts[result.state] = (counts[result.state] || 0) + 1;
            if (Number.isFinite(result.since) && result.since <= observedAt) {
              oldestAt =
                oldestAt === null
                  ? result.since
                  : Math.min(oldestAt, result.since);
            }
            if (result.action && alerts.length < 20)
              alerts.push({
                id: row.id,
                state: result.state,
                action: result.action,
              });
          }
          if (rows.length < 100) break;
          after = rows.at(-1).id;
          if (inspected === 1000)
            truncated = (await repo.scan(kind, { after, limit: 1 })).length > 0;
        }
        groups.push({
          kind,
          label,
          inspected,
          truncated,
          counts,
          oldestAt,
          oldestAgeMs: oldestAt === null ? null : observedAt - oldestAt,
          alerts,
        });
      }
      await collect('task', 'Execution', (task) => {
        const a = task.assignment;
        if (!a || !['queued', 'running', 'failed'].includes(a.status))
          return null;
        const since = a.startedAt || a.authorizedAt || task.createdAt;
        if (a.permissionWait)
          return {
            state: 'waiting_permission',
            since,
            action:
              'Ask the task owner to review the permission request. Do not retry the task.',
          };
        if (a.status === 'failed')
          return {
            state: 'failed',
            since: a.endedAt || since,
            action:
              'Review the task failure and runtime connection before using existing execution recovery.',
          };
        const deadline =
          a.status === 'queued' ? a.queueDeadlineAt : a.leaseUntil;
        if (
          (deadline && deadline <= observedAt) ||
          (a.deadlineAt && a.deadlineAt <= observedAt)
        ) {
          return {
            state: 'overdue',
            since: deadline || a.deadlineAt,
            action:
              'Check execution-recovery worker health and the supplier runtime. Existing leases govern recovery.',
          };
        }
        return { state: a.status, since };
      });
      await collect('artifact', 'File scanning', (file) => {
        if (!file.objectKey || file.scan?.status === 'clean') return null;
        const state = file.scan?.status || 'quarantined';
        if (state === 'scanning' && file.scanLease?.until > observedAt)
          return { state: 'scanning', since: file.createdAt };
        return {
          state: state === 'scanning' ? 'overdue' : state,
          since: file.scan?.checkedAt || file.createdAt,
          action:
            state === 'blocked'
              ? 'Keep the file blocked. Request a safe replacement from the supplier.'
              : 'Check scanner health, signatures and object availability. Automatic scanning retries; do not bypass quarantine.',
        };
      });
      await collect('payment-job', 'Payment checks', (job) => {
        const state =
          job.status === 'review'
            ? 'needs_review'
            : job.leaseUntil > observedAt
              ? 'checking'
              : job.failures
                ? 'retrying'
                : job.nextAt < observedAt - 60000
                  ? 'overdue'
                  : 'scheduled';
        return {
          state,
          since: job.lastCheckedAt || job.nextAt,
          ...(['needs_review', 'retrying', 'overdue'].includes(state)
            ? {
                action:
                  'Review this check in Payment recovery. Provider configuration and retry safeguards still apply.',
              }
            : {}),
        };
      });
      for (const [kind, label] of [
        ['schedule', 'Scheduled tasks'],
        ['workspace-app', 'Scheduled apps'],
      ]) {
        await collect(kind, label, (job) => {
          if (kind === 'workspace-app' && !job.calendar) return null;
          if (job.status === 'paused')
            return {
              state: 'paused',
              since: job.updatedAt,
              action:
                'Review the schedule, current run, source access and permissions with its owner before resuming.',
            };
          if (job.status !== 'active') return null;
          if (job.nextAt < observedAt - 60000)
            return {
              state: 'overdue',
              since: job.nextAt,
              action:
                'Check the current run first: work awaiting review can intentionally defer the next run. Then check scheduler health.',
            };
          return { state: 'scheduled', since: null };
        });
      }
      await collect('scoping-job', 'Conversation replies', (job) => {
        if (!['pending', 'running', 'failed'].includes(job.status)) return null;
        const expired = job.expiresAt <= observedAt;
        return {
          state:
            job.status === 'failed' || expired
              ? 'needs_attention'
              : job.status === 'running'
                ? 'working'
                : 'waiting',
          since: job.createdAt || job.expiresAt - 180000,
          action:
            expired || job.status === 'failed'
              ? 'Ask the conversation owner to retry their saved message. Check model and recovery worker health first.'
              : null,
        };
      });
      return {
        observedAt,
        scope: 'operations',
        partial: groups.some((group) => group.truncated),
        groups,
      };
    });
  }
  return { operationsBacklog };
}
module.exports = { createOperations };
