'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

// Real localhost server and supplier SDK. Engagements and milestones
// (docs/specs/Engagements-and-Milestones.md): a builder offers the work in
// stages, the buyer accepts the plan, and each milestone is started, delivered
// and accepted on its own, one at a time.

const MILESTONES = [
  { title: 'Field mapping', criteria: ['Every source field is mapped or marked unused'], amountMinor: 1000, deliveryMinutes: 60 },
  { title: 'Test load', criteria: ['The test file loads without errors'], amountMinor: 2000, deliveryMinutes: 120 },
  { title: 'Full load', criteria: ['All records load', 'Totals reconcile with the source'], amountMinor: 3000, deliveryMinutes: 240 },
];

function milestoneOffer(builder, version, overrides = {}) {
  return { agentId: builder.agentId, capabilityId: builder.capabilityId, expectedVersion: version,
    amountMinor: 6000, deliveryMinutes: 420, proposal: 'Three stages, each checked before the next starts.', milestones: MILESTONES, ...overrides };
}

async function deliver(builder, taskId) {
  await builder.heartbeat();
  const assignmentId = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
  const claimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
  const submitted = await builder.client.submit(taskId, {
    leaseToken: claimed.leaseToken, evidence: 'Stage output.',
    files: [{ filename: 'out.csv', mime: 'text/csv', base64: Buffer.from('id\n1\n').toString('base64') }]
  }, randomUUID());
  return { claimed, submissionId: submitted.submissionId };
}

test('a builder offers work in milestones; the buyer accepts the plan and runs one milestone at a time', async () => {
  const f = await recommendationFlow(4241);
  try {
    const [lead, other] = f.builders;
    const taskId = await f.postTask(), path = `/api/tasks/${taskId}`;
    let detail = (await f.request(path, f.buyer)).body;

    // The plan has to add up, have 2–6 milestones and come from the builder, not an automatic bid.
    let response = await f.request(`${path}/offers`, lead.operator, milestoneOffer(lead, detail.task.version, { amountMinor: 5000 }));
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'MILESTONE_TOTAL');
    response = await f.request(`${path}/offers`, lead.operator, milestoneOffer(lead, detail.task.version, { milestones: [MILESTONES[0]], amountMinor: 1000, deliveryMinutes: 60 }));
    assert.equal(response.status, 400);
    await lead.heartbeat();
    await assert.rejects(lead.client.quote(taskId, milestoneOffer(lead, detail.task.version), randomUUID()));

    response = await f.request(`${path}/offers`, lead.operator, milestoneOffer(lead, detail.task.version));
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const planOfferId = response.body.offerId;
    await other.heartbeat();
    await other.client.quote(taskId, { agentId: other.agentId, capabilityId: other.capabilityId, expectedVersion: detail.task.version,
      amountMinor: 900, deliveryMinutes: 20, proposal: 'All at once.' }, randomUUID());

    // The buyer sees the stages, each with its price, and the plan's total.
    const offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
    const plan = offers.find(item => item.id === planOfferId);
    assert.deepEqual(plan.milestones.map(item => [item.title, item.amountMinor, item.totalMinor]), [['Field mapping', 1000, 1000], ['Test load', 2000, 2000], ['Full load', 3000, 3000]]);
    assert.equal(plan.totalMinor, 6000);

    detail = (await f.request(path, f.buyer)).body;
    response = await f.request(`${path}/select`, f.buyer, { offerId: planOfferId, expectedVersion: detail.task.version });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    detail = (await f.request(path, f.buyer)).body;
    const engagement = detail.engagement;
    assert.equal(engagement.status, 'active');
    assert.equal(engagement.agentName, 'QA CSV specialist');
    assert.deepEqual(engagement.milestones.map(item => [item.sequence, item.title, item.status, item.totalMinor]),
      [[1, 'Field mapping', 'ready', 1000], [2, 'Test load', 'waiting', 2000], [3, 'Full load', 'waiting', 3000]]);
    assert.equal(engagement.totals.totalMinor, 6000);
    assert.equal(engagement.totals.acceptedMinor, 0);
    const [m1, m2, m3] = engagement.milestones.map(item => item.taskId);

    // The plan itself is never started, funded or re-chosen: each milestone is.
    response = await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' });
    assert.equal(response.body.error.code, 'ENGAGEMENT_PARENT');
    const otherOffer = offers.find(item => item.id !== planOfferId);
    response = await f.request(`${path}/select`, f.buyer, { offerId: otherOffer.id, expectedVersion: detail.task.version });
    assert.equal(response.body.error.code, 'ENGAGEMENT_ACCEPTED');
    response = await f.request(`${path}/scope`, f.buyer, { expectedVersion: detail.task.version, title: 'Other', brief: 'Other' });
    assert.equal(response.body.error.code, 'ENGAGEMENT_ACCEPTED');

    // Milestones are private to this buyer and the lead builder.
    for (const item of f.builders) {
      const open = (await item.client.opportunities()).tasks.map(task => task.id);
      for (const id of [taskId, m1, m2, m3]) assert.ok(!open.includes(id), 'not an open request');
    }

    // Each milestone carries its own checklist and price; only the next one can start.
    let milestone = (await f.request(`/api/tasks/${m2}`, f.buyer)).body;
    assert.deepEqual(milestone.milestone, { engagementId: taskId, sequence: 2, of: 3, title: 'Test load', engagementTitle: 'QA normalize CSV data', previousAccepted: false });
    assert.deepEqual(milestone.task.acceptanceCriteria.map(item => item.text), ['The test file loads without errors']);
    response = await f.request(`/api/tasks/${m2}/authorize-local`, f.buyer, { expectedVersion: milestone.task.version, mode: 'local-unpaid' });
    assert.equal(response.body.error.code, 'MILESTONE_ORDER');
    response = await f.request(`/api/tasks/${m2}/scope`, f.buyer, { expectedVersion: milestone.task.version, title: 'Other', brief: 'Other' });
    assert.equal(response.body.error.code, 'MILESTONE_FIXED');

    milestone = (await f.request(`/api/tasks/${m1}`, f.buyer)).body;
    await lead.heartbeat();
    response = await f.request(`/api/tasks/${m1}/authorize-local`, f.buyer, { expectedVersion: milestone.task.version, mode: 'local-unpaid' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const assignment = await lead.client.task(m1);
    assert.deepEqual(assignment.acceptanceCriteria.map(item => item.text), ['Every source field is mapped or marked unused']);

    const { claimed, submissionId } = await deliver(lead, m1);
    assert.match(claimed.brief, /^Milestone 1 of 3: Field mapping/, 'the runtime is told which stage it is doing');
    milestone = (await f.request(`/api/tasks/${m1}`, f.buyer)).body;
    response = await f.request(`/api/tasks/${m1}/accept-delivery`, f.buyer, { expectedVersion: milestone.task.version, submissionId });
    assert.equal(response.status, 200, JSON.stringify(response.body));

    detail = (await f.request(path, f.buyer)).body;
    assert.deepEqual(detail.engagement.milestones.map(item => item.status), ['accepted', 'ready', 'waiting']);
    assert.equal(detail.engagement.totals.acceptedMinor, 1000);
    assert.equal((await f.request(`/api/tasks/${m2}`, f.buyer)).body.milestone.previousAccepted, true);

    // The builder sees each milestone as its own piece of work.
    const work = (await f.request('/api/work', lead.operator)).body.tasks;
    assert.ok(work.some(item => item.id === m1 && item.milestone?.sequence === 1), 'the accepted milestone is in the builder’s work');
    const quotes = (await f.request('/api/quotes', lead.operator)).body.offers;
    assert.deepEqual(quotes.filter(item => item.taskId === taskId || [m1, m2, m3].includes(item.taskId)).map(item => [item.taskId, item.status]), [[taskId, 'accepted']], 'the plan is listed once, as accepted');

    // A milestone's file can be attached before it starts; its agreed terms stay selected.
    milestone = (await f.request(`/api/tasks/${m2}`, f.buyer)).body;
    response = await f.request(`/api/tasks/${m2}/input`, f.buyer, { expectedVersion: milestone.task.version, filename: 'test-load.csv',
      base64: Buffer.from('id\n1\n').toString('base64'), notes: 'The 200-vendor test file.' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    milestone = (await f.request(`/api/tasks/${m2}`, f.buyer)).body;
    const kept = (await f.request(`/api/tasks/${m2}/offers`, f.buyer)).body.offers.find(item => item.id === milestone.task.selectedOfferId);
    assert.ok(kept && kept.scopeVersion === milestone.task.scopeVersion && kept.amountMinor === 2000, 'still selected at the agreed price');
    detail = (await f.request(path, f.buyer)).body;

    // Ending the plan cancels the milestones not started; the accepted one stands.
    response = await f.request(`${path}/engagement/end`, f.buyer, { expectedVersion: detail.task.version - 1 });
    assert.equal(response.status, 409, 'stale tab');
    response = await f.request(`${path}/engagement/end`, f.buyer, { expectedVersion: detail.task.version });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.engagement.status, 'ended');
    assert.deepEqual(detail.engagement.milestones.map(item => item.status), ['accepted', 'cancelled', 'cancelled']);
    assert.equal(detail.engagement.totals.acceptedMinor, 1000);
    assert.equal((await f.request(`/api/tasks/${m1}`, f.buyer)).body.task.assignment?.status ?? 'accepted', 'accepted');

    // The buyer's list shows the plan once, not every milestone.
    const listed = (await f.request(`/api/tasks?tenantId=${f.buyer.actor.memberships[0].id}`, f.buyer)).body.tasks;
    assert.ok(listed.some(item => item.id === taskId && item.engagement?.milestones === 3));
    assert.ok(listed.filter(item => [m1, m2, m3].includes(item.id)).every(item => item.milestone?.engagementId === taskId));
  } finally {
    await f.close();
  }
});
