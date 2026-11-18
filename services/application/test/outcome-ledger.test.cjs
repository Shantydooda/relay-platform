'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { taskOutcome, summarizeOutcomes, ledgerLabel, MIN_RATE_SAMPLE } = require('../src/outcome-ledger.cjs');

const DAY = 86400000;
const NOW = 1000 * DAY;
let seq = 0;
function task({ status, at = NOW - DAY, revisions = 0, refunded = false, agentId = 'agent', capabilityId = 'cap', operatorId = 'op', supersededBy } = {}) {
  const id = `t${++seq}`;
  return {
    id,
    offers: [{ id: `${id}-offer`, capabilityId }],
    submissions: Array.from({ length: revisions }, () => ({ status: 'revision_requested' })),
    settlement: refunded ? { status: 'refunded', updatedAt: at } : null,
    orchestrationStep: supersededBy ? { supersededBy } : undefined,
    assignment: status && {
      id: `${id}-job`, offerId: `${id}-offer`, agentId, operatorId, status, runtimeVersion: '1.2.0',
      acceptedAt: status === 'accepted' ? at : undefined,
      endedAt: ['failed', 'cancelled'].includes(status) ? at : undefined,
      cancelledAt: status === 'cancelled' ? at : undefined,
    },
  };
}

test('every terminal outcome is classified, including failures and refunds', () => {
  assert.equal(taskOutcome(task({ status: 'accepted' })).outcome, 'accepted_first_time');
  assert.equal(taskOutcome(task({ status: 'accepted', revisions: 1 })).outcome, 'accepted_after_revision');
  assert.equal(taskOutcome(task({ status: 'failed' })).outcome, 'failed');
  assert.equal(taskOutcome(task({ status: 'cancelled' })).outcome, 'cancelled');
  assert.equal(taskOutcome(task({ status: 'accepted', refunded: true })).outcome, 'refunded');
  assert.equal(taskOutcome(task({ status: 'accepted' })).runtimeVersion, '1.2.0');
});

test('work that is still open, or superseded by a replanned step, is not an outcome', () => {
  for (const status of ['queued', 'running', 'buyer_review', undefined]) assert.equal(taskOutcome(task({ status })), null);
  assert.equal(taskOutcome(task({ status: 'accepted', supersededBy: 'newer-step' })), null);
});

test('the summary keeps its denominator, scopes by agent and capability, and respects the window', () => {
  const tasks = [
    task({ status: 'accepted' }), task({ status: 'accepted', revisions: 2 }), task({ status: 'failed' }),
    task({ status: 'cancelled' }),
    task({ status: 'accepted', at: NOW - 91 * DAY }), // outside the 90-day window
    task({ status: 'accepted', capabilityId: 'other' }),
    task({ status: 'failed', agentId: 'someone-else' }),
  ];
  const summary = summarizeOutcomes(tasks, { operatorId: 'op', agentId: 'agent', capabilityId: 'cap', now: NOW });
  assert.equal(summary.runs, 3); // cancelled by the buyer is reported but not counted as a decided run
  assert.equal(summary.accepted, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.acceptedRate, null); // too few runs for a percentage
  assert.equal(ledgerLabel(summary), '3 runs · 1 accepted first time · 1 after revision · 1 failed · last 90 days in this environment');
});

test('a percentage appears only once the sample is large enough', () => {
  const tasks = [
    ...Array.from({ length: MIN_RATE_SAMPLE - 2 }, () => task({ status: 'accepted' })),
    task({ status: 'failed' }), task({ status: 'accepted', refunded: true }),
  ];
  const summary = summarizeOutcomes(tasks, { now: NOW });
  assert.equal(summary.runs, MIN_RATE_SAMPLE);
  assert.equal(summary.acceptedRate, (MIN_RATE_SAMPLE - 2) / MIN_RATE_SAMPLE);
  assert.match(ledgerLabel(summary), /\(90% accepted\)/);
  assert.equal(ledgerLabel(summarizeOutcomes([], { now: NOW })), 'No verified runs yet');
});
