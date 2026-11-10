'use strict';

const { randomUUID } = require('node:crypto');
const { fail, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');

const { createPaymentJobs, indexPayment, indexOperator } = require('./payment-jobs.cjs');
const TERMINAL = new Set(['expired', 'refunded']);
function assertUnfunded(task) {
  if (task.settlement && !TERMINAL.has(task.settlement.status)) {
    fail(409, 'FUNDING_LOCKED', 'Resolve the existing sandbox funding before changing this agreement.');
  }
}
function paymentView(payment, job = null) {
  if (!payment) return null;
  const { id, status, amountMinor, currency, offerId, scopeVersion, operatorId, updatedAt, ledger } = payment;
  return { id, status, amountMinor, currency, offerId, scopeVersion, operatorId, updatedAt,
    sandbox: true, platformFeeMinor: 0, ledger: ledger || [],
    reconciliation: job ? { status: job.status === 'review' ? 'needs_review' : job.failures ? 'retrying' : 'automatic', lastCheckedAt: job.lastCheckedAt || null, nextCheckAt: job.nextAt, errorCode: job.errorCode || null } : null };
}

function createPayments(context, provider) {
  const { repository, command, taskFor, now, expected, touch, event } = context;
  const enabled = !!provider && context.localExecution;
  const recovery = require('./payment-recovery.cjs').createPaymentRecovery(context, enabled);
  const configured = () => {
    if (!enabled) fail(503, 'SANDBOX_NOT_CONNECTED', 'Stripe sandbox is not connected. No money has moved.');
  };
  const active = actor => {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'An active account is required.');
  };
  const ownerBuyer = async (repo, actor, id) => {
    const task = await taskFor(repo, actor, id, true);
    require('./orchestration.cjs').fixedScope(task);
    if (actor.memberships.find(m => m.id === task.tenantId)?.role !== 'owner') {
      fail(403, 'APPROVAL_REQUIRED', 'Sandbox funding currently requires the workspace owner.');
    }
    return task;
  };
  async function participant(repo, actor, id) {
    active(actor);
    const task = await repo.get('task', id, true);
    if (task?.settlement?.operatorId === actor.user.id) return task;
    return taskFor(repo, actor, id);
  }
  function ready(operator) {
    return operator?.ready === true && operator.manualPayouts === true && operator.checkedAt > now() - 300000;
  }
  async function status(actor) {
    active(actor);
    return repository.read(async repo => {
      const op = await repo.get('sandbox-operator', actor.user.id);
      return { recoveryAccess: recovery.hasAccess(actor), configured: enabled, mode: 'sandbox', livePayments: false,
        operator: op ? { status: ready(op) ? 'sandbox_ready' : op.ready ? 'refresh_required' : op.accountId ? 'onboarding_required' : 'creating', country: op.country,
          requirements: op.requirements || [], pending: !!op.pending, checkedAt: op.checkedAt || null } : { status: 'not_started' } };
    });
  }
  const spendingHistory = require('./spending-snapshots.cjs').createSpendingReports(context);
  // An operation is durably reserved before contacting Stripe. After an unknown
  // outcome, retries use the SAME provider key. Never replay beyond its window.
  function retryWindow(operation) {
    if (now() - operation.createdAt >= 23 * 3600000) {
      fail(409, 'RECONCILIATION_REQUIRED', 'This uncertain operation needs provider reconciliation before another attempt.');
    }
  }
  async function onboard(actor, body, key) {
    configured(); active(actor); exactKeys(body, ['country']);
    if (!/^[A-Z]{2}$/.test(body.country || '')) fail(400, 'INVALID_COUNTRY', 'Choose a two-letter country code.');
    await command(actor.user.id, key, ['sandbox-operator', body], async () => active(actor), async repo => {
      // The shared per-owner lock also protects concurrent keys and creation.
      return { requested: true };
    });
    let op = await repository.transaction(`sandbox-operator:${actor.user.id}`, async repo => {
      const current = await repo.get('sandbox-operator', actor.user.id, true);
      if (current) {
        if (current.country !== body.country) fail(409, 'COUNTRY_LOCKED', 'Use the existing operator account country.');
        if (!current.accountId && !current.contactEmail) {
          fail(409, 'OPERATOR_MIGRATION_REVIEW', 'An earlier operator setup needs reconciliation before upgrading its Stripe API version.');
        }
        return current;
      }
      const record = { id: actor.user.id, ownerId: actor.user.id, country: body.country, contactEmail: actor.user.email, operationId: randomUUID(), createdAt: now(), status: 'creating' };
      await repo.save('sandbox-operator', record); return record;
    });
    if (!op.accountId) {
      retryWindow(op);
      const result = await provider.createOperator({ ...op, id: op.operationId });
      op = await repository.transaction(`sandbox-operator:${actor.user.id}`, async repo => {
        const current = await repo.get('sandbox-operator', actor.user.id, true);
        if (!current.accountId) {
          current.accountId = result.accountId; current.status = 'onboarding_required';
          await repo.save('sandbox-operator', current);
          await indexOperator(repo, current, now());
        } else if (current.accountId !== result.accountId) fail(502, 'OPERATOR_MISMATCH', 'Provider returned a different operator account.');
        return current;
      });
    }
    // Links are short-lived and single-use, never persisted in task evidence.
    return provider.onboarding(op.accountId, randomUUID());
  }
  async function refreshOperator(actor) {
    configured(); active(actor);
    await refreshOperatorRecord(actor.user.id);
    return status(actor);
  }
  async function refreshOperatorRecord(operatorId) {
    const previous = await repository.read(repo => repo.get('sandbox-operator', operatorId));
    if (!previous?.accountId) fail(409, 'ONBOARDING_REQUIRED', 'Start sandbox operator onboarding first.');
    const requestedAt = now(), checkToken = randomUUID();
    await repository.transaction(`sandbox-operator:${operatorId}`, async repo => {
      const op = await repo.get('sandbox-operator', operatorId, true);
      op.checkToken = checkToken; await repo.save('sandbox-operator', op);
    });
    const result = await provider.operator(previous.accountId);
    if (result.accountId !== previous.accountId) fail(502, 'OPERATOR_MISMATCH', 'Operator account does not match.');
    await repository.transaction(`sandbox-operator:${operatorId}`, async repo => {
      const op = await repo.get('sandbox-operator', operatorId, true);
      if (op.checkToken !== checkToken) return;
      Object.assign(op, result, { checkedAt: requestedAt });
      await repo.save('sandbox-operator', op);
    });
    return { status: 'checked' };
  }
  async function checkAction(repo, actor, task, action) {
    configured(); active(actor);
    const id = task.id, p = task.settlement;
    await participant(repo, actor, id);
    const sync = await repo.get('payment-job', `task:${id}`);
    if (sync?.status === 'review') fail(409, 'RECONCILIATION_REQUIRED', 'Resolve the payment review before authorizing another operation.');
    if (action === 'fund') {
      if (task.workPlan && task.workPlan.cadence !== 'once') fail(409, 'SCHEDULE_REQUIRED', 'Funding belongs to individual runs, not the recurring request.');
      await taskFor(repo, actor, id, true);
      if (!task.companyApprovalRequired && !actor.memberships.find(m => m.id === task.tenantId)?.company) await ownerBuyer(repo, actor, id);
      assertUnfunded(task);
      if (task.assignment || task.status !== 'posted') fail(409, 'FUNDING_UNAVAILABLE', 'Select an offer before funding.');
      const offer = task.offers.find(o => o.id === task.selectedOfferId);
      if (!offer || offer.scopeVersion !== task.scopeVersion || offer.expiresAt <= now()) fail(409, 'OFFER_UNAVAILABLE', 'Select a current offer.');
      if (!Number.isSafeInteger(offer.amountMinor) || offer.amountMinor < 50 || offer.amountMinor > 100000) fail(409, 'SANDBOX_AMOUNT_LIMIT', 'Sandbox funding supports 0.50–1,000 in the agreed currency.');
      const op = await repo.get('sandbox-operator', offer.operatorId, true);
      if (!ready(op)) fail(409, 'OPERATOR_NOT_READY', 'The operator must refresh sandbox verification and payout readiness.');
      await context.approvals.requireApproval(repo, actor, task);
    } else if (action === 'refund') {
      await ownerBuyer(repo, actor, id);
      if (p?.status !== 'funded' || (task.assignment && !['cancelled', 'failed'].includes(task.assignment.status))) {
        fail(409, 'REFUND_UNAVAILABLE', 'Stop the task first. Refunds are available before transfer, for unstarted, cancelled or failed work.');
      }
    } else {
      if (!p || p.operatorId !== actor.user.id) fail(403, 'FORBIDDEN', 'Only the selected operator can settle this task.');
      const op = await repo.get('sandbox-operator', actor.user.id, true);
      if (!ready(op) || op.accountId !== p.accountId) fail(409, 'OPERATOR_NOT_READY', 'Refresh sandbox payout readiness first.');
      if (action === 'transfer') {
        const submission = task.submissions.at(-1);
        if (p.status !== 'funded' || task.assignment?.status !== 'accepted' || submission?.status !== 'accepted' || task.assignment.offerId !== p.offerId) {
          fail(409, 'DELIVERY_NOT_ACCEPTED', 'Confirmed funding and accepted delivery are required before transfer.');
        }
      } else {
        if (p.status !== 'transferred') fail(409, 'PAYOUT_UNAVAILABLE', 'A confirmed transfer is required before payout.');
      }
    }
  }
  async function paymentActions(repo, actor, task) {
    const { availability } = require('./action-availability.cjs');
    const actions = {};
    for (const action of ['fund', 'refund', 'transfer', 'payout']) {
      actions[action] = await availability(() => checkAction(repo, actor, structuredClone(task), action));
    }
    return actions;
  }
  async function begin(actor, id, action, body, key) {
    configured(); active(actor); exactKeys(body, ['expectedVersion']);
    if (!['fund', 'refund', 'transfer', 'payout'].includes(action)) fail(404, 'NOT_FOUND', 'Unknown sandbox action.');
    if (action === 'fund' && provider.assertFundingSupported) {
      const funding = await repository.read(async repo => {
        const task = await taskFor(repo, actor, id, true);
        const offer = task.offers.find(item => item.id === task.selectedOfferId);
        const operator = offer && await repo.get('sandbox-operator', offer.operatorId);
        return operator ? { accountId: operator.accountId, currency: offer.currency || 'USD' } : null;
      });
      if (funding) await provider.assertFundingSupported(funding.accountId, funding.currency);
    }
    await command(actor.user.id, key, ['sandbox', id, action, body], repo => participant(repo, actor, id), async repo => {
      const task = await participant(repo, actor, id); expected(task, body.expectedVersion);
      await checkAction(repo, actor, task, action);
      let p = task.settlement;
      if (action === 'fund') {
        const offer = task.offers.find(o => o.id === task.selectedOfferId);
        const op = await repo.get('sandbox-operator', offer.operatorId, true);
        if (p) await repo.save('sandbox-settlement-history', { ...p, ownerId: task.ownerId });
        p = { id: randomUUID(), ownerId: task.ownerId, taskId: id, operatorId: offer.operatorId,
          accountId: op.accountId, amountMinor: offer.amountMinor, currency: offer.currency || 'USD', offerId: offer.id,
          scopeVersion: task.scopeVersion, inputHash: task.input?.sha256 || null, ledger: [], status: 'creating_checkout' };
        task.settlement = p;
      } else if (action === 'refund') {
        p.status = 'creating_refund';
      } else if (action === 'transfer') {
        p.acceptedSubmissionId = task.submissions.at(-1).id;
        p.status = 'creating_transfer';
      } else {
        p.status = 'creating_payout';
      }
      p.operationId = randomUUID(); p.createdAt = now(); p.updatedAt = now();
      touch(task, now()); event(task, actor.user.id, `sandbox.${action}.requested`, now());
      await saveTask(repo, task);
      await indexPayment(repo, task, now(), true);
      return { taskId: id, paymentId: p.id };
    });
    return reconcile(actor, id);
  }
  async function reconcile(actor, id) {
    configured();
    return reconcileRecord(id, repo => participant(repo, actor, id), actor.user.id);
  }
  async function reconcileRecord(id, authorize, actorId, verifyTerminal = false) {
    const snapshot = await repository.read(async repo => {
      const task = await authorize(repo);
      return structuredClone(task.settlement);
    });
    if (!snapshot) fail(404, 'NOT_FOUND', 'No sandbox funding exists for this task.');
    const p = snapshot;
    let result, next, entry;
    const operation = { ...p, id: p.operationId };
    if (p.status.startsWith('creating_')) retryWindow(p);
    switch (p.status) {
      case 'creating_checkout': result = await provider.checkout(operation); next = 'awaiting_payment'; break;
      case 'awaiting_payment':
        result = await provider.funding(p); next = result.status;
        if (!['awaiting_payment', 'expired', 'funded'].includes(next)) fail(502, 'INVALID_PROVIDER_STATUS', 'Unexpected funding status.');
        if (next === 'funded') entry = ['provider_cash', 'buyer_funds', result.chargeId];
        break;
      case 'creating_refund':
        result = await provider.refund(operation); next = 'refund_pending'; break;
      case 'refund_pending':
        result = await provider.refundStatus(p);
        if (result.status === 'requires_action') fail(409, 'PAYMENT_STATE_REVIEW', 'The refund requires provider review.');
        next = result.status === 'succeeded' ? 'refunded' : ['failed', 'canceled'].includes(result.status) ? 'refund_failed' : 'refund_pending';
        if (next === 'refunded') entry = ['buyer_funds', 'provider_cash', p.refundId];
        break;
      case 'creating_transfer':
        result = await provider.transfer(operation); next = 'transferred';
        entry = ['buyer_funds', 'operator_balance', result.transferId]; break;
      case 'creating_payout': result = await provider.payout(operation); next = 'payout_pending'; break;
      case 'payout_pending':
        result = await provider.payoutStatus(p);
        next = result.status === 'paid' ? 'paid' : ['failed', 'canceled'].includes(result.status) ? 'payout_failed' : 'payout_pending';
        if (next === 'paid') entry = ['operator_balance', 'sandbox_payout', p.payoutId];
        break;
      default:
        if (verifyTerminal && ['paid','payout_failed'].includes(p.status)) {
          const check = await provider.payoutStatus(p);
          if ((p.status === 'paid' && check.status !== 'paid') || (p.status === 'payout_failed' && !['failed','canceled'].includes(check.status))) fail(409, 'PAYMENT_STATE_REVIEW', 'A completed payout changed at the provider. Reconciliation review is required.');
        }
        return paymentView(p);
    }
    return repository.transaction(`sandbox-task:${id}`, async repo => {
      const task = await authorize(repo), current = task.settlement;
      // A late response cannot overwrite a newer refund, transfer or payout.
      if (current.id !== p.id || current.status !== p.status || current.operationId !== p.operationId) return paymentView(current);
      // Provider status is deliberately not spread over domain status.
      for (const field of ['sessionId', 'url', 'intentId', 'chargeId', 'refundId', 'transferId', 'payoutId']) {
        if (result[field] !== undefined) current[field] = result[field];
      }
      if (current.status === next && !entry) return paymentView(current);
      current.status = next; current.updatedAt = now();
      if (entry && !current.ledger.some(e => e.reference === entry[2])) {
        current.ledger.push({ debit: entry[0], credit: entry[1], amountMinor: p.amountMinor, currency: p.currency || 'USD', reference: entry[2], createdAt: now() });
      }
      touch(task, now()); event(task, actorId, `sandbox.${next}`, now()); await saveTask(repo, task);
      await indexPayment(repo, task, now(), true);
      return paymentView(current);
    });
  }
  async function taskPayment(actor, id) {
    return repository.read(async repo => paymentView((await participant(repo, actor, id)).settlement, await repo.get('payment-job', `task:${id}`)));
  }
  async function checkoutLink(actor, id) {
    configured();
    return repository.read(async repo => {
      const task = await taskFor(repo, actor, id, true);
      if (task.companyApprovalRequired) await context.approvals.requireApproval(repo, actor, task);
      else await ownerBuyer(repo, actor, id);
      if (task.settlement?.status !== 'awaiting_payment') fail(409, 'CHECKOUT_UNAVAILABLE', 'Reconcile funding before opening checkout.');
      return { url: task.settlement.url };
    });
  }
  const jobs = createPaymentJobs({ repository, now, enabled, refreshOperator: refreshOperatorRecord,
    reconcileTask: id => reconcileRecord(id, repo => repo.get('task', id, true), 'system:payment-reconciliation', true) });
  return { paymentActions, ...jobs, paymentRecovery: recovery.paymentRecovery, retryPaymentRecovery: recovery.retryPaymentRecovery, paymentStatus: status, spendingHistory, onboardOperator: onboard, refreshOperator, sandboxPayment: begin,
    reconcilePayment: reconcile, taskPayment, checkoutLink };
}
module.exports = { createPayments, assertUnfunded, paymentView };
