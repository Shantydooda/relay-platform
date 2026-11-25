'use strict';
// QA (adversarial review, 25 Nov 2026): the payment panels in the browser client.
// Passing tests document verified behaviour; `todo` tests reproduce confirmed bugs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../../../packages/ui/src/components.cjs');

const source = fs.readFileSync(path.join(__dirname, '../public/payments-ui.js'), 'utf8');
// Deterministic formatter with the same contract as marketplace.js#money (minor units).
const money = (value, currency = 'USD') => `${currency} ${(value / 100).toFixed(2)}`;
function load(state) {
  const ctx = vm.createContext({ state, escape: text, money, date: () => 'Today', RelayExecution: undefined });
  vm.runInContext(`${source};globalThis.RelayPayments = RelayPayments;`, ctx);
  return ctx.RelayPayments;
}

// What paymentView (services/application/src/payments.cjs) sends for a $5.00 quote
// with Relay's tiered fee switched on (RELAY_FEE_SCHEDULE): buyer total $6.25.
const FEE_PAYMENT = { id: 'p1', status: 'funded', amountMinor: 625, payoutMinor: 500, feeMinor: 125, platformFeeMinor: 125, currency: 'USD', reconciliation: { status: 'automatic' } };
const task = { id: 't1', version: 3, title: 'CSV cleanup', selectedOfferId: 'o1', actions: { payments: { transfer: { allowed: true }, payout: { allowed: true } } } };

test('buyer payment panel shows the all-in amount the buyer was charged', () => {
  const html = load({ payments: { configured: true } }).task(task, FEE_PAYMENT, false, null);
  assert.match(html, /USD 6\.25/);
});

test('builder earnings show what the builder is transferred, not the buyer’s total including Relay’s fee',
  { todo: 'BUG-WEB-1: builder payment/earnings panel renders payment.amountMinor (buyer total incl. fee) instead of payoutMinor' }, () => {
    const ui = load({ payments: { configured: true }, work: [{ ...task, payment: FEE_PAYMENT, execution: { status: 'accepted' } }] });
    const panel = ui.task(task, FEE_PAYMENT, true, { status: 'accepted' });
    assert.match(panel, /USD 5\.00/, 'the builder is transferred $5.00');
    assert.doesNotMatch(panel, /USD 6\.25/, 'the buyer total is not the builder’s earning');
    assert.doesNotMatch(ui.earnings(), /USD 6\.25/);
  });

test('without a fee, builder and buyer amounts agree (legacy payments have no payoutMinor)', () => {
  const legacy = { id: 'p0', status: 'funded', amountMinor: 500, currency: 'USD' };
  const ui = load({ payments: { configured: true } });
  assert.match(ui.task(task, legacy, true, { status: 'accepted' }), /USD 5\.00/);
});

test('builder sees transfer only after acceptance and payout only after transfer; nothing while review is paused', () => {
  const ui = load({ payments: { configured: true } });
  assert.match(ui.task(task, FEE_PAYMENT, true, { status: 'accepted' }), /data-operation="transfer"/);
  assert.doesNotMatch(ui.task(task, FEE_PAYMENT, true, { status: 'buyer_review' }), /data-operation="transfer"/);
  assert.match(ui.task(task, { ...FEE_PAYMENT, status: 'transferred' }, true, { status: 'accepted' }), /data-operation="payout"/);
  const paused = ui.task(task, { ...FEE_PAYMENT, reconciliation: { status: 'needs_review' } }, true, { status: 'accepted' });
  assert.doesNotMatch(paused, /data-action="sandbox-payment"/);
});

test('a disallowed fund action renders disabled with the server’s reason, escaped', () => {
  const blocked = { ...task, actions: { payments: { fund: { allowed: false, reason: '<img src=x onerror=alert(1)>' } } } };
  const html = load({ payments: { configured: true } }).task(blocked, null, false, null);
  assert.match(html, /<button disabled/);
  assert.doesNotMatch(html, /<img src=x/);
});

function billingWithFee() {
  const zero = { openingHeldMinor: 0, fundedMinor: 625, refundedMinor: 0, releasedMinor: 625, netMinor: 625, heldMinor: 0, pendingFundingMinor: 0, pendingRefundMinor: 0 };
  return { currency: 'USD', scope: 'workspace', observedAt: 0, period: { from: '', to: '' }, totals: zero, page: 0, pageCount: 1, nextPage: null,
    items: [{ id: 't1', title: '<b>CSV</b>', createdAt: 0, status: 'accepted', paymentStatus: 'paid', agreedMinor: 625, ...zero, transactions: [
      { kind: 'funding', reference: 'ch_1', settlementId: 's', amountMinor: 625, currency: 'USD', createdAt: 0 },
      { kind: 'release', reference: 'tr_1', settlementId: 's', amountMinor: 500, currency: 'USD', createdAt: 1 },
      { kind: 'release', reference: 'tr_1:fee', settlementId: 's', amountMinor: 125, currency: 'USD', createdAt: 1, relayFee: true },
    ] }] };
}

test('history page escapes task titles and labels the fee line as Relay’s fee', () => {
  const html = load({ spendingHistory: billingWithFee() }).billing();
  assert.doesNotMatch(html, /<b>CSV<\/b>/);
  assert.match(html, /Relay fee/);
});

test('history page copy does not claim there is no platform fee when a Relay fee was charged',
  { todo: 'BUG-WEB-2: billing/payment copy says "no platform fee"/"zero platform fee" and "Released… transfers to builders" while the fee schedule charges and releases a Relay fee' }, () => {
    const ui = load({ spendingHistory: billingWithFee(), payments: { configured: true } });
    assert.doesNotMatch(ui.billing(), /no platform fee/i);
    assert.doesNotMatch(ui.task(task, FEE_PAYMENT, false, null), /zero platform fee/i);
  });
