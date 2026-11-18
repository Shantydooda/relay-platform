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
    assert.equal(listing.ownerPackages, undefined, 'buyers never see drafts');
    const own = (await f.request(`/api/agent-market/${builder.agentId}`, builder.operator)).body.agent;
    assert.deepEqual(own.ownerPackages.map(item => [item.id, item.status]), [[packageId, 'draft']], 'the owner sees drafts on their own agent page');
    assert.equal(own.agentVersion, agent.version, 'and the version to edit against');

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

async function publishPackage(f, builder, overrides = {}) {
  let agent = await ownAgent(f, builder);
  const path = `/api/agents/${builder.agentId}/packages`;
  const created = await f.request(path, builder.operator, { expectedVersion: agent.version, capabilityId: builder.capabilityId, ...PACKAGE, ...overrides });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  agent = await ownAgent(f, builder);
  const published = await f.request(`${path}/${created.body.packageId}`, builder.operator, { expectedVersion: agent.version, status: 'published' }, 'PATCH');
  assert.equal(published.status, 200, JSON.stringify(published.body));
  return created.body.packageId;
}

async function deliver(builder, taskId, round) {
  await builder.heartbeat();
  const assignmentId = (await builder.client.assignments()).assignments.find(item => item.taskId === taskId).assignmentId;
  const claimed = await builder.client.claim(taskId, { assignmentId }, randomUUID());
  const submitted = await builder.client.submit(taskId, {
    leaseToken: claimed.leaseToken, evidence: `Round ${round} output.`,
    files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from(`email\nround${round}@example.test\n`).toString('base64') }]
  }, randomUUID());
  return { claimed, submissionId: submitted.submissionId };
}

const CSV = Buffer.from('email\na@example.test\na@example.test\n').toString('base64');

test('buying a package creates fixed terms that start through the normal checks and keep the acceptance rules', async () => {
  const f = await recommendationFlow(4212);
  try {
    const [builder, other] = f.builders;
    const packageId = await publishPackage(f, builder);
    const buyPath = `/api/agent-market/${builder.agentId}/packages/${packageId}/buy`;
    const tenantId = f.buyer.actor.memberships[0].id;

    // The buyer confirms the version they saw; a builder can't buy their own package.
    assert.equal((await f.request(buyPath, f.buyer, { tenantId, expectedPackageVersion: 2 })).status, 409, 'stale package version');
    assert.equal((await f.request(buyPath, builder.operator, { tenantId: builder.operator.actor.memberships[0].id, expectedPackageVersion: 1 })).status, 404);
    const key = randomUUID();
    let response = await f.request(buyPath, f.buyer, { tenantId, expectedPackageVersion: 1 }, 'POST', key);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    assert.deepEqual(await f.request(buyPath, f.buyer, { tenantId, expectedPackageVersion: 1 }, 'POST', key), response, 'replay is idempotent');
    const { taskId } = response.body, path = `/api/tasks/${taskId}`;

    let detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.task.status, 'selected', 'buyers see the package offer as chosen');
    assert.equal(detail.task.package.packageId, packageId);
    assert.equal(detail.task.package.packageVersion, 1);
    assert.equal(detail.task.title, PACKAGE.title);
    assert.deepEqual(detail.task.acceptanceCriteria.map(item => item.text), PACKAGE.criteria);
    const offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
    assert.equal(offers.length, 1, 'the package is the only offer');
    assert.equal(offers[0].amountMinor, 2500);
    assert.equal(offers[0].packageId, packageId);
    assert.equal(detail.task.selectedOfferId, offers[0].id, 'buying selects the package offer');
    assert.ok(detail.events.some(event => event.type === 'package.bought'));
    assert.ok(Array.isArray(detail.messages) && !detail.messages.length, 'the package text is not shown as a message the buyer wrote');

    // The builder's later edits never reach a bought task.
    let agent = await ownAgent(f, builder);
    response = await f.request(`/api/agents/${builder.agentId}/packages/${packageId}`, builder.operator,
      { expectedVersion: agent.version, capabilityId: builder.capabilityId, ...PACKAGE, priceMinor: 4000, criteria: ['Something different'] }, 'PUT');
    assert.equal(response.status, 200);
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.task.package.priceMinor, 2500);
    assert.deepEqual(detail.task.acceptanceCriteria.map(item => item.text), PACKAGE.criteria);

    // Package terms are fixed: no scope or checklist edits, no competing quotes, not in the public feed.
    response = await f.request(`${path}/scope`, f.buyer, { expectedVersion: detail.task.version, title: 'Other', brief: 'Something else' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PACKAGE_FIXED');
    response = await f.request(`${path}/acceptance-criteria`, f.buyer, { expectedVersion: detail.task.version, criteria: ['Other check'] }, 'PUT');
    assert.equal(response.body.error.code, 'PACKAGE_FIXED');
    for (const item of f.builders) assert.ok(!(await item.client.opportunities()).tasks.some(task => task.id === taskId), 'not an open opportunity');
    await other.heartbeat();
    await assert.rejects(other.client.quote(taskId, { agentId: other.agentId, capabilityId: other.capabilityId, expectedVersion: detail.task.version,
      amountMinor: 900, deliveryMinutes: 10, proposal: 'Cheaper.' }, randomUUID()));

    // The required CSV is checked at start, and attaching it keeps the package offer selected.
    response = await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'INPUT_REQUIRED');
    response = await f.request(`${path}/input`, f.buyer, { expectedVersion: detail.task.version, filename: 'emails.csv', base64: CSV, notes: 'Our newsletter list.' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    detail = (await f.request(path, f.buyer)).body;
    const offer = (await f.request(`${path}/offers`, f.buyer)).body.offers.find(item => item.id === detail.task.selectedOfferId);
    assert.ok(offer, 'still selected after the input changes the scope');
    assert.equal(offer.scopeVersion, detail.task.scopeVersion);
    assert.equal(offer.amountMinor, 2500);

    await builder.heartbeat();
    response = await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const assignment = await builder.client.task(taskId);
    assert.deepEqual(assignment.acceptanceCriteria.map(item => item.text), PACKAGE.criteria, 'the runtime gets the bought checklist');

    // The acceptance rules apply unchanged: two rounds naming unmet items, then end as unmet.
    for (const round of [1, 2]) {
      const { submissionId } = await deliver(builder, taskId, round);
      detail = (await f.request(path, f.buyer)).body;
      response = await f.request(`${path}/request-revision`, f.buyer, { expectedVersion: detail.task.version, submissionId, notes: 'Duplicates remain.', unmetCriteria: ['c1'] });
      assert.equal(response.status, 200, JSON.stringify(response.body));
    }
    detail = (await f.request(path, f.buyer)).body;
    response = await f.request(`${path}/end-unmet`, f.buyer, { expectedVersion: detail.task.version, reason: 'Duplicates are still there.', unmetCriteria: ['c1'] });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    detail = (await f.request(path, f.buyer)).body;
    assert.equal(detail.task.assignment?.agreement?.packageId ?? detail.task.package.packageId, packageId);
  } finally {
    await f.close();
  }
});

test('a paused package can’t be bought, and extra polish rounds are limited to what the package includes', async () => {
  const f = await recommendationFlow(4213);
  try {
    const [builder] = f.builders;
    const packageId = await publishPackage(f, builder, { extraRounds: 1 });
    const tenantId = f.buyer.actor.memberships[0].id;
    const buyPath = `/api/agent-market/${builder.agentId}/packages/${packageId}/buy`;
    const { taskId } = (await f.request(buyPath, f.buyer, { tenantId, expectedPackageVersion: 1 })).body;
    const path = `/api/tasks/${taskId}`;
    let detail = (await f.request(path, f.buyer)).body;
    await f.request(`${path}/input`, f.buyer, { expectedVersion: detail.task.version, filename: 'emails.csv', base64: CSV, notes: 'List.' });
    detail = (await f.request(path, f.buyer)).body;
    await builder.heartbeat();
    assert.equal((await f.request(`${path}/authorize-local`, f.buyer, { expectedVersion: detail.task.version, mode: 'local-unpaid' })).status, 200);

    // A revision that names no unmet checklist item is a polish round; the package includes one.
    let { submissionId } = await deliver(builder, taskId, 1);
    detail = (await f.request(path, f.buyer)).body;
    let response = await f.request(`${path}/request-revision`, f.buyer, { expectedVersion: detail.task.version, submissionId, notes: 'Tidy the header.' });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    ({ submissionId } = await deliver(builder, taskId, 2));
    detail = (await f.request(path, f.buyer)).body;
    response = await f.request(`${path}/request-revision`, f.buyer, { expectedVersion: detail.task.version, submissionId, notes: 'One more tweak.' });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'POLISH_LIMIT');
    response = await f.request(`${path}/request-revision`, f.buyer, { expectedVersion: detail.task.version, submissionId, notes: 'Duplicates remain.', unmetCriteria: ['c1'] });
    assert.equal(response.status, 200, 'fixes for unmet checklist items stay free');

    // Paused packages can't be bought.
    const agent = await ownAgent(f, builder);
    await f.request(`/api/agents/${builder.agentId}/packages/${packageId}`, builder.operator, { expectedVersion: agent.version, status: 'paused' }, 'PATCH');
    response = await f.request(buyPath, f.buyer, { tenantId, expectedPackageVersion: 1 });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'PACKAGE_UNAVAILABLE');
  } finally {
    await f.close();
  }
});
