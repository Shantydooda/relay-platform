'use strict';
// Agents page parity with docs/design/marketplace/browse.html: flat category
// chips, the price range, and the Requests and Builders pages.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context);
}
const taxonomy = [{ id: 'data-research', label: 'Data & research', seed: true, tasks: [{ id: 'data-cleanup', label: 'Data cleanup' }, { id: 'lead-lists', label: 'Lead lists' }] },
  { id: 'erp-finance', label: 'ERP & finance operations', tasks: [{ id: 'erp-migration', label: 'ERP data migration' }] }];
const agent = (id, builder, amountMinor, categoryIds = ['data-cleanup']) => ({ id, builder, name: id, purpose: 'Does work', categories: [], capabilities: [], categoryIds, fieldIds: [], categoryLabel: 'Data cleanup',
  waysToBuy: ['hire'], worksWith: [], relayTest: { passed: true }, evidence: { runs: 3 }, buyers: { repeat: 0 }, fromPrice: amountMinor === null ? null : { amountMinor, currency: 'USD' } });

test('the Main tab shows flat category chips, seed field first, with "+N" to the full list', () => {
  const m = ui({ market: { taxonomy, agents: [agent('a', 'B', 100, ['erp-migration']), agent('b', 'B', 100), agent('c', 'C', 100, ['erp-migration'])] } });
  const html = m.categoryChips(m.filters());
  assert.ok(html.indexOf('Data cleanup') < html.indexOf('ERP data migration'), 'the seed field comes first even with fewer agents');
  assert.match(html, /data-tab="categories"[^>]*>\+ 1</);
});

test('the price range filters by from-price; unpriced agents hide only while a range is set', () => {
  const cheap = agent('cheap', 'B', 900), mid = agent('mid', 'B', 20000), quoted = agent('quoted', 'B', null);
  const m = ui({ market: { taxonomy, agents: [cheap, mid, quoted] } });
  const f = m.filters();
  assert.deepEqual([cheap, mid, quoted].map(a => m.priceMatches(a, f)), [true, true, true]);
  f.price = [1, 2];
  assert.deepEqual([cheap, mid, quoted].map(a => m.priceMatches(a, f)), [false, true, false]);
  const erp = agent('erp', 'B', 4000000);
  f.price = [5, 6];
  assert.equal(m.priceMatches(erp, f), true, 'a $40k ERP package falls in $25k–$100k: the scale is not capped at $5k');
  f.price = [7, 7];
  assert.equal(m.priceMatches({ ...erp, fromPrice: { amountMinor: 50000000, currency: 'USD' } }, f), true, '$100k+ is open-ended');
  f.price = [0, 0];
  assert.equal(m.priceMatches(cheap, f), true, '"< $10" alone keeps a $9 package');
  f.price = [1, 2];
  const html = m.priceRange([cheap, mid, quoted]);
  assert.match(html, /data-action="market-price-reset"/);
  assert.match(html, /1 agent without a listed price is hidden/);
  assert.doesNotMatch(html, /style=/, 'no inline styles: the CSP forbids them');
  assert.match(ui({ market: { taxonomy, agents: [] } }).priceRange([quoted]), /No package prices yet/);
});

test('Requests lists open requests for builders and explains why it may be empty', () => {
  const empty = ui({ openRequests: [] }).requestsPage();
  assert.match(empty, /shown to builders with an agent on Relay/);
  const html = ui({ openRequests: [{ id: 't1', title: 'Vendor master cleanup', brief: 'Dedupe vendors', categoryLabel: 'Master-data cleanup', acceptanceCriteria: [{ id: 'c1' }], checks: [{ id: 'k1' }, { id: 'k2' }],
    intake: { targetLabel: 'Oracle NetSuite', objectLabel: 'Vendor master', recordCount: 4210 }, myOffers: [] }] }).requestsPage();
  assert.match(html, /Requests <span class="mk-total">1/);
  assert.match(html, /Master-data cleanup/);
  assert.match(html, /Oracle NetSuite · Vendor master · 4,210 records/);
  assert.match(html, /2 automatic checks/);
  assert.match(html, /ERP data<\/span>/);
});

test('Builders groups published agents by builder, most verified runs first', () => {
  const html = ui({ market: { windowDays: 90, agents: [agent('a1', 'Quiet Co', 100), { ...agent('b1', 'Busy Labs', 100), evidence: { runs: 40 } }, agent('b2', 'Busy Labs', 100)] } }).buildersPage();
  assert.match(html, /Builders <span class="mk-total">2/);
  assert.ok(html.indexOf('busy-labs') < html.indexOf('quiet-co'));
  assert.match(html, /2 agents/);
  assert.match(html, /43 verified runs · 90d/);
});
