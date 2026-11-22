'use strict';
// The Relay Connector's HTTP routes, driven by the real connector loop
// (packages/relay-connector) against a real local server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { mkdtempSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { openDatabase } = require('../src/database.cjs');
const { openApplicationDatabase } = require('../../application/src/sqlite.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createApp } = require('../src/app.cjs');
const { createVault } = require('../../connectors/src/vault.cjs');
const { connectorSystems } = require('../../application/src/relay-connector.cjs');
const { loadConfig, createFolderSource, createConnector } = require('../../../packages/relay-connector/src/index.cjs');

test('a connector checks in over HTTP with its key; browsers and wrong keys are refused', async t => {
  const authDb = openDatabase(':memory:'), applicationDb = openApplicationDatabase(':memory:');
  const store = await createUnifiedLocalStore({ authDb, applicationDb, localExecution: true, connectionVault: createVault(randomBytes(32).toString('hex')), connectionProviders: connectorSystems() });
  const origin = 'http://127.0.0.1:4197';
  const server = createApp({ store, origin });
  await new Promise(resolve => server.listen(4197, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); applicationDb.close(); authDb.close(); });

  const owner = store.principal(await store.register({ name: 'Owner', email: 'owner@example.test', password: 'disposable connector test password', workspace: 'buyer' }, 'owner'));
  const tenantId = owner.memberships[0].id;
  const { connectorKey } = await store.connect(owner, { tenantId, provider: 'netsuite', environment: 'sandbox', label: 'NetSuite sandbox' }, randomUUID());

  const dir = mkdtempSync(join(tmpdir(), 'relay-connector-http-'));
  mkdirSync(join(dir, 'exports'));
  writeFileSync(join(dir, 'exports', 'vendors.csv'), 'id,name\nV-1,Acme\n');
  writeFileSync(join(dir, 'relay-connector.json'), JSON.stringify({ relay: origin, root: 'exports', objects: { vendor: 'vendors.csv' }, auditLog: 'audit.log' }));
  const config = loadConfig(join(dir, 'relay-connector.json'), { RELAY_CONNECTOR_KEY: connectorKey });
  const connector = createConnector({ config, source: createFolderSource(config), waitSeconds: 0 });
  const hello = await connector.hello();
  assert.deepEqual(hello.objects, ['vendor']);
  assert.equal(await connector.once(), false, 'no read is waiting: Relay answers 204');
  const [listed] = (await store.connections(owner, tenantId)).connections;
  assert.equal(listed.connector.online, true);

  // A connector waiting for work never holds up the rest of Relay.
  const waiting = fetch(origin + '/api/connector/reads?wait=3', { headers: { authorization: `Bearer ${connectorKey}` } });
  await new Promise(resolve => setTimeout(resolve, 200));
  const started = Date.now();
  await store.connections(owner, tenantId);
  assert.ok(Date.now() - started < 1000, 'other requests are served while the connector waits');
  assert.equal((await waiting).status, 204);

  const fromBrowser = await fetch(origin + '/api/connector/reads', { headers: { origin, authorization: `Bearer ${connectorKey}` } });
  assert.equal(fromBrowser.status, 403, 'the connector API never serves a browser');
  const wrong = await fetch(origin + '/api/connector/reads', { headers: { authorization: `Bearer ${connectorKey.slice(0, -3)}abc` } });
  assert.equal(wrong.status, 401);
  assert.equal((await wrong.json()).error.code, 'CONNECTOR_KEY_INVALID');
  const cookieOnly = await fetch(origin + '/api/connector/hello', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"version":"1","objects":["vendor"]}' });
  assert.equal(cookieOnly.status, 401, 'no key, no access');
});
