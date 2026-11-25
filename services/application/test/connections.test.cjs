'use strict';
// Buyer connections and access grants (docs/specs/Buyer-Connections.md): buyers
// connect their systems once; an agent asks for read access during work; the
// buyer is notified and grants a scoped, expiring read; the agent reads through
// Relay and never sees the buyer's credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createSampleErp, SAMPLE_TOKEN } = require('../../connectors/src/erp-fixture.cjs');
const { setup, DAY } = require('./fixtures/connections-fixture.cjs');

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: buyers connect a system once; credentials are sealed and never shown`, async t => {
    const f = await setup(t, adapter);
    const { connectionId } = await f.connect();
    const [listed] = (await f.app.connections(f.buyer, f.tenantId)).connections;
    assert.equal(listed.id, connectionId);
    assert.equal(listed.account, 'TSTDRV123');
    assert.equal(listed.environment, 'sandbox');
    assert.deepEqual([...listed.objects], ['vendor', 'customer', 'item']);
    const stored = await f.repository.read(r => r.get('connection', connectionId));
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(SAMPLE_TOKEN), 'the token is sealed at rest');
    assert.doesNotMatch(JSON.stringify(listed), /secret|token/i);
    await assert.rejects(f.connect({ credentials: { accountId: 'X', token: 'wrong' } }), { code: 'CONNECTION_REJECTED' });
    await assert.rejects(f.connect({ provider: 'netsuite' }), { code: 'PROVIDER_UNAVAILABLE' });
    await assert.rejects(f.connect({}, f.employee), { code: 'FORBIDDEN' });
    const catalog = f.app.connectionCatalog();
    assert.ok(catalog.find(p => p.kind === 'sample-erp').available);
    assert.equal(catalog.find(p => p.kind === 'netsuite').available, false);
  });

  test(`${adapter}: an agent asks, the buyer is notified and grants a scoped read through Relay`, async t => {
    const f = await setup(t, adapter);
    const { connectionId } = await f.connect();
    await f.claim();
    await f.ask();
    const task = await f.repository.read(r => r.get('task', f.taskId));
    assert.equal(task.assignment.status, 'queued', 'execution time pauses while the buyer decides');
    assert.ok(task.assignment.permissionWait);
    const notes = (await f.app.notifications(f.buyer)).items;
    assert.ok(notes.some(n => n.title === 'An agent is asking for access to your systems'));
    await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: 'x'.repeat(43), grantId: randomUUID(), object: 'vendor' }), { code: 'LEASE_EXPIRED' });
    // Granting needs a matching, active connection.
    await assert.rejects(f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId: randomUUID(), days: 7 }, randomUUID()), { code: 'NOT_FOUND' });
    const { grantId } = await f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 3 }, randomUUID());
    const claimed = await f.claim();
    assert.deepEqual(claimed.accessGrants.map(g => ({ ...g, objects: [...g.objects] })), [{ id: grantId, provider: 'sample-erp', environment: 'sandbox', objects: ['vendor'], expiresAt: Date.parse('2026-11-22T09:00:00Z') }]);
    assert.doesNotMatch(JSON.stringify(claimed), new RegExp(SAMPLE_TOKEN), 'the agent never receives the buyer credential');
    const read = await f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor' });
    assert.equal(read.rows.length, 3);
    assert.equal(read.rows[0].taxId, '12-3456789');
    await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'customer' }), { code: 'GRANT_SCOPE' });
    for (const cursor of [-1, 1.5, '', 'a b', 'x\ny', {}, 'x'.repeat(501)])
      await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor', cursor }), { code: 'INVALID_CURSOR' }, JSON.stringify(cursor));
    const detail = await f.app.detail(f.buyer, f.taskId);
    assert.equal(detail.access.grants[0].reads, 1, 'the buyer sees every read');
    assert.equal(detail.access.grants[0].rowsRead, 3);
    // Expiry ends access without anyone acting.
    f.advance(3 * DAY + 1);
    await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor' }), { code: /GRANT_REQUIRED|LEASE_EXPIRED|EXECUTION_EXPIRED/ });
  });

  test(`${adapter}: a slow system doesn’t hold the work while it answers, and access revoked meanwhile returns nothing`, async t => {
    // The provider call waits on a gate we open by hand.
    const erp = createSampleErp(), inner = erp.read.bind(erp);
    let open, called;
    const reached = new Promise(resolve => { called = resolve; });
    erp.read = async (...args) => { called(); await new Promise(resolve => { open = resolve; }); return inner(...args); };
    const f = await setup(t, adapter, { providers: [erp] });
    const { connectionId } = await f.connect();
    await f.claim(); await f.ask();
    const { grantId } = await f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID());
    const claimed = await f.claim();
    const reading = f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor' });
    reading.catch(() => {});
    await reached;
    // While the system is still answering, the buyer can act on the same work.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('revoking waited for the read')), 2000));
    await Promise.race([f.app.revokeAccess(f.buyer, grantId, { expectedVersion: 1 }, randomUUID()), timeout]);
    open();
    await assert.rejects(reading, { code: 'GRANT_REQUIRED' });
    const detail = await f.app.detail(f.buyer, f.taskId);
    assert.equal(detail.access.grants[0].reads, 0, 'a read that lost its access isn’t counted or returned');
    assert.equal(detail.access.grants[0].rowsRead, 0);
  });

  test(`${adapter}: revoking a grant or disconnecting the system stops reads at once`, async t => {
    const f = await setup(t, adapter);
    const { connectionId } = await f.connect();
    await f.claim(); await f.ask();
    const { grantId } = await f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID());
    let claimed = await f.claim();
    await f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor' });
    await f.app.revokeAccess(f.buyer, grantId, { expectedVersion: 1 }, randomUUID());
    await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId, object: 'vendor' }), { code: 'GRANT_REQUIRED' });
    assert.ok((await f.app.notifications(f.builder)).items.some(n => n.title === 'Access to the buyer’s system was revoked'));
    // A fresh grant, then the buyer disconnects the system entirely.
    await f.ask({ objects: ['vendor', 'item'] });
    const second = await f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID());
    claimed = await f.claim();
    const connection = (await f.app.connections(f.buyer, f.tenantId)).connections[0];
    await f.app.disconnect(f.buyer, connectionId, { expectedVersion: connection.version }, randomUUID());
    await assert.rejects(f.app.readAccess(f.principal, f.taskId, { leaseToken: claimed.leaseToken, grantId: second.grantId, object: 'item' }), { code: 'GRANT_REQUIRED' });
    assert.equal((await f.repository.read(r => r.get('connection', connectionId))).secret, null, 'disconnecting deletes the sealed credential');
  });
}

test('a declined or unanswered request lets the agent end as blocked by the buyer, outside its track record', async t => {
  const f = await setup(t);
  await f.connect();
  await f.claim();
  await assert.rejects(f.app.endBlocked(f.principal, f.taskId, { note: 'No access.' }, randomUUID()), { code: 'BLOCK_NOT_ALLOWED' });
  await f.ask();
  await assert.rejects(f.app.endBlocked(f.principal, f.taskId, { note: 'Waiting too long.' }, randomUUID()), { code: 'BLOCK_NOT_ALLOWED' }, 'a fresh request must be given time');
  await f.app.declineAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId() }, randomUUID());
  await f.app.endBlocked(f.principal, f.taskId, { note: 'Vendor records are needed to find duplicates; access was declined.' }, randomUUID());
  const task = await f.repository.read(r => r.get('task', f.taskId));
  assert.equal(task.assignment.status, 'cancelled');
  assert.equal(task.assignment.endReason, 'buyer_prerequisite');
  const { taskOutcome } = require('../src/outcome-ledger.cjs');
  assert.equal(taskOutcome(task).outcome, 'cancelled', 'not a failure on the agent’s record');
  assert.ok((await f.app.notifications(f.buyer)).items.some(n => n.title === 'Work stopped: the agent couldn’t get the access it needs'));
});

test('a request left unanswered for 72 hours of waiting also allows ending as blocked', async t => {
  const f = await setup(t);
  await f.claim(); await f.ask();
  f.advance(72 * 3600000 + 1);
  await f.app.endBlocked(f.principal, f.taskId, { note: 'No reply to the access request after three days.' }, randomUUID());
  assert.equal((await f.repository.read(r => r.get('task', f.taskId))).assignment.endReason, 'buyer_prerequisite');
});

test('only workspace owners grant access, and only to a system of the requested kind', async t => {
  const f = await setup(t);
  const { connectionId } = await f.connect({ environment: 'production', label: 'Production (sample)' });
  await f.claim(); await f.ask();
  await assert.rejects(f.app.approveAccess(f.buyer, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID()), { code: 'CONNECTION_MISMATCH' }, 'a sandbox request can’t be answered with production');
  await assert.rejects(f.app.approveAccess(f.employee, f.taskId, { expectedVersion: await f.version(f.taskId), requestId: await f.requestId(), connectionId, days: 7 }, randomUUID()), { code: /NOT_FOUND|FORBIDDEN/ });
  await assert.rejects(f.ask({ objects: ['payroll'] }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.ask({ days: 90 }), { code: 'INVALID_INPUT' });
});
