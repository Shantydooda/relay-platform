'use strict';
// QA (auth/permissions): company approvals, project leads and access epochs
// (approvals.cjs, projects.cjs). SQLite only; no pglite needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');

async function setup(t) {
  const f = await fixture(t, 'sqlite'), tenantId = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  f.buyer.memberships[0].accessEpoch = 1;
  const person = (name, role) => ({ user: { id: randomUUID(), name }, memberships: [{ id: tenantId, role, company: true, accessEpoch: 1 }] });
  const employee = person('Requester', 'employee'), lead = person('Lead', 'employee'), approver = person('Approver', 'approver'), other = person('Other', 'employee');
  const actors = [f.buyer, employee, lead, approver, other, f.builder, f.stranger];
  const resolve = async id => actors.find(a => a.user.id === id);
  const app = createApplication({ ...f.options, resolveOperator: resolve, resolveActor: resolve });
  const own = async who => f.repository.transaction('qa-fixture', async repo => {
    const task = await repo.get('task', f.taskId, true); task.ownerId = who.user.id; task.companyApprovalRequired = true; await repo.save('task', task);
  });
  await app.configureBudget(f.buyer, tenantId, { limitMinor: 5000, expectedVersion: 0 }, randomUUID());
  const version = async () => (await f.repository.read(r => r.get('task', f.taskId))).version;
  const request = async who => app.requestApproval(who, f.taskId, { expectedVersion: await version(), note: 'Needed for the wave' }, randomUUID());
  const decide = async (who, decision = 'approved') => {
    const task = await f.repository.read(r => r.get('task', f.taskId));
    return app.decideApproval(who, f.taskId, { approvalId: task.approval.id, expectedVersion: task.approval.version, decision, note: 'Reviewed' }, randomUUID());
  };
  const fund = async who => app.sandboxPayment(who, f.taskId, 'fund', { expectedVersion: await version() }, randomUUID());
  return { ...f, app, tenantId, employee, lead, approver, other, own, version, request, decide, fund };
}

test('only owners, approvers and the project lead can decide; employees and outsiders cannot', async t => {
  const f = await setup(t);
  await f.own(f.employee);
  await f.request(f.employee);
  await assert.rejects(f.decide(f.other), { code: 'FORBIDDEN' });
  await assert.rejects(f.decide(f.employee), { code: 'FORBIDDEN' }, 'a requester without a deciding role cannot self-approve');
  await assert.rejects(f.decide(f.stranger), { code: 'FORBIDDEN' });
  await assert.rejects(f.decide(f.builder), { code: 'FORBIDDEN' });
  // Approvers cannot request approval (they cannot write tasks).
  await assert.rejects(f.request(f.approver), { code: 'FORBIDDEN' });
  assert.equal((await f.decide(f.approver)).status, 'approved');
});

test('employees see only their own approval requests in the company budget; approvers see all', async t => {
  const f = await setup(t);
  await f.own(f.employee);
  await f.request(f.employee);
  assert.equal((await f.app.companyBudget(f.other, f.tenantId)).requests.length, 0);
  assert.equal((await f.app.companyBudget(f.employee, f.tenantId)).requests.length, 1);
  assert.equal((await f.app.companyBudget(f.approver, f.tenantId)).requests.length, 1);
  await assert.rejects(f.app.companyBudget(f.stranger, f.tenantId), { code: 'FORBIDDEN' });
  await assert.rejects(f.app.configureBudget(f.approver, f.tenantId, { limitMinor: 1, expectedVersion: 1 }, randomUUID()), { code: 'FORBIDDEN' });
});

test('an approval stops authorizing funding once the approver\'s access epoch changes', async t => {
  const f = await setup(t);
  await f.own(f.employee);
  await f.request(f.employee);
  await f.decide(f.approver);
  // Role change / removal and re-add bump the epoch: the old decision must not fund work.
  f.approver.memberships[0].accessEpoch = 2;
  await assert.rejects(f.fund(f.employee), { code: 'APPROVAL_REQUIRED' });
  f.approver.memberships[0].accessEpoch = 1;
  // The requester's epoch is bound too.
  f.employee.memberships[0].accessEpoch = 2;
  await assert.rejects(f.fund(f.employee), { code: 'APPROVAL_REQUIRED' });
  // Control: with both epochs unchanged the same approval funds the work.
  f.employee.memberships[0].accessEpoch = 1;
  const funded = await f.fund(f.employee);
  assert.ok(['awaiting_payment', 'funded'].includes(funded.status), JSON.stringify(funded));
});

test('a demoted approver\'s approval no longer funds work', async t => {
  const f = await setup(t);
  await f.own(f.employee);
  await f.request(f.employee);
  await f.decide(f.approver);
  f.approver.memberships[0].role = 'employee';
  await assert.rejects(f.fund(f.employee), { code: 'FORBIDDEN' });
  f.approver.memberships[0].role = 'approver';
  assert.ok(await f.fund(f.employee), 'control: restored role funds');
});

test('risk: a project lead who posted the request can approve their own spend', async t => {
  // docs/specs/Enterprise-and-Projects.md lets the lead approve project work, but says nothing
  // about separation of duties. Today the lead can be requester and approver of the same request.
  const f = await setup(t);
  const { projectId } = await f.app.createProject(f.buyer, f.tenantId, { name: 'Wave 2', description: '', leadId: f.lead.user.id, memberIds: [], capMinor: 1000 }, randomUUID());
  await f.own(f.lead);
  await f.app.moveTask(f.lead, f.taskId, { expectedVersion: await f.version(), projectId }, randomUUID());
  await f.request(f.lead);
  const result = await f.decide(f.lead);
  assert.equal(result.status, 'approved', 'self-approval by the lead is currently allowed');
  const task = await f.repository.read(r => r.get('task', f.taskId));
  assert.equal(task.approval.requestedBy, task.approval.decidedBy);
  assert.equal(task.approval.decidedAs, 'lead');
});
