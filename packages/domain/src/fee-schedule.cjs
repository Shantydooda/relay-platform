'use strict';

const { quoteBreakdown } = require('./marketplace.cjs');

// Relay's fee as a tiered share of the buyer's all-in total, applied per payout
// band (docs/Decisions-Needed.md §1, option B). Each band's fee is computed with
// quoteBreakdown, so payout + fee = total holds exactly in every band and overall.
//
// The live rate is set by configuration and defaults to 0%: nothing changes for
// buyers or builders until the founder switches it on.
//
// Not yet wired into checkout. Funding, payouts and the double-entry ledger must
// adopt it together, verified by the Postgres-backed payment suites.

const ZERO = Object.freeze([Object.freeze({ upToMinor: null, feeBps: 0 })]);

// "100000:2000,1000000:1200,*:800" means 20% on the first 1,000.00 of payout,
// 12% up to 10,000.00 and 8% above. "0" or empty means no fee.
function parseFeeSchedule(value) {
  const spec = String(value ?? '').trim();
  if (!spec || spec === '0') return ZERO;
  const bands = spec.split(',').map(part => {
    const match = part.trim().match(/^(\*|[1-9][0-9]*):([0-9]{1,4})$/);
    if (!match) throw new TypeError(`Invalid fee band "${part.trim()}"`);
    const feeBps = Number(match[2]);
    if (feeBps >= 10000) throw new TypeError('A fee must be below 100%');
    return Object.freeze({ upToMinor: match[1] === '*' ? null : Number(match[1]), feeBps });
  });
  bands.forEach((band, index) => {
    const last = index === bands.length - 1;
    if (last !== (band.upToMinor === null)) throw new TypeError('Only the final fee band may be open-ended ("*"), and it is required');
    if (index && !last && band.upToMinor <= bands[index - 1].upToMinor) throw new TypeError('Fee band limits must increase');
    if (!Number.isSafeInteger(band.upToMinor ?? 0)) throw new TypeError('Fee band limit is too large');
  });
  return Object.freeze(bands);
}

function priceWithFee(payoutMinor, schedule = ZERO) {
  if (!Number.isSafeInteger(payoutMinor) || payoutMinor < 0) throw new TypeError('Payout must be a non-negative integer of minor units');
  let remaining = payoutMinor;
  let previousLimit = 0;
  let feeMinor = 0;
  const bands = [];
  for (const band of schedule) {
    if (!remaining) break;
    const width = band.upToMinor === null ? remaining : Math.min(remaining, band.upToMinor - previousLimit);
    if (width > 0) {
      const part = quoteBreakdown(width, band.feeBps);
      feeMinor += part.feeMinor;
      bands.push({ payoutMinor: width, feeBps: band.feeBps, feeMinor: part.feeMinor });
      remaining -= width;
    }
    if (band.upToMinor !== null) previousLimit = band.upToMinor;
  }
  const totalMinor = payoutMinor + feeMinor;
  if (!Number.isSafeInteger(totalMinor)) throw new RangeError('Total is too large');
  return { payoutMinor, feeMinor, totalMinor, bands };
}

module.exports = { parseFeeSchedule, priceWithFee, ZERO_FEE_SCHEDULE: ZERO };
