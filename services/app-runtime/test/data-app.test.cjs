'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePackage, runPackage } = require('../src/data-app.cjs');
const manifest = {
  format: 'relay-data-app',
  version: 1,
  name: 'Overdue invoices',
  description: 'Prioritize overdue invoices',
  input: 'json-records',
  steps: [
    { op: 'filter', field: 'daysOverdue', compare: 'gt', value: 0 },
    { op: 'sort', field: 'amount', direction: 'desc' },
    { op: 'deduplicate', field: 'customer' },
    { op: 'select', fields: ['customer', 'amount'] },
    { op: 'limit', count: 2 },
  ],
};
module.exports = { manifest };
test('builder pipeline transforms data deterministically with per-step evidence', () => {
  const source = JSON.stringify([
    { customer: 'A', amount: 30, daysOverdue: 10 },
    { customer: 'B', amount: 100, daysOverdue: 0 },
    { customer: 'C', amount: 80, daysOverdue: 3 },
    { customer: 'A', amount: 30, daysOverdue: 10 },
  ]);
  const app = parsePackage(Buffer.from(JSON.stringify(manifest)));
  const result = runPackage(app, source);
  assert.deepEqual(JSON.parse(result.output), [
    { customer: 'C', amount: 80 },
    { customer: 'A', amount: 30 },
  ]);
  assert.deepEqual(
    result.steps.map((s) => s.outputRows),
    [3, 3, 2, 2, 2],
  );
  assert.deepEqual(runPackage(app, source), result);
  assert.equal(app.steps.length, 5);
});
test('unsupported code, permissions, versions and unbounded work are rejected', () => {
  for (const change of [
    { version: 2 },
    { network: true },
    { steps: [{ op: 'eval', code: 'process.exit()' }] },
    { steps: [{ op: 'limit', count: 1000000 }] },
    { steps: Array(21).fill({ op: 'limit', count: 1 }) },
    {
      steps: [{ op: 'filter', field: 'constructor', compare: 'eq', value: 1 }],
    },
    { steps: [{ op: 'filter', field: 'amount', compare: 'gt', value: '1' }] },
  ])
    assert.throws(() =>
      parsePackage(Buffer.from(JSON.stringify({ ...manifest, ...change }))),
    );
  assert.throws(() => parsePackage(Buffer.alloc(17000)), { code: 'APP_LIMIT' });
  assert.throws(() => parsePackage(Buffer.from([255])), {
    code: 'APP_INVALID',
  });
});
test('malformed, oversized, nested and missing-field data fail without output', () => {
  for (const input of [
    '{}',
    'null',
    '[{"amount":1}]',
    '[{"constructor":"x"}]',
    '[{"x":{}}]',
    '[{"x":[]}]',
    'x'.repeat(16001),
  ])
    assert.throws(() => runPackage(manifest, input), {
      code: 'SOURCE_INVALID',
    });
  assert.throws(
    () =>
      runPackage(
        manifest,
        JSON.stringify([{ customer: 'A', amount: 5, daysOverdue: '3' }]),
      ),
    { code: 'SOURCE_INVALID' },
  );
  assert.deepEqual(JSON.parse(runPackage(manifest, '[]').output), []);
});
