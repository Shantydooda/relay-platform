'use strict';
// Enterprise projects (docs/specs/Enterprise-and-Projects.md): a folder plus a
// budget cap inside the company allowance, shared visibility for members, and
// approval by the project lead.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');

async function setup(t, adapter = 'sqlite') {
  const f = await fixture(t, adapter), tenantId = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  const person = (name, role) => ({ user: { id: randomUUID(), name }, memberships: [{ id: tenantId, role, company: true }] });
  const employee = person('Requester', 'employee'), lead = person('Lead', 'employee'), analyst = person('Analyst', 'employee'),
    outsider = person('Outsider', 'employee'), approver = person('Approver', 'approver');
  const actors = [f.buyer, employee, lead, analyst, outsider, approver, f.builder, f.stranger];
  const app = createApplication({ ...f.options, resolveOperator: async id => actors.find(a => a.user.id === id), resolveActor: async id => actors.find(a => a.user.id === id) });
  const cloneTask = async (id = randomUUID()) => {
    await f.repository.transaction('fixture', async repo => {
      const task = await repo.get('task', f.taskId, true);
      await repo.save('task', { ...task, id, ownerId: employee.user.id, companyApprovalRequired: true });
    });
    return id;
  };
  await f.repository.transaction('fixture', async repo => {
    const task = await repo.get('task', f.taskId, true); task.ownerId = employee.user.id; task.companyApprovalRequired = true; await repo.save('task', task);
  });
  await app.configureBudget(f.buyer, tenantId, { limitMinor: 5000, expectedVersion: 0 }, randomUUID());
  const create = (body = {}, who = f.buyer) => app.createProject(who, tenantId,
    { name: 'NetSuite migration – Wave 2', description: 'Item and vendor master cleanup', leadId: lead.user.id, memberIds: [analyst.user.id, employee.user.id], capMinor: 800, ...body }, randomUUID());
  const version = async id => (await f.repository.read(r => r.get('task', id))).version;
  const move = async (projectId, id = f.taskId, who = employee) => app.moveTask(who, id, { expectedVersion: await version(id), projectId }, randomUUID());
  const request = async (id = f.taskId) => app.requestApproval(employee, id, { expectedVersion: await version(id), note: 'Vendor master load' }, randomUUID());
  const decide = async (who, id = f.taskId) => {
    const task = await f.repository.read(r => r.get('task', id));
    return app.decideApproval(who, id, { approvalId: task.approval.id, expectedVersion: task.approval.version, decision: 'approved', note: 'Within the wave budget' }, randomUUID());
  };
  return { ...f, app, tenantId, employee, lead, analyst, outsider, approver, create, move, request, decide, cloneTask, version };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: only owners create projects, with current company members`, async t => {
    const f = await setup(t, adapter);
    const { projectId } = await f.create();
    const list = await f.app.projects(f.buyer, f.tenantId);
    assert.equal(list.length, 1);
    assert.equal(list[0].name, 'NetSuite migration – Wave 2');
    assert.deepEqual({ ...list[0].budget }, { capMinor: 800, reservedMinor: 0, committedMinor: 0, availableMinor: 800, currency: 'USD' });
    await assert.rejects(f.create({}, f.employee), { code: 'FORBIDDEN' });
    await assert.rejects(f.create({ leadId: f.stranger.user.id }), { code: 'INVALID_INPUT' });
    await assert.rejects(f.create({ memberIds: [f.builder.user.id] }), { code: 'INVALID_INPUT' });
    // Members see their projects; other employees don't.
    assert.equal((await f.app.projects(f.analyst, f.tenantId)).length, 1);
    assert.equal((await f.app.projects(f.outsider, f.tenantId)).length, 0);
    await assert.rejects(f.app.project(f.outsider, projectId), { code: 'NOT_FOUND' });
    await assert.rejects(f.app.projects(f.stranger, f.tenantId), { code: 'FORBIDDEN' });
  });

  test(`${adapter}: project members see the project's work, read-only`, async t => {
    const f = await setup(t, adapter);
    const { projectId } = await f.create();
    await assert.rejects(f.app.detail(f.analyst, f.taskId), { code: 'NOT_FOUND' });
    await f.move(projectId);
    assert.equal((await f.app.detail(f.analyst, f.taskId)).task.projectId, projectId);
    assert.deepEqual({ ...(await f.app.detail(f.analyst, f.taskId)).project }, { id: projectId, name: 'NetSuite migration – Wave 2', status: 'active', leadId: f.lead.user.id });
    assert.equal((await f.app.detail(f.analyst, f.taskId)).postedBy, 'Requester');
    assert.equal((await f.app.detail(f.analyst, f.taskId)).mine, false);
    assert.equal((await f.app.detail(f.employee, f.taskId)).mine, true);
    assert.equal((await f.app.project(f.analyst, projectId)).tasks.length, 1);
    await assert.rejects(f.app.detail(f.outsider, f.taskId), { code: 'NOT_FOUND' });
    // Seeing isn't changing: a member can't post on someone else's task.
    await assert.rejects(f.app.mutateTask(f.analyst, f.taskId, 'messages', { expectedVersion: await f.version(f.taskId), body: 'Hi' }, randomUUID()), { code: 'NOT_FOUND' });
    // Leaving the company removes project access on the next request.
    f.analyst.memberships = [];
    await assert.rejects(f.app.detail(f.analyst, f.taskId), { code: 'NOT_FOUND' });
    await assert.rejects(f.app.project(f.analyst, projectId), { code: 'FORBIDDEN' });
  });

  test(`${adapter}: the lead approves within the project cap, inside the company limit`, async t => {
    const f = await setup(t, adapter);
    const { projectId } = await f.create();
    const second = await f.cloneTask();
    await f.move(projectId);
    await f.request();
    await assert.rejects(f.decide(f.analyst), { code: 'FORBIDDEN' });
    // The lead's queue lives on the project page, with the request reason.
    const queued = (await f.app.project(f.lead, projectId)).tasks.find(task => task.id === f.taskId);
    assert.equal(queued.approval.status, 'pending');
    assert.equal(queued.approval.note, 'Vendor master load');
    assert.equal(queued.approvalActions.approve.allowed, true);
    assert.equal((await f.app.project(f.analyst, projectId)).tasks[0].approvalActions.approve.allowed, false);
    await f.decide(f.lead);
    const view = await f.app.project(f.lead, projectId);
    assert.equal(view.budget.reservedMinor, 500);
    assert.equal(view.budget.availableMinor, 300);
    assert.equal((await f.app.companyBudget(f.buyer, f.tenantId)).budget.reservedMinor, 500);
    // A second $500 quote fits the company ($4,500 left) but not the project ($300 left).
    await f.move(projectId, second);
    await f.request(second);
    await assert.rejects(f.decide(f.lead, second), { code: 'PROJECT_BUDGET_EXCEEDED' });
    await assert.rejects(f.decide(f.approver, second), { code: 'PROJECT_BUDGET_EXCEEDED' });
    // The cap can't drop below what the project holds.
    const project = (await f.app.project(f.buyer, projectId)).project;
    await assert.rejects(f.app.updateProject(f.buyer, projectId, { expectedVersion: project.version, capMinor: 400 }, randomUUID()), { code: 'PROJECT_BUDGET_RESERVED' });
    await f.app.updateProject(f.buyer, projectId, { expectedVersion: project.version, capMinor: 1000 }, randomUUID());
    await f.decide(f.lead, second);
    assert.equal((await f.app.project(f.buyer, projectId)).budget.reservedMinor, 1000);
  });

  test(`${adapter}: competing lead approvals can't overbook the project`, async t => {
    const f = await setup(t, adapter);
    const { projectId } = await f.create();
    const second = await f.cloneTask();
    await f.move(projectId); await f.move(projectId, second);
    await f.request(); await f.request(second);
    const results = await Promise.allSettled([f.decide(f.lead), f.decide(f.lead, second)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'PROJECT_BUDGET_EXCEEDED');
    assert.equal((await f.app.project(f.buyer, projectId)).budget.reservedMinor, 500);
  });
}

test('a lead can only approve work in their own project', async t => {
  const f = await setup(t);
  await f.create();
  await f.request();
  await assert.rejects(f.decide(f.lead), { code: 'FORBIDDEN' });
});

test('moving a task to another project makes its approval stale and releases the money', async t => {
  const f = await setup(t);
  const { projectId } = await f.create();
  const other = (await f.create({ name: 'Wave 3' })).projectId;
  await f.move(projectId); await f.request(); await f.decide(f.lead);
  await f.move(other);
  assert.equal((await f.app.detail(f.employee, f.taskId)).approval.status, 'stale');
  assert.equal((await f.app.project(f.buyer, projectId)).budget.reservedMinor, 0);
  assert.equal((await f.app.companyBudget(f.buyer, f.tenantId)).budget.reservedMinor, 0);
  // Only members of the target project (or owners) can file work into it.
  await assert.rejects(f.move(projectId, f.taskId, f.outsider), { code: 'NOT_FOUND' });
});

test('replacing the lead voids their approvals at start', async t => {
  const f = await setup(t);
  const { projectId } = await f.create();
  await f.move(projectId); await f.request(); await f.decide(f.lead);
  const project = (await f.app.project(f.buyer, projectId)).project;
  await f.app.updateProject(f.buyer, projectId, { expectedVersion: project.version, leadId: f.analyst.user.id }, randomUUID());
  await assert.rejects(f.app.sandboxPayment(f.employee, f.taskId, 'fund', { expectedVersion: await f.version(f.taskId) }, randomUUID()), { code: 'APPROVAL_REQUIRED' });
});

test('archived projects accept no new work; new requests can be filed into a project', async t => {
  const f = await setup(t);
  const { projectId } = await f.create();
  const { taskId } = await f.app.createTask(f.analyst, { tenantId: f.tenantId, title: 'Vendor dedupe', brief: 'Remove duplicate vendors', projectId }, randomUUID());
  assert.equal((await f.app.detail(f.lead, taskId)).task.projectId, projectId);
  await assert.rejects(f.app.createTask(f.outsider, { tenantId: f.tenantId, title: 'Sneak in', brief: 'Not a member', projectId }, randomUUID()), { code: 'NOT_FOUND' });
  const project = (await f.app.project(f.buyer, projectId)).project;
  await f.app.updateProject(f.buyer, projectId, { expectedVersion: project.version, status: 'archived' }, randomUUID());
  await assert.rejects(f.app.createTask(f.analyst, { tenantId: f.tenantId, title: 'Late', brief: 'After archive', projectId }, randomUUID()), { code: 'PROJECT_ARCHIVED' });
});
