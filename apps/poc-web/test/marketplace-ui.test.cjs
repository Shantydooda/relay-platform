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
  assert.match(html, /No published prices yet/);
  assert.match(html, /<option value="price" disabled>/);
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
  assert.match(html, /No packages yet/);
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
