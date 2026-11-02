'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
const DAY = 86400000;
function reportingPeriod(from = '', to = '') {
  function parse(value) {
    if (!value) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      fail(400, 'INVALID_DATE_RANGE', 'Choose valid dates.');
    const stamp = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !Number.isFinite(stamp) ||
      new Date(stamp).toISOString().slice(0, 10) !== value
    )
      fail(400, 'INVALID_DATE_RANGE', 'Choose valid dates.');
    return stamp;
  }
  const start = parse(from),
    end = parse(to);
  if (start !== null && end !== null && start > end)
    fail(400, 'INVALID_DATE_RANGE', 'Start date must be before the end date.');
  return {
    from,
    to,
    start: start ?? -Infinity,
    end: end === null ? Infinity : end + DAY,
    timezone: 'UTC',
  };
}
const columns = [
  'openingHeldMinor',
  'fundedMinor',
  'refundedMinor',
  'releasedMinor',
  'netMinor',
  'heldMinor',
  'pendingFundingMinor',
  'pendingRefundMinor',
];
function applyPeriod(report, period) {
  const items = report.items
    .map((item) => {
      let openingHeldMinor = 0,
        fundedMinor = 0,
        refundedMinor = 0,
        releasedMinor = 0;
      for (const entry of item.transactions) {
        if (entry.createdAt >= period.end) continue;
        if (entry.createdAt < period.start)
          openingHeldMinor +=
            entry.kind === 'funding' ? entry.amountMinor : -entry.amountMinor;
        else if (entry.kind === 'funding') fundedMinor += entry.amountMinor;
        else if (entry.kind === 'refund') refundedMinor += entry.amountMinor;
        else if (entry.kind === 'release') releasedMinor += entry.amountMinor;
      }
      const netMinor = fundedMinor - refundedMinor;
      return {
        ...item,
        openingHeldMinor,
        fundedMinor,
        refundedMinor,
        releasedMinor,
        netMinor,
        heldMinor: openingHeldMinor + netMinor - releasedMinor,
        transactions: item.transactions.filter(
          (entry) =>
            entry.createdAt >= period.start && entry.createdAt < period.end,
        ),
      };
    })
    .filter(
      (item) =>
        item.transactions.length ||
        item.openingHeldMinor ||
        item.pendingFundingMinor ||
        item.pendingRefundMinor ||
        (item.createdAt >= period.start && item.createdAt < period.end),
    );
  const totals = Object.fromEntries(columns.map((key) => [key, 0]));
  for (const item of items)
    for (const key of columns) {
      totals[key] += item[key];
      if (!Number.isSafeInteger(totals[key]))
        throw new Error('Spending total exceeds supported precision.');
    }
  return {
    ...report,
    items,
    totals,
    period: { from: period.from, to: period.to, timezone: 'UTC' },
  };
}
function decimal(value) {
  const integer = BigInt(value);
  const absolute = integer < 0n ? -integer : integer;
  return `${integer < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
function csvCell(value) {
  let text = String(value ?? '');
  // Neutralize spreadsheet formulas in untrusted task titles and references.
  if (/^[\s]*[=+\-@]/.test(text) && !/^-?\d+\.\d{2}$/.test(text))
    text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function spendingCsv(report) {
  const header = [
    'Row type',
    'Task ID',
    'Task title',
    'Currency',
    'Mode',
    'From (UTC inclusive)',
    'To (UTC inclusive)',
    'Snapshot (UTC)',
    'Opening held',
    'Funding in period',
    'Refunds in period',
    'Released in period',
    'Net funding in period',
    'Closing held',
    'Pending funding now',
    'Pending refund now',
  ];
  const meta = [
    'USD',
    'sandbox',
    report.period.from,
    report.period.to,
    new Date(report.observedAt).toISOString(),
  ];
  const rows = [
    header,
    ...report.items.map((item) => [
      'TASK',
      item.id,
      item.title,
      ...meta,
      ...columns.map((key) => decimal(item[key])),
    ]),
    [
      'TOTAL',
      '',
      '',
      ...meta,
      ...columns.map((key) => decimal(report.totals[key])),
    ],
  ];
  return (
    '\uFEFF' +
    rows.map((row) => row.map(csvCell).join(',')).join('\r\n') +
    '\r\n'
  );
}
module.exports = { reportingPeriod, applyPeriod, spendingCsv };
