'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');

// Bind approval to the immutable offer and scope, never the conversation's
// version: adding an ordinary message must not invalidate a spending decision.
function agreement(task) {
  const offer = task.offers.find(item => item.id === task.selectedOfferId);
  if (!offer) return null;
  const value = { offer, scopeVersion: task.scopeVersion, title: task.title,
    brief: task.brief, inputHash: task.input?.sha256 || null };
  return { fingerprint: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    offerId: offer.id, agentName: offer.agentName || 'Agent', amountMinor: offer.amountMinor,
    currency: offer.currency, expiresAt: offer.expiresAt, deliveryMinutes: offer.deliveryMinutes,
    scopeVersion: task.scopeVersion, title: task.title, brief: task.brief };
}
function approvalView(task, now) {
  if (!task.companyApprovalRequired) return null;
  const approval = task.approval;
  if (!approval) return { status: 'required' };
  const invalid = approval.agreement.fingerprint !== agreement(task)?.fingerprint || task.status === 'cancelled';
  const expired = !task.assignment && (!task.settlement || ['expired', 'refunded'].includes(task.settlement.status)) && approval.agreement.expiresAt <= now;
  return { ...approval, status: ['pending', 'approved'].includes(approval.status) && (invalid || expired) ? 'stale' : approval.status };
}
function held(entry, now) {
  return entry.status === 'committed' || (entry.status === 'reserved' && entry.expiresAt > now);
}
function budgetView(budget, now) {
  if (!budget) return null;
  const entries = Object.values(budget.allocations);
  const reservedMinor = entries.filter(e => held(e, now) && e.status === 'reserved').reduce((n, e) => n + e.amountMinor, 0);
  const committedMinor = entries.filter(e => e.status === 'committed').reduce((n, e) => n + e.amountMinor, 0);
  return { limitMinor: budget.limitMinor, reservedMinor, committedMinor,
    availableMinor: budget.limitMinor - reservedMinor - committedMinor, currency: 'USD', version: budget.version };
}
// Called on every task write, under its row lock. Lock order is always task,
// then budget. Budget commands never acquire task locks in the reverse order.
async function syncApproval(repo, task) {
  const a = task.approval;
  if (!a) return;
  if (['pending', 'approved'].includes(a.status) &&
      (a.agreement.fingerprint !== agreement(task)?.fingerprint || task.status === 'cancelled' || (task.settlement?.id !== a.previousSettlementId && ['expired', 'refunded'].includes(task.settlement?.status)))) a.status = 'stale';
  const budget = await repo.get('company-budget', task.tenantId, true);
  const allocation = budget?.allocations[a.id];
  if (allocation) {
    const payment = task.settlement?.id !== a.previousSettlementId ? task.settlement : null;
    let status = allocation.status;
    if (payment && !['expired', 'refunded'].includes(payment.status)) status = 'committed';
    else if (task.assignment && !['cancelled', 'failed', 'accepted'].includes(task.assignment.status)) status = 'committed';
    else if (task.assignment || a.status !== 'approved' || ['expired', 'refunded'].includes(payment?.status)) status = 'released';
    if (status !== allocation.status) {
      allocation.status = status;
      budget.version++;
      await repo.save('company-budget', budget);
    }
  }
  await repo.save('approval-request', { ...a, taskId: task.id, tenantId: task.tenantId, ownerId: task.ownerId });
}
function createApprovals(context) {
  const { repository, command, taskFor, now, expected, touch, event, resolveOperator } = context;
  async function member(actor, tenantId, roles) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to continue.');
    const current = resolveOperator ? await resolveOperator(actor.user.id) : actor;
    const m = (current?.memberships || []).find(item => item.id === tenantId && item.company);
    if (!m || (roles && !roles.includes(m.role))) fail(403, 'FORBIDDEN', 'Your company role cannot perform this action.');
    return m;
  }
  async function companyBudget(actor, tenantId, after = '') {
    const m = await member(actor, tenantId);
    const page = require('./supplier-feed.cjs').pageInput(after, 50);
    return repository.read(async repo => {
      const budget = await repo.get('company-budget', tenantId);
      const rows = await repo.page('approval-request', m.role === 'employee' ? 'owner_id' : 'tenant_id', m.role === 'employee' ? actor.user.id : tenantId, page);
      return { budget: budgetView(budget, now()), requests: await Promise.all(rows.filter(r => r.tenantId === tenantId).map(async r => {
        const allocation = budget?.allocations[r.id];
        const expired = ['approved', 'pending'].includes(r.status) && r.agreement.expiresAt <= now() && allocation?.status !== 'committed';
        const task = await repo.get('task', r.taskId);
        const actions = task?.approval?.id === r.id
          ? await approvalActions(repo, actor, task)
          : Object.fromEntries(['request', 'approve', 'decline'].map(action => [action, { allowed: false, code: 'APPROVAL_STALE', reason: 'This request was replaced. Review the current request.' }]));
        return { ...r, actions, status: expired ? 'expired' : r.status, reservation: allocation?.status || null };
      })), nextCursor: rows.at(-1)?.id || after, hasMore: rows.length === page.limit };
    });
  }
  async function configureBudget(actor, tenantId, body, key) {
    exactKeys(body, ['limitMinor', 'expectedVersion']);
    if (!Number.isSafeInteger(body.limitMinor) || body.limitMinor < 0 || body.limitMinor > 100000000) fail(400, 'INVALID_INPUT', 'Choose a USD allowance between $0 and $1,000,000.');
    return command(actor.user.id, key, ['budget', tenantId, body], () => member(actor, tenantId, ['owner']), async repo => {
      let budget = await repo.get('company-budget', tenantId, true);
      if ((budget?.version || 0) !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', 'The budget changed. Refresh before saving.');
      budget ||= { id: tenantId, tenantId, ownerId: actor.user.id, version: 0, allocations: {} };
      const used = Object.values(budget.allocations).filter(e => held(e, now())).reduce((n, e) => n + e.amountMinor, 0);
      if (body.limitMinor < used) fail(409, 'BUDGET_RESERVED', 'The allowance cannot be below existing commitments.');
      budget.limitMinor = body.limitMinor; budget.version++;
      await repo.save('company-budget', budget);
      await repo.save('budget-audit', { id: randomUUID(), ownerId: actor.user.id, tenantId, limitMinor: body.limitMinor, version: budget.version, createdAt: now() });
      return budgetView(budget, now());
    }, `company-budget:${tenantId}`);
  }
  async function checkRequest(repo, actor, task) {
    await taskFor(repo, actor, task.id, true);
    if (task.workPlan && task.workPlan.cadence !== 'once') fail(409, 'SCHEDULE_REQUIRED', 'Approval is required for each individual run, not the recurring request.');
    const requester = await member(actor, task.tenantId, ['owner', 'employee']);
    if (task.assignment || task.settlement && !['expired', 'refunded'].includes(task.settlement.status)) fail(409, 'TASK_COMMITTED', 'This task is already committed.');
    const terms = agreement(task);
    if (task.status !== 'posted' || !terms || terms.expiresAt <= now() || terms.scopeVersion !== task.offers.find(o => o.id === terms.offerId).scopeVersion) fail(409, 'OFFER_UNAVAILABLE', 'Choose a current offer first.');
    if (terms.currency !== 'USD') fail(409, 'CURRENCY_UNSUPPORTED', 'Company allowances currently use USD.');
    if (['pending', 'approved'].includes(approvalView(task, now())?.status)) fail(409, 'APPROVAL_EXISTS', 'This offer already has an active approval request.');
    return { requester, terms };
  }
  async function requestApproval(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'note']);
    const note = text(body.note, 'Reason for the request', 1, 2000);
    return command(actor.user.id, key, ['approval-request', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      const { requester, terms } = await checkRequest(repo, actor, task);
      if (task.approval) await repo.save('approval-request', { ...task.approval, superseded: true, taskId: task.id, tenantId: task.tenantId, ownerId: task.ownerId });
      task.companyApprovalRequired = true;
      task.approval = { previousSettlementId: task.settlement?.id || null, id: randomUUID(), status: 'pending', version: 1, agreement: terms, note, requesterEpoch: requester.accessEpoch ?? null, requestedBy: actor.user.id, requestedAt: now() };
      touch(task, now()); event(task, actor.user.id, 'approval.requested', now());
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { taskId: id, version: task.version };
    });
  }
  async function checkDecision(repo, actor, task, decision) {
    await member(actor, task.tenantId, ['owner', 'approver']);
    const a = task.approval;
    if (!a || approvalView(task, now())?.status !== 'pending') fail(409, 'APPROVAL_STALE', 'This request changed or expired. Ask for a fresh request.');
    // A removed requester cannot obtain a new allocation through an old queue entry.
    if (resolveOperator) await member(await resolveOperator(a.requestedBy), task.tenantId, ['owner', 'employee']);
    if (decision === 'approved') {
      const budget = await repo.get('company-budget', task.tenantId, true);
      if (!budget) fail(409, 'BUDGET_REQUIRED', 'An administrator must set the company allowance first.');
      if (budgetView(budget, now()).availableMinor < a.agreement.amountMinor) fail(409, 'BUDGET_EXCEEDED', 'Not enough unreserved company budget.');
      if (Object.keys(budget.allocations).length >= 1000) fail(409, 'BUDGET_HISTORY_LIMIT', 'This local allowance has reached its history limit.');
      return budget;
    }
    return null;
  }
  async function approvalActions(repo, actor, task) {
    const { availability } = require('./action-availability.cjs');
    return {
      request: await availability(() => checkRequest(repo, actor, task)),
      approve: await availability(() => checkDecision(repo, actor, task, 'approved')),
      decline: await availability(() => checkDecision(repo, actor, task, 'declined')),
    };
  }
  async function decideApproval(actor, id, body, key) {
    exactKeys(body, ['approvalId', 'expectedVersion', 'decision', 'note']);
    if (!['approved', 'declined'].includes(body.decision)) fail(400, 'INVALID_INPUT', 'Choose approve or decline.');
    const note = text(body.note, 'Decision reason', 1, 2000);
    const access = async repo => {
      const task = await repo.get('task', id, true);
      if (!task) fail(404, 'NOT_FOUND', 'Request not found.');
      await member(actor, task.tenantId, ['owner', 'approver']);
      if (task.approval?.id !== body.approvalId || approvalView(task, now())?.status === 'stale') fail(409, 'APPROVAL_STALE', 'This request changed. Submit a fresh request.');
      return task;
    };
    return command(actor.user.id, key, ['approval-decision', id, body], access, async repo => {
      const task = await access(repo), a = task.approval;
      if (!a || a.id !== body.approvalId || a.version !== body.expectedVersion || approvalView(task, now()).status !== 'pending') fail(409, 'APPROVAL_STALE', 'This request changed or expired. Ask for a fresh request.');
      const budget = await checkDecision(repo, actor, task, body.decision);
      if (body.decision === 'approved') {
        budget.allocations[a.id] = { taskId: id, amountMinor: a.agreement.amountMinor, expiresAt: a.agreement.expiresAt, status: 'reserved' };
        budget.version++; await repo.save('company-budget', budget);
      }
      a.reviewerEpoch = (await member(actor, task.tenantId, ['owner', 'approver'])).accessEpoch ?? null;
      a.status = body.decision; a.version++; a.decisionNote = note; a.decidedBy = actor.user.id; a.decidedAt = now();
      touch(task, now()); event(task, actor.user.id, `approval.${body.decision}`, now());
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { taskId: id, status: a.status };
    });
  }
  async function requireApproval(repo, actor, task) {
    const company = task.companyApprovalRequired || actor.memberships.find(m => m.id === task.tenantId)?.company;
    if (!company) return;
    task.companyApprovalRequired = true;
    await member(actor, task.tenantId, ['owner', 'employee']);
    const a = approvalView(task, now());
    if (a?.status !== 'approved') fail(403, 'APPROVAL_REQUIRED', 'Request company approval for this exact offer before starting or funding work.');
    if (!resolveOperator) fail(503, 'MEMBERSHIP_UNAVAILABLE', 'Current approver access cannot be verified.');
    const reviewer = await member(await resolveOperator(a.decidedBy), task.tenantId, ['owner', 'approver']);
    const requester = await member(await resolveOperator(a.requestedBy), task.tenantId, ['owner', 'employee']);
    if ((reviewer.accessEpoch ?? null) !== (a.reviewerEpoch ?? null) || (requester.accessEpoch ?? null) !== (a.requesterEpoch ?? null)) fail(403, 'APPROVAL_REQUIRED', 'Company access changed. Request fresh approval.');
    const budget = await repo.get('company-budget', task.tenantId, true);
    const allocation = budget?.allocations[a.id];
    if (!allocation || !held(allocation, now())) fail(409, 'RESERVATION_EXPIRED', 'The budget reservation expired. Request approval again.');
  }
  return { approvalActions, companyBudget, configureBudget, requestApproval, decideApproval, requireApproval };
}
module.exports = { createApprovals, approvalView, syncApproval, budgetView };
