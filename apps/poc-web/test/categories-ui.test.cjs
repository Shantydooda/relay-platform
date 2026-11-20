'use strict';
// The category rail on the Agents page (marketplace-ui.js): fields with tasks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context);
}
const taxonomy = [
  { id: 'data-research', label: 'Data & research', seed: true, tasks: [{ id: 'data-cleanup', label: 'Data cleanup & deduplication' }, { id: 'lead-lists', label: 'Lead lists & prospecting' }] },
  { id: 'erp-finance', label: 'ERP & finance operations', tasks: [{ id: 'erp-migration', label: 'ERP data migration' }] },
  { id: 'design-media', label: 'Design & media', tasks: [{ id: 'video', label: 'Video' }] },
];
const agent = (categoryIds, fieldIds) => ({ builder: 'B', name: 'A', purpose: '', categories: ['Data'], capabilities: [], categoryIds, fieldIds, waysToBuy: [], worksWith: [], relayTest: { passed: true }, evidence: { runs: 0 }, buyers: { repeat: 0 } });

test('fields head the rail with counts; tasks nobody covers wait behind "Show all categories"', () => {
  const agents = [agent(['data-cleanup'], ['data-research']), agent(['erp-migration', 'data-cleanup'], ['erp-finance', 'data-research'])];
  const m = ui({ market: { agents, taxonomy } });
  const html = m.categoryRail(m.filters());
  assert.match(html, /data-value="field:data-research"[^>]*title="2 agents"[^>]*>Data &#38; research <span class="mk-seed">focus<\/span>/);
  assert.match(html, /data-value="data-cleanup"[^>]*title="2 agents"/);
  assert.doesNotMatch(html, /data-value="lead-lists"/, 'empty tasks are hidden by default');
  assert.doesNotMatch(html, /Design &#38; media/, 'empty fields are hidden by default');
  const all = ui({ market: { agents, taxonomy }, marketFilters: { q: '', categories: [], ways: [], works: [], evidence: [], allCategories: true } });
  const full = all.categoryRail(all.filters());
  assert.match(full, /data-value="lead-lists"[^>]*disabled[^>]*title="No agents for this yet"/);
  assert.match(full, /Show only categories with agents/);
});

test('filtering by a field or a task matches agents by their category ids', () => {
  const erp = agent(['erp-migration'], ['erp-finance']), clean = agent(['data-cleanup'], ['data-research']);
  const m = ui({ market: { agents: [erp, clean], taxonomy } });
  const f = { ...m.filters(), categories: ['field:erp-finance'] };
  assert.equal(m.matches(erp, f), true);
  assert.equal(m.matches(clean, f), false);
  assert.equal(m.matches(clean, { ...f, categories: ['data-cleanup'] }), true);
});
