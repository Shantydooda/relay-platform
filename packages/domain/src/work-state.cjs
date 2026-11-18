'use strict';

// Where a piece of work stands, computed once on the server for every audience.
//
// The stored records stay as they are: task status, assignment status, holds
// (`permissionWait`, `buyerPause`), the latest submission and its file scans,
// and the error code a run ended with. Before this projection, the buyer page,
// the builder page, the supplier API, the reference runtime, the ledger and the
// activity log each re-derived "what is happening, whose move is it, and how did
// it end" from those fields, and they disagreed. This module answers once.
//
// Everything here is informational. Commands still check their own guards; a
// projection is never authorization, and it can be stale the moment it is read.

const { waitingForPermission, pausedByBuyer } = require('./execution-state.cjs');

const PHASES = Object.freeze(['drafting', 'finding_agent', 'starting', 'scheduled', 'working', 'on_hold', 'in_review', 'done', 'ended', 'closed']);
const WAITING_ON = Object.freeze(['buyer', 'approver', 'agent', 'relay', 'nobody']);

// How a run ended, from the code it was stored with. `endedBy` says whose
// decision or failure ended it: the buyer, the agent, or Relay's own rules
// (deadlines, queue timeouts, retry limits).
const ENDINGS = Object.freeze({
  BUYER_ENDED_UNMET: { endedBy: 'buyer', reason: 'ENDED_UNMET' },
  EXECUTION_TIMEOUT: { endedBy: 'relay', reason: 'DEADLINE_PASSED' },
  SUPPLIER_UNAVAILABLE: { endedBy: 'relay', reason: 'AGENT_DID_NOT_START' },
  RETRY_EXHAUSTED: { endedBy: 'relay', reason: 'RETRIES_EXHAUSTED' },
  CSV_INVALID: { endedBy: 'agent', reason: 'AGENT_REPORTED_FAILURE' },
  OUTPUT_TOO_LARGE: { endedBy: 'agent', reason: 'AGENT_REPORTED_FAILURE' },
  INPUT_UNSUPPORTED: { endedBy: 'agent', reason: 'AGENT_REPORTED_FAILURE' },
  AGENT_ERROR: { endedBy: 'agent', reason: 'AGENT_REPORTED_FAILURE' },
});
// Stored as free text by task-changes.cjs before it had a code.
const REPLACED_BY_CHANGE = 'Replaced by an explicitly accepted scope change.';

// Every reason workState can return. The browser keeps buyer and builder words
// for each; a test fails when one is missing.
const REASONS = Object.freeze([
  'BRIEF_DRAFT', 'AWAITING_OFFERS', 'OFFERS_READY', 'READY_TO_START', 'APPROVAL_PENDING', 'APPROVAL_NEEDED', 'SCHEDULE_ACTIVE', 'REQUEST_CLOSED',
  'AGENT_STARTING', 'WORKING', 'AGENT_RECONNECTING', 'REVISION_QUEUED', 'REVISING', 'PAUSED_BY_BUYER', 'PERMISSION_NEEDED',
  'FILES_CHECKING', 'FILE_BLOCKED', 'DELIVERY_READY',
  'ACCEPTED', 'AUTO_ACCEPTED', 'CANCELLED', 'REPLACED_BY_CHANGE', 'FAILED', ...new Set(Object.values(ENDINGS).map(item => item.reason)),
]);

const TERMINAL = Object.freeze(['accepted', 'failed', 'cancelled']);
const isTerminal = assignment => !!assignment && TERMINAL.includes(assignment.status);

function ending(assignment) {
  if (!isTerminal(assignment)) return null;
  const { status, error } = assignment;
  if (status === 'accepted')
    return { endedBy: assignment.autoAccepted ? 'relay' : 'buyer', reason: assignment.autoAccepted ? 'AUTO_ACCEPTED' : 'ACCEPTED', code: null };
  if (status === 'cancelled')
    return { endedBy: 'buyer', reason: error === REPLACED_BY_CHANGE ? 'REPLACED_BY_CHANGE' : 'CANCELLED', code: null };
  const known = ENDINGS[error];
  return known ? { ...known, code: error } : { endedBy: null, reason: 'FAILED', code: error || null };
}

const leaseAlive = (assignment, now) => assignment.status === 'running' && assignment.leaseUntil > now;

// What a supplier runtime should do with this assignment right now. `claim`
// and `work` are hints: the claim and lease checks still decide.
function agentNext(assignment, now) {
  if (!assignment) return null;
  if (isTerminal(assignment)) return { action: 'stop', reason: ending(assignment).reason };
  if (pausedByBuyer(assignment)) return { action: 'wait', reason: 'PAUSED_BY_BUYER' };
  if (waitingForPermission(assignment)) return { action: 'wait', reason: 'PERMISSION_NEEDED' };
  if (assignment.status === 'buyer_review') return { action: 'wait', reason: 'DELIVERY_IN_REVIEW' };
  if (leaseAlive(assignment, now)) return { action: 'work', reason: 'LEASE_HELD' };
  if (assignment.deadlineAt && assignment.deadlineAt <= now) return { action: 'stop', reason: 'DEADLINE_PASSED' };
  // A revision request resets `attempt` to 0 and records `revisionNotes`; a lost
  // lease leaves `attempt` above 0 so the next claim is a resumption.
  if (assignment.attempt > 0) return { action: 'claim', reason: 'LEASE_LAPSED' };
  return { action: 'claim', reason: assignment.revisionNotes ? 'REVISION_REQUESTED' : 'READY' };
}

function deliveryState(submission) {
  const files = submission?.files || [];
  if (files.some(file => file.scan?.status === 'blocked')) return { waitingOn: 'buyer', reason: 'FILE_BLOCKED' };
  if (files.some(file => file.scan && file.scan.status !== 'clean')) return { waitingOn: 'relay', reason: 'FILES_CHECKING' };
  return { waitingOn: 'buyer', reason: 'DELIVERY_READY' };
}

function liveOffers(task, now) {
  return (task.offers || []).filter(offer => offer.scopeVersion === task.scopeVersion && offer.expiresAt > now);
}

// Before work is authorized: the brief, offers, selection and company approval.
function preAwardState(task, now, approvalStatus) {
  if (task.status === 'cancelled') return { phase: 'closed', waitingOn: 'nobody', reason: 'REQUEST_CLOSED' };
  if (task.recurringScheduleId) return { phase: 'scheduled', waitingOn: 'relay', reason: 'SCHEDULE_ACTIVE' };
  if (task.status === 'draft') return { phase: 'drafting', waitingOn: 'buyer', reason: 'BRIEF_DRAFT' };
  const offers = liveOffers(task, now);
  const selected = offers.find(offer => offer.id === task.selectedOfferId);
  if (selected) {
    if (approvalStatus === 'pending') return { phase: 'starting', waitingOn: 'approver', reason: 'APPROVAL_PENDING' };
    if (['required', 'declined', 'stale'].includes(approvalStatus)) return { phase: 'starting', waitingOn: 'buyer', reason: 'APPROVAL_NEEDED' };
    return { phase: 'starting', waitingOn: 'buyer', reason: 'READY_TO_START' };
  }
  return offers.length
    ? { phase: 'finding_agent', waitingOn: 'buyer', reason: 'OFFERS_READY' }
    : { phase: 'finding_agent', waitingOn: 'agent', reason: 'AWAITING_OFFERS' };
}

// The one answer to "where does this stand". Options:
// - approvalStatus: the company approval status for the selected offer, if any.
// - retryAvailable: whether the buyer can still try another agent after a failure.
function workState(task, now, { approvalStatus = null, retryAvailable = false } = {}) {
  const job = task.assignment;
  if (!job) return { ...preAwardState(task, now, approvalStatus), ending: null };
  if (isTerminal(job)) {
    const end = ending(job);
    if (job.status === 'accepted') return { phase: 'done', waitingOn: 'nobody', reason: end.reason, ending: end };
    return { phase: 'ended', waitingOn: retryAvailable ? 'buyer' : 'nobody', reason: end.reason, ending: end };
  }
  if (pausedByBuyer(job)) return { phase: 'on_hold', waitingOn: 'buyer', reason: 'PAUSED_BY_BUYER', ending: null };
  if (waitingForPermission(job)) return { phase: 'on_hold', waitingOn: 'buyer', reason: 'PERMISSION_NEEDED', ending: null };
  if (job.status === 'buyer_review') return { phase: 'in_review', ...deliveryState((task.submissions || []).at(-1)), ending: null };
  const revising = (task.submissions || []).at(-1)?.status === 'revision_requested';
  if (job.status === 'running' && leaseAlive(job, now))
    return { phase: 'working', waitingOn: 'agent', reason: revising ? 'REVISING' : 'WORKING', ending: null };
  if (job.status === 'running') return { phase: 'working', waitingOn: 'agent', reason: 'AGENT_RECONNECTING', ending: null };
  return { phase: 'working', waitingOn: 'agent', reason: revising ? 'REVISION_QUEUED' : 'AGENT_STARTING', ending: null };
}

module.exports = { workState, agentNext, ending, isTerminal, PHASES, WAITING_ON, REASONS, ENDINGS, TERMINAL, REPLACED_BY_CHANGE };
