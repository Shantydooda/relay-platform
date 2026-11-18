'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFeeSchedule, priceWithFee, ZERO_FEE_SCHEDULE } = require('../src/fee-schedule.cjs');
const { quoteBreakdown } = require('../src/marketplace.cjs');

const TIERED = '100000:2000,1000000:1200,*:800';

test('the default schedule charges nothing, so buyers pay exactly the builder price', () => {
  for (const value of [undefined, '', '0', ' 0 ']) assert.deepEqual(parseFeeSchedule(value), ZERO_FEE_SCHEDULE);
  assert.deepEqual(priceWithFee(123456), { payoutMinor: 123456, feeMinor: 0, totalMinor: 123456, bands: [{ payoutMinor: 123456, feeBps: 0, feeMinor: 0 }] });
});

test('a single band matches the existing quote arithmetic exactly', () => {
  const schedule = parseFeeSchedule('*:2000');
  for (const payout of [50, 999, 10000, 9999999]) {
    const quote = quoteBreakdown(payout, 2000), priced = priceWithFee(payout, schedule);
    assert.equal(priced.feeMinor, quote.feeMinor);
    assert.equal(priced.totalMinor, quote.totalMinor);
  }
});

test('tiers apply per band and payout + fee always equals the total', () => {
  const schedule = parseFeeSchedule(TIERED);
  const small = priceWithFee(100000, schedule);
  assert.equal(small.feeMinor, quoteBreakdown(100000, 2000).feeMinor);
  const large = priceWithFee(5000000, schedule);
  assert.deepEqual(large.bands.map(b => [b.payoutMinor, b.feeBps]), [[100000, 2000], [900000, 1200], [4000000, 800]]);
  assert.equal(large.feeMinor, large.bands.reduce((sum, b) => sum + b.feeMinor, 0));
  for (const payout of [0, 1, 99999, 100000, 100001, 1000000, 7654321]) {
    const p = priceWithFee(payout, schedule);
    assert.equal(p.payoutMinor + p.feeMinor, p.totalMinor);
    assert.equal(p.bands.reduce((sum, b) => sum + b.payoutMinor, 0), payout);
  }
});

test('the effective rate falls as projects grow, so large engagements are not punished', () => {
  const schedule = parseFeeSchedule(TIERED);
  const rate = payout => priceWithFee(payout, schedule).feeMinor / payout;
  assert.ok(rate(50000) > rate(500000));
  assert.ok(rate(500000) > rate(5000000));
});

test('malformed or unsafe schedules are rejected rather than guessed', () => {
  for (const bad of ['20%', '100000:2000', '*:2000,100000:1000', '100000:2000,50000:1000,*:500', '*:10000', '0:100,*:100', 'abc', '100000:-1,*:0'])
    assert.throws(() => parseFeeSchedule(bad), TypeError, bad);
  assert.throws(() => priceWithFee(-1), TypeError);
  assert.throws(() => priceWithFee(1.5), TypeError);
});
