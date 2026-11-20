'use strict';
// Machine-run acceptance checks (checks.cjs) and their place in the agreement.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');
const { normalizeChecks, runChecks, freeze } = require('../src/checks.cjs');

const csv = text => ({ filename: 'out.csv', mime: 'text/csv', base64: Buffer.from(text).toString('base64') });
const files = { template: 'External ID,Company Name,Terms,Balance\n', walk: 'legacy,netsuite\nN30,Net 30\nN45,Net 45\n', expected: 'External ID,Company Name\nV1,Acme Supply Co\n' };
const task = { attachments: [
  { id: 'tpl', role: 'target_template', filename: 'template.csv' }, { id: 'xw', role: 'code_crosswalk', filename: 'terms.csv' },
  { id: 'in1', role: 'sample_input', filename: 'in.csv', pairId: 'p1' }, { id: 'out1', role: 'expected_output', filename: 'expected.csv', pairId: 'p1' }] };
const load = async id => Buffer.from({ tpl: files.template, xw: files.walk, out1: files.expected }[id]);
const all = freeze(normalizeChecks([
  { type: 'row_count', expected: 3, tolerance: 0 },
  { type: 'required_fields', fields: ['External ID', 'Company Name'] },
  { type: 'unique_key', fields: ['External ID'] },
  { type: 'header_matches_template' },
  { type: 'values_in_crosswalk', field: 'Terms', attachmentId: 'xw', column: 'netsuite' },
  { type: 'control_total', field: 'Balance', expected: 1500.5, tolerance: 0.01 },
  { type: 'matches_samples', key: 'External ID' },
], task), task);

test('a clean delivery passes every check', async () => {
  const run = await runChecks(all, [csv('External ID,Company Name,Terms,Balance\nV1,Acme Supply Co,Net 30,"1,000.25"\nV2,Borealis Metals,Net 45,500.25\nV3,Contoso,Net 30,0\n')], load);
  assert.equal(run.file, 'out.csv');
  assert.deepEqual(run.results.map(r => `${r.id}:${r.status}`), ['k1:pass', 'k2:pass', 'k3:pass', 'k4:pass', 'k5:pass', 'k6:pass', 'k7:pass']);
});

test('each check names what failed, with examples', async () => {
  const run = await runChecks(all, [csv('Company Name,External ID,Terms,Balance\nAcme Supply Co.,V1,N30,1000\n,V1,Net 30,abc\n')], load);
  const by = Object.fromEntries(run.results.map(r => [r.type, r]));
  assert.match(by.row_count.detail, /2 rows, 1 fewer/);
  assert.match(by.required_fields.examples[0], /Row 3: Company Name empty/);
  assert.match(by.unique_key.examples[0], /Rows 2 and 3: V1/);
  assert.equal(by.header_matches_template.detail, 'Same columns, different order.');
  assert.match(by.values_in_crosswalk.examples[0], /Row 2: N30/);
  assert.match(by.control_total.examples[0], /Row 3: abc/);
  assert.match(by.matches_samples.examples[0], /V1 differs in Company Name/);
  assert.ok(run.results.every(r => r.status === 'fail'));
});

test('checks are validated against the request’s files, and odd deliveries are errors, not passes', async () => {
  assert.throws(() => normalizeChecks([{ type: 'header_matches_template' }], { attachments: [] }), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeChecks([{ type: 'values_in_crosswalk', field: 'Terms', attachmentId: 'nope', column: 'x' }], task), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeChecks([{ type: 'run_script', code: 'rm -rf /' }], task), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeChecks(Array.from({ length: 13 }, () => ({ type: 'row_count', expected: 1 })), task), { code: 'INVALID_INPUT' });
  const none = await runChecks(all.slice(0, 1), [{ filename: 'report.json', mime: 'application/json', base64: 'e30=' }], load);
  assert.equal(none.results[0].status, 'error');
  const broken = await runChecks(all.slice(0, 1), [csv('a,b\n1\n')], load);
  assert.match(broken.results[0].detail, /couldn’t be read/);
});

test('agreed checks run on delivery; a failing check makes the fix free and is named automatically', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const actor = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner', accessEpoch: 1 }] });
  const buyer = actor('Buyer'), builder = actor('Builder'), actors = [buyer, builder];
  const app = createApplication({ repository, localExecution: true, resolveActor: async id => actors.find(a => a.user.id === id), resolveOperator: async id => actors.find(a => a.user.id === id) });
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'Vendor cleaner', kind: 'general', purpose: 'Clean vendors', integration: 'sdk', capabilities: [{ category: 'Data', task: 'Normalize CSV' }] }, randomUUID());
  const credential = await app.issueSupplierCredential(builder, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token);
  await app.heartbeat(principal, { runtimeName: 'Vendor cleaner', runtimeVersion: '1' });
  let agent = (await app.marketplace.agents(builder))[0];
  const capabilityId = agent.capabilities[0].id;
  const assessment = await app.startQualification(builder, agentId, { expectedVersion: agent.version, capabilityId, rubric: 'csv-normalize-v1' }, randomUUID());
  for (let round = 1; round <= 2; round++) {
    const job = (await app.qualificationJobs(principal))[0], out = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = out.report;
    await app.submitQualification(principal, assessment.assessmentId, { round, csv: out.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } }, randomUUID());
  }
  agent = (await app.marketplace.agents(builder))[0];
  await app.marketplace.configure(builder, agentId, { expectedVersion: agent.version, integration: 'sdk', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const tenantId = buyer.memberships[0].id;
  const { taskId } = await app.createTask(buyer, { tenantId, title: 'Vendor import file', brief: 'Return a NetSuite vendor import file.' }, randomUUID());
  const v = async () => (await repository.read(r => r.get('task', taskId))).version;
  await app.addInput(buyer, taskId, { expectedVersion: await v(), filename: 'vendors.csv', base64: Buffer.from('id,name\nV1,Acme\n').toString('base64'), notes: 'Extract.' }, randomUUID());
  await app.addAttachment(buyer, taskId, { expectedVersion: await v(), role: 'target_template', filename: 'template.csv', base64: Buffer.from('External ID,Company Name\n').toString('base64') }, randomUUID());
  await app.setChecks(buyer, taskId, { expectedVersion: await v(), checks: [{ type: 'header_matches_template' }, { type: 'unique_key', fields: ['External ID'] }] }, randomUUID());
  await app.mutateTask(buyer, taskId, 'post', { expectedVersion: await v() }, randomUUID());
  await app.heartbeat(principal, { runtimeName: 'Vendor cleaner', runtimeVersion: '1' });
  const builderView = (await app.marketplace.opportunities(builder)).find(o => o.id === taskId);
  assert.deepEqual(builderView.checks.map(c => c.label), ['Columns match the import template', 'Key is unique'], 'builders see the checks before quoting');
  const offer = await app.marketplace.quote(builder, taskId, { agentId, capabilityId, expectedVersion: await v(), amountMinor: 100, deliveryMinutes: 60, proposal: 'Build the import file.' }, randomUUID(), principal);
  await app.marketplace.accept(buyer, taskId, { expectedVersion: await v(), offerId: offer.offerId }, randomUUID());
  await app.authorizeLocal(buyer, taskId, { expectedVersion: await v(), mode: 'local-unpaid' }, randomUUID());
  const detail = await app.detail(buyer, taskId);
  const claim = await app.claim(principal, taskId, { assignmentId: detail.execution.id }, randomUUID());
  assert.deepEqual(claim.checks.map(c => c.id), ['k1', 'k2'], 'the agent can test its own output against the agreed checks');
  // Buyer changes after authorization don't touch the frozen checks.
  await assert.rejects(app.setChecks(buyer, taskId, { expectedVersion: await v(), checks: [] }, randomUUID()), { code: 'TASK_ASSIGNED' });
  const submitted = await app.submit(principal, taskId, { leaseToken: claim.leaseToken, evidence: 'Built the file.', files: [csv('External ID,Company Name\nV1,Acme\nV1,Acme Dup\n')] }, randomUUID());
  const delivered = (await app.detail(buyer, taskId)).submissions.at(-1);
  assert.deepEqual(delivered.checks.results.map(r => r.status), ['pass', 'fail']);
  await app.reviewDelivery(buyer, taskId, 'request-revision', { expectedVersion: submitted.version, submissionId: submitted.submissionId, notes: 'Sort rows descending' }, randomUUID());
  const revised = (await repository.read(r => r.get('task', taskId))).submissions.at(-1);
  assert.deepEqual(revised.unmetCriteria, ['k2'], 'the failing check is named even though the buyer didn’t list it');
});
