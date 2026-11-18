'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Real localhost server and supplier SDK. Packages ("Hire it",
// docs/specs/Marketplace-Model.md): a builder's standing offer for one qualified
// capability, with a fixed price, delivery time and checklist.

const PACKAGE = {
  title: 'Clean one CSV', included: 'Exact duplicate rows removed, rows sorted, a validation report.',
  priceMinor: 2500, deliveryMinutes: 30, criteria: ['No duplicate rows remain', 'The header row is kept'], inputs: ['csv'], extraRounds: 1,
};

async function ownAgent(f, builder) {
  return (await f.request('/api/agents', builder.operator)).body.agents.find(item => item.id === builder.agentId);
}

test('builders define, version and publish packages for qualified capabilities only', async () => {
  const f = await recommendationFlow(4211);
  try {
    const [builder, other] = f.builders;
    const path = `/api/agents/${builder.agentId}/packages`;
    let agent = await ownAgent(f, builder);
    const body = { expectedVersion: agent.version, capabilityId: builder.capabilityId, ...PACKAGE };

    // Only the owner can add one, and only for a capability that passed its Relay test.
    assert.equal((await f.request(path, other.operator, body)).status, 404);
    const unqualified = await f.request('/api/agents', builder.operator, {
      name: 'QA untested agent', kind: 'specialist', integration: 'api', purpose: 'Enrich company records', domain: 'B2B data',
      capabilities: [{ category: 'Data', task: 'Enrich company records', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
    });
    assert.equal(unqualified.status, 201, JSON.stringify(unqualified.body));
    const untested = (await f.request('/api/agents', builder.operator)).body.agents.find(item => item.id === unqualified.body.agentId);
    let response = await f.request(`/api/agents/${untested.id}/packages`, builder.operator,
      { ...body, expectedVersion: untested.version, capabilityId: untested.capabilities[0].id });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'CAPABILITY_NOT_QUALIFIED');
    assert.equal((await f.request(path, builder.operator, { ...body, expectedVersion: agent.version - 1 })).status, 409, 'stale tab');

    const key = randomUUID();
    response = await f.request(path, builder.operator, body, 'POST', key);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.deepEqual(await f.request(path, builder.operator, body, 'POST', key), response, 'replay is idempotent');
    const { packageId } = response.body;
    assert.equal(response.body.version, 1);
    assert.equal(response.body.status, 'draft', 'a new package starts as a draft');

    // Drafts are private to the builder.
    agent = await ownAgent(f, builder);
    assert.equal(agent.packages.length, 1);
    assert.deepEqual(agent.packages[0].criteria.map(item => item.text), PACKAGE.criteria);
    let listing = (await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent;
    assert.deepEqual(listing.packages, []);

    response = await f.request(`${path}/${packageId}`, builder.operator, { expectedVersion: agent.version, status: 'published' }, 'PATCH');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    listing = (await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent;
    assert.equal(listing.packages.length, 1);
    assert.equal(listing.packages[0].priceMinor, 2500);
    assert.equal(listing.packages[0].currency, 'USD');
    assert.equal(listing.packages[0].version, 1);

    // Editing a published package makes a new version and keeps it published.
    agent = await ownAgent(f, builder);
    response = await f.request(`${path}/${packageId}`, builder.operator,
      { ...body, expectedVersion: agent.version, priceMinor: 3000 }, 'PUT');
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.version, 2);
    listing = (await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent;
    assert.equal(listing.packages[0].priceMinor, 3000);
    assert.equal(listing.packages[0].version, 2);
    assert.equal(listing.packages[0].status, 'published');

    // Pausing hides it again; another builder can't touch it.
    agent = await ownAgent(f, builder);
    assert.equal((await f.request(`${path}/${packageId}`, other.operator, { expectedVersion: agent.version, status: 'paused' }, 'PATCH')).status, 404);
    response = await f.request(`${path}/${packageId}`, builder.operator, { expectedVersion: agent.version, status: 'paused' }, 'PATCH');
    assert.equal(response.status, 200);
    assert.deepEqual((await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent.packages, []);
  } finally {
    await f.close();
  }
});
