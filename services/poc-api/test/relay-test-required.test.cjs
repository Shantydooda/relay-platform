'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Founder decision, 18 Nov 2026 (docs/specs/Marketplace-Model.md, "One marketplace
// for buyers and builders" §2): an agent is published, appears in browse and
// sells packages only for a capability that currently passes its Relay test. Only two
// Relay tests exist yet, so any agent may still quote on a posted request; the offer
// says whether the capability has passed one.

async function untestedAgent(f, builder) {
  const created = await f.request('/api/agents', builder.operator, {
    name: 'QA untested agent', kind: 'specialist', integration: 'api', purpose: 'Normalize CSV data without a Relay test', domain: 'CSV data processing',
    capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: { industries: [], regions: [], outputs: ['CSV'], tools: [] } }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return (await f.request('/api/agents', builder.operator)).body.agents.find(item => item.id === created.body.agentId);
}

test('an untested agent can’t be published or listed in browse, but can quote with its test status shown', async () => {
  const f = await recommendationFlow(4214);
  try {
    const [builder] = f.builders;
    const agent = await untestedAgent(f, builder);

    let response = await f.request(`/api/agents/${agent.id}/listing`, builder.operator, { expectedVersion: agent.version, status: 'published' }, 'PATCH');
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'RELAY_TEST_REQUIRED');
    assert.equal((await f.request(`/api/agents/${agent.id}/listing`, builder.operator, { expectedVersion: agent.version, status: 'paused' }, 'PATCH')).status, 200,
      'unpublishing never needs a test');

    const browse = (await f.request('/api/marketplace', f.buyer)).body.agents;
    assert.ok(!browse.some(row => row.id === agent.id), 'untested agents are not listed');
    assert.ok(browse.some(row => row.id === builder.agentId), 'tested agents are listed');

    const taskId = await f.postTask();
    const detail = (await f.request(`/api/tasks/${taskId}`, f.buyer)).body;
    response = await f.request(`/api/tasks/${taskId}/offers`, builder.operator, {
      agentId: agent.id, capabilityId: agent.capabilities[0].id, expectedVersion: detail.task.version,
      amountMinor: 500, deliveryMinutes: 10, proposal: 'Untested offer.',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));

    response = await f.request(`/api/tasks/${taskId}/offers`, builder.operator, {
      agentId: builder.agentId, capabilityId: builder.capabilityId, expectedVersion: detail.task.version,
      amountMinor: 500, deliveryMinutes: 10, proposal: 'Tested offer.',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const offers = (await f.request(`/api/tasks/${taskId}/offers`, f.buyer)).body.offers;
    assert.equal(offers.find(offer => offer.agentId === agent.id).qualification, 'unverified', 'the buyer sees there is no Relay test');
    assert.equal(offers.find(offer => offer.agentId === builder.agentId).qualification, 'qualified');
  } finally {
    await f.close();
  }
});
