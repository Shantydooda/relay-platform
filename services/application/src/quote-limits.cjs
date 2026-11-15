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

module.exports = { QUOTE_LIMITS, withinQuoteLimits };
