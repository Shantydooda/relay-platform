'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { QUOTE_LIMITS, withinQuoteLimits } = require('../src/quote-limits.cjs');

test('long engagements stay within the quote range used for both quotes and change requests', () => {
  assert.equal(withinQuoteLimits({ amountMinor: 2_500_000, deliveryMinutes: 60 * 24 * 90 }), true); // 90-day project
  assert.equal(withinQuoteLimits({ amountMinor: 1, deliveryMinutes: QUOTE_LIMITS.maxDeliveryMinutes }), true);
});

test('out-of-range or malformed terms are rejected', () => {
  for (const terms of [
    { amountMinor: 0, deliveryMinutes: 60 },
    { amountMinor: QUOTE_LIMITS.maxAmountMinor + 1, deliveryMinutes: 60 },
    { amountMinor: 100, deliveryMinutes: QUOTE_LIMITS.maxDeliveryMinutes + 1 },
    { amountMinor: 100.5, deliveryMinutes: 60 },
    { amountMinor: '100', deliveryMinutes: 60 },
  ]) assert.equal(withinQuoteLimits(terms), false, JSON.stringify(terms));
});

test('the execution window follows the agreed delivery time at every scale', () => {
  const { executionWindowMs } = require('../src/quote-limits.cjs');
  const MINUTE = 60000;
  assert.equal(executionWindowMs(1), 5 * MINUTE); // never shorter than five minutes
  assert.equal(executionWindowMs(45), 90 * MINUTE);
  assert.equal(executionWindowMs(3 * 24 * 60), 6 * 24 * 60 * MINUTE); // a three-day job is not cut off at 24 hours
  assert.equal(executionWindowMs(10 ** 9), 2 * QUOTE_LIMITS.maxDeliveryMinutes * MINUTE); // bounded by the quote range
  assert.equal(executionWindowMs(undefined), 5 * MINUTE);
});
