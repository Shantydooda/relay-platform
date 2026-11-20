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
  assert.match(html, /Paid work needs payout setup first/, 'said once above the list, not on every card');
});

test('opportunities show the buyer’s ERP facts and never an internal scope number', () => {
  const html = build().opportunity({ title: 'Vendor cleanup', brief: 'Dedupe', scopeVersion: 11, categoryLabel: 'Master-data cleanup',
    intake: { targetLabel: 'Oracle NetSuite', objectLabel: 'Vendor master', recordCount: 4210 }, acceptanceCriteria: [{}], checks: [{}, {}] }, () => '<form></form>');
  assert.doesNotMatch(html, /scope/i);
  assert.match(html, /Master-data cleanup · Oracle NetSuite · Vendor master · 4,210 records · 1 checklist item · 2 automatic checks/);
});

test('the shell marks the current section and offers sit under Opportunities', () => {
  const b = build({ agents: [agent()], quotes: [{ title: 'T', agentName: 'A', amountMinor: 5000, currency: 'USD', deliveryMinutes: 30, status: 'pending' }] });
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

test('Build is for builders: an account with no agent is sent to start one, without the builder menu', () => {
  const b = build({ account: { user: { name: 'Buyer', workspace: 'builder' } }, agents: [] });
  assert.equal(b.isBuilder(), false);
  const s = { account: { user: { workspace: 'builder' } }, agents: [], builderTab: 'dashboard' };
  b.gate(s);
  assert.equal(s.addingAgent, true, 'the dashboard of an account without agents becomes "New agent"');
  const html = b.shell('agents', 'New agent', 'Introduce it', '', '<form></form>');
  assert.doesNotMatch(html, /mk-build-nav/, 'no Dashboard, Opportunities or Earnings before there is an agent');
  const builder = build({ account: { user: { name: 'Builder', workspace: 'builder' } }, agents: [agent()] });
  assert.equal(builder.isBuilder(), true, 'a draft agent is enough');
  const kept = { account: { user: { workspace: 'builder' } }, agents: [agent()], builderTab: 'dashboard' };
  builder.gate(kept);
  assert.notEqual(kept.addingAgent, true);
  assert.match(builder.shell('dashboard', 'Dashboard', '', '', ''), /mk-build-nav/);
});

test('a set-up agent opens on its overview; a draft opens on its next setup step', () => {
  const passed = [{ id: 'c1', task: 'Clean CSV', qualification: 'qualified' }];
  const live = agent({ capabilities: passed, listingStatus: 'published', runtime: { connected: true, connectedAt: Date.now() - 120000 }, rules: { automaticRequested: true, automaticEnabled: true, automaticScope: 'limited', automaticLimitMinor: 50000, minimumPayout: 100, currency: 'USD' } });
  const b = build({ agents: [live], account: { user: { name: 'Builder', workspace: 'builder' } } });
  assert.equal(b.defaultTab(live), 'overview');
  assert.equal(b.defaultTab(agent()), 'connection', 'a described draft goes straight to connecting');
  assert.equal(b.defaultTab(agent({ readiness: {} })), 'profile');
  const html = b.manage(live, { tests: () => 'TESTS' });
  assert.match(html, /aria-current="page">Overview</);
  assert.match(html, /Ready for work/);
  assert.match(html, /last check-in 2 min ago/);
  assert.match(html, /Small requests only: up to USD 500, never ERP data/);
  assert.doesNotMatch(html, /TESTS/);
  assert.match(build({ agents: [agent()] }).manage(agent(), { connection: () => 'CONNECT' }), /CONNECT/);
  const draftHtml = build({ agents: [agent()], agentTab: 'overview' }).manage(agent(), {});
  assert.match(draftHtml, /Get it ready for work/);
  assert.match(draftHtml, /data-tab="connection">Connect</, 'the next step has the one primary button');
});

test('Opportunities lists only new requests; chosen offers move to Projects and old ones fold away', () => {
  const quotes = [
    { taskId: 't1', title: 'Offered one', agentName: 'A', amountMinor: 100, currency: 'USD', deliveryMinutes: 5, status: 'pending', runtimeBid: true },
    { taskId: 't2', title: 'Chosen one', agentName: 'A', amountMinor: 100, currency: 'USD', deliveryMinutes: 5, status: 'selected' },
    { taskId: 't3', title: 'Old one', agentName: 'A', amountMinor: 100, currency: 'USD', deliveryMinutes: 5, status: 'expired' }];
  const b = build({ agents: [agent()], quotes, opportunities: [
    { id: 't1', title: 'Offered one', brief: 'x', myOffers: [{ agentId: 'a1' }] },
    { id: 't4', title: 'Fresh one', brief: 'y', postedAt: Date.now() - 3 * 3600000, direct: true }] });
  const html = b.opportunities(() => '');
  const fresh = html.slice(html.indexOf('New for you'), html.indexOf('Your offers'));
  assert.match(fresh, /Fresh one/);
  assert.match(fresh, /Sent to you directly · Posted 3 h ago/);
  assert.doesNotMatch(fresh, /Offered one/, 'already offered on: listed under Your offers instead');
  const offers = html.slice(html.indexOf('Your offers'));
  assert.match(offers, /Offered one[\s\S]*sent automatically/);
  assert.doesNotMatch(offers, /Chosen one/);
  assert.match(offers, /<summary>Past offers \(1\)<\/summary>[\s\S]*Old one/);
});

test('Projects are grouped by who has to act', () => {
  const w = (id, status) => ({ id, status, title: id, agentName: 'A', updatedAt: Date.now() });
  const html = build({ work: [w('running-job', 'running'), w('picked-job', 'selected'), w('review-job', 'buyer_review'), w('done-job', 'accepted')] }).projects();
  const at = text => html.indexOf(text);
  assert.ok(at('Needs you or your agent') < at('running-job') && at('running-job') < at('Waiting on the buyer'));
  assert.ok(at('Waiting on the buyer') < at('picked-job') && at('review-job') < at('Done') && at('Done') < at('done-job'));
});
