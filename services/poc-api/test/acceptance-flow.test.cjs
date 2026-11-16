'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Real localhost server and supplier SDK. Acceptance policy (docs/Decisions-Needed.md §2):
// criteria are part of the scope, fixes are free until they are met, the buyer can end
// the work as unmet after two rounds of changes, and silence counts as acceptance only
// when a deployment opts in.

const CRITERIA = ['Every duplicate row is removed', 'Rows are sorted by email', 'The report lists the rows removed'];

async function hire(f, taskId) {
  const path = `/api/tasks/${taskId}`;
  const offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
  const chosen = offers.find(offer => offer.recommendation.recommended);
  assert.ok(chosen, 'a current offer is recommended');
  const builder = f.builders.find(item => item.agentId === chosen.agentId);
  let detail = (await f.request(path, f.buyer)).body;
  let response = await f.request(`${path}/select`, f.buyer, { expectedVersion: detail.task.version, offerId: chosen.id });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  detail = (await f.request(path, f.buyer)).body;
  response = await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return builder;
}

async function deliver(builder, taskId, round) {
  await builder.heartbeat();
  const assignmentId = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
  const claimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
  const csv = `email\nround${round}@example.test\n`;
  const submitted = await builder.client.submit(taskId, {
    leaseToken: claimed.leaseToken, evidence: `Round ${round} output.`,
    files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from(csv).toString('base64') }]
  }, randomUUID());
  return { claimed, submissionId: submitted.submissionId };
}

test('criteria are part of the scope, fixes name unmet criteria, and the buyer can end as unmet after two rounds', async () => {
  const f = await recommendationFlow(4201);
  try {
    const taskId = await f.postTask();
    const path = `/api/tasks/${taskId}`;
    await f.bid(taskId);
    let detail = (await f.request(path, f.buyer)).body;
    assert.deepEqual(detail.task.acceptanceCriteria, []);
    const oldOffer = (await f.request(`${path}/offers`, f.buyer)).body.offers.find(offer => offer.recommendation.recommended);

    // Validation and stale-tab protection.
    let response = await f.request(`${path}/acceptance-criteria`, f.buyer, { expectedVersion: detail.task.version - 1, criteria: CRITERIA }, 'PUT');
    assert.equal(response.status, 409, JSON.stringify(response.body));
    response = await f.request(`${path}/acceptance-criteria`, f.buyer, { expectedVersion: detail.task.version, criteria: Array.from({ length: 13 }, (_, i) => `Criterion number ${i}`) }, 'PUT');
    assert.equal(response.status, 400);
    response = await f.request(`${path}/acceptance-criteria`, f.buyer, { expectedVersion: detail.task.version, criteria: ['Same thing', 'same thing'] }, 'PUT');
    assert.equal(response.status, 400);
    // Only the buyer's workspace can change it; another tenant cannot see the task.
    response = await f.request(`${path}/acceptance-criteria`, f.builders[0].operator, { expectedVersion: detail.task.version, criteria: CRITERIA }, 'PUT');
    assert.equal(response.status, 404);

    const criteriaKey = randomUUID();
    const body = { expectedVersion: detail.task.version, criteria: CRITERIA };
    response = await f.request(`${path}/acceptance-criteria`, f.buyer, body, 'PUT', criteriaKey);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.deepEqual(response.body.acceptanceCriteria.map(item => item.id), ['c1', 'c2', 'c3']);
    assert.equal(response.body.scopeVersion, detail.task.scopeVersion + 1, 'a criteria change is a scope change');
    assert.deepEqual(await f.request(`${path}/acceptance-criteria`, f.buyer, body, 'PUT', criteriaKey), response, 'replay is idempotent');

    // Offers made for the old scope are invalidated.
    detail = (await f.request(path, f.buyer)).body;
    assert.deepEqual(detail.task.acceptanceCriteria.map(item => item.text), CRITERIA);
    assert.ok((await f.request(`${path}/offers`, f.buyer)).body.offers.every(offer => !offer.recommendation.recommended));
    assert.equal((await f.request(`${path}/select`, f.buyer, { expectedVersion: detail.task.version, offerId: oldOffer.id })).status, 409);
    assert.ok(detail.events.some(event => event.type === 'criteria.updated'));
    assert.deepEqual(detail.scopes.at(-1).acceptanceCriteria, detail.task.acceptanceCriteria);

    // Builders see the checklist before they quote.
    for (const builder of f.builders) {
      const opportunity = (await builder.client.opportunities()).tasks.find(task => task.id === taskId);
      assert.deepEqual(opportunity.acceptanceCriteria, detail.task.acceptanceCriteria);
    }
    await f.bid(taskId, detail.task.version);
    const builder = await hire(f, taskId);

    // The agreement freezes the criteria; the runtime sees them.
    let assignment = await builder.client.task(taskId);
    assert.deepEqual(assignment.acceptanceCriteria, detail.task.acceptanceCriteria);
    detail = (await f.request(path, f.buyer)).body;
    response = await f.request(`${path}/acceptance-criteria`, f.buyer, { expectedVersion: detail.task.version, criteria: ['Something else entirely'] }, 'PUT');
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'TASK_ASSIGNED');

    // Round 1: deliver, then request changes naming an unmet criterion.
    let delivered = await deliver(builder, taskId, 1);
    assert.deepEqual(delivered.claimed.unmetCriteria, [], 'nothing is unmet on the first attempt');
    detail = (await f.request(path, f.buyer)).body;
    assert.deepEqual(detail.acceptance, { criteria: detail.task.acceptanceCriteria, revisionRounds: 0, endAfterRounds: 2, unmetCriteria: [] });
    assert.equal(detail.actions.execution.end.allowed, false, 'ending is not offered before two rounds of changes');
    response = await f.request(`${path}/end-unmet`, f.buyer, { expectedVersion: detail.task.version, reason: 'Not good enough' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'END_NOT_YET');

    const revise = (submissionId, unmetCriteria) => f.request(`${path}/request-revision`, f.buyer,
      { expectedVersion: detail.task.version, submissionId, notes: 'Duplicates remain.', unmetCriteria });
    response = await revise(delivered.submissionId, ['c9']);
    assert.equal(response.status, 400, 'unmet criteria must come from the agreement');
    response = await revise(delivered.submissionId, ['c1']);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assignment = await builder.client.task(taskId);
    assert.deepEqual(assignment.submissions[0].unmetCriteria, ['c1'], 'the builder sees what is not met');

    // Round 2: the claim tells the runtime what to fix.
    delivered = await deliver(builder, taskId, 2);
    assert.deepEqual(delivered.claimed.acceptanceCriteria, detail.task.acceptanceCriteria);
    assert.deepEqual(delivered.claimed.unmetCriteria, ['c1']);
    detail = (await f.request(path, f.buyer)).body;
    response = await revise(delivered.submissionId, ['c1', 'c2']);
    assert.equal(response.status, 200, JSON.stringify(response.body));

    // After two rounds the buyer may end the work as unmet.
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.acceptance.revisionRounds, 2);
    assert.equal(detail.actions.execution.end.allowed, true);
    assert.equal(detail.retry, null);
    const endBody = { expectedVersion: detail.task.version, reason: 'Duplicates are still in the output.', unmetCriteria: ['c1'] };
    assert.equal((await f.request(`${path}/end-unmet`, builder.operator, endBody)).status, 404, 'another tenant cannot end the work');
    assert.equal((await f.request(`${path}/end-unmet`, f.buyer, { ...endBody, unmetCriteria: ['c7'] })).status, 400);
    const endKey = randomUUID();
    response = await f.request(`${path}/end-unmet`, f.buyer, endBody, 'POST', endKey);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.status, 'failed');
    assert.deepEqual(await f.request(`${path}/end-unmet`, f.buyer, endBody, 'POST', endKey), response, 'replay is idempotent');

    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.execution.status, 'failed');
    assert.deepEqual(detail.acceptance.unmetCriteria, ['c1']);
    assert.equal(detail.actions.execution.end.allowed, false);
    assert.deepEqual(detail.retry, { available: true }, 'the buyer can try another agent');
    assert.equal(detail.payment?.status ?? null, null, 'no payment was created or moved');
    const log = (await f.request('/api/activity', f.buyer)).body.items.filter(item => item.taskId === taskId);
    assert.deepEqual([log[0].label, log[0].actor], ['Work ended: criteria not met', 'you']);
    assert.ok(log.some(item => item.label === 'Acceptance criteria updated'));

    // The runtime is fenced and the ledger counts a failed run.
    assignment = await builder.client.task(taskId);
    assert.equal(assignment.status, 'failed');
    assert.equal(assignment.error, 'BUYER_ENDED_UNMET');
    await assert.rejects(builder.client.claim(taskId, { assignmentId: assignment.assignmentId }, randomUUID()));
    const card = (await f.request(`/api/agent-market/${builder.agentId}`, f.buyer)).body.agent.trackRecord;
    assert.equal(card.outcomes.failed, 1);
    assert.equal(card.outcomes.runs, 1);

    // Off by default: the auto-accept worker does nothing.
    assert.deepEqual(await f.store.reconcileAutoAccept(), { cursor: '', changed: 0, enabled: false });
  } finally {
    await f.close();
  }
});

test('auto-accept, when a deployment opts in, accepts a delivery only after the review window', async () => {
  let offset = 0;
  const windowMs = 20 * 60000; // under the 30-minute idle session limit, so the buyer stays signed in
  const f = await recommendationFlow(4202, { now: () => Date.now() + offset, autoAcceptAfterMs: windowMs });
  try {
    const taskId = await f.postTask();
    const path = `/api/tasks/${taskId}`;
    await f.bid(taskId);
    const builder = await hire(f, taskId);
    await deliver(builder, taskId, 1);

    assert.deepEqual(await f.store.reconcileAutoAccept(), { cursor: '', changed: 0, enabled: true });
    assert.equal((await f.request(path, f.buyer)).body.execution.status, 'buyer_review', 'inside the window nothing changes');

    offset = windowMs + 1000;
    assert.equal((await f.store.reconcileAutoAccept()).changed, 1);
    assert.equal((await f.store.reconcileAutoAccept()).changed, 0, 'a second pass is a no-op');
    const detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.execution.status, 'accepted');
    assert.equal(detail.submissions.at(-1).status, 'accepted');
    assert.ok(detail.events.some(event => event.type === 'delivery.auto_accepted'));
    const log = (await f.request('/api/activity', f.buyer)).body.items.filter(item => item.taskId === taskId);
    assert.deepEqual([log[0].label, log[0].actor], ['Delivery accepted automatically', 'relay']);
  } finally {
    await f.close();
  }
});
