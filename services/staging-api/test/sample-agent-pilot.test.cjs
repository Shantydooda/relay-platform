'use strict';
// The first-builder kit: the sample agent a builder downloads with the SDK
// takes the whole path on the hosted pilot by itself: it passes the Relay
// test, quotes on a fitting request, delivers, handles a revision and is
// accepted. Nothing here calls the store on the agent's behalf.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { pilot } = require('./helpers/pilot-fixture.cjs');
const { createSampleAgent } = require('../../../packages/supplier-sdk/examples/sample-agent/run.cjs');
const myAgent = require('../../../packages/supplier-sdk/examples/sample-agent/my-agent.cjs');

async function builderAgent({ store, actors: { builder } }) {
  const { agentId } = await store.marketplace.addAgent(builder, {
    name: 'Sample CSV cleaner', kind: 'specialist', integration: 'api', purpose: 'Clean supplied CSV files', domain: 'CSV data processing',
    capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
  }, randomUUID());
  const agent = async () => (await store.marketplace.agents(builder)).find(item => item.id === agentId);
  await store.marketplace.configure(builder, agentId, { expectedVersion: (await agent()).version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const { token } = await store.issueSupplierCredential(builder, agentId, { expectedVersion: (await agent()).version, expiresInSeconds: 3600 }, randomUUID());
  return { agentId, agent, token };
}

test('sample agent: passes the Relay test, quotes, delivers, revises and is accepted on the pilot', async t => {
  const f = await pilot(t, { pilotUnpaidExecution: true });
  const { store, actors: { builder, buyer } } = f;
  const { agentId, agent, token } = await builderAgent(f);
  const events = [];
  const runner = createSampleAgent({ origin: f.origin, token, expectedAgentId: agentId, agent: myAgent, fetchImpl: f.fetchImpl, log: event => events.push(event) });

  // The builder starts the agent, then a Relay test from the agent's page:
  // two rounds, the second with a revision. The agent answers both.
  await runner.tick();
  await store.startQualification(builder, agentId, { expectedVersion: (await agent()).version, capabilityId: (await agent()).capabilities[0].id, rubric: 'csv-normalize-v1' }, randomUUID());
  await runner.tick();
  await runner.tick();
  assert.equal((await agent()).capabilities[0].qualification, 'qualified', events.join('\n'));
  await store.marketplace.updateListing(builder, agentId, { expectedVersion: (await agent()).version, status: 'published' }, randomUUID());

  // A buyer posts a CSV request; the agent quotes on it by itself.
  const { taskId } = await store.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Clean supplier list', brief: 'Remove duplicate rows from this supplier list and sort it.' }, randomUUID());
  await store.addInput(buyer, taskId, { expectedVersion: 1, filename: 'suppliers.csv', notes: 'Our supplier export.', base64: Buffer.from('name,region\nZeta,UK\nAcme,US\nAcme,US\n').toString('base64') }, randomUUID());
  await store.mutateTask(buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  await runner.tick();
  await runner.tick();
  const offers = await store.marketplace.offers(buyer, taskId);
  assert.equal(offers.length, 1, 'quotes once, not on every poll');
  assert.equal(offers[0].amountMinor, 100);

  const version = async () => (await store.detail(buyer, taskId)).task.version;
  await store.marketplace.accept(buyer, taskId, { expectedVersion: await version(), offerId: offers[0].id }, randomUUID());
  await store.authorizeLocal(buyer, taskId, { expectedVersion: await version(), mode: 'local-unpaid' }, randomUUID());

  const delivered = async round => {
    await runner.tick();
    const detail = await store.detail(buyer, taskId);
    assert.equal(detail.task.status, 'buyer_review', events.join('\n'));
    assert.equal(detail.submissions.length, round);
    return detail.submissions.at(-1);
  };
  const contents = async submission => {
    const file = submission.files.find(item => item.filename === 'cleaned.csv');
    return (await store.download(buyer, taskId, submission.id, file.id)).bytes.toString();
  };
  const first = await delivered(1);
  assert.equal(await contents(first), 'name,region\r\nAcme,US\r\nZeta,UK\r\n');

  await store.reviewDelivery(buyer, taskId, 'request-revision', { expectedVersion: await version(), submissionId: first.id, notes: 'Please sort rows descending.' }, randomUUID());
  const second = await delivered(2);
  assert.equal(await contents(second), 'name,region\r\nZeta,UK\r\nAcme,US\r\n');

  await store.reviewDelivery(buyer, taskId, 'accept-delivery', { expectedVersion: await version(), submissionId: second.id }, randomUUID());
  const done = await store.detail(buyer, taskId);
  assert.equal(done.execution.status, 'accepted');
  assert.equal(done.execution.paymentStatus, 'not_applicable_local_unpaid');
  assert.ok(!events.some(event => event.includes(token)), 'the key never reaches the log');
});

test('sample agent: stops when the key belongs to a different agent', async t => {
  const f = await pilot(t);
  const { token } = await builderAgent(f);
  const runner = createSampleAgent({ origin: f.origin, token, expectedAgentId: randomUUID(), agent: myAgent, fetchImpl: f.fetchImpl, log: () => {} });
  await assert.rejects(runner.tick(), { code: 'AGENT_MISMATCH' });
});

test('sample agent: a request without a CSV is skipped, and an unreadable CSV fails honestly', async t => {
  const f = await pilot(t, { pilotUnpaidExecution: true });
  const { store, actors: { buyer } } = f;
  const { agentId, token } = await builderAgent(f);
  const runner = createSampleAgent({ origin: f.origin, token, expectedAgentId: agentId, agent: myAgent, fetchImpl: f.fetchImpl, log: () => {} });
  const { taskId: plain } = await store.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Write a memo', brief: 'Write a memo about our suppliers.' }, randomUUID());
  await store.mutateTask(buyer, plain, 'post', { expectedVersion: 1 }, randomUUID());

  const { taskId: bad } = await store.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Clean list', brief: 'Clean this list.' }, randomUUID());
  await store.addInput(buyer, bad, { expectedVersion: 1, filename: 'bad.csv', notes: 'Broken export.', base64: Buffer.from('a,b\nonly-one\n').toString('base64') }, randomUUID());
  await store.mutateTask(buyer, bad, 'post', { expectedVersion: 2 }, randomUUID());
  await runner.tick();
  assert.equal((await store.marketplace.offers(buyer, plain)).length, 0);
  const [offer] = await store.marketplace.offers(buyer, bad);
  const version = async () => (await store.detail(buyer, bad)).task.version;
  await store.marketplace.accept(buyer, bad, { expectedVersion: await version(), offerId: offer.id }, randomUUID());
  await store.authorizeLocal(buyer, bad, { expectedVersion: await version(), mode: 'local-unpaid' }, randomUUID());
  await runner.tick();
  const detail = await store.detail(buyer, bad);
  assert.equal(detail.task.status, 'failed');
  assert.equal(detail.execution.error, 'INPUT_UNSUPPORTED');
  assert.equal(detail.submissions.length, 0);
});
