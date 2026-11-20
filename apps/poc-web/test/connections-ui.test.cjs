'use strict';
// Connected systems and access requests (apps/poc-web/public/connections-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state) {
  const context = vm.createContext({ state, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(fs.readFileSync(require.resolve('../public/connections-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayConnections', context);
}
const T = 'c0000000-0000-4000-8000-000000000001';
const catalog = [
  { kind: 'sample-erp', label: 'Sample ERP (local testing)', available: true, environments: ['sandbox', 'production'], objects: ['vendor', 'customer'], credentialFields: [{ name: 'accountId', label: 'Account ID', secret: false }, { name: 'token', label: 'Access token', secret: true }] },
  { kind: 'netsuite', label: 'Oracle NetSuite', available: false, note: 'Token-based login on a dedicated, read-only integration role.' },
];
const connection = { id: 'k1', provider: 'sample-erp', providerLabel: 'Sample ERP (local testing)', environment: 'sandbox', label: 'NetSuite sandbox (Wave 2)', account: 'TSTDRV1', objects: ['vendor', 'customer'], activeGrants: 1, version: 1 };
const request = { id: 'r1', provider: 'sample-erp', providerLabel: 'Sample ERP (local testing)', environment: 'sandbox', objects: ['vendor'], purpose: 'Find duplicate vendors by tax ID.', days: 7, status: 'pending' };
const account = role => ({ user: { id: 'u', name: 'U' }, memberships: [{ id: T, role, company: true }] });
const detail = (access) => ({ task: { id: 't1', tenantId: T, version: 5 }, access });

test('the Connected systems tab lists systems without secrets, offers a connect form and labels planned connectors', () => {
  const html = ui({ connections: { canManage: true, catalog, connections: [connection] } }).tab();
  assert.match(html, /NetSuite sandbox \(Wave 2\)/);
  assert.match(html, /1 active grant/);
  assert.match(html, /id="connection-create"/);
  assert.match(html, /name="cred-token" type="password"/, 'secret fields are masked');
  assert.match(html, /Oracle NetSuite<\/strong>: Token-based login/);
  assert.match(html, /independent security review/);
  const member = ui({ connections: { canManage: false, catalog, connections: [] } }).tab();
  assert.doesNotMatch(member, /id="connection-create"/);
  assert.match(member, /Workspace owners connect systems/);
});

test('an access request asks the owner to pick a matching system and a duration', () => {
  const html = ui({ account: account('owner'), connections: { connections: [connection, { ...connection, id: 'k2', environment: 'production' }] } })
    .taskAccess(detail({ requests: [request], grants: [] }));
  assert.match(html, /Waiting for you/);
  assert.match(html, /Find duplicate vendors by tax ID/);
  assert.match(html, /data-access-approve="r1"/);
  assert.match(html, /<option value="k1">/);
  assert.doesNotMatch(html, /<option value="k2">/, 'a production system can’t answer a sandbox request');
  assert.match(html, /data-action="access-decline"/);
});

test('employees see the request but owners grant; declined requests explain what happens next', () => {
  const employee = ui({ account: account('employee'), connections: { connections: [connection] } }).taskAccess(detail({ requests: [request], grants: [] }));
  assert.doesNotMatch(employee, /data-access-approve/);
  assert.match(employee, /A workspace owner needs to approve this/);
  const declined = ui({ account: account('owner'), connections: { connections: [] } }).taskAccess(detail({ requests: [{ ...request, status: 'declined' }], grants: [] }));
  assert.match(declined, /isn’t counted against it/);
});

test('active grants show their reads and can be revoked', () => {
  const html = ui({ account: account('owner') }).taskAccess(detail({ requests: [], grants: [{ id: 'g1', connectionLabel: 'NetSuite sandbox (Wave 2)', objects: ['vendor'], status: 'active', expiresAt: Date.now() + 86400000, reads: 2, rowsRead: 6, version: 1 }] }));
  assert.match(html, /2 reads, 6 rows/);
  assert.match(html, /data-action="access-revoke" data-id="g1"/);
  assert.equal(ui({ account: account('owner') }).taskAccess(detail({ requests: [], grants: [] })), '');
});
