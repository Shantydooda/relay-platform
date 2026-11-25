'use strict';

// Organization controls (docs/specs/Enterprise-and-Projects.md → "Enterprise roadmap", step 1).
//
// - Members can publish agents: a company owner can switch it off. Members of
//   that company then can't create or publish agents or send offers from that
//   account. Agents belong to people, not companies, so the rule follows the
//   account rather than the active workspace. Owners are never blocked.
// - File access log: every human preview or download of a task file is recorded
//   against the task's workspace, so company owners can see who opened what.
// - Organization audit log: task events plus file access for one company, for
//   owners, newest first, exportable as CSV.
// - Builder organizations (step 2): a member acts for the organization from the
//   Build area. The organization is then the operator: it owns the agents,
//   connection keys, offers, work and reputation. Owners can always act for it;
//   members can when "Members can publish agents" is on. Access is checked
//   again on every request, so leaving the organization ends it at once, and
//   each change is logged against the person who made it.

const { randomUUID } = require('node:crypto');
const { fail, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { REGIONS, regionInput, requirement } = require('./processing-region.cjs');

const AUDIT_LIMIT = 500;   // rows returned
const TASK_LIMIT = 100;    // requests read per export
const RECORD_LIMIT = 100;  // newest file and setting records
const EVENT_LABELS = {
  'task.created': 'Request drafted', 'task.posted': 'Request posted', 'task.cancelled': 'Request cancelled', 'task.retried': 'Tried another agent',
  'task.project_changed': 'Moved to another project', 'scope.updated': 'Scope changed', 'criteria.updated': 'Checklist changed', 'input.attached': 'Input file attached',
  'offer.received': 'Offer received', 'offer.selected': 'Offer chosen', 'package.bought': 'Package bought', 'approval.requested': 'Approval requested',
  'assignment.authorized_local': 'Work started', 'execution.started': 'Agent picked up the work and its input', 'execution.progress': 'Agent progress update',
  'submission.received': 'Delivery received', 'delivery.accepted': 'Delivery accepted', 'delivery.auto_accepted': 'Delivery accepted automatically',
  'revision.requested': 'Revision requested', 'execution.failed': 'Work failed', 'execution.cancelled': 'Work cancelled', 'execution.ended_unmet': 'Ended as unmet',
  'access.requested': 'Data access requested', 'access.granted': 'Data access granted', 'access.declined': 'Data access declined', 'access.revoked': 'Data access revoked',
  'permission.approved': 'Permission approved', 'permission.declined': 'Permission declined', 'supplier.message': 'Builder message',
  'attachment.added': 'File attached', 'attachment.removed': 'File removed', 'intake.updated': 'ERP details updated', 'checks.updated': 'Automatic checks changed',
  'execution.blocked_by_buyer': 'Work paused by the buyer', 'approval.granted': 'Approved', 'approval.declined': 'Approval declined',
  'file.scan_requested': 'File scan requested', 'file.previewed': 'File previewed', 'file.downloaded': 'File downloaded', 'policy.changed': 'Organization setting changed',
  'builder.agent_created': 'Agent created', 'builder.agent_changed': 'Agent changed', 'builder.listing_changed': 'Listing changed', 'builder.offer_rules_changed': 'Automatic offers changed',
  'builder.offer_sent': 'Offer sent', 'builder.key_created': 'Connection key created', 'builder.key_revoked': 'Connection key revoked', 'builder.test_started': 'Relay test started',
  'builder.portfolio_changed': 'Portfolio changed', 'builder.package_changed': 'Package changed', 'builder.work_updated': 'Work updated', 'builder.message_sent': 'Builder message',
};
// Commands a member can run for an organization, and how the log names them.
const ORG_ACTIONS = {
  addAgent: 'builder.agent_created', updateAgent: 'builder.agent_changed', updateListing: 'builder.listing_changed', configure: 'builder.offer_rules_changed', quote: 'builder.offer_sent',
  issueCredential: 'builder.key_created', issueSupplierCredential: 'builder.key_created', revokeCredential: 'builder.key_revoked', startQualification: 'builder.test_started',
  addPortfolio: 'builder.portfolio_changed', decidePortfolio: 'builder.portfolio_changed', savePackage: 'builder.package_changed', setPackageStatus: 'builder.package_changed',
  claim: 'builder.work_updated', progress: 'builder.work_updated', submit: 'builder.work_updated', failExecution: 'builder.work_updated', supplierMessage: 'builder.message_sent',
};

function createOrgControls(context) {
  const { repository, command, now, resolveOperator, resolveActor } = context;

  async function current(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to continue.');
    const resolve = resolveActor || resolveOperator;
    return resolve ? (await resolve(actor.user.id)) || { user: actor.user, memberships: [] } : actor;
  }
  async function company(actor, tenantId, roles) {
    const m = ((await current(actor)).memberships || []).find(item => item.id === tenantId && item.company);
    if (!m || (roles && !roles.includes(m.role))) fail(403, 'FORBIDDEN', 'Your company role cannot perform this action.');
    return m;
  }
  const policyOf = async (repo, tenantId) => (await repo.get('org-policy', tenantId)) || { id: tenantId, tenantId, membersCanPublish: true, version: 0 };

  // Sortable ids keep the log in time order without a timestamp index.
  function entryId(time) { return `${String(time).padStart(15, '0')}-${randomUUID()}`; }

  async function orgPolicy(actor, tenantId) {
    await company(actor, tenantId);
    return repository.read(async repo => policyView(await policyOf(repo, tenantId)));
  }

  const policyView = p => ({ tenantId: p.tenantId, membersCanPublish: p.membersCanPublish, requiredRegion: p.requiredRegion || null, version: p.version });
  // The region a company requires of the agents its requests use (processing-region.cjs).
  const requiredRegion = async (repo, tenantId) => (await repo.get('org-policy', tenantId))?.requiredRegion || null;
  // What one request needs: the company rule, or the region its buyer chose (processing-region.cjs#requirement).
  const requirementFor = async (repo, task) => requirement(await requiredRegion(repo, task.tenantId), task.regionChoice || null);

  async function regionRules(repo, actor) {
    const rules = [];
    for (const m of ((await current(actor)).memberships || []).filter(item => item.company)) {
      const region = (await policyOf(repo, m.id)).requiredRegion;
      if (region) rules.push({ tenantId: m.id, name: await orgName(m), region });
    }
    return rules;
  }

  async function setOrgPolicy(actor, tenantId, body, key) {
    exactKeys(body, ['membersCanPublish', 'requiredRegion', 'expectedVersion']);
    if (!Number.isSafeInteger(body.expectedVersion)) fail(400, 'INVALID_INPUT', 'Refresh and try again.');
    if (body.membersCanPublish !== undefined && typeof body.membersCanPublish !== 'boolean') fail(400, 'INVALID_INPUT', 'Choose whether members can publish agents.');
    const region = body.requiredRegion === undefined ? undefined : regionInput(body.requiredRegion, 'Required region');
    if (body.membersCanPublish === undefined && region === undefined) fail(400, 'INVALID_INPUT', 'Choose a setting to change.');
    await company(actor, tenantId, ['owner']);
    return command(actor.user.id, key, ['org-policy', tenantId, body], () => company(actor, tenantId, ['owner']), async repo => {
      const policy = await policyOf(repo, tenantId);
      if (policy.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', 'This setting changed. Refresh and try again.');
      const time = now();
      const saved = { ...policy, ownerId: tenantId, tenantId, version: policy.version + 1, updatedAt: time };
      const changes = [];
      if (body.membersCanPublish !== undefined && body.membersCanPublish !== policy.membersCanPublish) {
        saved.membersCanPublish = body.membersCanPublish; changes.push(`Members can publish agents: ${body.membersCanPublish ? 'on' : 'off'}`);
      }
      if (region !== undefined && region !== (policy.requiredRegion || null)) {
        saved.requiredRegion = region; changes.push(`Agents must process data in: ${region ? REGIONS[region].replace('the ', '') : 'any region'}`);
        // Open requests follow the new rule at once, so builders only see what they can offer on.
        for (const task of await repo.list('task', 'tenant_id', tenantId)) {
          if (!['draft', 'posted'].includes(task.status)) continue;
          const next = region || task.regionChoice || null;
          if ((task.requiredRegion || null) === next) continue;
          const locked = await repo.get('task', task.id, true);
          locked.requiredRegion = next; await repo.save('task', locked);
        }
      }
      await repo.save('org-policy', saved);
      for (const detail of changes) await repo.save('audit-entry', { id: entryId(time), ownerId: actor.user.id, tenantId, at: time, actorId: actor.user.id, type: 'policy.changed', detail });
      return policyView(saved);
    });
  }

  const lookup = id => Promise.resolve().then(() => resolveOperator?.(id)).catch(() => null);
  const orgName = async m => m.name || (await lookup(m.id))?.user?.name || 'your organization';

  // Companies whose policy stops this account publishing (owners are exempt).
  async function blockers(repo, actor) {
    if (actor.organization) return [];
    const memberships = ((await current(actor)).memberships || []).filter(m => m.company && m.role !== 'owner');
    const blocked = [];
    for (const m of memberships) if (!(await policyOf(repo, m.id)).membersCanPublish) blocked.push({ id: m.id, name: await orgName(m) });
    return blocked;
  }
  // What this account may publish as: itself, and each organization it can act for.
  async function publishing(actor) {
    const companies = ((await current(actor)).memberships || []).filter(m => m.company);
    return repository.read(async repo => {
      const blockedBy = await blockers(repo, actor);
      const organizations = [];
      for (const m of companies) organizations.push({ id: m.id, name: await orgName(m), role: m.role,
        canAct: m.role === 'owner' || (await policyOf(repo, m.id)).membersCanPublish, agents: (await repo.list('agent', 'owner_id', m.id, 1000)).length });
      return { allowed: !blockedBy.length, blockedBy, organizations };
    });
  }

  // The organization a member could manage this agent for, by the same rule as
  // actAs: an owner, or any member while "Members can publish agents" is on.
  async function manageableAs(repo, actor, ownerId) {
    if (actor.organization) return null;
    const m = ((await current(actor)).memberships || []).find(item => item.id === ownerId && item.company);
    if (!m || (m.role !== 'owner' && !(await policyOf(repo, m.id)).membersCanPublish)) return null;
    return { id: m.id, name: await orgName(m) };
  }

  // The identity a member uses to act for an organization. Recomputed on every
  // request from current membership, so a removed member is refused at once.
  async function actAs(actor, orgId) {
    const person = await current(actor);
    if (person.organization) fail(403, 'FORBIDDEN', 'Act for an organization from your own account.');
    const m = (person.memberships || []).find(item => item.id === orgId && item.company);
    if (!m) fail(403, 'FORBIDDEN', 'You are not a member of this organization.');
    const org = await lookup(orgId);
    if (!org?.organization) fail(403, 'FORBIDDEN', 'This organization is unavailable.');
    if (m.role !== 'owner' && !(await repository.read(repo => policyOf(repo, orgId))).membersCanPublish) {
      fail(403, 'ORG_PUBLISHING_OFF', `${org.user.name} lets only its owners publish agents and send offers.`);
    }
    return { user: { id: orgId, name: org.user.name }, memberships: [], organization: true, csrf: actor.csrf,
      onBehalfOf: { id: person.user.id, name: person.user.name, role: m.role } };
  }

  // Records who did what for an organization. Called after the command succeeded.
  async function recordOrgAction(orgActor, method, args) {
    const type = ORG_ACTIONS[method];
    if (!type || !orgActor?.organization || !orgActor.onBehalfOf) return;
    const time = now(), body = args.find(arg => arg && typeof arg === 'object' && !Array.isArray(arg)) || {};
    const id = args.find(arg => typeof arg === 'string' && /^[0-9a-f-]{36}$/.test(arg)) || null;
    await repository.transaction(`audit:${orgActor.user.id}`, async repo => {
      const task = id && await repo.get('task', id);
      const agent = id && !task && await repo.get('agent', id);
      await repo.save('audit-entry', { id: entryId(time), ownerId: orgActor.onBehalfOf.id, tenantId: orgActor.user.id, at: time, actorId: orgActor.onBehalfOf.id, type,
        taskId: task ? task.id : null, taskTitle: task ? task.title : '', detail: agent ? agent.name : method === 'addAgent' ? String(body.name || '').slice(0, 120) : '' });
    });
  }
  async function assertCanPublish(repo, actor) {
    const blocked = await blockers(repo, actor);
    if (blocked.length) fail(403, 'ORG_PUBLISHING_OFF', `${blocked[0].name} doesn’t allow its members to publish agents or send offers. Ask an owner of ${blocked[0].name} to change this.`);
  }

  // Called after a file is read and authorized. A failure to log never hides the
  // file from someone allowed to see it, but it is reported to the caller's logs.
  async function recordFileAccess(actor, file, action) {
    const time = now();
    await repository.transaction(`audit:${file.tenantId}`, repo => repo.save('audit-entry', { id: entryId(time), ownerId: actor.user.id, tenantId: file.tenantId, at: time,
      actorId: actor.user.id, type: action === 'preview' ? 'file.previewed' : 'file.downloaded', taskId: file.taskId, taskTitle: file.taskTitle, filename: file.filename, fileId: file.fileId }));
  }

  async function orgAudit(actor, tenantId) {
    await company(actor, tenantId, ['owner']);
    return repository.read(async repo => {
      const entries = [];
      for (const task of await repo.list('task', 'tenant_id', tenantId, TASK_LIMIT)) {
        for (const e of task.events || []) entries.push({ at: e.createdAt, actorId: e.actorId, type: e.type, taskId: task.id, taskTitle: task.title });
      }
      for (const a of await repo.recent('audit-entry', 'tenant_id', tenantId, RECORD_LIMIT)) entries.push({ at: a.at, actorId: a.actorId, type: a.type, taskId: a.taskId || null, taskTitle: a.taskTitle || '', filename: a.filename || '', detail: a.detail || '' });
      const names = new Map();
      const name = async id => { if (!id) return 'Relay'; if (!names.has(id)) names.set(id, (await resolveOperator?.(id))?.user?.name || 'Former member'); return names.get(id); };
      entries.sort((a, b) => b.at - a.at);
      const rows = [];
      for (const e of entries.slice(0, AUDIT_LIMIT)) rows.push({ ...e, actor: await name(e.actorId), action: EVENT_LABELS[e.type] || e.type.replaceAll('.', ' ').replaceAll('_', ' ') });
      return { tenantId, entries: rows.map(({ actorId, ...row }) => row), truncated: entries.length > AUDIT_LIMIT,
        limits: `Up to ${TASK_LIMIT} requests and the newest ${RECORD_LIMIT} file and setting records. Membership changes are in the access history.` };
    });
  }

  return { orgPolicy, setOrgPolicy, publishing, assertCanPublish, recordFileAccess, orgAudit, auditCsv, actAs, manageableAs, recordOrgAction, requiredRegion, requirementFor, regionRules };
}

function auditCsv(audit) {
    const cell = value => { let v = String(value ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v; };
    const lines = [['Time (UTC)', 'Who', 'Action', 'Request', 'File', 'Detail'].join(',')];
    for (const e of audit.entries) lines.push([new Date(e.at).toISOString(), e.actor, e.action, e.taskTitle, e.filename, e.detail].map(cell).join(','));
    return lines.join('\n') + '\n';
}

module.exports = { createOrgControls, auditCsv, EVENT_LABELS, ORG_ACTIONS };
