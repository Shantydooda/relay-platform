'use strict';
// QA (adversarial review, 25 Nov 2026): money rules that can be checked without
// a provider or database. Passing tests document verified behaviour; tests marked
// `todo` reproduce confirmed bugs and are expected to fail until fixed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPayments, paymentView } = require('../src/payments.cjs');
const { checkEnd } = require('../src/acceptance.cjs');
const { createPricing, buyerTotal, settlementSplit } = require('../src/pricing.cjs');
const { summarizeSpending } = require('../src/spending.cjs');
const { reportingPeriod, applyPeriod, spendingCsv } = require('../src/spending-report.cjs');
const { parseFeeSchedule, priceWithFee } = require('../../../packages/domain/src/fee-schedule.cjs');

const TIERED = '100000:2000,1000000:1200,*:800';

// createPayments only wires closures at construction; no repository call happens.
function refundsFor({ provider = null, refundOnEnd = false } = {}) {
  const context = { localExecution: true, refundOnEnd, now: () => 0, repository: {} };
  createPayments(context, provider);
  return context.refunds;
}

// An unpaid run (assignment mode local-unpaid) after two revision rounds, so only
// the money rule decides whether "End as unmet" is allowed.
function unpaidTaskWith(settlement) {
  return {
    id: 't1',
    assignment: { status: 'buyer_review', mode: 'local-unpaid' },
    submissions: [{ status: 'revision_requested' }, { status: 'revision_requested' }, { status: 'submitted' }],
    ...(settlement ? { settlement } : {}),
  };
}

test('end as unmet: unpaid work with no payment record can be ended (refunds off and on)', () => {
  assert.equal(checkEnd(unpaidTaskWith(null)), null);
  assert.equal(checkEnd(unpaidTaskWith(null), refundsFor()), null);
  assert.equal(checkEnd(unpaidTaskWith(null), refundsFor({ provider: {}, refundOnEnd: true })), null);
});

test('end as unmet: a held (funded) payment is refused while refunds-on-end is off, and refunded when on', () => {
  const funded = () => unpaidTaskWith({ status: 'funded', amountMinor: 500 });
  assert.throws(() => checkEnd(funded()), { code: 'REFUND_REQUIRED' });
  assert.throws(() => checkEnd(funded(), refundsFor()), { code: 'REFUND_REQUIRED' });
  assert.equal(checkEnd(funded(), refundsFor({ provider: {}, refundOnEnd: true })), 'refund');
});

test('end as unmet: an open checkout or a refund in flight is refused in both modes', () => {
  for (const status of ['creating_checkout', 'awaiting_payment', 'creating_refund', 'refund_pending', 'refund_failed']) {
    assert.throws(() => checkEnd(unpaidTaskWith({ status })), { code: 'REFUND_REQUIRED' }, status);
    assert.throws(() => checkEnd(unpaidTaskWith({ status }), refundsFor({ provider: {}, refundOnEnd: true })), { code: 'REFUND_REQUIRED' }, status);
  }
});

test('end as unmet: an expired checkout holds no money, so ending is allowed when refunds-on-end is on', () => {
  assert.equal(checkEnd(unpaidTaskWith({ status: 'expired', amountMinor: 500 }), refundsFor({ provider: {}, refundOnEnd: true })), null);
});

// BUG-PAY-1. A buyer opens a sandbox checkout, lets it expire (nothing was paid),
// then starts the same offer as unpaid local work (execution.cjs#checkStart allows
// it: assertUnfunded treats 'expired' as terminal). With refundOnEnd off (the
// default locally), "End as unmet" and the lifecycle 'end' action are refused with
// "it has a held payment", although no money is held.
test('end as unmet: an expired checkout holds no money, so ending is allowed when refunds-on-end is off',
  { todo: 'BUG-PAY-1: expired (never-paid) checkout blocks "End as unmet" with a false "held payment" error when refundOnEnd is off' }, () => {
    assert.equal(checkEnd(unpaidTaskWith({ status: 'expired', amountMinor: 500 })), null);
    assert.equal(checkEnd(unpaidTaskWith({ status: 'expired', amountMinor: 500 }), refundsFor()), null);
  });

test('fee schedule parsing fails closed on malformed or ambiguous configuration', () => {
  for (const bad of ['100000:2000', '*:10000', '*:-1', '*:1.5', '100000:2000,50000:1000,*:800', '*:100,*:200',
    '0:100,*:100', '01000:100,*:100', '1e5:100,*:100', '100000 : 2000,*:800', '*:20000', 'abc', '100000:2000,,*:800',
    `${Number.MAX_SAFE_INTEGER + 2}:100,*:100`]) {
    assert.throws(() => parseFeeSchedule(bad), TypeError, bad);
    assert.throws(() => createPricing(bad), TypeError, `createPricing(${bad}) must not start with a silently wrong fee`);
  }
  assert.deepEqual(parseFeeSchedule(' 100000:2000 , *:800 ').map(b => [b.upToMinor, b.feeBps]), [[100000, 2000], [null, 800]]);
});

test('every priced amount reconciles exactly: payout + fee = total, fee never negative, band edges included', () => {
  const schedule = parseFeeSchedule(TIERED);
  const amounts = [0, 1, 2, 3, 4, 5, 49, 50, 99, 99999, 100000, 100001, 999999, 1000000, 1000001, 10_000_000];
  for (let i = 0; i < 500; i++) amounts.push(1 + ((i * 7919 * 104729) % 10_000_000));
  for (const payout of amounts) {
    const p = priceWithFee(payout, schedule);
    assert.equal(p.payoutMinor + p.feeMinor, p.totalMinor, `payout ${payout}`);
    assert.ok(p.feeMinor >= 0 && Number.isSafeInteger(p.totalMinor));
    assert.equal(p.bands.reduce((n, b) => n + b.payoutMinor, 0), payout);
    // The fee never exceeds the highest band's share of the total.
    assert.ok(p.feeMinor <= Math.ceil(p.totalMinor * 0.2), `payout ${payout}`);
  }
  assert.throws(() => priceWithFee(-1, schedule), TypeError);
  assert.throws(() => priceWithFee(1.5, schedule), TypeError);
  assert.throws(() => priceWithFee(Number.NaN, schedule), TypeError);
});

test('buyer total and settlement split: legacy offers cost the quote; the split always sums to the charge', () => {
  assert.equal(buyerTotal({ amountMinor: 500 }), 500);
  assert.equal(buyerTotal({ amountMinor: 500, feeMinor: 125, totalMinor: 625 }), 625);
  assert.deepEqual(settlementSplit({ amountMinor: 500 }), { chargeMinor: 500, payoutMinor: 500, feeMinor: 0 });
  const split = settlementSplit({ amountMinor: 625, payoutMinor: 500, feeMinor: 125 });
  assert.equal(split.payoutMinor + split.feeMinor, split.chargeMinor);
  const view = paymentView({ id: 'p', status: 'funded', amountMinor: 625, payoutMinor: 500, feeMinor: 125, currency: 'USD' });
  assert.deepEqual([view.amountMinor, view.payoutMinor, view.feeMinor, view.platformFeeMinor], [625, 500, 125, 125]);
});

function ledgerTask(id, ledger, extra = {}) {
  return { id, title: `Task ${id}`, createdAt: 1, offers: [], selectedOfferId: null,
    settlement: { id: `s-${id}`, status: 'paid', amountMinor: 625, currency: 'USD', ledger }, ...extra };
}
const view = () => ({ status: 'accepted' });
const FUNDED = { debit: 'provider_cash', credit: 'buyer_funds', amountMinor: 625, currency: 'USD', reference: 'ch_1', createdAt: 10 };
const TRANSFER = { debit: 'buyer_funds', credit: 'operator_balance', amountMinor: 500, currency: 'USD', reference: 'tr_1', createdAt: 20 };
const FEE = { debit: 'buyer_funds', credit: 'relay_fees', amountMinor: 125, currency: 'USD', reference: 'tr_1:fee', createdAt: 20 };
const PAYOUT = { debit: 'operator_balance', credit: 'sandbox_payout', amountMinor: 500, currency: 'USD', reference: 'po_1', createdAt: 30 };

test('spending: a payout is not a second buyer expense, the fee is released with the transfer, held ends at zero', () => {
  const report = summarizeSpending([ledgerTask('a', [FUNDED, TRANSFER, FEE, PAYOUT])], [], view, 100);
  assert.deepEqual([report.totals.fundedMinor, report.totals.releasedMinor, report.totals.heldMinor, report.totals.netMinor], [625, 625, 0, 625]);
  assert.equal(report.items[0].transactions.filter(t => t.relayFee).length, 1);
});

test('spending: a replayed ledger entry (same provider reference) is counted once', () => {
  const report = summarizeSpending([ledgerTask('a', [FUNDED, { ...FUNDED }, TRANSFER, FEE])], [], view, 100);
  assert.equal(report.totals.fundedMinor, 625);
});

test('spending: corrupt or mixed-currency ledgers refuse to report rather than show wrong totals', () => {
  assert.throws(() => summarizeSpending([ledgerTask('a', [{ ...FUNDED, amountMinor: -1 }])], [], view, 100), /Invalid spending ledger/);
  assert.throws(() => summarizeSpending([ledgerTask('a', [{ ...FUNDED, amountMinor: 1.5 }])], [], view, 100), /Invalid spending ledger/);
  assert.throws(() => summarizeSpending([ledgerTask('a', [FUNDED, { ...TRANSFER, currency: 'EUR' }])], [], view, 100), /currency/);
  // Released more than was funded: held would go negative.
  assert.throws(() => summarizeSpending([ledgerTask('a', [TRANSFER])], [], view, 100), /does not reconcile/);
  assert.throws(() => summarizeSpending([], [], view, 100, 'GBP'), /Unsupported/);
});

test('spending: a EUR settlement is excluded from a USD report and reported on its own', () => {
  const eur = ledgerTask('b', [{ ...FUNDED, currency: 'EUR' }]);
  eur.settlement.currency = 'EUR';
  assert.equal(summarizeSpending([eur], [], view, 100, 'USD').totals.fundedMinor, 0);
  assert.equal(summarizeSpending([eur], [], view, 100, 'EUR').totals.fundedMinor, 625);
});

test('spending: a refunded-then-refunded-again task (history + current settlement) sums both settlements', () => {
  const refund = { debit: 'buyer_funds', credit: 'provider_cash', amountMinor: 625, currency: 'USD', reference: 're_1', createdAt: 15 };
  const old = { id: 's-old', taskId: 'a', status: 'refunded', amountMinor: 625, currency: 'USD', ledger: [FUNDED, refund] };
  const current = ledgerTask('a', [{ ...FUNDED, reference: 'ch_2', createdAt: 40 }]);
  current.settlement.status = 'funded';
  const report = summarizeSpending([current], [old], view, 100);
  assert.deepEqual([report.totals.fundedMinor, report.totals.refundedMinor, report.totals.heldMinor], [1250, 625, 625]);
});

test('reporting period: opening held carries earlier movements; the end date is inclusive in UTC', () => {
  const day = Date.parse('2026-11-02T00:00:00Z');
  const task = ledgerTask('a', [{ ...FUNDED, createdAt: day - 1 }, { ...TRANSFER, createdAt: day + 1 }, { ...FEE, createdAt: day + 1 }]);
  const report = applyPeriod(summarizeSpending([task], [], view, day + 5), reportingPeriod('2026-11-02', '2026-11-02'));
  assert.deepEqual([report.totals.openingHeldMinor, report.totals.fundedMinor, report.totals.releasedMinor, report.totals.heldMinor], [625, 0, 625, 0]);
  assert.throws(() => reportingPeriod('2026-02-30', ''), { code: 'INVALID_DATE_RANGE' });
  assert.throws(() => reportingPeriod('2026-11-03', '2026-11-02'), { code: 'INVALID_DATE_RANGE' });
});

test('CSV export neutralises spreadsheet formulas in task titles but keeps negative amounts numeric', () => {
  const report = { currency: 'USD', period: { from: '', to: '' }, observedAt: 0, totals: Object.fromEntries(['openingHeldMinor', 'fundedMinor', 'refundedMinor', 'releasedMinor', 'netMinor', 'heldMinor', 'pendingFundingMinor', 'pendingRefundMinor'].map(k => [k, -344])), items: [] };
  for (const title of ['=HYPERLINK("http://x","y")', '+1+1', '-2+3', '@SUM(A1)', ' =1', '\t=1', '\r=1']) {
    report.items = [{ id: 'a', title, ...report.totals }];
    const csv = spendingCsv(report);
    assert.ok(csv.includes(`"'${title.replaceAll('"', '""')}"`), JSON.stringify(title));
  }
  assert.ok(spendingCsv(report).includes('"-3.44"'));
});

// End to end through the real application (SQLite, fixture provider): the checkout
// genuinely expires, then the run is recorded as unpaid local work in review after
// two revision rounds (written directly, since the fixture has no runtime).
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
async function expiredThenUnpaid(t) {
  const f = await fixture(t, 'sqlite');
  f.provider.funding = async () => ({ status: 'expired' });
  await f.begin('fund');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  assert.equal((await f.get()).settlement.status, 'expired', 'the checkout expired: nothing was paid');
  await f.repository.transaction('qa', async repo => {
    const task = await repo.get('task', f.taskId, true);
    task.assignment = { id: 'qa-assignment', agentId: 'agent-fixture', operatorId: f.builder.user.id, mode: 'local-unpaid', status: 'buyer_review', offerId: task.selectedOfferId };
    task.submissions = [{ id: 's1', status: 'revision_requested', files: [] }, { id: 's2', status: 'revision_requested', files: [] }, { id: 's3', status: 'submitted', files: [] }];
    await repo.save('task', task);
  });
  return f;
}
test('sqlite: after an expired checkout, unpaid work in review can be ended as unmet',
  { todo: 'BUG-PAY-1: endUnmet refused with REFUND_REQUIRED "held payment" after a never-paid checkout expired' }, async t => {
    const f = await expiredThenUnpaid(t);
    const result = await f.app.endUnmet(f.buyer, f.taskId, { expectedVersion: (await f.get()).version, reason: 'Checklist not met', unmetCriteria: [] }, randomUUID());
    assert.equal(result.status, 'failed');
  });
test('sqlite: the expired-checkout refusal is reproducible (documents the current behaviour behind BUG-PAY-1)', async t => {
  const f = await expiredThenUnpaid(t);
  await assert.rejects(f.app.endUnmet(f.buyer, f.taskId, { expectedVersion: (await f.get()).version, reason: 'Checklist not met', unmetCriteria: [] }, randomUUID()),
    { code: 'REFUND_REQUIRED', message: /held payment/ });
  assert.equal((await f.get()).settlement.ledger.length, 0, 'no money ever moved');
});
