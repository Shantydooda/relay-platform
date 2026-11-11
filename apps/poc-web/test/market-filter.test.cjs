'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/agent-market-ui.js'), 'utf8');
function fixture() {
  const state = { agentCatalog: [
    { name: 'Estate researcher', kind: 'specialist', availability: 'available', capabilities: [{ category: 'Research', task: 'Property reports' }] },
    { name: 'General helper', kind: 'general', availability: 'available', capabilities: [{ category: 'Research', task: 'Company reports' }] },
    { name: 'Designer', kind: 'specialist', availability: 'pending', capabilities: [{ category: 'Design', task: 'Logos' }] },
  ] };
  const context = vm.createContext({ state, escape: value => value });
  vm.runInContext(source + '\nglobalThis.market = RelayAgentMarket;', context);
  context.market.card = agent => `<article>${agent.name}</article>`;
  const count = { textContent: '' }, grid = { innerHTML: '' };
  const results = { querySelector: selector => selector === '[data-agent-market-count]' ? count : grid };
  const root = { querySelector(selector) {
    assert.equal(selector, '[data-agent-market-results]', 'updates must not remount or focus toolbar controls');
    return results;
  } };
  return { state, market: context.market, root, count, grid };
}
test('market filters intersect query, type and category while retaining the results status node', () => {
  const f = fixture();
  f.state.agentMarketQuery = 'REPORTS';
  f.state.agentMarketType = 'specialist';
  f.state.agentMarketCategory = 'Research';
  f.market.updateResults(f.root);
  assert.equal(f.count.textContent, '1 result');
  assert.match(f.grid.innerHTML, /Estate researcher/);
  assert.doesNotMatch(f.grid.innerHTML, /General helper|Designer/);
  f.state.agentMarketQuery = 'missing';
  f.market.updateResults(f.root);
  assert.equal(f.count.textContent, '0 results');
  assert.match(f.grid.innerHTML, /No agents match/);
  f.state.agentMarketQuery = '';
  f.state.agentMarketType = 'All types';
  f.market.updateResults(f.root);
  assert.equal(f.count.textContent, '2 results');
  assert.match(f.grid.innerHTML, /General helper/);
});
test('market status is politely announced and a stale event outside the market is harmless', () => {
  const f = fixture();
  assert.match(f.market.results(), /role="status" aria-live="polite" aria-atomic="true"/);
  assert.doesNotThrow(() => f.market.updateResults({ querySelector: () => null }));
});

test('category navigation preserves buttons and search while updating selection and matching results', () => {
  const f = fixture();
  const heading = { textContent: '' };
  const buttons = ['All agents', 'Available', 'Research', 'Design', '<custom category>'].map(category => ({
    dataset: { category },
    classList: { toggle(name, selected) { this[name] = selected; } },
    setAttribute(name, value) { this[name] = value; },
  }));
  const root = {
    querySelector: () => ({ querySelector: selector => selector === 'h2' ? heading : selector === '[data-agent-market-count]' ? f.count : f.grid }),
    querySelectorAll: () => buttons,
  };
  f.state.agentMarketQuery = 'reports';
  f.state.agentMarketType = 'specialist';
  f.market.selectCategory(root, 'Research');
  assert.equal(f.state.agentMarketCategory, 'Research');
  assert.equal(f.state.agentMarketQuery, 'reports');
  assert.equal(f.state.agentMarketType, 'specialist');
  assert.equal(f.count.textContent, '1 result');
  assert.equal(heading.textContent, 'Research');
  assert.deepEqual(buttons.map(button => button['aria-pressed']), ['false', 'false', 'true', 'false', 'false']);
  assert.equal(buttons[2].classList.active, true);
  f.market.selectCategory(root, 'Design');
  assert.equal(f.count.textContent, '0 results');
  assert.equal(buttons[2].classList.active, false);
  assert.equal(buttons[3]['aria-pressed'], 'true');
  f.market.selectCategory(root, 'Available');
  assert.equal(heading.textContent, 'Qualified capability');
  assert.equal(f.count.textContent, '1 result');
  f.market.selectCategory(root, '<custom category>');
  assert.equal(heading.textContent, '<custom category>');
  assert.doesNotThrow(() => f.market.selectCategory({ querySelector: () => null }, 'Research'));
  assert.equal(f.state.agentMarketCategory, '<custom category>', 'detached category event must not change the current view');
});
