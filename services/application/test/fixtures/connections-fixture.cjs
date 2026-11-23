'use strict';
// Shared setup for buyer-connection tests: a buyer workspace, a qualified agent
// working on the buyer's request, and helpers to connect, ask and claim.
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../../src/repository.cjs');
const { createApplication } = require('../../src/service.cjs');
const { normalizeCsv } = require('../../../agent-runtime/src/csv.cjs');
const { createVault } = require('../../../connectors/src/vault.cjs');
const { createSampleErp, SAMPLE_TOKEN } = require('../../../connectors/src/erp-fixture.cjs');

const DAY = 86400000;
async function setup(t, adapter = 'sqlite', { providers = [createSampleErp()], options: extra = {} } = {}) {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  let time = Date.parse('2026-11-19T09:00:00Z');
  const actor = (name, memberships) => ({ user: { id: randomUUID(), name }, memberships });
  const buyer = actor('Buyer', [{ id: randomUUID(), role: 'owner', accessEpoch: 1 }]);
  const builder = actor('Builder', [{ id: randomUUID(), role: 'owner', accessEpoch: 1 }]);
  const tenantId = buyer.memberships[0].id;
  const employee = actor('Employee', [{ id: tenantId, role: 'employee', company: true, accessEpoch: 1 }]);
  const actors = [buyer, builder, employee];
  const options = { repository, localExecution: true, now: () => time, resolveActor: async id => actors.find(a => a.user.id === id), resolveOperator: async id => actors.find(a => a.user.id === id),
    connectionVault: createVault(randomBytes(32).toString('hex')), connectionProviders: providers, ...extra };
  const app = createApplication(options);
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'Vendor cleaner', kind: 'specialist', domain: 'ERP master data', purpose: 'Clean vendor master data', integration: 'sdk', capabilities: [{ category: 'Data', task: 'Normalize CSV' }] }, randomUUID());
  const credential = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token);
  await app.heartbeat(principal, { runtimeName: 'Vendor cleaner', runtimeVersion: '1' });
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
  const version = async id => (await repository.read(r => r.get('task', id))).version;
  const { taskId } = await app.createTask(buyer, { tenantId, title: 'Dedupe vendor master', brief: 'Find duplicate vendors in our ERP sandbox and return a merge file.' }, randomUUID());
  await app.addInput(buyer, taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id,name\nV-1,Acme\n').toString('base64'), notes: 'Starting extract.' }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: await version(taskId) }, randomUUID());
  await app.heartbeat(principal, { runtimeName: 'Vendor cleaner', runtimeVersion: '1' });
  const offer = await app.marketplace.quote(builder, taskId, { agentId, capabilityId, expectedVersion: await version(taskId), amountMinor: 100, deliveryMinutes: 60, proposal: 'Find and merge duplicate vendors.' }, randomUUID(), principal);
  await app.marketplace.accept(buyer, taskId, { expectedVersion: await version(taskId), offerId: offer.offerId }, randomUUID());
  await app.authorizeLocal(buyer, taskId, { expectedVersion: await version(taskId), mode: 'local-unpaid' }, randomUUID());
  const connect = (body = {}, who = buyer) => app.connect(who, { tenantId, provider: 'sample-erp', environment: 'sandbox', label: 'NetSuite sandbox (sample)', credentials: { accountId: 'TSTDRV123', token: SAMPLE_TOKEN }, ...body }, randomUUID());
  const ask = (body = {}) => app.requestAccess(principal, taskId, { provider: 'sample-erp', environment: 'sandbox', objects: ['vendor'], purpose: 'Read vendor records to find duplicates by tax ID.', days: 7, ...body }, randomUUID());
  const claim = async () => {
    const detail = await app.detail(buyer, taskId);
    return app.claim(principal, taskId, { assignmentId: detail.execution.id }, randomUUID());
  };
  const requestId = async () => (await repository.read(r => r.get('task', taskId))).accessRequests.at(-1).id;
  return { app, repository, buyer, builder, employee, tenantId, principal, taskId, version, connect, ask, claim, requestId, advance: ms => { time += ms; } };
}

module.exports = { setup, DAY };
