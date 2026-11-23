'use strict';
// A region for one request on "Post a request", and the Settings tab on an
// organization's agent page for members who can build as it (marketplace-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state = {}) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context);
}

test('the request form offers a region for this request, and says when a company rule overrides it', () => {
  const m = ui({ account: { user: { name: 'B' }, memberships: [{ id: 'p1' }] } });
  const html = m.post();
  assert.match(html, /<label for="post-region">Data processed in <span class="mk-optional">optional/);
  assert.match(html, /<option value="" selected>Any region<\/option><option value="eu" >The EU only<\/option><option value="us" >The US only<\/option>/);
  assert.match(html, /Builders declare it; Relay doesn’t verify it/);
  assert.doesNotMatch(html, /always need/);
  const reopened = ui({ account: { user: { name: 'B' }, memberships: [{ id: 'p1' }] }, postDraft: { regionChoice: 'us' }, market: { regionRules: [{ tenantId: 'o1', name: 'Northwind <ERP>', region: 'eu' }] } });
  const again = reopened.post();
  assert.match(again, /<option value="us" selected>The US only/, 'a reopened draft keeps its choice');
  assert.match(again, /Requests filed in Northwind &#60;ERP&#62; always need the EU, whatever you choose here/);
});

test('a member who can build as the owning organization gets Settings, with links that switch to it', () => {
  const m = ui({});
  const agent = { id: 'a0000000-0000-4000-8000-000000000001', ownerPreview: false, manageAs: { id: 'o1', name: 'Acme <ERP>' } };
  const html = m.ownerTab(agent);
  assert.match(html, /You see this tab because you can build as Acme &#60;ERP&#62;/);
  assert.match(html, /data-action="manage-agent-as" data-org="o1" data-href="\/build\/agents\/a0000000-0000-4000-8000-000000000001\/profile"/);
  assert.doesNotMatch(html, /Packages tab/, 'package drafts stay with the owner');
  const own = m.ownerTab({ id: agent.id, ownerPreview: true });
  assert.match(own, /Only you see this tab/);
  assert.match(own, /href="\/build\/agents\/a0000000-0000-4000-8000-000000000001\/profile" data-route/);
});
