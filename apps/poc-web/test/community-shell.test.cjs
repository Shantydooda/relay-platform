'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const renderSource = source.slice(source.indexOf('function communityTopbar'), source.indexOf('function header()'));
function context(preview) {
  return vm.createContext({
    document: { documentElement: { dataset: { design: preview ? 'community' : undefined } } },
    state: { features: { workspaceApps: true }, agentMarketQuery: '<test>' },
    escape: value => value.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    relayCharacter: () => '<span>Relay character</span>', navigationIcon: () => '',
  });
}
test('community header preserves role-specific navigation and does not expose buyer search to builders', () => {
  const ctx = context(true); vm.runInContext(renderSource, ctx);
  const buyer = vm.runInContext('communityTopbar(false)', ctx);
  assert.match(buyer, /role="search"/);
  assert.match(buyer, /&lt;test&gt;/);
  assert.match(buyer, /data-tab="market"/);
  const builder = vm.runInContext('communityTopbar(true)', ctx);
  assert.doesNotMatch(builder, /role="search"|data-tab="market"/);
  assert.match(builder, /data-action="builder-tab"/);
  const original = context(false); vm.runInContext(renderSource, original);
  assert.equal(vm.runInContext('communityTopbar(false)', original), '');
});
