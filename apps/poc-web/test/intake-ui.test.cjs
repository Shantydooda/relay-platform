'use strict';
// ERP data requests on Post a request and the readiness checklist (intake-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state) {
  const context = vm.createContext({ state, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/intake-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayIntake', context);
}
const intake = (over = {}) => ({ targetLabel: 'Oracle NetSuite', objectLabel: 'Vendor master', sourceSystem: 'Sage 100', recordCount: 4210, asOfDate: '2026-11-15', dataOwnerName: 'Dana', dependenciesConfirmed: true,
  readiness: { complete: false, missing: ['Field mapping', '2 more sample pairs (input with its expected output)'], recommended: ['Code cross-walk'], pairs: 1 },
  attachments: [{ id: 'a1', role: 'source_extract', filename: 'vendors.csv', size: 2048 }, { id: 'a2', role: 'sample_input', filename: 'in.csv', size: 10, pairId: 'p1', caseKind: 'edge' }, { id: 'a3', role: 'expected_output', filename: 'out.csv', size: 10, pairId: 'p1' }], ...over });

test('Post a request offers an ERP data kind with the intake fields', () => {
  assert.doesNotMatch(ui({}).postFields(), /Target ERP/);
  const html = ui({ postKind: 'erp' }).postFields();
  assert.match(html, /value="erp" data-post-kind checked/);
  assert.match(html, /Target ERP/);
  assert.match(html, /<option value="sap-s4hana"/);
  assert.match(html, /name="dependenciesConfirmed"/);
  const data = new Map([['targetErp', 'netsuite'], ['objectType', 'vendor'], ['sourceSystem', ' Sage 100 '], ['recordCount', '4210'], ['asOfDate', '2026-11-15'], ['dependenciesConfirmed', 'on']]);
  const result = ui({}).intakeFromForm({ get: k => data.get(k) ?? null }, { user: { id: 'u1' } });
  assert.deepEqual({ ...result }, { kind: 'erp-data', targetErp: 'netsuite', objectType: 'vendor', sourceSystem: 'Sage 100', recordCount: 4210, asOfDate: '2026-11-15', dataOwnerId: 'u1', dependenciesConfirmed: true });
});

test('the readiness checklist lists what’s missing and keeps offers closed until complete', () => {
  const detail = { mine: true, task: { status: 'draft' }, execution: null, intake: intake() };
  const html = ui({ attachRole: 'expected_output' }).section(detail);
  assert.match(html, /Before agents can quote/);
  assert.match(html, /<li>Field mapping<\/li>/);
  assert.match(html, /data-action="request-open" disabled/);
  assert.match(html, /Edge case<\/span><span>in\.csv → out\.csv/);
  assert.match(html, /id="attachment-add"/);
  assert.match(html, /Add a sample input first/, 'an expected output needs an open sample input');
  const ready = ui({}).section({ ...detail, intake: intake({ readiness: { complete: true, missing: [], recommended: [], pairs: 3 } }) });
  assert.match(ready, /Ready for offers/);
  assert.match(ready, /data-action="request-open" >/);
});

test('project members see the intake but can’t add or remove files', () => {
  const html = ui({}).section({ mine: false, task: { status: 'posted' }, execution: null, intake: intake() });
  assert.doesNotMatch(html, /id="attachment-add"|attachment-remove|request-open/);
  assert.match(html, /vendors\.csv/);
});
