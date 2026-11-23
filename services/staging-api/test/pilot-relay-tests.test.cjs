'use strict';
// Build-Order "v1 step 1": on the hosted pilot a builder can connect their own
// runtime, pass a Relay test, publish, and be seen by buyers, exactly as locally.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { createUnifiedManagedStore } = require('../src/unified-managed.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
const { createSupplierClient } = require('../../../packages/supplier-sdk/src/index.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');
const http = require('node:http');

const ORIGIN = 'https://relay-pilot-test.onrender.com';

async function pilot(t, applicationOptions = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const users = {};
  for (const role of ['builder', 'buyer', 'staff']) users[role] = { id: randomUUID(), email: `${role}@pilot.test`, email_confirmed_at: new Date().toISOString() };
  const sessions = new Map();
  const provider = {
    limit: async () => {}, eligibleEmail: async () => true,
    signIn: async email => ({ data: { session: { access_token: email, expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
    identity: async access => ({ data: { user: Object.values(users).find(u => u.email === access) } }),
    bootstrap: async () => {}, profile: async () => ({ name: 'Pilot member', workspace: 'buyer' }),
    memberships: async () => assert.fail('must use authoritative ledger'),
    saveSession: async row => sessions.set(row.token_hash, { ...row }), session: async hash => sessions.get(hash),
    deleteSession: async hash => sessions.delete(hash), touchSession: async () => {},
  };
  const composition = createUnifiedManagedStore({ provider, sessionKey: randomBytes(32), repository,
    applicationOptions: { localExecution: false, pilotConnections: true, relayTestReviewerIds: [users.staff.id], ...applicationOptions } });
  const actors = {};
  for (const role of Object.keys(users)) {
    await composition.access.apply({ userId: users[role].id, revision: 1, expiresAt: Date.now() + 300000, memberships: [{ id: randomUUID(), role: 'owner', company: false, accessEpoch: 1 }] });
    actors[role] = await composition.store.principal(await composition.store.login({ email: users[role].email, password: 'fixture' }, 'local'));
  }
  const server = createApp({ origin: ORIGIN, mode: 'managed-pilot', store: composition.store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  // The runtime talks to the pilot's public address; the request reaches this test server.
  const port = server.address().port;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ host: '127.0.0.1', port, path: target.pathname + target.search, method: init.method,
      headers: { ...init.headers, Host: target.host } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); if (init.body) req.write(init.body); req.end();
  });
  return { store: composition.store, actors, client: token => createSupplierClient({ origin: ORIGIN, token, fetchImpl }) };
}

// The whole builder path: agent, own runtime key, Relay test passed, published.
async function listedAgent({ store, actors, client: supplier }) {
  const { builder } = actors;
  const { agentId } = await store.marketplace.addAgent(builder, {
    name: 'Pilot CSV cleaner', kind: 'specialist', integration: 'api', purpose: 'Normalize supplied CSV files', domain: 'CSV data processing',
    capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
  }, randomUUID());
  const agent = async () => (await store.marketplace.agents(builder)).find(item => item.id === agentId);
  await store.marketplace.configure(builder, agentId, { expectedVersion: (await agent()).version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const credential = await store.issueSupplierCredential(builder, agentId, { expectedVersion: (await agent()).version, expiresInSeconds: 3600 }, randomUUID());
  const client = supplier(credential.token);
  await client.heartbeat({ runtimeName: 'Builder-hosted runtime', runtimeVersion: '1' });

  const capabilityId = (await agent()).capabilities[0].id;
  const assessment = await store.startQualification(builder, agentId, { expectedVersion: (await agent()).version, capabilityId, rubric: 'csv-normalize-v1' }, randomUUID());
  for (const round of [1, 2]) {
    const job = (await client.qualifications()).jobs[0];
    assert.equal(job.round, round);
    const output = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
    const result = await client.submitQualification(assessment.assessmentId, { round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } }, randomUUID());
    assert.equal(result.status, round === 1 ? 'revision_pending' : 'passed');
  }
  await store.marketplace.updateListing(builder, agentId, { expectedVersion: (await agent()).version, status: 'published' }, randomUUID());
  return { agentId, capabilityId, client };
}

test('pilot: a builder connects a runtime, passes a Relay test, publishes and appears in browse', async t => {
  const f = await pilot(t);
  const { agentId } = await listedAgent(f);
  const browse = await f.store.marketplace.browse(f.actors.buyer, { sort: 'runs' });
  assert.ok((browse.agents || browse).some(row => row.id === agentId), 'buyers see the published agent');
});

test('pilot with unpaid runs on: a real request runs on the builder’s runtime, with a revision, and is accepted', async t => {
  const f = await pilot(t, { pilotUnpaidExecution: true });
  const { store, actors: { buyer } } = f;
  const { agentId, capabilityId, client } = await listedAgent(f);
  const version = async taskId => (await store.detail(buyer, taskId)).task.version;
  const { taskId } = await store.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Normalize CSV data', brief: 'Normalize CSV data: dedupe a supplier list.' }, randomUUID());
  await store.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
  const offer = await client.quote(taskId, { agentId, capabilityId, expectedVersion: await version(taskId), amountMinor: 100, deliveryMinutes: 10, proposal: 'Pilot run; payments are off, so nothing is charged.' }, randomUUID());
  await store.marketplace.accept(buyer, taskId, { expectedVersion: await version(taskId), offerId: offer.offerId }, randomUUID());
  await store.authorizeLocal(buyer, taskId, { expectedVersion: await version(taskId), mode: 'local-unpaid' }, randomUUID());

  const deliver = async csv => {
    const [assignment] = (await client.assignments()).assignments;
    const claimed = await client.claim(taskId, { assignmentId: assignment.assignmentId }, randomUUID());
    return client.submit(taskId, { leaseToken: claimed.leaseToken, evidence: 'Deduplicated.',
      files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from(csv).toString('base64') }] }, randomUUID());
  };
  const first = await deliver('name\nAcme\nAcme\n');
  await store.reviewDelivery(buyer, taskId, 'request-revision', { expectedVersion: await version(taskId), submissionId: first.submissionId, notes: 'Remove the duplicate Acme row.' }, randomUUID());
  const second = await deliver('name\nAcme\n');
  await store.reviewDelivery(buyer, taskId, 'accept-delivery', { expectedVersion: await version(taskId), submissionId: second.submissionId }, randomUUID());
  const detail = await store.detail(buyer, taskId);
  assert.equal(detail.execution.status, 'accepted');
  assert.equal(detail.execution.paymentStatus, 'not_applicable_local_unpaid', 'no money moves');
});

test('pilot: builders see Relay’s own tests, and the staff named in its settings can review proposals', async t => {
  const { store, actors } = await pilot(t);
  const { builder, staff } = actors;
  await store.marketplace.addAgent(builder, {
    name: 'Pilot lead agent', kind: 'specialist', integration: 'api', purpose: 'Build lead lists', domain: 'Lead lists',
    capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
  }, randomUUID());
  const listed = await store.relayTests(builder);
  assert.ok(listed.approved.some(item => item.builtIn), 'Relay’s own tests are available on the pilot');
  assert.equal(listed.canReview, false);
  assert.equal((await store.relayTests(staff)).canReview, true, 'staff are configured on the pilot');
});

test('pilot: in-app notifications are on, so a builder hears about a request that fits their agent', async t => {
  const { store, actors } = await pilot(t);
  const { builder, buyer } = actors;
  assert.equal(store.features.notifications, true);
  await store.marketplace.addAgent(builder, {
    name: 'Pilot CSV cleaner', kind: 'specialist', integration: 'api', purpose: 'Normalize supplied CSV files', domain: 'CSV data processing',
    capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
  }, randomUUID());
  const { taskId } = await store.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Normalize CSV data', brief: 'Normalize CSV data: dedupe and sort a supplier list.' }, randomUUID());
  await store.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
  const { items } = await store.notifications(builder);
  assert.ok(items.some(item => item.taskId === taskId && /fits Pilot CSV cleaner/.test(item.title)), JSON.stringify(items));
});
