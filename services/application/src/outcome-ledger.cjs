'use strict';

// Verified outcome ledger: a read projection over task records, never self-reported.
// Every terminal assignment counts, including failures, so a rate always has its denominator.
// See docs/Product-Thesis.md, principle 2.

const LEDGER_WINDOW_MS = 90 * 86400000;
// Below this many decided runs, show counts only. A percentage over 3 runs is noise.
const MIN_RATE_SAMPLE = 20;
const OUTCOMES = Object.freeze([
  'accepted_first_time',
  'accepted_after_revision',
  'failed',
  'refunded',
  'cancelled',
]);

function taskOutcome(task) {
  const job = task?.assignment;
  if (!job || task.orchestrationStep?.supersededBy) return null;
  const offer = (task.offers || []).find(item => item.id === job.offerId);
  const revisions = (task.submissions || []).filter(item => item.status === 'revision_requested').length;
  let outcome = null;
  let at = null;
  // A refund overrides acceptance: the buyer did not keep the result.
  if (task.settlement?.status === 'refunded') {
    outcome = 'refunded';
    at = task.settlement.updatedAt ?? job.endedAt ?? job.acceptedAt;
  } else if (job.status === 'accepted') {
    outcome = revisions ? 'accepted_after_revision' : 'accepted_first_time';
    at = job.acceptedAt;
  } else if (job.status === 'failed') {
    outcome = 'failed';
    at = job.endedAt;
  } else if (job.status === 'cancelled') {
    outcome = 'cancelled';
    at = job.cancelledAt ?? job.endedAt;
  }
  if (!outcome) return null;
  return {
    taskId: task.id,
    assignmentId: job.id,
    operatorId: job.operatorId,
    agentId: job.agentId,
    capabilityId: offer?.capabilityId ?? null,
    runtimeVersion: job.runtimeVersion ?? null,
    outcome,
    at: Number.isFinite(at) ? at : null,
  };
}

function summarizeOutcomes(tasks, { operatorId, agentId, capabilityId, runtimeVersion, now, windowMs = LEDGER_WINDOW_MS } = {}) {
  const counts = Object.fromEntries(OUTCOMES.map(name => [name, 0]));
  const since = now - windowMs;
  for (const task of tasks) {
    const record = taskOutcome(task);
    if (!record || record.at === null || record.at < since || record.at > now) continue;
    if (operatorId && record.operatorId !== operatorId) continue;
    if (agentId && record.agentId !== agentId) continue;
    if (capabilityId && record.capabilityId !== capabilityId) continue;
    // runtimeVersion: null selects runs from before versions were stamped.
    if (runtimeVersion !== undefined && record.runtimeVersion !== runtimeVersion) continue;
    counts[record.outcome]++;
  }
  // Buyer cancellations are reported but are not counted as a run the agent decided.
  const runs = counts.accepted_first_time + counts.accepted_after_revision + counts.failed + counts.refunded;
  const accepted = counts.accepted_first_time + counts.accepted_after_revision;
  return {
    basis: 'verified-outcomes-in-this-environment',
    windowDays: Math.round(windowMs / 86400000),
    runs,
    accepted,
    ...counts,
    acceptedRate: runs >= MIN_RATE_SAMPLE ? accepted / runs : null,
  };
}

function ledgerLabel(summary) {
  if (!summary || !summary.runs) return 'No verified runs yet';
  const parts = [`${summary.runs} ${summary.runs === 1 ? 'run' : 'runs'}`];
  if (summary.accepted_first_time) parts.push(`${summary.accepted_first_time} accepted first time`);
  if (summary.accepted_after_revision) parts.push(`${summary.accepted_after_revision} after revision`);
  if (summary.failed) parts.push(`${summary.failed} failed`);
  if (summary.refunded) parts.push(`${summary.refunded} refunded`);
  const rate = summary.acceptedRate === null ? '' : ` (${Math.round(summary.acceptedRate * 100)}% accepted)`;
  return `${parts.join(' · ')}${rate} · last ${summary.windowDays} days in this environment`;
}

module.exports = { LEDGER_WINDOW_MS, MIN_RATE_SAMPLE, OUTCOMES, taskOutcome, summarizeOutcomes, ledgerLabel };
