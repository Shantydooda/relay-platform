'use strict';
// A task bought as a package ("Hire it") shows its fixed terms, asks for the
// required CSV, and never presents competing quotes or a recommendation.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { text } = require('../../../packages/ui/src/components.cjs');

const pkg = { packageId: 'p1', packageVersion: 2, title: 'Clean one CSV', included: 'Duplicates removed.', priceMinor: 2500, currency: 'USD',
  deliveryMinutes: 30, criteria: [{ id: 'c1', text: 'No duplicate rows' }], inputs: ['csv'], extraRounds: 1 };
const offer = { id: 'o1', selected: true, agentId: 'a1', agentName: 'CSV Cleaner', operatorName: 'Test Builder', amountMinor: 2500, currency: 'USD', deliveryMinutes: 30,
  proposal: 'Duplicates removed.', packageId: 'p1', packageVersion: 2, taskVersion: 1, scopeVersion: 1, expiresAt: Date.now() + 1e9, runtimeBid: false };

function ui(task) {
  const state = { authMode: 'local', features: { localExecution: true }, detail: { task, actions: {} }, offers: [offer], agents: [], work: [], quotes: [], opportunities: [] };
  const ctx = vm.createContext({ state, location: { origin: 'http://127.0.0.1:4180' }, escape: text, date: () => 'Date', Intl, Date, relayCharacter: () => '' });
  for (const file of ['supplier-ui.js', 'marketplace.js', 'buyer-flow.js', 'execution-ui.js']) vm.runInContext(readFileSync(resolve(__dirname, '../public', file), 'utf8'), ctx);
  return { state, ctx };
}
const task = (extra = {}) => ({ id: 't1', status: 'selected', version: 1, scopeVersion: 1, title: 'Clean one CSV', brief: 'Duplicates removed.', package: pkg,
  acceptanceCriteria: pkg.criteria, input: null, ...extra });

test('a hired package shows its fixed terms instead of quotes and recommendations', () => {
  const { ctx } = ui(task());
  const html = vm.runInContext('offerCards()', ctx);
  assert.match(html, /Hired package/);
  assert.match(html, /Clean one CSV/);
  assert.match(html, /v2/);
  assert.match(html, /\$25\.00 package price/);
  assert.match(html, /No duplicate rows/);
  assert.match(html, /1 extra round/);
  assert.match(html, /change request/);
  assert.doesNotMatch(html, /supplier quote|Compare other offers|Recommendation policy|recommend/i);
  assert.doesNotMatch(html, /data-action="review-start"/, 'no start until the required CSV is attached');
  assert.match(html, /Attach your CSV/);
  const ready = vm.runInContext('offerCards()', ui(task({ input: { filename: 'a.csv', size: 10, notes: 'n' } })).ctx);
  assert.match(ready, /data-action="review-start"/);
});

test('the CSV is asked for as required on a package task', () => {
  const { ctx } = ui(task());
  const html = vm.runInContext('RelayExecution.input(state.detail.task)', ctx);
  assert.match(html, /Required for this package/);
  assert.doesNotMatch(html, /Optional source file|invalidates prior offers/);
  assert.match(html, /id="task-input"/);
});
