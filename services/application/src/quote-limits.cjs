'use strict';

// One authoritative range for quoted work. Quotes and change requests share it,
// so a long engagement that can be quoted can also be renegotiated.
const QUOTE_LIMITS = Object.freeze({
  maxAmountMinor: 10_000_000, // 100,000.00 in the quote currency
  maxDeliveryMinutes: 525_600, // 365 days
});

function withinQuoteLimits({ amountMinor, deliveryMinutes }) {
  return Number.isSafeInteger(amountMinor) && amountMinor >= 1 && amountMinor <= QUOTE_LIMITS.maxAmountMinor &&
    Number.isSafeInteger(deliveryMinutes) && deliveryMinutes >= 1 && deliveryMinutes <= QUOTE_LIMITS.maxDeliveryMinutes;
}

// The execution window is twice the agreed delivery time, never under five minutes.
// It follows the agreement at every scale: a three-day job gets six days, not a
// fixed 24 hours. A stalled runtime is still caught early by its heartbeat lease.
const MIN_EXECUTION_WINDOW_MS = 5 * 60000;
function executionWindowMs(deliveryMinutes) {
  const minutes = Math.min(Math.max(0, Number(deliveryMinutes) || 0), QUOTE_LIMITS.maxDeliveryMinutes);
  return Math.max(MIN_EXECUTION_WINDOW_MS, minutes * 2 * 60000);
}

module.exports = { QUOTE_LIMITS, withinQuoteLimits, executionWindowMs };
