'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const PENDING = new Set(['creating_checkout','awaiting_payment','creating_refund','refund_pending','creating_transfer','creating_payout','payout_pending']);
const referenceKey = (id, account = null) => `${account || 'platform'}:${id}`;

async function enqueue(repo, type, id, now, wake = false) {
  const key = `${type}:${id}`;
  const job = await repo.get('payment-job', key, true);
  if (job) {
    if (wake && job.status !== 'review' && !job.failures) {
      job.nextAt = now; job.wakeVersion = (job.wakeVersion || 0) + 1;
      await repo.save('payment-job', job);
    }
    return;
  }
  await repo.save('payment-job', { id: key, ownerId: 'system', type, targetId: id, status: 'pending', nextAt: now, failures: 0, wakeVersion: 0 });
}
async function indexPayment(repo, task, now, wake = false) {
  const p = task.settlement;
  if (!p) return;
  for (const field of ['sessionId','intentId','chargeId','refundId','transferId','payoutId']) {
    if (!p[field]) continue;
    const id = referenceKey(p[field], field === 'payoutId' ? p.accountId : null);
    const existing = await repo.get('payment-reference', id);
    if (existing && (existing.targetId !== task.id || existing.settlementId !== p.id)) fail(409, 'PROVIDER_REFERENCE_CONFLICT', 'Provider object is already bound to another settlement.');
    await repo.save('payment-reference', { id, ownerId: 'system', type: 'task', targetId: task.id, settlementId: p.id });
  }
  await enqueue(repo, 'task', task.id, now, wake);
  // A provider-declared failure is not a successful status check to retry forever.
  if (['refund_failed', 'payout_failed'].includes(p.status)) {
    const job = await repo.get('payment-job', `task:${task.id}`, true);
    if (job.status !== 'review') {
      job.status = 'review';
      job.errorCode = 'PAYMENT_STATE_REVIEW';
      await repo.save('payment-job', job);
    }
  }
}
async function indexOperator(repo, operator, now) {
  if (!operator.accountId) return;
  // account.updated can be sent by the platform or a connected-account endpoint.
  for (const account of [null, operator.accountId]) {
    await repo.save('payment-reference', { id: referenceKey(operator.accountId, account), ownerId: 'system', type: 'operator', targetId: operator.id });
  }
  await enqueue(repo, 'operator', operator.id, now);
}
function createPaymentJobs({ repository, now, enabled, reconcileTask, refreshOperator }) {
  async function receive(event) {
    if (!enabled) fail(503, 'SANDBOX_NOT_CONNECTED', 'Stripe sandbox is not connected.');
    return repository.transaction(`payment-event:${event.id}`, async repo => {
      const old = await repo.get('payment-event', event.id, true);
      if (old) {
        if (old.fingerprint !== event.fingerprint) fail(409, 'EVENT_CONFLICT', 'Event identity conflicts with a saved event.');
        return { received: true, duplicate: true };
      }
      await repo.save('payment-event', { ...event, ownerId: 'system', status: event.supported ? 'pending' : 'ignored', receivedAt: now(), attempts: 0, nextAt: now() });
      return { received: true };
    });
  }
  async function page(kind, name, limit, status = null) {
    return repository.transaction(`payment-cursor:${name}`, async repo => {
      const cursor = await repo.get('payment-cursor', name, true) || { id: name, ownerId: 'system', after: '' };
      const rows = status ? await repo.page(kind, 'status', status, { after: cursor.after, limit }) : await repo.scan(kind, { after: cursor.after, limit });
      cursor.after = rows.length === limit ? rows.at(-1).id : '';
      await repo.save('payment-cursor', cursor);
      return rows;
    });
  }
  async function tick() {
    if (!enabled) return { enabled: false, checked: 0 };
    // Bounded discovery also backfills old records and recovers a crash between
    // provider response and indexing. Persistent cursors prevent first-page starvation.
    for (const task of await page('task', 'tasks', 10)) {
      if (!task.settlement) continue;
      await repository.transaction(`sandbox-task:${task.id}`, async repo => indexPayment(repo, await repo.get('task', task.id, true), now()));
    }
    for (const operator of await page('sandbox-operator', 'operators', 10)) {
      await repository.transaction(`sandbox-operator:${operator.id}`, async repo => indexOperator(repo, await repo.get('sandbox-operator', operator.id, true), now()));
    }
    for (const item of await page('payment-event', 'events', 20, 'pending')) {
      if (item.status !== 'pending' || item.nextAt > now()) continue;
      await repository.transaction(`payment-event:${item.id}`, async repo => {
        const event = await repo.get('payment-event', item.id, true);
        if (event.status !== 'pending' || event.nextAt > now()) return;
        const ref = await repo.get('payment-reference', referenceKey(event.objectId, event.account));
        if (ref) {
          await enqueue(repo, ref.type, ref.targetId, now(), true);
          event.status = 'scheduled'; // A hint was queued, not a claim of settlement.
        } else {
          event.attempts++; event.nextAt = now() + Math.min(900000, 5000 * 2 ** event.attempts);
          if (event.attempts >= 12) event.status = 'unmatched';
        }
        await repo.save('payment-event', event);
      });
    }
    let checked = 0;
    for (const item of await page('payment-job', 'jobs', 4, 'pending')) {
      const claim = await repository.transaction(`payment-job:${item.id}`, async repo => {
        const job = await repo.get('payment-job', item.id, true);
        if (job.status === 'review' || job.nextAt > now() || job.leaseUntil > now()) return null;
        job.leaseToken = randomUUID(); job.leaseUntil = now() + 60000;
        await repo.save('payment-job', job); return job;
      });
      if (!claim) continue;
      let error, result;
      try {
        result = claim.type === 'task' ? await reconcileTask(claim.targetId) : await refreshOperator(claim.targetId);
        if (['refund_failed', 'payout_failed'].includes(result?.status)) {
          error = { code: 'PAYMENT_STATE_REVIEW' };
        }
      } catch (caught) { error = caught; }
      await repository.transaction(`payment-job:${item.id}`, async repo => {
        const job = await repo.get('payment-job', item.id, true);
        if (job.leaseToken !== claim.leaseToken) return;
        job.leaseUntil = 0; job.leaseToken = null; job.lastCheckedAt = now();
        if (error) {
          job.failures++;
          job.errorCode = ['RECONCILIATION_REQUIRED','PAYMENT_STATE_REVIEW'].includes(error.code) ? error.code : 'PROVIDER_CHECK_FAILED';
          job.status = job.failures >= 12 || job.errorCode !== 'PROVIDER_CHECK_FAILED' ? 'review' : 'pending';
          job.nextAt = now() + Math.min(900000, 5000 * 2 ** job.failures);
        } else {
          job.failures = 0; job.errorCode = null; job.status = 'pending';
          const interval = claim.type === 'operator' ? 60000 : PENDING.has(result?.status) ? 15000 : 300000;
          job.nextAt = job.wakeVersion !== claim.wakeVersion ? now() : now() + interval;
        }
        await repo.save('payment-job', job);
      });
      checked++;
    }
    return { enabled: true, checked };
  }
  return { receivePaymentEvent: receive, reconcilePayments: tick };
}
module.exports = { createPaymentJobs, indexPayment, indexOperator };
