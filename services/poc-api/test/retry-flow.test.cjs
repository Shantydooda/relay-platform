'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Real localhost server and supplier SDK. After a failed run the buyer can try
// another agent once: a fresh request the failed agent cannot quote on, while the
// failure stays on record and nothing about money changes.
test('after a failed run the buyer can try another agent, once, and the failed agent cannot quote', async () => {
  const f = await recommendationFlow(4198);
  try {
    const taskId = await f.postTask();
    await f.bid(taskId);
    const path = `/api/tasks/${taskId}`;
    const offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
    const chosen = offers.find(offer => offer.recommendation.recommended);
    const failing = f.builders.find(item => item.agentId === chosen.agentId);
    const other = f.builders.find(item => item.agentId !== chosen.agentId);
    assert.equal((await f.request(`${path}/select`, f.buyer, { expectedVersion: 2, offerId: chosen.id })).status, 200);
    let detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.retry, null, 'nothing to retry before a failure');
    assert.equal((await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' })).status, 200);
    await failing.heartbeat();
    const assignmentId = (await failing.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
    const claimed = await failing.client.claim(taskId, { assignmentId }, randomUUID());
    await failing.client.fail(taskId, { leaseToken: claimed.leaseToken, code: 'AGENT_ERROR' }, randomUUID());

    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.execution.status, 'failed');
    assert.deepEqual(detail.retry, { available: true });
    const tenantId = detail.task.tenantId;
    const body = { tenantId, title: detail.task.title, brief: detail.task.brief, retryFromTaskId: taskId, expectedSourceVersion: detail.task.version };

    // Only the task's own workspace members can retry, and not combined with a direct request.
    assert.equal((await f.request('/api/tasks', failing.operator, { ...body, tenantId: failing.operator.actor.memberships[0].id })).status, 404);
    assert.equal((await f.request('/api/tasks', f.buyer, { ...body, preferredAgentId: other.agentId, preferenceMode: 'agent' })).status, 400);
    assert.equal((await f.request('/api/tasks', f.buyer, { ...body, expectedSourceVersion: detail.task.version - 1 })).status, 409);

    const key = randomUUID();
    const created = await f.request('/api/tasks', f.buyer, body, 'POST', key);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(await f.request('/api/tasks', f.buyer, body, 'POST', key), created, 'a retried request with the same key is idempotent');
    const retryId = created.body.taskId;

    // The original keeps its failure for the ledger and points to the new attempt; a second retry is refused.
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.execution.status, 'failed');
    assert.deepEqual(detail.retry, { available: false, retriedBy: retryId });
    assert.ok(detail.events.some(event => event.type === 'task.retried'));
    assert.equal(detail.payment?.status ?? null, null, 'no payment was created or moved');
    const again = await f.request('/api/tasks', f.buyer, { ...body, expectedSourceVersion: detail.task.version });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'RETRY_UNAVAILABLE');

    assert.equal((await f.request(`/api/tasks/${retryId}/post`, f.buyer, { expectedVersion: 1 })).status, 200);
    await failing.heartbeat();
    await other.heartbeat();
    const feed = async builder => (await builder.client.opportunities()).tasks.map(task => task.id);
    assert.equal((await feed(failing)).includes(retryId), false, 'the failed agent does not see the new request');
    assert.equal((await feed(other)).includes(retryId), true);
    const quote = { capabilityId: failing.capabilityId, expectedVersion: 2, amountMinor: 500, deliveryMinutes: 10, proposal: 'Normalize the supplied CSV and deliver a cleaned CSV plus validation report.' };
    await assert.rejects(failing.client.quote(retryId, { ...quote, agentId: failing.agentId }, randomUUID()),
      error => /AGENT_EXCLUDED/.test(`${error.code} ${error.message}`));
    const offer = await other.client.quote(retryId, { ...quote, agentId: other.agentId, capabilityId: other.capabilityId }, randomUUID());
    assert.ok(offer.id || offer.offerId, JSON.stringify(offer));
  } finally {
    await f.close();
  }
});
