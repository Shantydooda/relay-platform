'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');

function pageInput(after = '', limit = 50) {
  if (typeof after !== 'string' || after.length > 150 || !/^[A-Za-z0-9:_-]*$/.test(after)) fail(400, 'INVALID_CURSOR', 'Cursor is invalid.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'INVALID_INPUT', 'Page size must be 1–100.');
  return { after, limit };
}
async function saveTask(repo, task) {
  // Acquire an assigned agent before the budget; execution uses the same order.
  if (task.assignment) await repo.get('agent', task.assignment.agentId, true);
  await require('./approvals.cjs').syncApproval(repo, task);
  await repo.save('task', task);
  if (!task.assignment) return;
  const assignment = task.assignment;
  // All assignment mutations lock the task first, then the agent. This also
  // serializes per-agent event sequencing across different tasks and workers.
  const agent = await repo.get('agent', assignment.agentId, true);
  if (!agent) throw new Error('Assigned agent is unavailable.');
  const sequence = (await repo.get('supplier-sequence', agent.id)) || { id: agent.id, ownerId: agent.ownerId, value: 0 };
  sequence.value++;
  await repo.save('supplier-sequence', sequence);
  await repo.save('supplier-event', {
    id: `${agent.id}:${String(sequence.value).padStart(16, '0')}`, ownerId: agent.ownerId, tenantId: agent.id,
    sequence: sequence.value, taskId: task.id, assignmentId: assignment.id, taskVersion: task.version,
    type: task.events.at(-1).type, status: assignment.status, occurredAt: task.updatedAt
  });
  await repo.save('agent-grant', { id: assignment.id, ownerId: agent.ownerId, tenantId: agent.id, taskId: task.id, agentId: agent.id, status: assignment.status });
  await repo.save('execution-index', { id: task.id, ownerId: task.ownerId, tenantId: task.tenantId, status: assignment.status });
}
function createSupplierFeed({ repository, credentials, opportunityView }) {
  async function events(principal, after = '', limit = 50) {
    const page = pageInput(after, limit);
    if (after && !after.startsWith(`${principal.agentId}:`)) fail(400, 'INVALID_CURSOR', 'Use a cursor from this agent.');
    return repository.read(async repo => {
      await credentials.runtimeAgent(repo, principal, 'assignments:read');
      const rows = await repo.page('supplier-event', 'tenant_id', principal.agentId, page);
      return { events: rows.map(({ id, sequence, taskId, assignmentId, taskVersion, type, status, occurredAt }) =>
        ({ id, sequence, taskId, assignmentId, taskVersion, type, status, occurredAt })),
        nextCursor: rows.at(-1)?.id || after, hasMore: rows.length === limit };
    });
  }
  async function assignment(principal, id) {
    return repository.read(async repo => {
      await credentials.runtimeAgent(repo, principal, 'assignments:read');
      const task = await repo.get('task', id);
      if (!task?.assignment || task.assignment.agentId !== principal.agentId || task.assignment.operatorId !== principal.actor.user.id) fail(404, 'NOT_FOUND', 'Assignment not found.');
      const { id: assignmentId, status, attempt, leaseUntil, deadlineAt, progress, error } = task.assignment;
      const toolGrants = (await repo.list('tool-grant', 'tenant_id', task.tenantId)).filter(grant => grant.subjectKind === 'task' && grant.subjectId === id && grant.assignmentId === assignmentId && grant.agentId === principal.agentId && grant.status === 'active').map(({ id, sourceId, operation, expiresAt }) => ({ id, sourceId, operation, expiresAt }));
      return { taskId: id, assignmentId, messages: task.messages.map(({authorId,...message})=>message), changeProposals: task.changeProposals || [], contextReferences: (task.contextReferences || []).map(({content,...ref}) => ref), permissionRequests: task.permissionRequests || [], toolGrants, taskVersion: task.version, status, attempt, leaseUntil: leaseUntil || null,
        deadlineAt: deadlineAt || null, progress, error: error || null,
        submissions: task.submissions.map(item => ({ id: item.id, version: item.version, status: item.status })) };
    });
  }
  async function opportunities(principal, after = '', limit = 50) {
    const page = pageInput(after, limit);
    return repository.read(async repo => {
      await credentials.runtimeAgent(repo, principal, 'opportunities:read');
      const rows = await repo.page('task', 'status', 'posted', page);
      return { tasks: rows.filter(task =>
        (!task.preferredAgentId || task.preferredAgentId === principal.agentId) &&
        (!task.preferredOperatorId || task.preferredOperatorId === principal.actor.user.id)
      ).map(task => opportunityView(task, principal.actor)).filter(Boolean),
        nextCursor: rows.at(-1)?.id || after, hasMore: rows.length === limit };
    });
  }
  async function assignments(principal, after = '', limit = 50) {
    const page = pageInput(after, limit);
    return repository.read(async repo => {
      await credentials.runtimeAgent(repo, principal, 'assignments:read');
      const rows = await repo.page('agent-grant', 'tenant_id', principal.agentId, { ...page, statuses: ['queued', 'running'] });
      const assignments = [];
      for (const row of rows) {
        const task = await repo.get('task', row.taskId), value = task?.assignment;
        if (value?.agentId === principal.agentId && ['queued', 'running'].includes(value.status)) assignments.push({ taskId: task.id, assignmentId: value.id, status: value.status, attempt: value.attempt, leaseUntil: value.leaseUntil || 0 });
      }
      return { assignments, nextCursor: rows.at(-1)?.id || after, hasMore: rows.length === limit };
    });
  }
  return { supplierEvents: events, supplierAssignment: assignment, supplierOpportunities: opportunities, supplierAssignments: assignments };
}
module.exports = { saveTask, pageInput, createSupplierFeed };
