'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { REASONS, workState } = require('../../../packages/domain/src/work-state.cjs');

function ui() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/work-state-ui.js'), 'utf8'), context);
  return code => vm.runInContext(code, context);
}

test('every reason the server can send has buyer and builder words', () => {
  const run = ui();
  const labels = run('RelayWorkState.LABELS');
  for (const reason of REASONS) {
    assert.ok(labels.buyer[reason], `buyer label for ${reason}`);
    assert.ok(labels.builder[reason], `builder label for ${reason}`);
  }
  assert.deepEqual(Object.keys(labels.buyer).sort(), [...REASONS].sort(), 'no stale buyer labels');
  assert.deepEqual(Object.keys(labels.builder).sort(), [...REASONS].sort(), 'no stale builder labels');
});

test('the same state reads correctly to each side and groups by whose move it is', () => {
  const run = ui();
  const view = work => run(`(task => [RelayWorkState.label(task), RelayWorkState.label(task, 'builder'), RelayWorkState.group(task), RelayWorkState.tone(task), RelayWorkState.action(task)])(${JSON.stringify({ work })})`);
  const ended = workState({ assignment: { status: 'failed', error: 'BUYER_ENDED_UNMET' } }, 0, { retryAvailable: true });
  assert.deepEqual([...view(ended)], ['Ended · checklist not met', 'Ended by the buyer · checklist not met', 'Needs you', 'attention', 'Try another agent']);
  const paused = workState({ assignment: { status: 'queued', buyerPause: {} } }, 0);
  assert.deepEqual([...view(paused)], ['Paused', 'Paused by the buyer', 'Needs you', 'attention', 'Resume or review'],
    'a buyer pause is the buyer’s move, not "under way"');
  const blocked = workState({ assignment: { status: 'buyer_review' }, submissions: [{ files: [{ scan: { status: 'blocked' } }] }] }, 0);
  assert.deepEqual([...view(blocked)], ['File blocked', 'Delivered · a file was blocked', 'Needs you', 'attention', 'Review delivery']);
  const working = workState({ assignment: { status: 'running', leaseUntil: 10 } }, 0);
  assert.deepEqual([...view(working)], ['In progress', 'In progress', 'Under way', 'active', 'Open conversation']);
  const done = workState({ assignment: { status: 'accepted' } }, 0);
  assert.deepEqual([...view(done)], ['Delivery accepted', 'Accepted', 'Completed', 'complete', 'Open conversation']);
  const scheduled = workState({ status: 'posted', recurringScheduleId: 's', offers: [] }, 0);
  assert.equal(view(scheduled)[2], 'Under way', 'a recurring parent is not "needs you"');
});
