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
