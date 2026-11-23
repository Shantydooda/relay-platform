'use strict';
// Relay's fee on offers (docs/Build-Order.md, step 7; Decisions-Needed.md §1, option B).
//
// - A builder's quote (`offer.amountMinor`) is what the builder receives.
// - Relay's fee is added on top with the tiered schedule (fee-schedule.cjs) and
//   frozen on the offer when it is made: `feeMinor` and `totalMinor`. The agreement
//   copies the offer, so a later schedule change never reprices agreed work.
// - Buyers see, reserve, approve and are charged the all-in total. The builder is
//   transferred their quote; the fee stays with Relay as its own ledger entry.
// - The schedule comes from configuration and defaults to no fee, so nothing
//   changes for anyone until it is switched on. Bands use the offer currency's
//   minor units.
// Offers made before fees existed have no `totalMinor`; they cost the quote.

const { parseFeeSchedule, priceWithFee } = require('../../../packages/domain/src/fee-schedule.cjs');

function createPricing(spec) {
  const schedule = parseFeeSchedule(spec);
  const price = payoutMinor => priceWithFee(payoutMinor, schedule);
  return {
    charging: schedule.some(band => band.feeBps > 0),
    // Plain wording for builders. Each rate is a share of what the buyer pays, applied by
    // bands of the builder's price: "20% of the buyer's price on the first 1,000 of your
    // price, 12% up to 10,000 and 8% above".
    describe() {
      const pct = band => `${band.feeBps / 100}%`, amount = minor => (minor / 100).toLocaleString('en-US');
      if (schedule.length === 1) return `${pct(schedule[0])} of the buyer’s price`;
      return schedule.map((band, i) => i === 0 ? `${pct(band)} of the buyer’s price on the first ${amount(band.upToMinor)} of your price` : band.upToMinor === null ? `${pct(band)} above` : `${pct(band)} up to ${amount(band.upToMinor)}`)
        .join(', ').replace(/, ([^,]*)$/, ' and $1');
    },
    price,
    // Freezes the fee on a new or repriced offer.
    priced(offer) { const { feeMinor, totalMinor } = price(offer.amountMinor); return Object.assign(offer, { feeMinor, totalMinor }); },
  };
}

// What the buyer pays for an offer or agreement.
const buyerTotal = offer => offer?.totalMinor ?? offer?.amountMinor;
// What a funded settlement pays the builder and keeps as Relay's fee.
const settlementSplit = p => ({ chargeMinor: p.amountMinor, payoutMinor: p.payoutMinor ?? p.amountMinor, feeMinor: p.feeMinor ?? 0 });

module.exports = { createPricing, buyerTotal, settlementSplit };
