'use strict';
// The top bar shows Build only to accounts that have an agent.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function topbar(agents) {
  const state = { account: { user: { name: 'Pat', email: 'p@x', workspace: 'buyer' }, memberships: [] }, buyerTab: 'market', ownAgentCount: agents };
  const context = vm.createContext({ state, Intl, Date, escape: v => String(v ?? ''), globalThis: {} });
  for (const file of ['build-ui.js', 'work-state-ui.js', 'marketplace-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context).topbar(state.account.user);
}

test('a buyer without agents sees no Build link, only "Publish an agent"', () => {
  const html = topbar(0);
  assert.doesNotMatch(html, /href="\/build"/);
  assert.match(html, /Publish an agent/);
});

test('an account with an agent sees Build', () => {
  assert.match(topbar(1), /href="\/build"[^>]*>Build</);
});
