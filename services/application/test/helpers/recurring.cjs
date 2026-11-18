'use strict';
const { randomUUID } = require('node:crypto');
const { createApplication } = require('../../src/service.cjs');
const { normalizeCsv } = require('../../../agent-runtime/src/csv.cjs');

async function recurringFixture(repository) {
  let time = Date.parse('2026-10-29T08:00:00Z');
  const actor = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner', accessEpoch: 1 }] });
  const buyer = actor('Buyer'), builder = actor('Builder'), outsider = actor('Other');
  const actors = [buyer, builder, outsider];
  const options = { repository, localExecution: true, now: () => time, resolveActor: async id => actors.find(a => a.user.id === id), resolveOperator: async id => actors.find(a => a.user.id === id) };
  const app = createApplication(options);
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'CSV worker', kind: 'general', purpose: 'Normalize CSV', integration: 'sdk', capabilities: [{ category: 'Data', task: 'Normalize CSV' }] }, randomUUID());
  const credential = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token);
  const heartbeat = () => app.heartbeat(principal, { runtimeName: 'CSV worker', runtimeVersion: '1' });
  await heartbeat();
  let agent = (await app.marketplace.agents(builder))[0];
  const capabilityId = agent.capabilities[0].id;
  const assessment = await app.startQualification(builder, agentId, { expectedVersion: agent.version, capabilityId, rubric: 'csv-normalize-v1' }, randomUUID());
  for (let round = 1; round <= 2; round++) {
    const job = (await app.qualificationJobs(principal))[0], output = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
    await app.submitQualification(principal, assessment.assessmentId, { round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } }, randomUUID());
  }
  agent = (await app.marketplace.agents(builder))[0];
  await app.marketplace.configure(builder, agentId, { expectedVersion: agent.version, integration: 'sdk', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Weekly clean data', brief: 'Normalize the supplied CSV; remove exact duplicates.' }, randomUUID());
  await app.addInput(buyer, taskId, { expectedVersion: 1, filename: 'source.csv', base64: Buffer.from('name\nZebra\nAcme\nAcme\n').toString('base64'), notes: 'Saved input for recurring runs.' }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const quote = async (id, amountMinor = 100) => {
    await heartbeat();
    const task = await repository.read(repo => repo.get('task', id));
    return app.marketplace.quote(builder, id, { agentId, capabilityId, expectedVersion: task.version, amountMinor, deliveryMinutes: 1, proposal: 'Normalize the supplied CSV.' }, randomUUID(), principal);
  };
  const offer = await quote(taskId);
  await app.marketplace.accept(buyer, taskId, { expectedVersion: 3, offerId: offer.offerId }, randomUUID());
  await app.authorizeLocal(buyer, taskId, { expectedVersion: 4, mode: 'local-unpaid' }, randomUUID());
  const finish = async id => {
    const detail = await app.detail(buyer, id);
    const claim = await app.claim(principal, id, { assignmentId: detail.execution.id }, randomUUID());
    const output = normalizeCsv(Buffer.from(claim.input.base64, 'base64'));
    const submitted = await app.submit(principal, id, { leaseToken: claim.leaseToken, evidence: 'Deterministic CSV counts verified', files: [{ filename: 'clean.csv', mime: 'text/csv', base64: output.csv.toString('base64') }] }, randomUUID());
    await app.reviewDelivery(buyer, id, 'accept-delivery', { expectedVersion: submitted.version, submissionId: submitted.submissionId }, randomUUID());
  };
  await finish(taskId);
  const config = { expectedVersion: (await app.detail(buyer, taskId)).task.version, calendar: { cadence: 'daily', time: '09:00', timezone: 'UTC', day: 1 }, perRunLimitMinor: 100, monthlyLimitMinor: 200, consent: 'local-unpaid-recurring' };
  const prepareRecurring = async () => {
    const created = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Daily clean data', brief: 'Every day normalize the supplied CSV and remove exact duplicates.' }, randomUUID());
    const id = created.taskId;
    await app.addInput(buyer, id, { expectedVersion: 1, filename: 'source.csv', base64: Buffer.from('name\nZebra\nAcme\nAcme\n').toString('base64'), notes: 'Recurring request input.' }, randomUUID());
    // Model confirmation is covered separately by scoping tests.
    await repository.transaction(id, async repo => {
      const task = await repo.get('task', id);
      task.workPlan = { cadence: 'daily', schedule: 'Every day', openQuestions: [], status: 'proposed_not_active' };
      await repo.save('task', task);
    });
    await app.mutateTask(buyer, id, 'post', { expectedVersion: 2 }, randomUUID());
    const offer = await quote(id);
    await app.marketplace.accept(buyer, id, { expectedVersion: 3, offerId: offer.offerId }, randomUUID());
    return id;
  };
  const create = async () => {
    const id = await prepareRecurring();
    return app.createSchedule(buyer, id, { ...config, expectedVersion: 4 }, randomUUID());
  };
  return { app, options, buyer, builder, outsider, principal, taskId, agentId, capabilityId, quote, finish, config, create, prepareRecurring, heartbeat, setTime: value => { time = typeof value === 'string' ? Date.parse(value) : value; } };
}
module.exports = { recurringFixture };
