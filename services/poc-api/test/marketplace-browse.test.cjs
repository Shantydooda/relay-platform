'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// The browse-first marketplace over a real localhost server and supplier SDK:
// rows come from real listings and finished work, and agent and task pages have
// real links that load the app.

test('the marketplace lists real agents with the evidence Relay recorded, and pages have real links', async () => {
  const f = await recommendationFlow(4203);
  try {
    const anonymous = await fetch(`${f.origin}/api/marketplace`, { headers: { Origin: f.origin } });
    assert.equal(anonymous.status, 401);

    let market = (await f.request('/api/marketplace', f.buyer)).body;
    assert.equal(market.agents.length, 2);
    for (const row of market.agents) {
      assert.equal(row.relayTest.passed, true);
      assert.equal(row.isNew, true);
      assert.deepEqual(row.waysToBuy, ['commission']);
      assert.equal(row.fromPrice, null);
      assert.deepEqual(row.packages, []);
      assert.equal(row.evidence.runs, 0);
      assert.equal(row.version, '1');
    }
    assert.deepEqual(market.connectors, ['CSV upload'], 'only CSV input works in this test environment');

    // One accepted run moves that agent to the top of "most verified runs".
    const taskId = await f.postTask();
    const path = `/api/tasks/${taskId}`;
    await f.bid(taskId);
    const offer = (await f.request(`${path}/offers`, f.buyer)).body.offers.find(item => item.recommendation.recommended);
    const builder = f.builders.find(item => item.agentId === offer.agentId);
    let detail = (await f.request(path, f.buyer)).body;
    assert.equal((await f.request(`${path}/select`, f.buyer, { expectedVersion: detail.task.version, offerId: offer.id })).status, 200);
    detail = (await f.request(path, f.buyer)).body;
    assert.equal((await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' })).status, 200);
    await builder.heartbeat();
    const assignmentId = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
    const claimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
    const submitted = await builder.client.submit(taskId, { leaseToken: claimed.leaseToken, evidence: 'Done.',
      files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from('email\na@example.test\n').toString('base64') }] }, randomUUID());
    detail = (await f.request(path, f.buyer)).body;
    assert.equal((await f.request(`${path}/accept-delivery`, f.buyer, { expectedVersion: detail.task.version, submissionId: submitted.submissionId })).status, 200);

    market = (await f.request('/api/marketplace', f.buyer)).body;
    const [top, other] = market.agents;
    assert.equal(top.id, builder.agentId);
    assert.equal(top.evidence.runs, 1);
    assert.equal(top.evidence.accepted_first_time, 1);
    assert.equal(top.evidence.acceptedRate, null, 'no rate below 20 decided runs');
    assert.deepEqual(top.buyers, { total: 1, repeat: 0 });
    assert.equal(top.isNew, false);
    assert.equal(other.isNew, true);
    const byPrice = await f.request('/api/marketplace?sort=price', f.buyer);
    assert.equal(byPrice.status, 200, 'packages give prices to sort by');
    assert.ok(byPrice.body.agents.every(row => row.fromPrice === null), 'no packages here, so every agent is quoted per request');
    assert.equal((await f.request('/api/marketplace?sort=cheapest', f.buyer)).status, 400);
    assert.equal((await f.request('/api/marketplace?sort=newest', f.buyer)).status, 200);

    // A builder sees their own listing marked as theirs.
    const own = (await f.request('/api/marketplace', builder.operator)).body.agents.find(item => item.id === builder.agentId);
    assert.equal(own.own, true);

    // The agent page carries the same row next to its versioned track record.
    const page = (await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent;
    assert.equal(page.market.evidence.runs, 1);
    assert.equal(page.trackRecord.versions[0].runtimeVersion, '1');
    assert.ok(page.trackRecord.versions[0].lastRunAt > 0);

    // Real links load the app; anything else under those paths is not found.
    for (const link of [`/agents/${builder.agentId}`, `/tasks/${taskId}`, '/post', '/evidence']) {
      const response = await fetch(f.origin + link);
      assert.equal(response.status, 200, link);
      assert.match(await response.text(), /marketplace-ui\.js/);
    }
    assert.equal((await fetch(`${f.origin}/agents/not-an-id`)).status, 404);
    assert.equal((await fetch(`${f.origin}/docs/not-a-guide`)).status, 404);
    assert.equal((await fetch(`${f.origin}/marketplace-ui.css`)).status, 200);
  } finally {
    await f.close();
  }
});
