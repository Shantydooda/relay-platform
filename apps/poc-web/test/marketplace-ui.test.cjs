'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state = {}) {
  const context = vm.createContext({ state, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/marketplace-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context);
}
const id = '3f706d3f-9900-424d-86ef-9d196d693a6a';
function agent(overrides = {}) {
  return { id, builder: 'Tidy Rows', name: 'CSV Normalizer', purpose: 'Cleans CSV files', domain: null, category: 'CSV cleanup', categories: ['CSV cleanup'],
    capabilities: [{ id: 'c1', category: 'CSV cleanup', task: 'Normalize CSV', qualification: 'qualified', metadata: {} }], waysToBuy: ['commission'], packages: [],
    fromPrice: null, relayTest: { passed: true, rubric: 'csv-normalize-v1', runtimeVersion: '1.3.0' }, buyers: { total: 0, repeat: 0 }, hostedOnRelay: false,
    worksWith: [], declaredTools: [], version: '1.3.0', versionSince: Date.now(), listedAt: Date.now(), own: false, isNew: false, availability: 'available',
    evidence: { runs: 0, accepted: 0, accepted_first_time: 0, accepted_after_revision: 0, failed: 0, refunded: 0, cancelled: 0, acceptedRate: null, windowDays: 90 },
    ...overrides };
}
const evidence = (runs, accepted, extra = {}) => ({ runs, accepted, accepted_first_time: accepted, accepted_after_revision: 0, failed: runs - accepted, refunded: 0, cancelled: 0,
  acceptedRate: runs >= 20 ? accepted / runs : null, windowDays: 90, ...extra });

test('real links map to pages and back', () => {
  const m = ui();
  assert.deepEqual({ ...m.parse(`/agents/${id}`) }, { page: 'agent', id });
  assert.deepEqual({ ...m.parse(`/tasks/${id}`) }, { page: 'task', id });
  assert.deepEqual({ ...m.parse('/', `#task=${id}`) }, { page: 'task', id }, 'old task links still open');
  assert.deepEqual({ ...m.parse('/', `#storefront=${id}?source=market`) }, { page: 'agent', id }, 'old agent links still open');
  assert.deepEqual({ ...m.parse('/post') }, { page: 'post', id: null });
  assert.deepEqual({ ...m.parse('/agents/nope') }, { page: null, id: null });
  assert.equal(m.path({ buyerTab: 'market', agentPageId: id }), `/agents/${id}`);
  assert.equal(m.path({ buyerTab: 'market' }), '/');
  assert.equal(m.path({ buyerTab: 'tasks', detail: { task: { id, status: 'posted' } } }), `/tasks/${id}`);
  assert.equal(m.path({ buyerTab: 'request' }), '/post');
  const s = {};
  assert.equal(m.apply({ page: 'agent', id }, s), null);
  assert.equal(s.buyerTab, 'market');
  assert.equal(s.agentPageId, id);
  assert.equal(m.apply({ page: 'task', id }, s), id);
});

test('evidence: counts with their window below 20 decided runs, a rate from 20, failures always shown', () => {
  const m = ui();
  assert.equal(m.evidenceLine(agent()).text, 'Passed Relay test · no runs yet');
  assert.equal(m.evidenceLine(agent({ relayTest: { passed: false } })).text, 'Relay test not passed · no runs yet');
  const small = m.evidenceLine(agent({ evidence: evidence(6, 5, { accepted_after_revision: 1 }), buyers: { total: 2, repeat: 1 } }));
  assert.equal(small.text, '6 runs · 5 accepted · 1 revised · 1 failed · 90d · 1 repeat buyer');
  assert.doesNotMatch(small.text, /%/);
  assert.equal(small.strong, false);
  assert.equal(m.evidenceLine(agent({ evidence: evidence(19, 19) })).text.includes('%'), false);
  const rated = m.evidenceLine(agent({ evidence: evidence(20, 17) }));
  assert.equal(rated.text, '85% accepted · 20 runs · 90d');
  assert.equal(rated.strong, true);
});

test('rows lead with builder/agent and show ways to buy, price and version honestly', () => {
  const m = ui({ market: { agents: [agent({ isNew: true })], sort: 'runs', windowDays: 90, connectors: [] } });
  assert.equal(m.handle(agent()), 'tidy-rows/csv-normalizer');
  const html = m.browse();
  assert.match(html, /tidy-rows\/csv-normalizer/);
  assert.match(html, /href="\/agents\/3f706d3f/);
  assert.match(html, />New</);
  assert.match(html, /Commission/);
  assert.match(html, /Quoted per request/);
  assert.match(html, /v1\.3\.0 · today/);
  assert.match(html, /Cleans CSV files/, 'a small catalogue shows a description line');
  assert.ok(html.indexOf('Post a request') > html.indexOf('mk-list'), '"Post a request" comes after the list');
  assert.match(html, /Rankings can’t be bought/);
  assert.match(html, /No package prices yet/);
  assert.match(html, /data-value="hire"[^>]*disabled/, 'Hire it is unavailable until an agent has a package');
});

test('filters narrow the list and an empty result offers a way out', () => {
  const tested = agent();
  const busy = agent({ id: 'b', builder: 'Ledgerline', name: 'Dedupe', categories: ['CRM cleanup'], category: 'CRM cleanup', evidence: evidence(25, 20), buyers: { total: 3, repeat: 2 }, worksWith: ['Google Drive'] });
  const state = { market: { agents: [tested, busy], sort: 'runs', windowDays: 90, connectors: ['Google Drive'] } };
  const m = ui(state);
  const f = m.filters();
  f.evidence = ['runs20']; assert.deepEqual(m.visible().map(a => a.id), ['b']);
  f.evidence = ['repeat']; assert.deepEqual(m.visible().map(a => a.id), ['b']);
  f.evidence = []; f.categories = ['CSV cleanup']; assert.deepEqual(m.visible().map(a => a.id), [id]);
  f.categories = []; f.works = ['Google Drive']; assert.deepEqual(m.visible().map(a => a.id), ['b']);
  f.works = []; f.q = 'tidy normal'; assert.deepEqual(m.visible().map(a => a.id), [id]);
  f.q = 'nothing like this';
  assert.match(m.browse(), /No agents match these filters/);
  assert.match(m.browse(), /data-action="market-clear"/);
  state.market.agents = [];
  f.q = '';
  assert.match(m.browse(), /No agents are listed yet/);
});

test('the agent page shows empty states for what is not built, and no rate below 20', () => {
  const page = { id, ownerPreview: false, saved: false, savedVersion: 0, availability: 'available', name: 'CSV Normalizer',
    market: agent({ evidence: evidence(6, 5) }), trackRecord: { versions: [{ runtimeVersion: '1.3.0', current: true, lastRunAt: Date.now(), outcomes: evidence(6, 5) }] } };
  const m = ui({ agentPage: page, agentTab: 'card' });
  const html = m.agent();
  assert.match(html, /5 of 6/);
  assert.doesNotMatch(html, /\d+%/);
  assert.match(html, /Self-serve runs aren’t available/);
  assert.match(html, /No packages for this agent/);
  assert.match(html, /data-action="market-quote"/);
  assert.match(html, /rate after 20/);
  for (const tab of ['packages', 'discussion']) {
    const s = { agentPage: page, agentTab: tab };
    assert.match(ui(s).agent(), /mk-empty/, tab);
  }
  const own = ui({ agentPage: { ...page, ownerPreview: true }, agentTab: 'card' }).agent();
  assert.doesNotMatch(own, /data-action="market-quote"/, 'you cannot hire your own agent');
  assert.match(ui({ agentPage: null }).agent(), /Agent unavailable/);
});

test('Post a request takes a title, brief, checklist and an optional CSV input', () => {
  const html = ui({ preferredAgent: { id, name: 'CSV Normalizer', operatorName: 'Tidy Rows' } }).post();
  for (const field of ['post-title', 'post-brief', 'post-criteria', 'post-input']) assert.match(html, new RegExp(`id="${field}"`));
  assert.match(html, /type="file" accept="\.csv,text\/csv"/);
  assert.match(html, /tidy-rows\/csv-normalizer/);
  assert.match(ui({ postFile: { name: 'contacts.csv' } }).post(), /Attached: <strong>contacts\.csv/);
});

const pkg = (overrides = {}) => ({ id: 'p1', version: 2, status: 'published', capabilityId: 'c1', title: 'Clean one CSV', included: 'Duplicates removed, rows sorted.',
  priceMinor: 2500, currency: 'USD', deliveryMinutes: 90, criteria: [{ id: 'c1', text: 'No duplicate rows' }, { id: 'c2', text: 'Header kept' }],
  inputs: ['csv'], extraRounds: 1, ...overrides });
const page = (overrides = {}, market = {}) => ({ id, ownerPreview: false, saved: false, savedVersion: 0, availability: 'available', name: 'CSV Normalizer',
  market: agent({ waysToBuy: ['hire', 'commission'], packages: [pkg()], fromPrice: { amountMinor: 2500, currency: 'USD' }, ...market }), trackRecord: { versions: [] }, ...overrides });

test('buyers see each package’s fixed terms and can hire it from the tab and the buying panel', () => {
  const html = ui({ agentPage: page(), agentTab: 'packages' }).agent();
  assert.match(html, /Clean one CSV/);
  assert.match(html, /\$25\.00/);
  assert.match(html, /1 hr 30 min/, 'delivery time after work starts');
  assert.match(html, /No duplicate rows/);
  assert.match(html, /Header kept/);
  assert.match(html, /A CSV file/);
  assert.match(html, /1 extra round/);
  assert.match(html, /data-action="package-buy" data-agent="3f706d3f[^"]*" data-id="p1" data-version="2"/);
  const panel = ui({ agentPage: page(), agentTab: 'card' }).agent();
  assert.match(panel, /mk-buy-box"><h2>Hire it/);
  assert.match(panel, /data-action="package-buy"/, 'the buying panel offers the package too');
  assert.doesNotMatch(panel, /No packages yet/);
  assert.match(ui({ agentPage: page({}, { packages: [], waysToBuy: ['commission'], fromPrice: null }), agentTab: 'packages' }).agent(), /No packages yet/);
});

test('owners manage packages on their own agent page and can’t buy them', () => {
  const owner = page({ ownerPreview: true, agentVersion: 7, ownerPackages: [pkg(), pkg({ id: 'p2', status: 'draft', title: 'Draft package' })] }, { own: true });
  const html = ui({ agentPage: owner, agentTab: 'packages' }).agent();
  assert.match(html, /Draft package/);
  assert.match(html, /mk-tag[^"]*">Draft/);
  assert.match(html, /data-action="package-new"/);
  assert.match(html, /data-action="package-status" data-id="p2" data-status="published"/);
  assert.match(html, /data-action="package-status" data-id="p1" data-status="paused"/);
  assert.match(html, /data-action="package-edit" data-id="p1"/);
  assert.doesNotMatch(html, /data-action="package-buy"/);

  const editing = ui({ agentPage: owner, agentTab: 'packages', packageForm: { id: null } }).agent();
  assert.match(editing, /<form[^>]*id="package-form"/);
  for (const name of ['title', 'included', 'price', 'delivery', 'criteria', 'extraRounds', 'capabilityId']) assert.match(editing, new RegExp(`name="${name}"`), name);
  assert.match(editing, /<option value="c1"/, 'tested capabilities can be chosen');

  const untested = page({ ownerPreview: true, agentVersion: 7, ownerPackages: [] }, { own: true, capabilities: [{ id: 'c9', category: 'Research', task: 'Research', qualification: 'unverified', metadata: {} }] });
  const blocked = ui({ agentPage: untested, agentTab: 'packages', packageForm: { id: null } }).agent();
  assert.match(blocked, /Pass a Relay test/);
  assert.doesNotMatch(blocked, /id="package-form"/);
});

test('browse filters by packages and shows the real from-price', () => {
  const hireable = agent({ id: 'h', waysToBuy: ['hire', 'commission'], packages: [pkg()], fromPrice: { amountMinor: 2500, currency: 'USD' } });
  const state = { market: { agents: [agent(), hireable], sort: 'price', windowDays: 90, connectors: [] } };
  const m = ui(state);
  const html = m.browse();
  assert.match(html, /from \$25\.00/);
  assert.match(html, /Hire/);
  assert.match(html, /<option value="price" selected>/);
  assert.doesNotMatch(html, /No published prices yet/);
  assert.match(html, /data-action="market-filter" data-group="ways" data-value="hire" aria-pressed="false"(?![^>]*disabled)/);
  m.filters().ways = ['hire'];
  assert.deepEqual(m.visible().map(a => a.id), ['h']);
});

test('a builder profile lives at /builders/<handle> and lists that builder’s agents', () => {
  const m = ui({});
  assert.deepEqual({ ...m.parse('/builders/tidy-rows') }, { page: 'builder', id: 'tidy-rows' });
  assert.equal(m.parse('/builders/Not_A_Handle').page, null);
  const s = {}; m.apply({ page: 'builder', id: 'tidy-rows' }, s);
  assert.equal(m.path(s), '/builders/tidy-rows');
  const market = { windowDays: 90, agents: [agent({ builderId: 'b1', builderKind: 'organization', evidence: { ...agent().evidence, runs: 12 } }), agent({ id: 'x2', name: 'Vendor Dedupe', builderId: 'b1', builderKind: 'organization' }), agent({ id: 'x3', builder: 'Other', builderId: 'b9' })] };
  const html = ui({ market, builderHandle: 'tidy-rows' }).builderPage();
  assert.match(html, /<h1><span class="mk-handle">tidy-rows</);
  assert.match(html, /Organization/);
  assert.match(html, /2 agents/);
  assert.match(html, /12 verified runs · 90d/);
  assert.match(html, /tidy-rows\/csv-normalizer[\s\S]*tidy-rows\/vendor-dedupe/);
  assert.doesNotMatch(html, /x3/);
  assert.match(ui({ market, builderHandle: 'nobody' }).builderPage(), /No builder by that name/);
});

test('two builders with the same name get separate rows and a profile that keeps them apart', () => {
  const market = { windowDays: 90, agents: [agent({ id: 'x1', builderId: 'b1' }), agent({ id: 'x2', builderId: 'b2', name: 'Other agent' })] };
  const list = ui({ market }).buildersPage();
  assert.match(list, /Builders <span class="mk-total">2/);
  assert.match(list, /href="\/builders\/tidy-rows" data-route/);
  const profile = ui({ market, builderHandle: 'tidy-rows' }).builderPage();
  assert.match(profile, /2 builders use this name/);
});

test('the agent page links its builder’s profile, and only the owner gets a Settings tab that opens Build', () => {
  const buyer = ui({ agentPage: page(), agentTab: 'card' }).agent();
  assert.match(buyer, /href="\/builders\/tidy-rows" data-route/);
  assert.doesNotMatch(buyer, /data-tab="settings"/);
  const owner = ui({ agentPage: page({ ownerPreview: true, ownerPackages: [] }, { own: true }), agentTab: 'settings' }).agent();
  assert.match(owner, /data-tab="settings"[^>]*>Settings</);
  assert.match(owner, new RegExp(`href="/build/agents/${id}/connection" data-route`));
  assert.match(owner, new RegExp(`href="/build/agents/${id}/offers" data-route`));
  assert.doesNotMatch(ui({ agentPage: page(), agentTab: 'settings' }).agent(), /\/build\/agents\//, 'a buyer asking for Settings sees the card');
});
