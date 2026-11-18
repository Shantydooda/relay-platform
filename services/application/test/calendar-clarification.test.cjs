'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  clarifyMonthlyDate,
} = require('../../scoping/src/calendar-clarification.cjs');
const base = {
  intent: 'request',
  cadence: 'monthly',
  schedule: 'On the 31st of every month',
  questions: ['What should the report include?'],
  brief: 'Create our investor report.',
};
test('uncertain monthly dates require an explicit choice without changing scope', () => {
  for (const day of [29, 30, 31]) {
    const result = clarifyMonthlyDate({
      ...base,
      schedule: `Day ${day} each month`,
    });
    assert.match(result.questions[0], /skip.*last day/);
    assert.equal(result.brief, base.brief);
    assert.equal(result.schedule, `Day ${day} each month`);
  }
  assert.equal(base.questions.length, 1);
});
test('calendar checks preserve question and hypothetical intent, safe dates and existing clarification', () => {
  for (const patch of [
    { intent: 'question' },
    { intent: 'hypothetical' },
    { cadence: 'once' },
    { schedule: 'On day 28 each month' },
    { schedule: 'On the 31st, skip months without that date' },
    { schedule: 'On the 31st or the last day of shorter months' },
    { schedule: 'Every month at 09:30' },
    { schedule: 'Day 1 at 09:31' },
    { questions: ['What happens in shorter months?'] },
  ]) {
    const proposal = { ...base, ...patch };
    assert.equal(clarifyMonthlyDate(proposal), proposal);
  }
  assert.equal(
    clarifyMonthlyDate({ ...base, questions: ['a', 'b', 'c'] }).questions
      .length,
    3,
  );
});
