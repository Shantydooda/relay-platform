'use strict';
// ERP readiness intake, typed attachments and sample pairs (intake.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');

const b64 = text => Buffer.from(text).toString('base64');
async function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const actor = (name, memberships) => ({ user: { id: randomUUID(), name }, memberships });
  const buyer = actor('Buyer', [{ id: randomUUID(), role: 'owner' }]);
  const tenantId = buyer.memberships[0].id;
  const steward = actor('Dana Steward', [{ id: tenantId, role: 'employee', company: true }]);
  const outsider = actor('Outsider', [{ id: randomUUID(), role: 'owner' }]);
  const actors = [buyer, steward, outsider];
  const app = createApplication({ repository, localExecution: true, resolveActor: async id => actors.find(a => a.user.id === id), resolveOperator: async id => actors.find(a => a.user.id === id) });
  const { taskId } = await app.createTask(buyer, { tenantId, title: 'Vendor master cleanup', brief: 'Dedupe vendors before the NetSuite load.' }, randomUUID());
  const version = async () => (await repository.read(r => r.get('task', taskId))).version;
  const intake = (over = {}) => app.setIntake(buyer, taskId, { expectedVersion: 0, intake: { kind: 'erp-data', targetErp: 'netsuite', objectType: 'vendor', sourceSystem: 'Sage 100', recordCount: 4210, asOfDate: '2026-11-15', dataOwnerId: steward.user.id, dependenciesConfirmed: true, ...over } }, randomUUID());
  const setIntake = async over => app.setIntake(buyer, taskId, { expectedVersion: await version(), intake: { kind: 'erp-data', targetErp: 'netsuite', objectType: 'vendor', sourceSystem: 'Sage 100', recordCount: 4210, asOfDate: '2026-11-15', dataOwnerId: steward.user.id, dependenciesConfirmed: true, ...over } }, randomUUID());
  const attach = async (role, filename, content, extra = {}) => app.addAttachment(buyer, taskId, { expectedVersion: await version(), role, filename, base64: b64(content), ...extra }, randomUUID());
  const pair = async (caseKind = 'typical') => {
    const { pairId } = await attach('sample_input', `in-${caseKind}.csv`, 'id,name\nV1,ACME SUPPLY CO.\n', { caseKind });
    await attach('expected_output', `out-${caseKind}.csv`, 'id,name\nV1,Acme Supply Co\n', { pairId });
  };
  const post = async () => app.mutateTask(buyer, taskId, 'post', { expectedVersion: await version() }, randomUUID());
  return { app, repository, buyer, steward, outsider, tenantId, taskId, version, intake, setIntake, attach, pair, post };
}

test('offers stay closed until the ERP intake is complete', async t => {
  const f = await setup(t);
  await f.setIntake({ recordCount: null, dependenciesConfirmed: false });
  let readiness = (await f.app.detail(f.buyer, f.taskId)).intake.readiness;
  assert.equal(readiness.complete, false);
  assert.ok(readiness.missing.includes('Record count'));
  assert.ok(readiness.missing.includes('Source extract'));
  assert.ok(readiness.missing.some(m => m.startsWith('3 more sample pairs')));
  await assert.rejects(f.post(), { code: 'INTAKE_INCOMPLETE' });
  await f.setIntake({});
  await f.attach('source_extract', 'vendors.csv', 'id,name\nV1,Acme\n');
  await f.attach('target_template', 'netsuite-vendor-import.csv', 'External ID,Company Name\n');
  await f.attach('field_mapping', 'mapping.csv', 'source,target\nname,Company Name\n');
  await f.pair('typical'); await f.pair('edge');
  await assert.rejects(f.post(), { code: 'INTAKE_INCOMPLETE' }, 'two pairs are not enough');
  await f.pair('unchanged');
  readiness = (await f.app.detail(f.buyer, f.taskId)).intake.readiness;
  assert.equal(readiness.complete, true);
  assert.equal(readiness.pairs, 3);
  assert.ok(readiness.recommended.includes('Code cross-walk'));
  await f.post();
  assert.equal((await f.app.detail(f.buyer, f.taskId)).task.status, 'posted');
});

test('balances need a reconciliation baseline; the data owner must be in the workspace', async t => {
  const f = await setup(t);
  await assert.rejects(f.setIntake({ dataOwnerId: f.outsider.user.id }), { code: 'INVALID_INPUT' });
  await f.setIntake({ objectType: 'open_ap' });
  assert.ok((await f.app.detail(f.buyer, f.taskId)).intake.readiness.missing.includes('Reconciliation baseline'));
  assert.equal((await f.app.detail(f.buyer, f.taskId)).intake.dataOwnerName, 'Dana Steward');
  await assert.rejects(f.setIntake({ asOfDate: '15/11/2026' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.setIntake({ targetErp: 'quickbooks' }), { code: 'INVALID_INPUT' });
});

test('drafts refine scope v1; once posted, every file change is a new scope; pairs stay together', async t => {
  const f = await setup(t);
  await f.setIntake({});
  assert.equal((await f.app.detail(f.buyer, f.taskId)).task.scopeVersion, 1, 'a draft stays on version 1 while the intake is filled in');
  await f.attach('source_extract', 'v.csv', 'a\n'); await f.attach('target_template', 't.csv', 'a\n'); await f.attach('field_mapping', 'm.csv', 'a\n');
  await f.pair(); await f.pair('edge'); await f.pair('unchanged');
  assert.equal((await f.app.detail(f.buyer, f.taskId)).task.scopeVersion, 1);
  await f.post();
  const before = (await f.app.detail(f.buyer, f.taskId)).task.scopeVersion;
  const { pairId } = await f.attach('sample_input', 'in.csv', 'id\nV1\n', { caseKind: 'edge' });
  await assert.rejects(f.attach('expected_output', 'out.csv', 'id\nV1\n', { pairId: randomUUID() }), { code: 'INVALID_INPUT' });
  await f.attach('expected_output', 'out.csv', 'id\nV1\n', { pairId });
  await assert.rejects(f.attach('expected_output', 'out2.csv', 'id\nV1\n', { pairId }), { code: 'PAIR_COMPLETE' });
  const detail = await f.app.detail(f.buyer, f.taskId);
  assert.equal(detail.task.scopeVersion, before + 2);
  const input = detail.intake.attachments.find(a => a.filename === 'in.csv');
  await f.app.removeAttachment(f.buyer, f.taskId, { expectedVersion: await f.version(), attachmentId: input.id }, randomUUID());
  assert.equal((await f.app.detail(f.buyer, f.taskId)).intake.attachments.filter(a => a.filename === 'in.csv' || a.filename === 'out.csv').length, 0, 'removing an input removes its expected output');
  await assert.rejects(f.attach('rules', 'rules.exe', 'x'), { code: 'INVALID_FILE' });
  await assert.rejects(f.attach('source_extract', 'big.csv', 'x'.repeat(5 * 1024 * 1024 + 1)), { code: 'INVALID_FILE' });
});

test('builders see the intake and file names before quoting, never the contents or the data owner', async t => {
  const f = await setup(t);
  await f.setIntake({});
  await f.attach('source_extract', 'vendors.csv', 'id,name\nV1,SECRET VENDOR\n');
  await f.attach('target_template', 't.csv', 'a\n'); await f.attach('field_mapping', 'm.csv', 'a\n');
  await f.pair(); await f.pair('edge'); await f.pair('unchanged');
  await f.post();
  const builder = { user: { id: randomUUID(), name: 'Builder' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  await f.app.marketplace.addAgent(builder, { name: 'Agent', kind: 'general', purpose: 'Cleans data', integration: 'sdk', capabilities: [{ categoryId: 'master-data', task: 'Vendor cleanup' }] }, randomUUID());
  assert.deepEqual(await f.app.marketplace.opportunities(f.outsider), [], 'someone with no agent sees no open requests');
  const [opportunity] = (await f.app.marketplace.opportunities(builder)).filter(o => o.id === f.taskId);
  assert.equal(opportunity.intake.targetLabel, 'Oracle NetSuite');
  assert.equal(opportunity.intake.recordCount, 4210);
  assert.ok(opportunity.intake.attachments.some(a => a.filename === 'vendors.csv'));
  const raw = JSON.stringify(opportunity);
  assert.doesNotMatch(raw, /SECRET VENDOR|base64|Dana Steward/);
});
