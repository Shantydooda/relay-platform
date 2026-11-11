'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const id = '12345678-1234-1234-1234-123456789abc';
function fixture() {
  const agent = { id, name: '<Agent>', operatorName: '<Builder>', kind: 'specialist', domain: 'Research', purpose: '<script>private</script>', availability: 'available', capabilities: [
    { category: 'Research', task: 'Property reports', qualification: 'declared' },
    { category: 'Data', task: 'CSV cleanup', qualification: 'qualified', evidence: { title: '<test>', expiresAt: 1 } },
  ] };
  const context = vm.createContext({ URLSearchParams, state: { agentCatalog: [agent] }, location: { origin: 'http://127.0.0.1:4180', hash: `#storefront=${id}` }, date: () => 'date', escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), render() {}, document: { querySelector: () => null } });
  vm.runInContext(fs.readFileSync(require.resolve('../public/agent-market-ui.js'), 'utf8') + '\nglobalThis.market = RelayAgentMarket;', context);
  return { context, market: context.market, agent };
}
test('storefront exposes per-capability evidence without invented pricing or blanket qualification', () => {
  const f = fixture(), html = f.market.page();
  assert.match(html, /1 of 2 capabilities qualified/);
  assert.match(html, /No current Relay qualification/);
  assert.match(html, /No fixed price or turnaround/);
  assert.match(html, /Requires a Relay account on this localhost/);
  assert.match(html, /&lt;Agent&gt;/);
  assert.doesNotMatch(html, /<script>|<Builder>|<test>/);
  assert.match(html, /#storefront=12345678/);
});
test('unlisted and unqualified storefronts do not offer actionable direct requests', () => {
  const f = fixture();
  assert.match(f.market.storefront('missing'), /Agent unavailable/);
  assert.doesNotMatch(f.market.storefront('missing'), /market-request-agent/);
  f.agent.availability = 'qualification_pending';
  assert.match(f.market.page(), /disabled>Request this agent/);
  f.market.choose(id);
  assert.equal(f.context.state.preferredAgent, undefined);
});
test('storefront routes validate IDs and request handoff preserves the selected supplier', () => {
  const f = fixture();
  assert.equal(f.market.storefrontId('#storefront=../secret'), null);
  assert.equal(f.market.storefrontId(`#storefront=${id}&extra=true`), null);
  f.market.choose(id);
  assert.equal(f.context.state.preferredAgent.id, id);
  assert.equal(f.context.state.buyerTab, 'request');
  assert.equal(f.context.location.hash, '');
  assert.match(f.context.state.prompt, /<Agent>/);
});

test('profile navigation and Back load the catalog without converting a visit into a task', async () => {
  const f = fixture();
  const callbacks = [], calls = [];
  Object.assign(f.context, {
    window: { addEventListener: (name, fn) => callbacks.push(fn) }, URL,
    run: fn => { f.context.pending = fn(); },
    refresh: async value => calls.push(['refresh', value]),
    render: () => calls.push('render'),
    root: { querySelector: () => ({ focus: () => calls.push('focus') }) },
    RelayAgentMarket: f.market,
  });
  f.context.state.account = { user: { workspace: 'buyer' } };
  f.context.state.detail = { task: { id: 'previous' } };
  const app = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  vm.runInContext(app.slice(app.indexOf('// Storefront links are local authenticated routes;')), f.context);
  callbacks[0]({ oldURL: 'http://127.0.0.1:4180/#market' });
  await f.context.pending;
  assert.equal(f.context.state.buyerTab, 'market');
  assert.equal(f.context.state.detail, null);
  assert.equal(f.context.state.preferredAgent, undefined);
  assert.deepEqual(calls, [['refresh', null], 'render', 'focus']);
  f.context.location.hash = '#market';
  callbacks[0]({ oldURL: `http://127.0.0.1:4180/#storefront=${id}` });
  await f.context.pending;
  assert.equal(calls.length, 6);
  f.context.state.account.user.workspace = 'builder';
  f.context.location.hash = `#storefront=${id}`;
  callbacks[0]({ oldURL: 'http://127.0.0.1:4180/#market' });
  await f.context.pending;
  assert.equal(calls.length, 9);
  assert.equal(f.context.state.account.user.workspace, 'builder', 'preview does not silently change workspace');
});

test('individual profile lookup works outside the catalog and owner preview cannot hire itself', () => {
  const f = fixture();
  f.context.state.agentCatalog = [];
  f.context.state.storefrontAgent = { ...f.agent, ownerPreview: true, listingStatus: 'draft' };
  assert.match(f.market.page(), /Your listing preview/);
  assert.match(f.market.page(), /disabled>Request this agent/);
  f.market.choose(id);
  assert.equal(f.context.state.preferredAgent, undefined);
});

test('source-tagged profile links preserve agent identity and capture a bounded entry-point label', () => {
  for (const [suffix, source] of [['?source=builder','builder-link'],['?source=market','market'],['','storefront']]) {
    const f = fixture();
    f.context.location.hash = '#storefront='+id+suffix;
    assert.equal(f.market.storefrontId(f.context.location.hash), id);
    f.market.choose(id);
    assert.equal(f.context.state.preferredAgent.discoverySource, source);
  }
  const f = fixture();
  assert.equal(f.market.storefrontId('#storefront='+id+'?source=secret'), null);
  f.context.location.hash = '#market';f.market.choose(id);
  assert.equal(f.context.state.preferredAgent.discoverySource, 'market');
});

test('saved controls reflect persisted state, owner preview hides them, and unavailable saves expose no profile', () => {
  const f = fixture();
  f.agent.saved = true; f.agent.savedVersion = 4;
  assert.match(f.market.page(), /data-version="4" data-saved="true" aria-pressed="true"/);
  f.agent.ownerPreview = true;
  assert.doesNotMatch(f.market.page(), /data-action="market-save"/);
  f.context.state.agentMarketSaved = true;
  f.context.state.agentDiscovery = { unavailableSaved: [{ id, saved: true, savedVersion: 4 }] };
  const html = f.market.cards([]);
  assert.match(html, /Saved agent unavailable/);
  assert.doesNotMatch(html, /Property reports|private|Request agent/);
  assert.match(f.market.query(), /saved=true/);
});
