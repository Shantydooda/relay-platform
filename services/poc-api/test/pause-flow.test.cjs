'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Real localhost server, real supplier SDK transport. A buyer pause must stop the
// runtime (lease revoked, claims refused) and a resume must let it continue.
test('a buyer can pause running work, the runtime is fenced, and resume lets it continue', async () => {
  const f = await recommendationFlow(4197);
  try {
    const taskId = await f.postTask();
    await f.bid(taskId);
    const path = `/api/tasks/${taskId}`;
    const offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
    const chosen = offers.find(offer => offer.recommendation.recommended);
    const builder = f.builders.find(item => item.agentId === chosen.agentId);
    let response = await f.request(`${path}/select`, f.buyer, { expectedVersion: 2, offerId: chosen.id });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    let detail = (await f.request(path, f.buyer)).body;
    response = await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    await builder.heartbeat();

    const assignmentId = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
    const claimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
    assert.ok(claimed.leaseToken, 'the runtime holds a lease');
    await builder.client.progress(taskId, { leaseToken: claimed.leaseToken, message: 'Working' }, randomUUID());
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.execution.status, 'running');
    assert.equal(detail.actions.execution.pause.allowed, true);
    assert.equal(detail.actions.execution.resume.allowed, false);

    const pauseKey = randomUUID();
    response = await f.request(`${path}/pause-execution`, f.buyer, { expectedVersion: detail.task.version }, 'POST', pauseKey);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.pausedByBuyer, true);
    assert.deepEqual(await f.request(`${path}/pause-execution`, f.buyer, { expectedVersion: detail.task.version }, 'POST', pauseKey), response,
      'a retried pause with the same key returns the same result');

    // The builder's old lease is revoked and new claims are refused while paused.
    // Before the pause the lease works; after it, the same lease is refused.
    await assert.rejects(
      builder.client.progress(taskId, { leaseToken: claimed.leaseToken, message: 'Still working' }, randomUUID()),
      error => /LEASE_EXPIRED/.test(`${error.code} ${error.message}`));
    const feed = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId);
    assert.equal(feed.pausedByBuyer, true);
    assert.equal(feed.status, 'queued');
    await assert.rejects(builder.client.claim(taskId, { assignmentId }, randomUUID()), error => /PAUSED_BY_BUYER/.test(`${error.code} ${error.message}`));

    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.task.pausedByBuyer, true);
    assert.equal(detail.execution.pausedByBuyer, true);
    assert.equal(detail.actions.execution.pause.allowed, false);
    assert.equal(detail.actions.execution.resume.allowed, true);
    assert.ok(detail.events.some(event => event.type === 'execution.paused'));

    // Only the task's buyer can pause or resume.
    response = await f.request(`${path}/resume-execution`, builder.operator, { expectedVersion: detail.task.version });
    assert.notEqual(response.status, 200);

    response = await f.request(`${path}/resume-execution`, f.buyer, { expectedVersion: detail.task.version });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.pausedByBuyer, false);
    await builder.heartbeat();
    const reclaimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
    // The buyer's activity log records the pause and resume as theirs; the builder cannot read it.
    const log = (await f.request('/api/activity', f.buyer)).body.items.filter(item => item.taskId === taskId);
    assert.deepEqual(log.slice(0, 3).map(item => [item.label, item.actor]),
      [['Agent started work', 'agent'], ['Work resumed', 'you'], ['Work paused', 'you']]);
    const builderLog = (await f.request('/api/activity', builder.operator)).body.items;
    assert.equal(builderLog.some(item => item.taskId === taskId), false);
    assert.ok(reclaimed.leaseToken, 'work can be claimed again after resume');
    assert.notEqual(reclaimed.leaseToken, claimed.leaseToken);
  } finally {
    await f.close();
  }
});
