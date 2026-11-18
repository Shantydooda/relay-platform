'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');

test('pilot supplier qualification and quotes do not enable execution, payments or local workers', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = person('Buyer'), builder = person('Builder');
  let active = true;
  const resolveActor = async id => {
    const actor = [buyer, builder].find(a => a.user.id === id);
    return active ? actor : { ...actor, memberships: [] };
  };
  assert.throws(() => createApplication({ repository, pilotConnections: true }), /MANAGED_IDENTITY/);
  assert.throws(() => createApplication({ repository, pilotConnections: true, localExecution: true, resolveActor, resolveOperator: resolveActor }), /MANAGED_IDENTITY/);
  const app = createApplication({ repository, pilotConnections: true, resolveActor, resolveOperator: resolveActor });
  const { agentId } = await app.marketplace.addAgent(builder, {
    name: 'Pilot CSV supplier', purpose: 'Normalize supplied CSV', kind: 'specialist', domain: 'Data', integration: 'api',
    capabilities: [{ category: 'Data', task: 'Normalize supplied CSV' }],
  }, randomUUID());
  await assert.rejects(app.issueCredential(builder, agentId, { expectedVersion: 1 }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
  await app.marketplace.configure(builder, agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const credential = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 2 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token, { kind: 'supplier-api' });
  await app.heartbeat(principal, { runtimeName: 'Independent supplier fixture', runtimeVersion: '1' });
  const getAgent = async () => (await app.marketplace.agents(builder))[0];
  let agent = await getAgent();
  const assessment = await app.startQualification(builder, agentId, {
    expectedVersion: agent.version, capabilityId: agent.capabilities[0].id, rubric: 'csv-normalize-v1',
  }, randomUUID());
  for (const status of ['revision_pending', 'passed']) {
    const [job] = await app.qualificationJobs(principal);
    const output = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
    const result = await app.submitQualification(principal, assessment.assessmentId, {
      round: job.round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort },
    }, randomUUID());
    assert.equal(result.status, status);
  }
  agent = await getAgent();
  assert.equal(agent.capabilities[0].qualification, 'qualified');
  const { taskId } = await app.createTask(buyer, {
    tenantId: buyer.memberships[0].id, title: 'CSV cleanup', brief: 'Normalize a small CSV file.',
  }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
  const quote = await app.marketplace.quote(builder, taskId, {
    agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 2,
    amountMinor: 100, deliveryMinutes: 5, proposal: 'A test quote for CSV normalization.',
  }, randomUUID(), principal);
  const [offer] = await app.marketplace.offers(buyer, taskId);
  assert.equal(offer.qualificationEvidence.id, assessment.assessmentId);
  await app.marketplace.accept(buyer, taskId, { expectedVersion: 2, offerId: quote.offerId }, randomUUID());
  await assert.rejects(app.authorizeLocal(buyer, taskId, { expectedVersion: 3, mode: 'local-unpaid' }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
  await assert.rejects(app.authorizeLocal(buyer, taskId, { expectedVersion: 3, mode: 'stripe-sandbox' }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
  assert.equal(app.features.recurring, false);
  assert.equal(app.features.workspaceApps, false);
  assert.equal(app.features.localExecution, false);
  active = false;
  await assert.rejects(app.runtimePrincipal(credential.token), { code: 'OPERATOR_UNAVAILABLE' });
  active = true;
  agent = await getAgent();
  await app.revokeCredential(builder, agentId, { expectedVersion: agent.version }, randomUUID());
  await assert.rejects(app.heartbeat(principal, { runtimeName: 'Late supplier', runtimeVersion: '1' }), { code: 'INVALID_AGENT_KEY' });
});

// The pilot operator can open exactly one more capability: unpaid execution by
// supplier-hosted runtimes. Payments, local processes and scheduled work stay off.
test('a pilot with unpaid execution enabled runs supplier-hosted work end to end and nothing else opens', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = person('Buyer'), builder = person('Builder');
  const resolveActor = async id => [buyer, builder].find(a => a.user.id === id);
  assert.throws(() => createApplication({ repository, pilotUnpaidExecution: true }), /PILOT_UNPAID_EXECUTION_REQUIRES_PILOT/);
  const app = createApplication({ repository, pilotConnections: true, pilotUnpaidExecution: true, resolveActor, resolveOperator: resolveActor });
  assert.equal(app.features.unpaidExecution, true);
  assert.equal(app.features.changeProposals, true);
  for (const closed of ['localExecution', 'recurring', 'workspaceApps', 'driveConnections', 'attioDelivery', 'notifications'])
    assert.equal(app.features[closed], false, closed);

  const { agentId } = await app.marketplace.addAgent(builder, {
    name: 'Pilot CSV supplier', purpose: 'Normalize supplied CSV', kind: 'specialist', domain: 'Data', integration: 'api',
    capabilities: [{ category: 'Data', task: 'Normalize supplied CSV' }],
  }, randomUUID());
  await assert.rejects(app.issueCredential(builder, agentId, { expectedVersion: 1 }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
  await app.marketplace.configure(builder, agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const credential = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 2 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token, { kind: 'supplier-api' });
  await app.heartbeat(principal, { runtimeName: 'Independent supplier fixture', runtimeVersion: '1' });
  const agent = (await app.marketplace.agents(builder))[0];

  const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'CSV cleanup', brief: 'Normalize a small CSV file.' }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
  const quote = await app.marketplace.quote(builder, taskId, {
    agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 2,
    amountMinor: 100, deliveryMinutes: 5, proposal: 'A test quote for CSV normalization.',
  }, randomUUID(), principal);
  await app.marketplace.accept(buyer, taskId, { expectedVersion: 2, offerId: quote.offerId }, randomUUID());
  await assert.rejects(app.authorizeLocal(buyer, taskId, { expectedVersion: 3, mode: 'stripe-sandbox' }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
  let detail = await app.detail(buyer, taskId);
  assert.equal(detail.actions.execution.startLocal.allowed, true);
  assert.equal(detail.actions.execution.startFunded.allowed, false);
  await app.authorizeLocal(buyer, taskId, { expectedVersion: 3, mode: 'local-unpaid' }, randomUUID());

  const [assignment] = await app.assignments(principal);
  const claimed = await app.claim(principal, taskId, { assignmentId: assignment.assignmentId }, randomUUID());
  const delivered = await app.submit(principal, taskId, { leaseToken: claimed.leaseToken, evidence: 'Cleaned.',
    files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from('a\n1\n').toString('base64') }] }, randomUUID());
  detail = await app.detail(buyer, taskId);
  await app.reviewDelivery(buyer, taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: delivered.submissionId }, randomUUID());
  detail = await app.detail(buyer, taskId);
  assert.equal(detail.execution.status, 'accepted');
  assert.equal(detail.execution.paymentStatus, 'not_applicable_local_unpaid');
  assert.equal(detail.payment?.status ?? null, null, 'no payment exists');
  // Same-agent recovery, orchestration and payment operations remain local-only.
  await assert.rejects(app.retryExecution(buyer, taskId, { expectedVersion: detail.task.version, reason: 'Try the same agent again' }, randomUUID()), { code: 'LOCAL_ONLY' });
});
