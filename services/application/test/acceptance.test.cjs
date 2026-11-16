'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCriteria, criteriaFor, revisionRounds, unmetCriteriaInput, checkEnd, acceptanceView,
  MAX_CRITERIA, END_AFTER_ROUNDS } = require('../src/acceptance.cjs');
const { taskOutcome } = require('../src/outcome-ledger.cjs');

const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

function task({ status = 'buyer_review', rounds = 0, criteria = [{ id: 'c1', text: 'All rows kept' }], mode = 'local-unpaid', settlement = null } = {}) {
  return {
    acceptanceCriteria: [{ id: 'c1', text: 'Draft criterion that changed later' }],
    submissions: [...Array.from({ length: rounds }, () => ({ status: 'revision_requested' })), { status: 'ready' }],
    settlement,
    assignment: { status, mode, agreement: { acceptanceCriteria: criteria } },
  };
}

test('criteria are trimmed, numbered, capped and must differ', () => {
  assert.deepEqual(normalizeCriteria(['  Rows sorted by email ', 'Report lists removed rows']),
    [{ id: 'c1', text: 'Rows sorted by email' }, { id: 'c2', text: 'Report lists removed rows' }]);
  assert.deepEqual(normalizeCriteria([]), [], 'clearing the checklist is allowed');
  rejects(() => normalizeCriteria('one'), 'INVALID_INPUT');
  rejects(() => normalizeCriteria(Array.from({ length: MAX_CRITERIA + 1 }, (_, i) => `Criterion ${i}`)), 'INVALID_INPUT');
  rejects(() => normalizeCriteria(['Same', 'same']), 'INVALID_INPUT');
  rejects(() => normalizeCriteria(['ok']), 'INVALID_INPUT');
  rejects(() => normalizeCriteria(['x'.repeat(301)]), 'INVALID_INPUT');
});

test('authorized work reads the criteria frozen in its agreement, not the live draft', () => {
  assert.deepEqual(criteriaFor(task()), [{ id: 'c1', text: 'All rows kept' }]);
  assert.deepEqual(criteriaFor({ acceptanceCriteria: [{ id: 'c1', text: 'Draft' }] }), [{ id: 'c1', text: 'Draft' }]);
  assert.deepEqual(criteriaFor({}), []);
});

test('unmet criteria must be distinct ids from the agreement', () => {
  const t = task({ criteria: [{ id: 'c1', text: 'a' }, { id: 'c2', text: 'b' }] });
  assert.deepEqual(unmetCriteriaInput(t, undefined), []);
  assert.deepEqual(unmetCriteriaInput(t, ['c2']), ['c2']);
  rejects(() => unmetCriteriaInput(t, ['c3']), 'INVALID_INPUT');
  rejects(() => unmetCriteriaInput(t, ['c1', 'c1']), 'INVALID_INPUT');
  rejects(() => unmetCriteriaInput(t, 'c1'), 'INVALID_INPUT');
});

test('ending as unmet needs two rounds of changes, live work and no held payment', () => {
  assert.equal(END_AFTER_ROUNDS, 2);
  rejects(() => checkEnd(task({ rounds: 1 })), 'END_NOT_YET');
  assert.doesNotThrow(() => checkEnd(task({ rounds: 2 })));
  for (const status of ['queued', 'running', 'buyer_review']) assert.doesNotThrow(() => checkEnd(task({ status, rounds: 2 })));
  for (const status of ['accepted', 'failed', 'cancelled']) rejects(() => checkEnd(task({ status, rounds: 2 })), 'STATE_CONFLICT');
  rejects(() => checkEnd({ submissions: [] }), 'STATE_CONFLICT');
  rejects(() => checkEnd(task({ rounds: 2, mode: 'stripe-sandbox' })), 'REFUND_REQUIRED');
  rejects(() => checkEnd(task({ rounds: 2, settlement: { status: 'held' } })), 'REFUND_REQUIRED');
  assert.doesNotThrow(() => checkEnd(task({ rounds: 2, settlement: { status: 'refunded' } })));
});

test('the view reports rounds and the last unmet criteria; an ended run counts as failed in the ledger', () => {
  const t = task({ rounds: 2 });
  assert.equal(revisionRounds(t), 2);
  assert.deepEqual(acceptanceView(t), { criteria: [{ id: 'c1', text: 'All rows kept' }], revisionRounds: 2, endAfterRounds: 2, unmetCriteria: [] });
  Object.assign(t.assignment, { id: 'job', status: 'failed', error: 'BUYER_ENDED_UNMET', endedAt: 5, unmetCriteria: ['c1'] });
  t.offers = [];
  assert.deepEqual(acceptanceView(t).unmetCriteria, ['c1']);
  assert.equal(taskOutcome(t).outcome, 'failed');
});
