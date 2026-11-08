'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const state = { account: { user: { id: 'buyer' } }, buyerTab: 'market', agentCatalog: [], agentDiscovery: { total: 0, hasMore: false } };
  const requests = [];
  const context = vm.createContext({ state, URLSearchParams, setTimeout, clearTimeout, escape: String,
    api: url => new Promise((resolve, reject) => requests.push({ url, resolve, reject })) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/agent-market-ui.js'), 'utf8') + '\nglobalThis.market = RelayAgentMarket;', context);
  const market = context.market;
  market.storefrontId = () => '';
  market.card = a => a.id;
  const count = {}, grid = {}, pagination = {};
  const root = { querySelector: () => ({ querySelector: s => s === '[data-agent-market-count]' ? count : s === '.agent-market-grid' ? grid : pagination }) };
  return { state, market, requests, root, count, grid, pagination };
}
const result = (ids, nextCursor = '') => ({ agents: ids.map(id => ({ id })), total: 70, hasMore: !!nextCursor, nextCursor, categories: ['Research'] });
test('new search wins over late replies and searching never shows a false empty state', async () => {
  const f = fixture();
  f.state.agentMarketQuery = 'old';
  const old = f.market.search(f.root);
  assert.match(f.grid.innerHTML, /Finding matching/);
  f.state.agentMarketQuery = 'new';
  const latest = f.market.search(f.root);
  f.requests[1].resolve(result(['new'])); await latest;
  f.requests[0].resolve(result(['old'])); await old;
  assert.equal(f.state.agentCatalog[0].id, 'new');
  assert.equal(f.count.textContent, '1 shown · 70 matches');
});
test('more uses cursor, deduplicates results, and filter changes reset the page', async () => {
  const f = fixture();
  f.state.agentCatalog = [{ id: 'a' }]; f.state.agentDiscovery = result(['a'], 'cursor');
  const more = f.market.load(f.root, true);
  assert.equal(new URL(f.requests[0].url, 'http://local').searchParams.get('after'), 'cursor');
  f.requests[0].resolve(result(['a', 'b'], 'next')); await more;
  assert.equal(f.state.agentCatalog.map(a => a.id).join(','), 'a,b');
  f.state.agentMarketType = 'specialist';
  const search = f.market.search(f.root);
  assert.equal(new URL(f.requests[1].url, 'http://local').searchParams.get('after'), '');
  f.requests[1].resolve(result(['c'])); await search;
  assert.equal(f.state.agentCatalog.map(a => a.id).join(','), 'c');
});
test('errors expose retry with filters intact, and account changes discard responses', async () => {
  const f = fixture(); f.state.agentMarketQuery = 'property';
  const first = f.market.search(f.root);
  f.requests[0].reject(new Error('offline')); await first;
  assert.match(f.pagination.innerHTML, /Retry search/);
  assert.equal(f.state.agentMarketQuery, 'property');
  const retry = f.market.search(f.root);
  f.state.account.user.id = 'another';
  f.requests[1].resolve(result(['private'])); await retry;
  assert.equal(f.state.agentCatalog.length, 0);
  f.state.buyerTab = 'tasks';
  await f.market.load(f.root);
  assert.equal(f.requests.length, 2);
});
