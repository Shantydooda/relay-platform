'use strict';

// Enterprise projects (docs/specs/Enterprise-and-Projects.md).
//
// A project is a folder plus a budget cap inside one company workspace:
// - Members see every task filed into it (read-only; only the task's owner or a
//   company owner changes a task). Work outside projects stays private.
// - The cap lives inside the company allowance. There is no second ledger: a
//   project's spend is the company allocations tagged with its id
//   (approvals.cjs), so the two levels can never disagree.
// - The project lead may approve quotes on the project's work (approvals.cjs).
//
// Lock order: task → company budget, as everywhere. Project records are read
// unlocked by approvals after the budget lock; cap changes lock the project,
// then the budget, so no cycle exists.

const { randomUUID } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');

const MAX_PROJECTS = 100;
const MAX_MEMBERS = 50;
const MAX_CAP_MINOR = 100000000;
const PROJECT_FIELDS = ['name', 'description', 'leadId', 'memberIds', 'capMinor'];

function held(entry, now) {
  return entry.status === 'committed' || (entry.status === 'reserved' && entry.expiresAt > now);
}

function isMember(project, userId) {
  return project.leadId === userId || project.memberIds.includes(userId);
}

function projectBudget(project, budget, now) {
  const entries = Object.values(budget?.allocations || {}).filter(e => e.projectId === project.id && held(e, now));
  const reservedMinor = entries.filter(e => e.status === 'reserved').reduce((n, e) => n + e.amountMinor, 0);
  const committedMinor = entries.filter(e => e.status === 'committed').reduce((n, e) => n + e.amountMinor, 0);
  return { capMinor: project.capMinor, reservedMinor, committedMinor, availableMinor: project.capMinor - reservedMinor - committedMinor, currency: 'USD' };
}

function projectView(project) {
  const { id, tenantId, name, description, leadId, memberIds, capMinor, status, version, createdAt, updatedAt } = project;
  return { id, tenantId, name, description, leadId, memberIds: [...memberIds], capMinor, status, version, createdAt, updatedAt };
}

function cap(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CAP_MINOR) fail(400, 'INVALID_INPUT', 'Choose a USD project budget between $0 and $1,000,000.');
  return value;
}

function createProjects(context) {
  const { repository, command, now, resolveOperator, resolveActor, taskFor, taskView, touch, event, expected } = context;

  async function current(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to continue.');
    const resolve = resolveActor || resolveOperator;
    return resolve ? (await resolve(actor.user.id)) || { user: actor.user, memberships: [] } : actor;
  }
  async function companyMember(actor, tenantId, roles) {
    const m = ((await current(actor)).memberships || []).find(item => item.id === tenantId && item.company);
    if (!m || (roles && !roles.includes(m.role))) fail(403, 'FORBIDDEN', 'Your company role cannot perform this action.');
    return m;
  }
  // Lead and members must be current members of the same company.
  async function people(tenantId, leadId, memberIds) {
    text(leadId, 'Project lead', 1, 64);
    if (!Array.isArray(memberIds) || memberIds.length > MAX_MEMBERS) fail(400, 'INVALID_INPUT', `Add up to ${MAX_MEMBERS} members.`);
    const ids = [...new Set(memberIds.map(id => text(id, 'Member', 1, 64)))].filter(id => id !== leadId);
    if (!resolveOperator) fail(503, 'MEMBERSHIP_UNAVAILABLE', 'Company membership cannot be verified.');
    for (const id of [leadId, ...ids]) {
      const person = await resolveOperator(id);
      if (!person?.memberships?.some(m => m.id === tenantId && m.company)) fail(400, 'INVALID_INPUT', 'The lead and members must belong to this company.');
    }
    return ids;
  }
  async function readable(repo, actor, projectId) {
    const project = await repo.get('project', text(projectId, 'Project', 36, 36));
    if (!project) fail(404, 'NOT_FOUND', 'Project not found.');
    const m = await companyMember(actor, project.tenantId);
    if (m.role !== 'owner' && !isMember(project, actor.user.id)) fail(404, 'NOT_FOUND', 'Project not found.');
    return { project, role: m.role };
  }

  async function createProject(actor, tenantId, body, key) {
    exactKeys(body, PROJECT_FIELDS);
    const name = text(body.name, 'Project name', 2, 80);
    const description = body.description ? text(body.description, 'Description', 1, 1000) : '';
    const capMinor = cap(body.capMinor);
    return command(actor.user.id, key, ['project', tenantId, body], () => companyMember(actor, tenantId, ['owner']), async repo => {
      if ((await repo.list('project', 'tenant_id', tenantId, MAX_PROJECTS + 1)).length >= MAX_PROJECTS)
        fail(409, 'PROJECT_LIMIT', `A company can have up to ${MAX_PROJECTS} projects.`);
      const memberIds = await people(tenantId, body.leadId, body.memberIds);
      const time = now();
      const project = { id: randomUUID(), tenantId, ownerId: actor.user.id, name, description, leadId: body.leadId, memberIds, capMinor,
        status: 'active', version: 1, createdAt: time, updatedAt: time };
      await repo.save('project', project);
      await repo.save('project-audit', { id: randomUUID(), tenantId, ownerId: actor.user.id, projectId: project.id, change: 'created', version: 1, createdAt: time });
      return { projectId: project.id, version: project.version };
    }, `project-create:${tenantId}`);
  }

  async function updateProject(actor, projectId, body, key) {
    exactKeys(body, ['expectedVersion', ...PROJECT_FIELDS, 'status']);
    const access = async repo => {
      const project = await repo.get('project', text(projectId, 'Project', 36, 36), true);
      if (!project) fail(404, 'NOT_FOUND', 'Project not found.');
      await companyMember(actor, project.tenantId, ['owner']);
      return project;
    };
    return command(actor.user.id, key, ['project-update', projectId, body], access, async repo => {
      const project = await access(repo); expected(project, body.expectedVersion);
      const changes = [];
      if (body.name !== undefined) { project.name = text(body.name, 'Project name', 2, 80); changes.push('name'); }
      if (body.description !== undefined) { project.description = body.description ? text(body.description, 'Description', 1, 1000) : ''; changes.push('description'); }
      if (body.status !== undefined) {
        if (!['active', 'archived'].includes(body.status)) fail(400, 'INVALID_INPUT', 'Choose active or archived.');
        project.status = body.status; changes.push('status');
      }
      if (body.leadId !== undefined || body.memberIds !== undefined) {
        const leadId = body.leadId ?? project.leadId;
        project.memberIds = await people(project.tenantId, leadId, body.memberIds ?? [...project.memberIds, project.leadId]);
        if (leadId !== project.leadId) changes.push('lead');
        project.leadId = leadId; changes.push('members');
      }
      if (body.capMinor !== undefined) {
        const capMinor = cap(body.capMinor);
        // The budget lock orders this against concurrent approvals.
        const budget = await repo.get('company-budget', project.tenantId, true);
        const used = projectBudget(project, budget, now());
        if (capMinor < used.reservedMinor + used.committedMinor) fail(409, 'PROJECT_BUDGET_RESERVED', 'The project budget cannot be below what it already holds.');
        project.capMinor = capMinor; changes.push('budget');
      }
      project.version++; project.updatedAt = now();
      await repo.save('project', project);
      await repo.save('project-audit', { id: randomUUID(), tenantId: project.tenantId, ownerId: actor.user.id, projectId, change: changes.join(',') || 'none', version: project.version, createdAt: project.updatedAt });
      return { projectId, version: project.version };
    });
  }

  async function projects(actor, tenantId) {
    const m = await companyMember(actor, tenantId);
    return repository.read(async repo => {
      const all = (await repo.list('project', 'tenant_id', tenantId, MAX_PROJECTS))
        .filter(project => m.role === 'owner' || isMember(project, actor.user.id));
      if (!all.length) return [];
      const budget = await repo.get('company-budget', tenantId);
      const tasks = await repo.list('task', 'tenant_id', tenantId, 1000);
      const names = {};
      for (const project of all) if (!(project.leadId in names)) names[project.leadId] = resolveOperator ? (await resolveOperator(project.leadId))?.user?.name || 'Former member' : null;
      return all.map(project => ({ ...projectView(project), leadName: names[project.leadId], budget: projectBudget(project, budget, now()),
        taskCount: tasks.filter(task => task.projectId === project.id).length,
        you: { lead: project.leadId === actor.user.id, member: isMember(project, actor.user.id) } }))
        .sort((a, b) => (a.status === b.status ? 0 : a.status === 'active' ? -1 : 1) || a.name.localeCompare(b.name));
    });
  }

  // The lead's approval queue lives on the project page: the request, its reason
  // and whether this viewer may decide.
  async function approvalFor(repo, actor, task) {
    const approval = require('./approvals.cjs').approvalView(task, now());
    if (!approval?.id) return { approval: null, approvalActions: null };
    const { id, status, version, note, agreement, decisionNote } = approval;
    return { approval: { id, status, version, note, decisionNote: decisionNote || null,
      agreement: { agentName: agreement.agentName, amountMinor: require('./pricing.cjs').buyerTotal(agreement), currency: agreement.currency, scopeVersion: agreement.scopeVersion } },
      approvalActions: await context.approvals.approvalActions(repo, actor, task) };
  }
  async function project(actor, projectId) {
    return repository.read(async repo => {
      const { project, role } = await readable(repo, actor, projectId);
      const budget = await repo.get('company-budget', project.tenantId);
      const tasks = (await repo.list('task', 'tenant_id', project.tenantId, 1000)).filter(task => task.projectId === project.id);
      const members = [];
      for (const id of [project.leadId, ...project.memberIds]) {
        const person = resolveOperator ? await resolveOperator(id) : null;
        const active = !!person?.memberships?.some(m => m.id === project.tenantId && m.company);
        members.push({ id, name: person?.user?.name || 'Former member', role: id === project.leadId ? 'lead' : 'member', active });
      }
      return { project: projectView(project), budget: projectBudget(project, budget, now()), members,
        tasks: await Promise.all(tasks.map(async task => ({ ...taskView(task, now()), mine: task.ownerId === actor.user.id, ...await approvalFor(repo, actor, task) }))),
        you: { owner: role === 'owner', lead: project.leadId === actor.user.id, member: isMember(project, actor.user.id) } };
    });
  }

  // Filing a request into a project: the actor must be in it (or own the company),
  // and it must be active.
  async function checkFiling(repo, actor, tenantId, projectId) {
    const project = await repo.get('project', text(projectId, 'Project', 36, 36));
    if (!project || project.tenantId !== tenantId) fail(404, 'NOT_FOUND', 'Project not found.');
    const m = await companyMember(actor, tenantId);
    if (m.role !== 'owner' && !isMember(project, actor.user.id)) fail(404, 'NOT_FOUND', 'Project not found.');
    if (project.status !== 'active') fail(409, 'PROJECT_ARCHIVED', 'This project is archived. Reopen it to add work.');
    return project;
  }

  async function moveTask(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'projectId']);
    return command(actor.user.id, key, ['task-project', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true); expected(task, body.expectedVersion);
      if (task.assignment || (task.settlement && !['expired', 'refunded'].includes(task.settlement.status)))
        fail(409, 'TASK_COMMITTED', 'Work has started, so it stays in its project.');
      const projectId = body.projectId ?? null;
      if (projectId) await checkFiling(repo, actor, task.tenantId, projectId);
      if ((task.projectId || null) === projectId) return { taskId, version: task.version, projectId };
      // The project is part of the approved agreement (approvals.cjs), so moving
      // makes any approval stale and saveTask releases its reservation.
      if (projectId) task.projectId = projectId; else delete task.projectId;
      const time = now();
      touch(task, time); event(task, actor.user.id, 'task.project_changed', time);
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { taskId, version: task.version, projectId };
    });
  }

  return { createProject, updateProject, projects, project, moveTask, checkFiling };
}

module.exports = { createProjects, projectBudget, isMember, MAX_PROJECTS, MAX_MEMBERS };
