'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { fail, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const snapshot = job => createHash('sha256').update(JSON.stringify(job)).digest('hex');

// Operations access is server configured, never inferred from workspace ownership.
function createPaymentRecovery({ repository, now, localExecution, paymentRecoveryUserIds = [] }, enabled) {
  const allowed = new Set(paymentRecoveryUserIds);
  const hasAccess = actor => !!localExecution && !!actor?.user?.id && !actor.recoveryRequired && allowed.has(actor.user.id);
  function authorize(actor) {
    if (!hasAccess(actor)) fail(403, 'FORBIDDEN', 'Payment recovery requires operations access.');
  }
  function policy(job) {
    if (!enabled) return 'Connect the sandbox before retrying.';
    if (job.leaseUntil > now()) return 'A check is already running. Wait for its result.';
    if (['RECONCILIATION_REQUIRED', 'PAYMENT_STATE_REVIEW'].includes(job.errorCode)) return 'Provider evidence must be reviewed manually. Automatic retry cannot resolve this discrepancy.';
    if (job.nextAt > now() && !job.failures) return 'The next automatic check is already scheduled.';
    if (job.recoveryRequestedAt && now() - job.recoveryRequestedAt < 60000) return 'A retry was just requested. Allow one minute before trying again.';
    return null;
  }
  async function list(actor, after = '') {
    authorize(actor);
    if (typeof after !== 'string' || after.length > 160) fail(400, 'INVALID_CURSOR', 'Invalid recovery cursor.');
    return repository.read(async repo => {
      const rows = await repo.scan('payment-job', { after, limit: 25 });
      const items = await Promise.all(rows.map(async job => {
        const task = job.type === 'task' ? await repo.get('task', job.targetId) : null;
        const blockedReason = policy(job);
        const history = await repo.list('payment-recovery', 'tenant_id', job.id, 100);
        return { id: job.id, title: task?.title || 'Operator verification', type: job.type,
          status: job.status === 'review' ? 'needs_review' : job.failures ? 'retrying' : job.leaseUntil > now() ? 'checking' : job.nextAt < now() - 60000 ? 'overdue' : 'scheduled',
          paymentStatus: task?.settlement?.status || null, amountMinor: task?.settlement?.amountMinor ?? null,
          failures: job.failures, lastCheckedAt: job.lastCheckedAt || null, nextAt: job.nextAt,
          errorCode: job.errorCode || null, snapshot: snapshot(job), canRetry: !blockedReason, blockedReason,
          references: task?.settlement ? ['sessionId','intentId','refundId','transferId','payoutId'].filter(field=>task.settlement[field]).map(field=>({type:field,id:task.settlement[field]})) : [],
          history: history.sort((a,b)=>b.createdAt-a.createdAt).slice(0,10).map(({createdAt,reason,actorId})=>({createdAt,reason,actorId})) };
      }));
      return { configured: enabled, items, next: rows.length === 25 ? rows.at(-1).id : null };
    });
  }
  async function retry(actor, id, body, key) {
    authorize(actor);
    exactKeys(body, ['snapshot', 'reason']);
    if (typeof id !== 'string' || id.length > 160 || !/^[a-f0-9]{64}$/.test(body.snapshot || '') || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 500) fail(400, 'INVALID_RECOVERY', 'Review the latest state and add a reason of 10–500 characters.');
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail(400, 'IDEMPOTENCY_REQUIRED', 'A valid request key is required.');
    const fingerprint = createHash('sha256').update(JSON.stringify([id, body.snapshot, body.reason.trim()])).digest('hex');
    // Same lock as the worker; the receipt, audit and scheduling commit together.
    return repository.transaction(`payment-job:${id}`, async repo => {
      authorize(actor);
      const previous = await repo.receipt(actor.user.id, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for different content.');
        return previous.result;
      }
      const job = await repo.get('payment-job', id, true);
      if (!job) fail(404, 'NOT_FOUND', 'Payment check not found.');
      if (snapshot(job) !== body.snapshot) fail(409, 'RECOVERY_STALE', 'The payment changed. Refresh and review it before retrying.');
      const blocked = policy(job);
      if (blocked) fail(409, 'RECOVERY_BLOCKED', blocked);
      const previousErrorCode = job.errorCode, previousFailures = job.failures;
      job.status = 'pending'; job.failures = 0; job.errorCode = null; job.nextAt = now();
      job.recoveryRequestedAt = now(); job.wakeVersion = (job.wakeVersion || 0) + 1;
      await repo.save('payment-job', job);
      await repo.save('payment-recovery', { id: randomUUID(), ownerId: actor.user.id, tenantId: job.id,
        actorId: actor.user.id, reason: body.reason.trim(), createdAt: now(), previousSnapshot: body.snapshot, previousErrorCode, previousFailures });
      const result = { scheduled: true, message: 'A check is queued. No new payment was authorized.' };
      await repo.saveReceipt(actor.user.id, key, fingerprint, result);
      return result;
    });
  }
  return { hasAccess, paymentRecovery: list, retryPaymentRecovery: retry };
}
module.exports = { createPaymentRecovery };
