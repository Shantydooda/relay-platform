'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeSpending } = require('../src/spending.cjs');
const funding = {
  debit: 'provider_cash',
  credit: 'buyer_funds',
  currency: 'USD',
  amountMinor: 12345,
  reference: 'charge-1',
  createdAt: 1,
};
const task = (ledger) => ({
  id: 'task-1',
  title: 'Work',
  createdAt: 1,
  offers: [],
  settlement: {
    id: 'payment-1',
    amountMinor: 12345,
    status: 'refund_pending',
    ledger,
  },
});
const summarize = (records) =>
  summarizeSpending(records, [], () => ({ status: 'posted' }), 2);
test('exact integer totals, pending refunds and duplicate notifications reconcile', () => {
  const result = summarize([task([funding, { ...funding }])]);
  assert.equal(result.totals.fundedMinor, 12345);
  assert.equal(result.totals.heldMinor, 12345);
  assert.equal(result.totals.refundedMinor, 0);
  assert.equal(result.totals.pendingRefundMinor, 12345);
  assert.equal(result.items[0].transactions.length, 1);
  assert.equal(result.items[0].transactions[0].reference, 'charge-1');
});
test('invalid currency, precision and negative held balances fail rather than show misleading totals', () => {
  for (const change of [
    { currency: 'EUR' },
    { amountMinor: 1.1 },
    { amountMinor: -1 },
  ]) {
    assert.throws(
      () => summarize([task([{ ...funding, ...change }])]),
      /Invalid spending/,
    );
  }
  assert.throws(
    () =>
      summarize([
        task([
          { ...funding, debit: 'buyer_funds', credit: 'operator_balance' },
        ]),
      ]),
    /does not reconcile/,
  );
});

const {
  reportingPeriod,
  applyPeriod,
  spendingCsv,
} = require('../src/spending-report.cjs');
const at = (value) => Date.parse(value + 'T00:00:00Z');
function periodFixture() {
  const entry = (kind, amountMinor, day) => ({
    kind,
    amountMinor,
    createdAt: at(day),
  });
  return {
    observedAt: at('2026-11-03'),
    items: [
      {
        id: 'one',
        title: '=SUM(A1)\n"quoted", title',
        createdAt: at('2026-10-01'),
        pendingFundingMinor: 0,
        pendingRefundMinor: 0,
        transactions: [
          entry('funding', 12345, '2026-10-31'),
          entry('refund', 345, '2026-11-01'),
          entry('release', 12000, '2026-11-02'),
        ],
      },
      {
        id: 'two',
        title: 'Second task',
        createdAt: at('2026-11-01'),
        pendingFundingMinor: 99,
        pendingRefundMinor: 0,
        transactions: [entry('funding', 1, '2026-11-01')],
      },
    ],
  };
}
function parseCsv(csv) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (c === '\uFEFF') continue;
    if (c === '"') {
      if (quoted && csv[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (c === '\r' && !quoted && csv[i + 1] === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i++;
    } else field += c;
  }
  return rows;
}
test('transaction date boundaries retain opening funds and reconcile later refunds/releases', () => {
  const report = applyPeriod(
    periodFixture(),
    reportingPeriod('2026-11-01', '2026-11-01'),
  );
  assert.equal(report.totals.openingHeldMinor, 12345);
  assert.equal(report.totals.fundedMinor, 1);
  assert.equal(report.totals.refundedMinor, 345);
  assert.equal(report.totals.releasedMinor, 0);
  assert.equal(report.totals.netMinor, -344);
  assert.equal(report.totals.heldMinor, 12001);
  assert.equal(report.totals.pendingFundingMinor, 99);
  const next = applyPeriod(
    periodFixture(),
    reportingPeriod('2026-11-02', '2026-11-02'),
  );
  assert.equal(next.totals.openingHeldMinor, 12001);
  assert.equal(next.totals.heldMinor, 1);
  assert.equal(next.totals.releasedMinor, 12000);
});
test('every CSV numeric column sums exactly to displayed totals including cents and negative net funding', () => {
  const report = applyPeriod(
    periodFixture(),
    reportingPeriod('2026-11-01', '2026-11-01'),
  );
  const rows = parseCsv(spendingCsv(report));
  const keys = [
    'openingHeldMinor',
    'fundedMinor',
    'refundedMinor',
    'releasedMinor',
    'netMinor',
    'heldMinor',
    'pendingFundingMinor',
    'pendingRefundMinor',
  ];
  const cents = (value) => {
    const negative = value.startsWith('-');
    const [whole, fraction] = value.replace('-', '').split('.');
    return (BigInt(whole) * 100n + BigInt(fraction)) * (negative ? -1n : 1n);
  };
  for (let col = 8; col < 16; col++) {
    const sum = rows
      .slice(1, -1)
      .reduce((total, row) => total + cents(row[col]), 0n);
    assert.equal(sum, cents(rows.at(-1)[col]));
    assert.equal(sum, BigInt(report.totals[keys[col - 8]]));
  }
  assert.equal(rows[1][2], '\'=SUM(A1)\n"quoted", title');
  assert.equal(rows.at(-1)[0], 'TOTAL');
});
test('rejects invalid/reversed dates and empty reports still export explicit zero totals', () => {
  for (const args of [
    ['2026-02-30', ''],
    ['2026-12-02', '2026-11-01'],
    ['bad', ''],
  ])
    assert.throws(() => reportingPeriod(...args), {
      code: 'INVALID_DATE_RANGE',
    });
  const empty = applyPeriod(
    { items: [], observedAt: at('2026-11-03') },
    reportingPeriod(),
  );
  const rows = parseCsv(spendingCsv(empty));
  assert.equal(rows.length, 2);
  assert.equal(rows[1][8], '0.00');
});
