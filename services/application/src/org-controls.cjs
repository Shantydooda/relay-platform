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

const { randomUUID } = require('node:crypto');
const { fail, exactKeys } = require('../../../packages/contracts/src/input.cjs');

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
    return repository.read(async repo => { const p = await policyOf(repo, tenantId); return { tenantId, membersCanPublish: p.membersCanPublish, version: p.version }; });
  }

  async function setOrgPolicy(actor, tenantId, body, key) {
    exactKeys(body, ['membersCanPublish', 'expectedVersion']);
    if (typeof body.membersCanPublish !== 'boolean' || !Number.isSafeInteger(body.expectedVersion)) fail(400, 'INVALID_INPUT', 'Choose whether members can publish agents.');
    await company(actor, tenantId, ['owner']);
    return command(actor.user.id, key, ['org-policy', tenantId, body], () => company(actor, tenantId, ['owner']), async repo => {
      const policy = await policyOf(repo, tenantId);
      if (policy.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', 'This setting changed. Refresh and try again.');
      const time = now();
      const saved = { ...policy, ownerId: tenantId, tenantId, membersCanPublish: body.membersCanPublish, version: policy.version + 1, updatedAt: time };
      await repo.save('org-policy', saved);
      await repo.save('audit-entry', { id: entryId(time), ownerId: actor.user.id, tenantId, at: time, actorId: actor.user.id, type: 'policy.changed',
        detail: `Members can publish agents: ${body.membersCanPublish ? 'on' : 'off'}` });
      return { tenantId, membersCanPublish: saved.membersCanPublish, version: saved.version };
    });
  }

  // Companies whose policy stops this account publishing (owners are exempt).
  async function blockers(repo, actor) {
    const memberships = ((await current(actor)).memberships || []).filter(m => m.company && m.role !== 'owner');
    const blocked = [];
    for (const m of memberships) if (!(await policyOf(repo, m.id)).membersCanPublish) blocked.push({ id: m.id, name: m.name || 'your organization' });
    return blocked;
  }
  async function publishing(actor) {
    return repository.read(async repo => { const blockedBy = await blockers(repo, actor); return { allowed: !blockedBy.length, blockedBy }; });
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

  return { orgPolicy, setOrgPolicy, publishing, assertCanPublish, recordFileAccess, orgAudit, auditCsv };
}

function auditCsv(audit) {
    const cell = value => { let v = String(value ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`; return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v; };
    const lines = [['Time (UTC)', 'Who', 'Action', 'Request', 'File', 'Detail'].join(',')];
    for (const e of audit.entries) lines.push([new Date(e.at).toISOString(), e.actor, e.action, e.taskTitle, e.filename, e.detail].map(cell).join(','));
    return lines.join('\n') + '\n';
}

module.exports = { createOrgControls, auditCsv, EVENT_LABELS };
