'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { workState, agentNext, ending, ENDINGS, REPLACED_BY_CHANGE } = require('../src/work-state.cjs');
const { shouldClaim } = require('../../supplier-sdk/src/index.cjs');

const NOW = 1_000_000;
function task({ status = 'posted', assignment = null, offers = [], selectedOfferId = null, submissions = [], recurringScheduleId = null } = {}) {
  return { status, scopeVersion: 2, assignment, offers, selectedOfferId, submissions, recurringScheduleId };
}
const offer = (id, overrides = {}) => ({ id, scopeVersion: 2, expiresAt: NOW + 60000, ...overrides });
const job = overrides => ({ status: 'queued', attempt: 0, leaseUntil: 0, deadlineAt: NOW + 600000, ...overrides });
const state = (value, options) => {
  const { phase, waitingOn, reason } = workState(value, NOW, options);
  return [phase, waitingOn, reason];
};

test('before work starts: drafting, finding an agent, choosing, approval and closing', () => {
  assert.deepEqual(state(task({ status: 'draft' })), ['drafting', 'buyer', 'BRIEF_DRAFT']);
  assert.deepEqual(state(task()), ['finding_agent', 'agent', 'AWAITING_OFFERS']);
  assert.deepEqual(state(task({ offers: [offer('a', { expiresAt: NOW - 1 }), offer('b', { scopeVersion: 1 })] })),
    ['finding_agent', 'agent', 'AWAITING_OFFERS'], 'expired and old-scope offers do not count');
  assert.deepEqual(state(task({ offers: [offer('a')] })), ['finding_agent', 'buyer', 'OFFERS_READY']);
  assert.deepEqual(state(task({ offers: [offer('a')], selectedOfferId: 'a' })), ['starting', 'buyer', 'READY_TO_START']);
  assert.deepEqual(state(task({ offers: [offer('a')], selectedOfferId: 'a' }), { approvalStatus: 'pending' }), ['starting', 'approver', 'APPROVAL_PENDING']);
  for (const approvalStatus of ['required', 'declined', 'stale'])
    assert.deepEqual(state(task({ offers: [offer('a')], selectedOfferId: 'a' }), { approvalStatus }), ['starting', 'buyer', 'APPROVAL_NEEDED']);
  assert.deepEqual(state(task({ offers: [offer('a', { expiresAt: NOW - 1 })], selectedOfferId: 'a' })), ['finding_agent', 'agent', 'AWAITING_OFFERS'],
    'an expired selection is not a selection');
  assert.deepEqual(state(task({ status: 'cancelled' })), ['closed', 'nobody', 'REQUEST_CLOSED']);
  assert.deepEqual(state(task({ recurringScheduleId: 's' })), ['scheduled', 'relay', 'SCHEDULE_ACTIVE']);
});

test('active work: whose move it is, including holds, revisions and lost leases', () => {
  assert.deepEqual(state(task({ assignment: job() })), ['working', 'agent', 'AGENT_STARTING']);
  assert.deepEqual(state(task({ assignment: job({ status: 'running', leaseUntil: NOW + 1000 }) })), ['working', 'agent', 'WORKING']);
  assert.deepEqual(state(task({ assignment: job({ status: 'running', leaseUntil: NOW - 1 }) })), ['working', 'agent', 'AGENT_RECONNECTING']);
  assert.deepEqual(state(task({ assignment: job(), submissions: [{ status: 'revision_requested' }] })), ['working', 'agent', 'REVISION_QUEUED']);
  assert.deepEqual(state(task({ assignment: job({ status: 'running', leaseUntil: NOW + 1 }), submissions: [{ status: 'revision_requested' }] })), ['working', 'agent', 'REVISING']);
  assert.deepEqual(state(task({ assignment: job({ buyerPause: { at: 1 } }) })), ['on_hold', 'buyer', 'PAUSED_BY_BUYER']);
  assert.deepEqual(state(task({ assignment: job({ permissionWait: { at: 1 } }) })), ['on_hold', 'buyer', 'PERMISSION_NEEDED']);
  assert.deepEqual(state(task({ assignment: job({ buyerPause: {}, permissionWait: {} }) })), ['on_hold', 'buyer', 'PAUSED_BY_BUYER'],
    'the buyer’s own pause is the hold they need to lift first');
});

test('a delivery with a blocked file is not "still checking"', () => {
  const review = files => task({ assignment: job({ status: 'buyer_review' }), submissions: [{ status: 'ready', files }] });
  assert.deepEqual(state(review([{ scan: { status: 'clean' } }])), ['in_review', 'buyer', 'DELIVERY_READY']);
  assert.deepEqual(state(review([{}])), ['in_review', 'buyer', 'DELIVERY_READY'], 'inline files without a scan record');
  assert.deepEqual(state(review([{ scan: { status: 'quarantined' } }, { scan: { status: 'clean' } }])), ['in_review', 'relay', 'FILES_CHECKING']);
  assert.deepEqual(state(review([{ scan: { status: 'scanning' } }, { scan: { status: 'blocked' } }])), ['in_review', 'buyer', 'FILE_BLOCKED']);
});

test('every stored ending code says who ended the run', () => {
  const ended = (status, error, extra = {}) => ending({ status, error, ...extra });
  for (const [code, expected] of Object.entries(ENDINGS)) assert.deepEqual(ended('failed', code), { ...expected, code });
  assert.deepEqual(ended('failed', 'BUYER_ENDED_UNMET'), { endedBy: 'buyer', reason: 'ENDED_UNMET', code: 'BUYER_ENDED_UNMET' });
  assert.deepEqual(ended('failed', 'EXECUTION_TIMEOUT').endedBy, 'relay');
  assert.deepEqual(ended('failed', 'AGENT_ERROR').endedBy, 'agent');
  assert.deepEqual(ended('failed', 'SOMETHING_NEW'), { endedBy: null, reason: 'FAILED', code: 'SOMETHING_NEW' });
  assert.deepEqual(ended('cancelled', null), { endedBy: 'buyer', reason: 'CANCELLED', code: null });
  assert.deepEqual(ended('cancelled', REPLACED_BY_CHANGE), { endedBy: 'buyer', reason: 'REPLACED_BY_CHANGE', code: null });
  assert.deepEqual(ended('accepted', null), { endedBy: 'buyer', reason: 'ACCEPTED', code: null });
  assert.deepEqual(ended('accepted', null, { autoAccepted: true }), { endedBy: 'relay', reason: 'AUTO_ACCEPTED', code: null });
  assert.equal(ending({ status: 'running' }), null);
});

test('a finished run waits on the buyer only while they can still try another agent', () => {
  const failed = task({ assignment: job({ status: 'failed', error: 'AGENT_ERROR' }) });
  assert.deepEqual(state(failed, { retryAvailable: true }), ['ended', 'buyer', 'AGENT_REPORTED_FAILURE']);
  assert.deepEqual(state(failed), ['ended', 'nobody', 'AGENT_REPORTED_FAILURE']);
  assert.deepEqual(state(task({ assignment: job({ status: 'accepted' }) })), ['done', 'nobody', 'ACCEPTED']);
  assert.equal(workState(failed, NOW).ending.endedBy, 'agent');
  assert.equal(workState(task(), NOW).ending, null);
});

test('the agent is told to claim, work, wait or stop, and the SDK follows it', () => {
  const next = value => agentNext(job(value), NOW);
  assert.deepEqual(next(), { action: 'claim', reason: 'READY' });
  assert.deepEqual(next({ revisionNotes: 'Sort descending' }), { action: 'claim', reason: 'REVISION_REQUESTED' });
  assert.deepEqual(next({ attempt: 1 }), { action: 'claim', reason: 'LEASE_LAPSED' });
  assert.deepEqual(next({ status: 'running', attempt: 1, leaseUntil: NOW - 1 }), { action: 'claim', reason: 'LEASE_LAPSED' });
  assert.deepEqual(next({ status: 'running', leaseUntil: NOW + 1 }), { action: 'work', reason: 'LEASE_HELD' });
  assert.deepEqual(next({ buyerPause: {} }), { action: 'wait', reason: 'PAUSED_BY_BUYER' });
  assert.deepEqual(next({ permissionWait: {} }), { action: 'wait', reason: 'PERMISSION_NEEDED' });
  assert.deepEqual(next({ status: 'buyer_review' }), { action: 'wait', reason: 'DELIVERY_IN_REVIEW' });
  assert.deepEqual(next({ deadlineAt: NOW }), { action: 'stop', reason: 'DEADLINE_PASSED' });
  assert.deepEqual(next({ status: 'failed', error: 'BUYER_ENDED_UNMET' }), { action: 'stop', reason: 'ENDED_UNMET' });
  assert.deepEqual(next({ status: 'cancelled' }), { action: 'stop', reason: 'CANCELLED' });
  assert.equal(agentNext(null, NOW), null);

  assert.equal(shouldClaim({ next: { action: 'claim' } }), true);
  for (const action of ['work', 'wait', 'stop']) assert.equal(shouldClaim({ next: { action } }), false, action);
  // Older servers send no `next`: the SDK falls back to holds and the lease.
  assert.equal(shouldClaim({ status: 'queued' }, NOW), true);
  assert.equal(shouldClaim({ status: 'queued', pausedByBuyer: true }, NOW), false);
  assert.equal(shouldClaim({ status: 'queued', waitingForPermission: true }, NOW), false);
  assert.equal(shouldClaim({ status: 'running', leaseUntil: NOW + 1 }, NOW), false);
  assert.equal(shouldClaim({ status: 'running', leaseUntil: NOW - 1 }, NOW), true);
  assert.equal(shouldClaim(null), false);
});
