'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');
async function fixture(t, adapter = 'sqlite') {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  const actor = { user: { id: randomUUID(), name: 'Builder' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  let time = Date.now();
  const options = { repository, localExecution: true, now: () => time, resolveOperator: async () => actor };
  const app = createApplication(options);
  const { agentId } = await app.marketplace.addAgent(actor, { name: 'CSV and research', kind: 'general', purpose: 'Process files and research', integration: 'api', capabilities: [{ category: 'Data', task: 'Normalize CSV' }, { category: 'Research', task: 'Research companies' }] }, randomUUID());
  const credential = await app.issueSupplierCredential(actor, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token);
  await app.heartbeat(principal, { runtimeName: 'Reference', runtimeVersion: '1' });
  const getAgent = async () => (await app.marketplace.agents(actor))[0];
  const start = async (rubric = 'csv-normalize-v1') => {
    const agent = await getAgent();
    return app.startQualification(actor, agentId, { expectedVersion: agent.version, capabilityId: agent.capabilities[0].id, rubric }, randomUUID());
  };
  const answer = async (application = app) => {
    const job = (await application.qualificationJobs(principal))[0];
    const result = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = result.report;
    return { job, body: { round: job.round, csv: result.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } } };
  };
  return { app, options, repository, actor, agentId, principal, getAgent, start, answer, advance: value => time += value };
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: qualification requires real test and revision; scoped evidence survives app restart and is quoted`, async t => {
    const f = await fixture(t, adapter);
    const started = await f.start();
    await assert.rejects(f.start(), { code: 'ASSESSMENT_PENDING' });
    let { body } = await f.answer();
    const key = randomUUID();
    const first = await f.app.submitQualification(f.principal, started.assessmentId, body, key);
    assert.equal(first.status, 'revision_pending');
    assert.deepEqual(await f.app.submitQualification(f.principal, started.assessmentId, body, key), first);
    assert.equal((await f.getAgent()).readiness.capability, false);
    const restarted = createApplication(f.options);
    ({ body } = await f.answer(restarted));
    assert.equal(body.round, 2);
    assert.equal((await restarted.submitQualification(f.principal, started.assessmentId, body, randomUUID())).status, 'passed');
    const agent = await f.getAgent();
    assert.equal(agent.capabilities[0].qualification, 'qualified');
    assert.equal(agent.capabilities[1].qualification, 'unverified');
    assert.equal(agent.readiness.canReceivePaidWork, false);
    assert.equal(agent.capabilities[0].assessment.submissions.length, 2);
    assert.ok(!JSON.stringify(agent).includes(f.principal.credentialHash));
    assert.ok(!JSON.stringify(agent).includes('"expected"'));
    const buyer = { user: { id: randomUUID(), name: 'Buyer' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
    const { taskId } = await f.app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Clean CSV', brief: 'Normalize supplied CSV' }, randomUUID());
    await f.app.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
    await f.app.marketplace.quote(f.actor, taskId, { agentId: f.agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 2, amountMinor: 100, deliveryMinutes: 1, proposal: 'Normalize the CSV' }, randomUUID());
    const offer = (await f.app.marketplace.offers(buyer, taskId))[0];
    assert.equal(offer.qualification, 'qualified');
    assert.equal(offer.qualificationEvidence.id, started.assessmentId);
    assert.equal(offer.qualificationEvidence.submissions.length, 2);
    await f.app.heartbeat(f.principal, { runtimeName: 'Reference', runtimeVersion: '2' });
    assert.equal((await f.getAgent()).capabilities[0].qualification, 'expired');
    assert.equal((await f.app.marketplace.offers(buyer, taskId))[0].qualificationEvidence.runtimeVersion, '1');
  });
}
test('qualification rejects wrong output, skipped revision, strangers, stale keys and late submissions', async t => {
  const f = await fixture(t);
  const started = await f.start();
  const { body } = await f.answer();
  await assert.rejects(f.app.submitQualification(f.principal, started.assessmentId, { ...body, round: 2 }, randomUUID()), { code: 'ASSESSMENT_STATE' });
  const stranger = { ...f.actor, user: { id: randomUUID() } };
  await assert.rejects(f.app.startQualification(stranger, f.agentId, { expectedVersion: 3, capabilityId: (await f.getAgent()).capabilities[0].id, rubric: 'csv-normalize-v1' }, randomUUID()), { code: 'NOT_FOUND' });
  assert.equal((await f.app.submitQualification(f.principal, started.assessmentId, { ...body, csv: 'name,company\r\nwrong,data\r\n' }, randomUUID())).status, 'failed');
  assert.equal((await f.getAgent()).capabilities[0].qualification, 'unverified');
  const retry = await f.start();
  f.advance(3600001);
  await assert.rejects(f.app.submitQualification(f.principal, retry.assessmentId, body, randomUUID()), { code: 'ASSESSMENT_EXPIRED' });
  const agent = await f.getAgent();
  await f.app.revokeCredential(f.actor, agent.id, { expectedVersion: agent.version }, randomUUID());
  await assert.rejects(f.app.submitQualification(f.principal, retry.assessmentId, body, randomUUID()), { code: 'INVALID_AGENT_KEY' });
});
test('competing assessment completions cannot duplicate evidence or skip revision', async t => {
  const f = await fixture(t, 'postgres');
  const started = await f.start(), { body } = await f.answer();
  const results = await Promise.allSettled([1, 2].map(() => f.app.submitQualification(f.principal, started.assessmentId, body, randomUUID())));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await f.getAgent()).capabilities[0].assessment.submissions.length, 1);
});

test('a runtime update invalidates an unfinished test and permits a fresh assessment', async t => {
  const f = await fixture(t);
  const first = await f.start(), { body } = await f.answer();
  await f.app.heartbeat(f.principal, { runtimeName: 'Reference', runtimeVersion: '2' });
  assert.equal((await f.getAgent()).capabilities[0].assessment.status, 'invalidated');
  assert.deepEqual(await f.app.qualificationJobs(f.principal), []);
  await assert.rejects(f.app.submitQualification(f.principal, first.assessmentId, body, randomUUID()), { code: 'ASSESSMENT_EXPIRED' });
  const next = await f.start();
  assert.notEqual(next.assessmentId, first.assessmentId);
  assert.equal((await f.app.qualificationJobs(f.principal)).length, 1);
});
test('correct-looking CSV with a false report fails and extra claimed pass fields are rejected', async t => {
  const f = await fixture(t), started = await f.start(), { body } = await f.answer();
  await assert.rejects(f.app.submitQualification(f.principal, started.assessmentId, { ...body, status: 'passed' }, randomUUID()), { code: 'INVALID_FIELDS' });
  const result = await f.app.submitQualification(f.principal, started.assessmentId, { ...body, report: { ...body.report, duplicatesRemoved: 0 } }, randomUUID());
  assert.equal(result.status, 'failed');
  assert.equal((await f.getAgent()).readiness.capability, false);
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: link assessment rejects fabricated evidence and qualifies only after both exact rounds`, async t => {
    const f = await fixture(t, adapter);
    const { inventory } = require('../../link-runtime/src/inventory.cjs');
    const first = await f.start('link-inventory-v1');
    let job = (await f.app.qualificationJobs(f.principal))[0];
    let result = inventory(job.input);
    await assert.rejects(f.app.submitQualification(f.principal, first.assessmentId, { round: 1, ...result, passed: true }, randomUUID()), { code: 'INVALID_FIELDS' });
    assert.equal((await f.app.submitQualification(f.principal, first.assessmentId, { round: 1, ...result, report: { ...result.report, rejected: 0 } }, randomUUID())).status, 'failed');
    const second = await f.start('link-inventory-v1');
    for (const round of [1, 2]) {
      job = (await f.app.qualificationJobs(f.principal))[0];
      result = inventory(job.input, job.revision);
      const completed = await f.app.submitQualification(f.principal, second.assessmentId, { round, ...result }, randomUUID());
      assert.equal(completed.status, round === 1 ? 'revision_pending' : 'passed');
    }
    const agent = await f.getAgent();
    assert.equal(agent.capabilities[0].qualification, 'qualified');
    assert.equal(agent.capabilities[1].qualification, 'unverified');
    assert.match(agent.capabilities[0].assessment.limitation, /No websites fetched/);
    assert.ok(!JSON.stringify(agent).includes('"expected"'));
  });
}
