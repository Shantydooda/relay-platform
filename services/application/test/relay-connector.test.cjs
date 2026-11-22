'use strict';
// The Relay Connector (docs/specs/Buyer-Connections.md → "Relay Connector"):
// a buyer runs a small connector inside their own network. It keeps the ERP
// login there and answers an agent's granted read with only the rows asked for.
// Relay holds a connector key (stored as a hash), never the ERP's credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setup } = require('./fixtures/connections-fixture.cjs');
const { connectorSystems } = require('../src/relay-connector.cjs');

const VENDORS = [{ id: 'V-1', name: 'Acme', taxId: '12-3' }, { id: 'V-2', name: 'ACME', taxId: '12-3' }];
const timings = { readWaitMs: 600, pollMs: 10, onlineMs: 60000 };

async function connector(t, adapter = 'sqlite', options = {}) {
  const f = await setup(t, adapter, { providers: connectorSystems(), options: { connectorTimings: { ...timings, ...options } } });
  const connect = (body = {}) => f.app.connect(f.buyer, { tenantId: f.tenantId, provider: 'netsuite', environment: 'sandbox', label: 'NetSuite sandbox', ...body }, randomUUID());
  const ask = (body = {}) => f.app.requestAccess(f.principal, f.taskId, { provider: 'netsuite', environment: 'sandbox', objects: ['vendor'], purpose: 'Read vendor records to find duplicates by tax ID.', days: 7, ...body }, randomUUID());
  async function granted() {
    const { connectionId, connectorKey } = await connect();
    await f.app.connectorHello(connectorKey, { version: '0.1.0', objects: ['vendor', 'customer'] });
    await f.claim(); await ask();
    const { grantId } = await f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID());
    const claimed = await f.claim();
    return { connectionId, connectorKey, grantId, lease: claimed.leaseToken };
  }
  return { ...f, connect, ask, granted };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: connecting through the connector asks for no ERP login; the key is shown once and stored as a hash`, async t => {
    const f = await connector(t, adapter);
    const { connectionId, connectorKey } = await f.connect();
    assert.match(connectorKey, /^rcn_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    const stored = await f.repository.read(r => r.get('connection', connectionId));
    assert.equal(stored.mode, 'connector');
    assert.equal(stored.secret, null, 'Relay holds no ERP credential');
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(connectorKey.split('.')[1]), 'only a hash of the key is kept');
    let [listed] = (await f.app.connections(f.buyer, f.tenantId)).connections;
    assert.deepEqual(JSON.parse(JSON.stringify(listed.connector)), { online: false, lastSeenAt: null, version: null });
    assert.deepEqual([...listed.objects], [], 'nothing can be granted until the connector says what it serves');
    assert.doesNotMatch(JSON.stringify(listed), /rcn_|Hash/);

    await f.app.connectorHello(connectorKey, { version: '0.1.0', objects: ['vendor', 'customer'] });
    [listed] = (await f.app.connections(f.buyer, f.tenantId)).connections;
    assert.equal(listed.connector.online, true);
    assert.equal(listed.connector.version, '0.1.0');
    assert.deepEqual([...listed.objects], ['vendor', 'customer']);
    f.advance(61000);
    [listed] = (await f.app.connections(f.buyer, f.tenantId)).connections;
    assert.equal(listed.connector.online, false, 'a connector that stops checking in shows offline');

    await assert.rejects(f.app.connectorHello(connectorKey.slice(0, -2) + 'xx', { version: '0.1.0', objects: ['vendor'] }), { code: 'CONNECTOR_KEY_INVALID' });
    await assert.rejects(f.app.connectorHello('nope', { version: '0.1.0', objects: ['vendor'] }), { code: 'CONNECTOR_KEY_INVALID' });
    await assert.rejects(f.app.connectorHello(connectorKey, { version: '0.1.0', objects: ['payroll'] }), { code: 'INVALID_INPUT' });
    await assert.rejects(f.connect({ credentials: { token: 'x' } }), { code: 'INVALID_INPUT' }, 'the connector keeps the login; Relay refuses one');
    const catalog = f.app.connectionCatalog().find(p => p.kind === 'netsuite');
    assert.equal(catalog.available, true);
    assert.equal(catalog.connector, true);
    assert.deepEqual([...catalog.credentialFields], []);
  });

  test(`${adapter}: a granted read goes to the buyer’s connector and only the rows come back`, async t => {
    const f = await connector(t, adapter);
    const { grantId, connectorKey, lease } = await f.granted();
    const reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor', cursor: '0' });
    const job = await f.app.connectorNextRead(connectorKey, { waitMs: 500 });
    assert.deepEqual(Object.keys(job).sort(), ['agent', 'cursor', 'grantId', 'limit', 'object', 'params', 'readId', 'request']);
    assert.equal(job.object, 'vendor');
    assert.equal(job.agent, 'Vendor cleaner');
    assert.equal(job.request, 'Dedupe vendor master');
    await f.app.connectorAnswer(connectorKey, job.readId, { rows: VENDORS, nextCursor: null });
    const read = await reading;
    assert.deepEqual(JSON.parse(JSON.stringify(read.rows)), VENDORS);
    const detail = await f.app.detail(f.buyer, f.taskId);
    assert.equal(detail.access.grants[0].reads, 1);
    assert.equal(detail.access.grants[0].rowsRead, 2);
    const stored = await f.repository.read(r => r.get('connector-read', job.readId));
    assert.equal(stored.status, 'delivered');
    assert.equal(stored.result, null, 'rows aren’t kept once delivered');
    await assert.rejects(f.app.connectorAnswer(connectorKey, job.readId, { rows: [], nextCursor: null }), { code: 'READ_CLOSED' });
    assert.equal(await f.app.connectorNextRead(connectorKey, { waitMs: 0 }), null, 'nothing else is waiting');
  });
}

test('an offline connector fails the read at once; a slow one times out and its late answer is refused', async t => {
  const f = await connector(t, 'sqlite', { onlineMs: 1000 });
  const { grantId, connectorKey, lease } = await f.granted();
  f.advance(2000);
  await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' }), { code: 'CONNECTOR_OFFLINE' });
  assert.equal(await f.app.connectorNextRead(connectorKey, { waitMs: 0 }), null, 'an offline read is never queued');
  // Asking for work counts as checking in.
  const reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' });
  await assert.rejects(reading, { code: 'CONNECTOR_TIMEOUT' });
  const late = await f.app.connectorNextRead(connectorKey, { waitMs: 0 });
  assert.equal(late, null, 'a timed-out read is withdrawn');
});

test('the connector’s errors and malformed answers reach the agent as a plain failure', async t => {
  const f = await connector(t);
  const { grantId, connectorKey, lease } = await f.granted();
  let reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' });
  let job = await f.app.connectorNextRead(connectorKey, { waitMs: 500 });
  await f.app.connectorAnswer(connectorKey, job.readId, { error: { code: 'OBJECT_UNAVAILABLE', message: 'No export is configured for vendor.' } });
  await assert.rejects(reading, { code: 'CONNECTOR_ERROR', message: /No export is configured for vendor/ });

  reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' });
  job = await f.app.connectorNextRead(connectorKey, { waitMs: 500 });
  await assert.rejects(f.app.connectorAnswer(connectorKey, job.readId, { rows: [{ nested: { a: 1 } }], nextCursor: null }), { code: 'INVALID_INPUT' });
  await assert.rejects(reading, { code: 'CONNECTOR_ERROR', message: /couldn’t accept/ });
  const detail = await f.app.detail(f.buyer, f.taskId);
  assert.equal(detail.access.grants[0].reads, 0, 'failed reads aren’t counted');
});

test('a connector can only answer its own reads; disconnecting voids the key and fails pending reads', async t => {
  const f = await connector(t);
  const { grantId, connectorKey, lease, connectionId } = await f.granted();
  const other = await f.connect({ label: 'Second NetSuite' });
  await f.app.connectorHello(other.connectorKey, { version: '0.1.0', objects: ['vendor'] });
  const reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' });
  reading.catch(() => {});
  assert.equal(await f.app.connectorNextRead(other.connectorKey, { waitMs: 0 }), null, 'another connector never sees this read');
  const job = await f.app.connectorNextRead(connectorKey, { waitMs: 500 });
  await assert.rejects(f.app.connectorAnswer(other.connectorKey, job.readId, { rows: [], nextCursor: null }), { code: 'NOT_FOUND' });
  const listed = (await f.app.connections(f.buyer, f.tenantId)).connections.find(c => c.id === connectionId);
  await f.app.disconnect(f.buyer, connectionId, { expectedVersion: listed.version }, randomUUID());
  await assert.rejects(reading, { code: /CONNECTOR_ERROR|GRANT_REQUIRED/ });
  await assert.rejects(f.app.connectorNextRead(connectorKey, { waitMs: 0 }), { code: 'CONNECTOR_KEY_INVALID' });
  await assert.rejects(f.app.connectorAnswer(connectorKey, job.readId, { rows: [], nextCursor: null }), { code: 'CONNECTOR_KEY_INVALID' });
});

test('access revoked while the connector answers returns nothing to the agent', async t => {
  const f = await connector(t);
  const { grantId, connectorKey, lease } = await f.granted();
  const reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: lease, grantId, object: 'vendor' });
  reading.catch(() => {});
  const job = await f.app.connectorNextRead(connectorKey, { waitMs: 500 });
  await f.app.revokeAccess(f.buyer, grantId, { expectedVersion: 1 }, randomUUID());
  await f.app.connectorAnswer(connectorKey, job.readId, { rows: VENDORS, nextCursor: null });
  await assert.rejects(reading, { code: 'GRANT_REQUIRED' });
  assert.equal((await f.app.detail(f.buyer, f.taskId)).access.grants[0].rowsRead, 0);
});
