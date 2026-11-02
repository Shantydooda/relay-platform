'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');

test('buyer agent market preserves offer approval and hosting visibly requires a paid entitlement', () => {
  const market = readFileSync(resolve(__dirname, '../public/agent-market-ui.js'), 'utf8');
  const apps = readFileSync(resolve(__dirname, '../public/workspace-apps-ui.js'), 'utf8');
  const shell = readFileSync(resolve(__dirname, '../public/app.js'), 'utf8');
  assert.match(market, /does not hire it immediately/);
  assert.match(market, /Request agent/);
  assert.match(market, /Request builder/);
  assert.match(shell, /preferredAgentId/);
  assert.match(apps, /Pro or Business required/);
  assert.match(apps, /Billing is disconnected on localhost/);
  assert.match(apps, /Localhost simulates the hosting control plane/);
  assert.match(apps, /subscription_hold/);
  assert.match(apps, /deprovision/);
  assert.match(apps, /\/host/);
});

test('agent market renders the dense category rail, filters and qualified cards safely', () => {
  const source = readFileSync(resolve(__dirname, '../public/agent-market-ui.js'), 'utf8');
  const state = {
    agentMarketCategory: 'Research',
    agentMarketType: 'specialist',
    agentMarketQuery: 'sources',
    agentCatalog: [{
      id: 'agent-1',
      name: '<Source Scout>',
      operatorName: 'Northstar Labs',
      purpose: 'Finds cited sources for a brief.',
      domain: 'Research',
      kind: 'specialist',
      availability: 'available',
      capabilities: [{ category: 'Research', task: 'Source discovery', qualification: 'qualified', evidence: { title: '<Relay test>', expiresAt: 1798761600000 } }],
    }],
  };
  const context = {
    state,
    escape: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
    date: value => new Date(value).toISOString(),
  };
  vm.createContext(context);
  vm.runInContext(`${source}\nglobalThis.market = RelayAgentMarket;`, context);
  const html = context.market.page();
  assert.match(html, /agent-market-categories/);
  assert.match(html, /Search agents and capabilities/);
  assert.match(html, /Source discovery/);
  assert.match(html, /Request builder/);
  assert.match(html, /Request agent/);
  assert.match(html, /Capabilities & evidence/);
  assert.match(html, /&lt;Relay test&gt;/);
  assert.match(html, /&lt;Source Scout&gt;/);
  assert.doesNotMatch(html, /<Source Scout>/);
});
