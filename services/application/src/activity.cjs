'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');

// One place to see what happened across your work: who did what, when, on which task.
// Built from each task's immutable event history; it is a view, never authorization.

const LABELS = Object.freeze({
  'task.created': 'Brief saved',
  'task.retried': 'Another agent requested',
  'task.posted': 'Request sent to agents',
  'task.cancelled': 'Request closed',
  'scope.updated': 'Scope updated',
  'scope.reviewed': 'Scope reviewed',
  'criteria.updated': 'Acceptance criteria updated',
  'scoping.requested': 'Relay started drafting the scope',
  'scoping.cancelled': 'Scope drafting cancelled',
  'input.attached': 'File attached',
  'context.updated': 'Attached sources changed',
  'offer.received': 'Quote received',
  'offer.selected': 'Quote selected',
  'approval.requested': 'Approval requested',
  'approval.approved': 'Approval given',
  'approval.declined': 'Approval declined',
  'assignment.authorized_local': 'Work authorized',
  'execution.started': 'Agent started work',
  'execution.progress': 'Agent reported progress',
  'execution.paused': 'Work paused',
  'execution.resumed': 'Work resumed',
  'execution.cancelled': 'Work cancelled',
  'execution.failed': 'Work failed',
  'execution.ended_unmet': 'Work ended: criteria not met',
  'execution.requeued': 'Agent lost its connection; waiting to resume',
  'execution.recovery_requested': 'Retry requested',
  'permission.approved': 'Access approved',
  'permission.declined': 'Access declined',
  'submission.received': 'Delivery received',
  'delivery.auto_accepted': 'Delivery accepted automatically',
  'file.scan_requested': 'Safety scan requested',
  'file.scanned': 'Safety scan finished',
  'supplier.message': 'Message from the agent operator',
  'change.proposed': 'Change proposed',
  'change.accepted': 'Change accepted',
  'change.declined': 'Change declined',
  'change.execution_stopped': 'Work stopped for a change',
  'schedule.enabled': 'Schedule enabled',
  'schedule.offer_selected': 'Scheduled quote selected',
  'plan.created': 'Plan created',
  'plan.accepted': 'Plan completed',
  'plan.recovered': 'Plan recovered',
});

// Unknown or future event types still appear, in a readable form, rather than being dropped.
function labelFor(type) {
  if (LABELS[type]) return LABELS[type];
  const words = String(type || 'update').replace(/[._]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actorFor(event, task, viewerId) {
  if (event.actorId === viewerId) return 'you';
  if (!event.actorId || event.actorId === 'system') return 'relay';
  const operators = new Set([task.assignment?.operatorId, ...(task.offers || []).map(offer => offer.operatorId)].filter(Boolean));
  if (operators.has(event.actorId) || String(event.actorId).startsWith('agent:')) return 'agent';
  return 'workspace';
}

const MAX_ITEMS = 100;

function createActivity({ repository }) {
  async function activity(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to view activity.');
    return repository.read(async repo => {
      const tenants = new Set((actor.memberships || []).map(membership => membership.id));
      // Removed employees cannot keep seeing a workspace's history through old task ownership.
      const tasks = (await repo.list('task', 'owner_id', actor.user.id)).filter(task => tenants.has(task.tenantId));
      const items = [];
      for (const task of tasks) {
        for (const event of task.events || []) {
          items.push({
            taskId: task.id,
            taskTitle: task.title,
            tenantId: task.tenantId,
            type: event.type,
            label: labelFor(event.type),
            actor: actorFor(event, task, actor.user.id),
            createdAt: event.createdAt,
            sequence: event.sequence,
          });
        }
      }
      items.sort((a, b) => b.createdAt - a.createdAt || a.taskId.localeCompare(b.taskId) || b.sequence - a.sequence);
      return { items: items.slice(0, MAX_ITEMS), limit: MAX_ITEMS, truncated: items.length > MAX_ITEMS };
    });
  }
  return { activity };
}

module.exports = { createActivity, labelFor, actorFor };
