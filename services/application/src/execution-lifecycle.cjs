'use strict';

const { waitingForPermission } = require('../../../packages/domain/src/execution-state.cjs');

const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');

function createLifecycle({ repository, command, taskFor, expected, now, touch, event, localExecution, approvals }) {
  function checkCancel(task) {
    if (!task.assignment || !['queued', 'running', 'buyer_review'].includes(task.assignment.status)) fail(409, 'STATE_CONFLICT', 'Only pending execution or a delivery awaiting review can be cancelled.');
  }
  async function checkRetry(repo, actor, task) {
    if (!localExecution) fail(403, 'LOCAL_ONLY', 'Recovery is local only.');
    const job = task.assignment;
    if (!job || job.status !== 'failed' || job.mode !== 'local-unpaid' || task.submissions.length || (job.manualRetries || 0) >= 2 || task.scheduleId) fail(409, 'RECOVERY_BLOCKED', 'This execution cannot be safely retried here. Create a reviewed request instead.');
    const agent = await repo.get('agent', job.agentId, true);
    if (!agent?.credentialHash || agent.credentialExpiresAt <= now() || agent.connectedAt <= now() - 120000) fail(409, 'RUNTIME_REQUIRED', 'Reconnect the assigned runtime before retrying.');
    await approvals.requireApproval(repo, actor, task);
    return job;
  }
  async function lifecycleActions(repo, actor, task) {
    const { availability } = require('./action-availability.cjs');
    const check = async action => {
      await taskFor(repo, actor, task.id, true);
      if (action === 'cancel') checkCancel(task);
      else await checkRetry(repo, actor, structuredClone(task));
    };
    return { cancel: await availability(() => check('cancel')), retry: await availability(() => check('retry')) };
  }
  async function cancelExecution(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'reason']);
    const reason = text(body.reason, 'Cancellation reason', 1, 1000);
    return command(actor.user.id, key, ['cancel-execution', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true);
      expected(task, body.expectedVersion);
      checkCancel(task);
      task.assignment.status = 'cancelled';
      task.assignment.cancelledAt = now();
      task.assignment.endedAt = now();
      task.assignment.cancelReason = reason;
      task.assignment.leaseHash = null;
      task.assignment.progress = 'The buyer cancelled this task. The runtime must stop further work.';
      if (task.submissions.at(-1)?.status === 'ready') task.submissions.at(-1).status = 'cancelled';
      touch(task, now());
      event(task, actor.user.id, 'execution.cancelled', now());
      await saveTask(repo, task);
      return { taskId: id, version: task.version, status: 'cancelled', paymentStatus: task.assignment.mode === 'stripe-sandbox' ? task.settlement.status : 'not_applicable_local_unpaid' };
    });
  }
  async function executionQueue(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to view execution.');
    return repository.read(async repo => {
      const grants = await repo.list('grant', 'owner_id', actor.user.id);
      const owned = await repo.list('task', 'owner_id', actor.user.id);
      const ids = new Set([...grants.map(g => g.taskId), ...owned.map(t => t.id)]);
      const items = [];
      for (const id of ids) {
        const task = await repo.get('task', id), job = task?.assignment;
        if (!job || !['queued', 'running', 'failed', 'buyer_review'].includes(job.status)) continue;
        // Removed employees cannot retain access via task ownership.
        const buyerAccess = task.ownerId === actor.user.id && actor.memberships.some(m => m.id === task.tenantId);
        if (!buyerAccess && job.operatorId !== actor.user.id) continue;
        const actions = await lifecycleActions(repo, actor, task);
        items.push({ actions, taskId: id, title: task.title, status: job.status, version: task.version,
          waitingSince: job.authorizedAt, heartbeatAt: job.heartbeatAt || null,
          waitingForPermission: waitingForPermission(job),
          overdue: job.permissionWait ? false : job.status === 'queued' ? job.queueDeadlineAt <= now() : job.status === 'running' && job.leaseUntil <= now(),
          attempt: job.attempt, error: job.error || null, progress: job.progress,
          canRetry: actions.retry.allowed });
      }
      return { items, limit: 100, checkedAt: now() };
    });
  }
  async function retryExecution(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'reason']);
    const reason = text(body.reason, 'Retry reason', 10, 500);
    if (!localExecution) fail(403, 'LOCAL_ONLY', 'Recovery is local only.');
    return command(actor.user.id, key, ['retry-execution', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      const job = await checkRetry(repo, actor, task);
      job.manualRetries = (job.manualRetries || 0) + 1;
      job.recoveryHistory = [...(job.recoveryHistory || []), { at: now(), actorId: actor.user.id, reason, error: job.error, attempt: job.attempt }];
      job.status = 'queued'; job.error = null; job.endedAt = null;
      // Preserve monotonically increasing attempts so suppliers do not reuse an
      // obsolete claim command key after a manual recovery.
      job.attemptLimit = job.attempt + 3;
      job.leaseHash = null; job.leaseUntil = 0;
      job.queueDeadlineAt = now() + 120000;
      job.deadlineAt = now() + 120000 + Math.min(86400000, Math.max(300000, job.agreement.deliveryMinutes * 120000));
      job.progress = 'Recovery authorized. Waiting for the assigned runtime.';
      touch(task, now()); event(task, actor.user.id, 'execution.recovery_requested', now());
      await saveTask(repo, task);
      return { taskId: id, version: task.version };
    });
  }
  // Bounded keyset scans continue across ticks, so older live assignments do not
  // permanently hide overdue work later in the index. Transactions recheck state.
  async function reconcileExecutions(cursors = {}) {
    const next = {};
    let changed = 0;
    for (const status of ['queued', 'running']) {
      const rows = await repository.read(repo => repo.page('execution-index', 'status', status, { after: cursors[status] || '', limit: 100 }));
      next[status] = rows.length === 100 ? rows.at(-1).id : '';
      for (const row of rows) {
        changed += await repository.transaction(`reconcile:${row.id}`, async repo => {
          const task = await repo.get('task', row.id, true), assignment = task?.assignment;
          if (!assignment || assignment.status !== status || assignment.permissionWait) return 0;
          let error;
          if (assignment.deadlineAt && assignment.deadlineAt <= now()) error = 'EXECUTION_TIMEOUT';
          else if (status === 'queued' && assignment.queueDeadlineAt && assignment.queueDeadlineAt <= now()) error = 'SUPPLIER_UNAVAILABLE';
          else if (status === 'running' && assignment.leaseUntil <= now()) {
            if (assignment.attempt >= (assignment.attemptLimit || 3)) error = 'RETRY_EXHAUSTED';
            else {
              assignment.status = 'queued';
              assignment.queueDeadlineAt = now() + 120000;
              assignment.progress = 'The runtime lost its lease. Waiting for a fresh claim.';
            }
          } else return 0;
          if (error) {
            assignment.status = 'failed';
            assignment.endedAt = now();
            assignment.error = error;
            assignment.progress = error === 'SUPPLIER_UNAVAILABLE' ? 'The runtime did not start within the connection window.' : error === 'RETRY_EXHAUSTED' ? 'The runtime exhausted its retry attempts.' : 'The execution window expired before delivery.';
          }
          assignment.leaseHash = null;
          touch(task, now());
          event(task, 'system', error ? 'execution.failed' : 'execution.requeued', now());
          await saveTask(repo, task);
          return 1;
        });
      }
    }
    return { cursors: next, changed };
  }
  return { lifecycleActions, cancelExecution, reconcileExecutions, executionQueue, retryExecution };
}
module.exports = { createLifecycle };
