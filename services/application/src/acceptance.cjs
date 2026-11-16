'use strict';

// Acceptance policy (docs/Decisions-Needed.md §2, "Acceptance and exits").
//
// 1. Acceptance criteria are a short checklist on the scope. Changing them is a
//    scope change: offers made for the old scope are invalidated, and authorized
//    work keeps the criteria frozen in its agreement.
// 2. Fixes are free until the agreed criteria are met. A revision request can
//    name the criteria that are not met yet.
// 3. Either side can exit. After END_AFTER_ROUNDS revision rounds the buyer can end
//    the work as unmet: it counts as a failed run in the outcome ledger and the
//    buyer can try another agent. The builder can already withdraw by failing the
//    assignment.
// 4. Silence counts as acceptance only when the deployment turns it on
//    (autoAcceptAfterMs). It stays off until payments are live.
//
// No money moves here. Ending work that has a held payment is refused until refunds
// are wired to this exit, so the buyer is never told money moved when it didn't.

const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');

const MAX_CRITERIA = 12;
const END_AFTER_ROUNDS = 2;
// Free fixes are bounded only by the exit rule, plus a safety cap on runaway loops.
const MAX_REVISION_ROUNDS = 10;
const ENDABLE = ['queued', 'running', 'buyer_review'];

function normalizeCriteria(value) {
  if (!Array.isArray(value)) fail(400, 'INVALID_INPUT', 'Acceptance criteria must be a list.');
  if (value.length > MAX_CRITERIA) fail(400, 'INVALID_INPUT', `Keep acceptance criteria to ${MAX_CRITERIA} items.`);
  const seen = new Set();
  return value.map((item, index) => {
    const criterion = text(item, `Criterion ${index + 1}`, 3, 300);
    const key = criterion.toLowerCase();
    if (seen.has(key)) fail(400, 'INVALID_INPUT', 'Each acceptance criterion must be different.');
    seen.add(key);
    return { id: `c${index + 1}`, text: criterion };
  });
}

function criteriaFor(task) {
  return task.assignment?.agreement?.acceptanceCriteria || task.acceptanceCriteria || [];
}

function revisionRounds(task) {
  return (task.submissions || []).filter(item => item.status === 'revision_requested').length;
}

function unmetCriteriaInput(task, value) {
  if (value === undefined) return [];
  const agreed = new Set(criteriaFor(task).map(item => item.id));
  if (!Array.isArray(value) || value.some(id => !agreed.has(id)) || new Set(value).size !== value.length)
    fail(400, 'INVALID_INPUT', 'Choose criteria from the agreement.');
  return value;
}

function checkEnd(task) {
  const job = task.assignment;
  if (!job || !ENDABLE.includes(job.status)) fail(409, 'STATE_CONFLICT', 'Only work in progress or awaiting review can be ended.');
  if (revisionRounds(task) < END_AFTER_ROUNDS)
    fail(409, 'END_NOT_YET', `You can end the work as unmet after ${END_AFTER_ROUNDS} rounds of changes. Request changes first, naming what isn’t met.`);
  if (job.mode === 'stripe-sandbox' || (task.settlement && task.settlement.status !== 'refunded'))
    fail(409, 'REFUND_REQUIRED', 'This work has a held payment. Ending it needs a refund, and refunds aren’t connected to this step yet.');
}

function acceptanceView(task) {
  return { criteria: criteriaFor(task), revisionRounds: revisionRounds(task), endAfterRounds: END_AFTER_ROUNDS,
    unmetCriteria: task.assignment?.unmetCriteria || [] };
}

function createAcceptance({ command, taskFor, expected, now, touch, event, saveTask, assertUnfunded }) {
  async function setCriteria(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'criteria']);
    const criteria = normalizeCriteria(body.criteria);
    return command(actor.user.id, key, ['acceptance-criteria', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true);
      expected(task, body.expectedVersion);
      if (task.status === 'cancelled') fail(409, 'TASK_CLOSED', 'This request is closed.');
      if (task.assignment) fail(409, 'TASK_ASSIGNED', 'Authorized work keeps its agreed criteria. Propose a change instead.');
      if (task.orchestrationPlan || task.orchestrationStep) require('./orchestration.cjs').fixedScope(task);
      if (task.scheduleId || task.recurringScheduleId) fail(409, 'SCHEDULE_MANAGED', 'Recurring runs use an immutable scope.');
      assertUnfunded(task);
      const time = now();
      task.acceptanceCriteria = criteria;
      task.scopeVersion++;
      task.scopes.push({ version: task.scopeVersion, title: task.title, brief: task.brief, acceptanceCriteria: criteria,
        createdAt: time, inputHash: task.input?.sha256 || null });
      task.selectedOfferId = null;
      touch(task, time);
      event(task, actor.user.id, 'criteria.updated', time);
      await saveTask(repo, task);
      return { taskId: id, version: task.version, scopeVersion: task.scopeVersion, acceptanceCriteria: criteria };
    });
  }

  async function endUnmet(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'reason', 'unmetCriteria']);
    const reason = text(body.reason, 'Reason', 3, 1000);
    return command(actor.user.id, key, ['end-unmet', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true);
      expected(task, body.expectedVersion);
      checkEnd(task);
      const unmet = unmetCriteriaInput(task, body.unmetCriteria);
      const job = task.assignment, time = now();
      job.status = 'failed';
      job.error = 'BUYER_ENDED_UNMET';
      job.endedAt = time;
      job.leaseHash = null;
      job.endReason = reason;
      job.unmetCriteria = unmet;
      job.progress = 'The buyer ended this work because the agreed criteria weren’t met. The runtime must stop.';
      const latest = task.submissions.at(-1);
      if (latest?.status === 'ready') latest.status = 'rejected';
      touch(task, time);
      event(task, actor.user.id, 'execution.ended_unmet', time);
      await saveTask(repo, task);
      return { taskId: id, version: task.version, status: 'failed' };
    });
  }

  return { setCriteria, endUnmet };
}

module.exports = { createAcceptance, acceptanceView, checkEnd, normalizeCriteria, criteriaFor, revisionRounds, unmetCriteriaInput,
  MAX_CRITERIA, END_AFTER_ROUNDS, MAX_REVISION_ROUNDS };
