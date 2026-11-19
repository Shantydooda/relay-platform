'use strict';
// The Build area (build-ui.js): builder pages inside the shared marketplace shell.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function build(state = {}) {
  const context = vm.createContext({ state, Intl, Date, money: (n, c) => `${c} ${n / 100}`, deliveryDuration: m => `${m} min`,
    escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/build-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayBuild', context);
}
const agent = (over = {}) => ({ id: 'a1', name: 'CSV Cleaner', purpose: 'Cleans CSVs', listingStatus: 'draft', capabilities: [{ qualification: 'unverified', category: 'Data' }], packages: [], runtime: { connected: false }, readiness: { profile: true }, ...over });

test('every builder page has its own address; anything else is not a Build page', () => {
  const b = build();
  const at = path => { const r = b.parse(path); return r && `${r.page}:${r.id}`; };
  assert.equal(at('/build'), 'build:dashboard');
  assert.equal(at('/build/projects'), 'build:work');
  assert.equal(at('/build/new'), 'build:new');
  assert.equal(b.parse('/build/nope'), null);
  assert.equal(b.parse('/builders'), null);
  for (const [id, , slug] of b.NAV) assert.equal(b.path({ builderTab: id }), slug ? `/build/${slug}` : '/build');
  assert.equal(b.path({ builderTab: 'quotes' }), '/build/opportunities', 'offers live under Opportunities');
  assert.equal(b.path({ addingAgent: true }), '/build/new');
  const s = {}; b.apply({ page: 'build', id: 'new' }, s);
  assert.equal(s.addingAgent, true);
});

test('agent status says what is true: Draft, Testing, Ready to publish, Live, Paused', () => {
  const b = build();
  const passed = [{ qualification: 'qualified' }];
  assert.equal(b.status(agent()).label, 'Draft');
  assert.equal(b.status(agent({ runtime: { connected: true } })).label, 'Testing');
  assert.equal(b.status(agent({ capabilities: passed })).label, 'Ready to publish');
  assert.equal(b.status(agent({ capabilities: passed, listingStatus: 'published' })).label, 'Live');
  assert.equal(b.status(agent({ capabilities: passed, listingStatus: 'paused' })).label, 'Paused');
  const html = build({ agents: [agent({ capabilities: passed, listingStatus: 'published' })] }).agentsPage();
  assert.doesNotMatch(html, /Setup incomplete|Continue setup/, 'a live agent is never shown as unfinished');
  assert.match(html, />Manage</);
  assert.match(html, /href="\/agents\/a1"/);
  assert.match(html, /not set up for paid work yet/);
});

test('opportunities show the buyer’s ERP facts and never an internal scope number', () => {
  const html = build().opportunity({ title: 'Vendor cleanup', brief: 'Dedupe', scopeVersion: 11, categoryLabel: 'Master-data cleanup',
    intake: { targetLabel: 'Oracle NetSuite', objectLabel: 'Vendor master', recordCount: 4210 }, acceptanceCriteria: [{}], checks: [{}, {}] }, () => '<form></form>');
  assert.doesNotMatch(html, /scope/i);
  assert.match(html, /Master-data cleanup · Oracle NetSuite · Vendor master · 4,210 records · 1 checklist item · 2 automatic checks/);
});

test('the shell marks the current section and offers sit under Opportunities', () => {
  const b = build({ quotes: [{ title: 'T', agentName: 'A', amountMinor: 5000, currency: 'USD', deliveryMinutes: 30, status: 'pending' }] });
  const html = b.shell('quotes', 'Opportunities', '', '', b.offers());
  assert.match(html, /href="\/build\/opportunities" data-route class="active" aria-current="page">Opportunities/);
  assert.match(html, /Waiting for the buyer/);
  assert.match(html, />Projects</);
});

// The Build pages use the same parts as the buyer pages: browse cards, list rows, stat strip.
test('Build pages reuse the marketplace look, not the old workspace panels', () => {
  const live = agent({ capabilities: [{ qualification: 'qualified', category: 'Data' }], listingStatus: 'published' });
  const b = build({ account: { user: { name: 'Test Builder' } }, agents: [live, agent({ id: 'a2', name: 'Draft One' })],
    quotes: [{ title: 'T', agentName: 'A', amountMinor: 5000, currency: 'USD', deliveryMinutes: 30, status: 'pending' }],
    work: [{ id: 'w1', title: 'Clean export', agentName: 'CSV Cleaner', status: 'selected', amountMinor: 2500, currency: 'USD' }], opportunities: [] });
  const agents = b.agentsPage();
  assert.match(agents, /class="mk-list"/);
  assert.match(agents, /mk-handle">test-builder\/csv-cleaner</);
  const dash = b.dashboard();
  assert.match(dash, /class="mk-strip/);
  assert.match(dash, /class="mk-threads"/);
  assert.match(dash, /Draft One/, 'unfinished agents need attention');
  assert.doesNotMatch(dash + agents + b.offers() + b.projects() + b.earnings() + b.settings(), /class="panel/);
  const shell = b.shell('agents', 'Agents', 'Lede', '', '');
  assert.match(shell, /<h1>Agents <span class="mk-total">2<\/span><\/h1>/);
  assert.match(b.projects(), /Clean export/);
});

test('an agent’s setup page is headed builder/agent, with no section count', () => {
  const b = build({ account: { user: { name: 'Test Builder' } }, agents: [agent()], setupAgentId: 'a1' });
  const html = b.shell('agents', b.agentTitle(agent()), 'Draft', '', '');
  assert.match(html, /test-builder\/csv-cleaner<\/span><\/h1>/);
});
