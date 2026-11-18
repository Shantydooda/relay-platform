'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('host holds disable new runs without hiding saved downloads', () => {
  const data = {
    grants: [{ id: 'grant', status: 'active', expiresAt: Date.now() + 60000 }],
    sources: [{ id: 'source', name: 'Fixture', status: 'active' }],
    runs: [{ id: 'saved', appId: 'app', status: 'saved', output: 'A', filename: 'clean.csv' }],
    hosting: { entitlement: { canHost: false }, hosts: [{ appId: 'app', status: 'subscription_hold', resources: {} }] },
  };
  const ctx = vm.createContext({ state: { workspaceApps: data }, escape: String, date: String });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/workspace-apps-ui.js'), 'utf8') + '\nthis.ui=RelayApps;', ctx);
  const app = { id: 'app', grantId: 'grant', sourceId: 'source', status: 'active' };
  const held = ctx.ui.card(app);
  assert.match(held, /data-control="run" disabled/);
  assert.match(held, /Saved outputs remain available/);
  assert.match(held, /Download clean.csv/);
  data.hosting.entitlement.canHost = true;
  data.hosting.hosts[0].status = 'running';
  assert.doesNotMatch(ctx.ui.card(app), /data-control="run" disabled/);
});
