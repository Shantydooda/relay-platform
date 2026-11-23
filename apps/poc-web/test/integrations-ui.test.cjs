'use strict';
// Settings → Integrations (apps/poc-web/public/integrations-ui.js): one list for
// every account, personal or organization, Hugging Face settings style.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const PERSONAL = 'a0000000-0000-4000-8000-000000000001';
const ORG = 'b0000000-0000-4000-8000-000000000002';
const catalog = [
  { kind: 'github', label: 'GitHub', available: true, environments: ['production'], objects: ['repositories', 'issues'], help: 'Use a fine-grained token.',
    credentialFields: [{ name: 'token', label: 'Fine-grained token', secret: true }] },
  { kind: 'hubspot', label: 'HubSpot', available: true, environments: ['sandbox', 'production'], objects: ['contacts'],
    credentialFields: [{ name: 'token', label: 'Private app token', secret: true }] },
  { kind: 'netsuite', label: 'Oracle NetSuite', available: false, note: 'Token-based login on a dedicated, read-only integration role.' },
];
const github = { id: 'k1', provider: 'github', providerLabel: 'GitHub', environment: 'production', label: 'Acme <repos>', account: 'acme', objects: ['repositories'], activeGrants: 2, version: 3 };

function ui(extra = {}) {
  const state = {
    account: { user: { id: 'u1', name: 'Dana Buyer' }, memberships: [{ id: PERSONAL, role: 'owner', name: 'Dana Buyer' }, { id: ORG, role: 'employee', name: 'Acme Corp', company: true }] },
    features: { driveConnections: true, attioDelivery: true },
    buyerTab: 'integrations', ...extra,
  };
  const calls = [];
  const context = vm.createContext({ state, calls, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`),
    api: async (path, options) => { calls.push([path, options]); return path.startsWith('/api/connections') ? { canManage: true, catalog, connections: [github] } : { configured: true, connected: false, version: 1 }; } });
  vm.runInContext(fs.readFileSync(require.resolve('../public/integrations-ui.js'), 'utf8'), context);
  return { state, calls, run: code => vm.runInContext(code, context) };
}

test('integrations live at /settings/integrations for a personal account, and per organization', () => {
  const f = ui();
  assert.deepEqual(JSON.parse(JSON.stringify(f.run('RelayIntegrations.parse("/settings/integrations")'))), { page: 'integrations', id: null });
  assert.deepEqual(JSON.parse(JSON.stringify(f.run(`RelayIntegrations.parse("/settings/integrations/${ORG}")`))), { page: 'integrations', id: ORG });
  assert.equal(f.run('RelayIntegrations.parse("/settings/other")'), null);
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  assert.equal(f.state.buyerTab, 'integrations');
  assert.equal(f.run('RelayIntegrations.tenant(state)'), PERSONAL, 'an ordinary account manages its own workspace');
  assert.equal(f.run('RelayIntegrations.path(state)'), '/settings/integrations');
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: '${ORG}' }, state)`);
  assert.equal(f.run('RelayIntegrations.path(state)'), `/settings/integrations/${ORG}`);
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: 'c0000000-0000-4000-8000-000000000009' }, state)`);
  assert.equal(f.run('RelayIntegrations.tenant(state)'), PERSONAL, 'a workspace you are not in falls back to your own');
});

test('loading fetches the workspace’s systems, and Drive and Attio only for its owners', async () => {
  const f = ui();
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  await f.run('RelayIntegrations.load(state)');
  assert.deepEqual(f.calls.map(call => call[0]).sort(), [`/api/attio/status?tenantId=${PERSONAL}`, `/api/connections?tenantId=${PERSONAL}`, `/api/drive/status?tenantId=${PERSONAL}`]);
  assert.equal(f.state.integrations.tenantId, PERSONAL);
  f.calls.length = 0;
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: '${ORG}' }, state)`);
  await f.run('RelayIntegrations.load(state)');
  assert.deepEqual(f.calls.map(call => call[0]), [`/api/connections?tenantId=${ORG}`], 'members see the list; owners manage Drive and Attio');
});

test('the page is one list: a row per integration with what it is for, its status and one action', async () => {
  const f = ui();
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  await f.run('RelayIntegrations.load(state)');
  const html = f.run('RelayIntegrations.page()');
  assert.match(html, /class="mk-build mk-settings"/, 'the settings shell with its left menu');
  assert.match(html, /href="\/settings\/integrations" data-route class="active"/);
  assert.match(html, new RegExp(`href="/settings/integrations/${ORG}" data-route`), 'each organization you belong to');
  assert.match(html, /<h1>Integrations/);
  for (const group of ['Agents read during work', 'Files for your requests', 'Send results']) assert.match(html, new RegExp(group));
  assert.match(html, /data-integration="github"[\s\S]*Connected · 1[\s\S]*data-action="integration-open" data-kind="github"[^>]*>Manage/);
  assert.match(html, /data-integration="hubspot"[\s\S]*Not connected[\s\S]*>Connect</);
  assert.match(html, /data-integration="drive"[\s\S]*Ready to connect/);
  assert.match(html, /data-integration="attio-delivery"[\s\S]*Ready to connect/);
  assert.match(html, /mk-integration-planned" data-integration="netsuite"[\s\S]*Coming next/);
  assert.doesNotMatch(html, /id="connection-create"/, 'forms open from their row');
  assert.doesNotMatch(html, /YOUR TOOLS, TOGETHER|class="panel"/, 'none of the old workspace look');
});

test('opening a row shows its connections and a connect form with masked secrets; members only read', async () => {
  const f = ui();
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  await f.run('RelayIntegrations.load(state)');
  f.state.integrationOpen = 'github';
  const html = f.run('RelayIntegrations.page()');
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Acme &#60;repos&#62;/, 'labels are escaped');
  assert.match(html, /2 active grants/);
  assert.match(html, /data-action="connection-disconnect" data-id="k1" data-version="3"/);
  assert.match(html, /<details class="mk-integration-more"><summary>Connect another GitHub<\/summary><form id="connection-create"[\s\S]*name="provider" value="github"[\s\S]*name="cred-token" type="password"/);
  assert.match(html, /Use a fine-grained token/);

  f.state.integrations.connections.canManage = false;
  const member = f.run('RelayIntegrations.page()');
  assert.doesNotMatch(member, /id="connection-create"|connection-disconnect/);
  assert.match(member, /Owners of this workspace connect systems/);
});

test('Drive and Attio rows carry their own actions for the chosen workspace', async () => {
  const f = ui();
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  await f.run('RelayIntegrations.load(state)');
  f.state.integrations.drive = { configured: true, connected: true, version: 4 };
  f.state.integrations.attio = { configured: false };
  f.state.integrationOpen = 'drive';
  let html = f.run('RelayIntegrations.page()');
  assert.match(html, /data-integration="drive"[\s\S]*Connected/);
  assert.match(html, /data-action="integration-drive" data-operation="pick"/);
  assert.match(html, /data-action="integration-drive" data-operation="disconnect"/);
  assert.match(html, /data-integration="attio-delivery"[\s\S]*Setup required[\s\S]*>Details</, 'nothing to connect until the server is set up');
  f.state.integrationOpen = 'attio-delivery';
  html = f.run('RelayIntegrations.page()');
  assert.match(html, /configured on the server/);
  assert.doesNotMatch(html, /data-action="integration-attio"/);
  f.state.integrations.drive = { configured: false };
  f.state.integrationOpen = 'drive';
  html = f.run('RelayIntegrations.page()');
  assert.match(html, /Google sign-in isn’t set up on this server yet/);
  assert.doesNotMatch(html, /data-action="integration-drive"/, 'no connect button until Google sign-in is configured');
});

test('with connections switched off on the server, the page says so instead of failing', async () => {
  const f = ui({ features: {} });
  f.run(`RelayIntegrations.apply({ page: 'integrations', id: null }, state)`);
  f.state.integrations = { tenantId: PERSONAL, connections: null, drive: null, attio: null };
  const html = f.run('RelayIntegrations.page()');
  assert.match(html, /No integrations are available on this server yet/);
});
