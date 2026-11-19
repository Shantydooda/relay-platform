'use strict';
// Automatic checks on the request page (intake-ui.js): the editor and delivery results.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state) {
  const context = vm.createContext({ state, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/intake-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayIntake', context);
}
const check = { id: 'k1', type: 'unique_key', fields: ['Tax ID'], label: 'Key is unique', description: 'Tax ID' };

test('the poster adds and removes checks before work starts; parameters follow the check type', () => {
  const detail = { mine: true, task: { status: 'posted' }, execution: null, checks: [check], intake: { attachments: [{ id: 'x1', role: 'code_crosswalk', filename: 'terms.csv' }] } };
  const html = ui({ checkType: 'values_in_crosswalk' }).checksSection(detail);
  assert.match(html, /Key is unique<\/span><span>Tax ID/);
  assert.match(html, /data-action="check-remove" data-id="k1"/);
  assert.match(html, /<option value="x1">terms\.csv/);
  assert.match(html, /agents quote again/);
  assert.match(ui({ checkType: 'header_matches_template' }).checksSection(detail), /Add the target import template first/);
  const locked = ui({}).checksSection({ ...detail, execution: { status: 'running' } });
  assert.doesNotMatch(locked, /check-add|check-remove/, 'authorized work keeps its agreed checks');
  assert.equal(ui({}).checksSection({ ...detail, mine: false, checks: [] }), '');
});

test('form values become a check body, and display fields are stripped before saving', () => {
  const r = ui({});
  const data = new Map([['type', 'control_total'], ['field', ' Open Balance '], ['expected', '1500.50'], ['tolerance', '0.01']]);
  assert.deepEqual({ ...r.checkFromForm({ get: k => data.get(k) ?? null }) }, { type: 'control_total', field: 'Open Balance', expected: 1500.5, tolerance: 0.01 });
  const keys = new Map([['type', 'unique_key'], ['fields', 'Name, Country']]);
  assert.deepEqual([...r.checkFromForm({ get: k => keys.get(k) ?? null }).fields], ['Name', 'Country']);
  assert.deepEqual({ ...r.checkBody({ ...check, filename: 'x', samples: [] }) }, { type: 'unique_key', fields: ['Tax ID'] });
});

test('delivery results say what failed and that the fix is free', () => {
  const detail = { submissions: [{ version: 2, checks: { file: 'out.csv', results: [
    { id: 'k1', type: 'unique_key', label: 'Key is unique', description: 'Tax ID', status: 'fail', detail: '1 duplicate key.', examples: ['Rows 2 and 3: 12-3456789'] },
    { id: 'k2', type: 'row_count', label: 'Row count', description: '3 rows', status: 'pass', detail: '3 rows.', examples: [] }] } }] };
  const html = ui({}).checkResults(detail);
  assert.match(html, /Checks on delivery v2/);
  assert.match(html, /1 of 2 checks didn’t pass/);
  assert.match(html, /the fix is free/);
  assert.match(html, /Rows 2 and 3: 12-3456789/);
  assert.match(html, /mk-check-pass/);
  assert.equal(ui({}).checkResults({ submissions: [{ version: 1 }] }), '');
});
