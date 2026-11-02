'use strict';
const { createHash } = require('node:crypto');
const {
  fail,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');
const labels = {
  'supplier.message': 'Your agent sent a message',
  'change.proposed': 'Revised terms are ready to review',
  'change.accepted': 'Revised terms were accepted',
  'change.declined': 'The original scope was retained',
  'message.added': 'A new message arrived',
  'task.cancelled': 'Task was cancelled',
  'offer.received': 'A new offer arrived',
  'offer.selected': 'An offer was selected',
  'assignment.authorized_local': 'Work is queued',
  'execution.started': 'Work has started',
  'execution.failed': 'Work needs attention',
  'execution.cancelled': 'Work was cancelled',
  'execution.requeued': 'Work is back in the queue',
  'submission.received': 'Delivery is ready to review',
  'delivery.accepted': 'Delivery was accepted',
  'revision.requested': 'A revision was requested',
  'permission.requested': 'An agent needs permission',
  'permission.approved': 'Permission was approved',
  'permission.declined': 'Permission was declined',
  'approval.requested': 'Budget approval requested',
  'approval.approved': 'Budget was approved',
  'approval.declined': 'Budget was declined',
  'schedule.run_created': 'A scheduled run was created',
};
const supplierTypes = new Set([
  'change.accepted', 'change.declined',
  'message.added',
  'task.cancelled',
  'offer.selected',
  'assignment.authorized_local',
  'execution.failed',
  'execution.cancelled',
  'delivery.accepted',
  'revision.requested',
  'permission.approved',
  'permission.declined',
]);
function createNotifications({ repository, now, resolveActor }) {
  async function collect(repo, actor) {
    if (!actor?.user?.id || actor.recoveryRequired)
      fail(403, 'FORBIDDEN', 'Sign in to view notifications.');
    const current = resolveActor ? await resolveActor(actor.user.id) : actor;
    const tasks = new Map();
    for (const member of current.memberships) {
      let after = '';
      while (true) {
        const page = await repo.page('task', 'tenant_id', member.id, {
          after,
          limit: 100,
        });
        for (const task of page) {
          const own = task.ownerId === actor.user.id || member.role === 'owner';
          if (own || member.role === 'approver')
            tasks.set(task.id, { task, side: 'buyer', approvalOnly: !own });
        }
        if (page.length < 100) break;
        after = page.at(-1).id;
      }
    }
    let after = '';
    while (true) {
      const page = await repo.page('offer-index', 'owner_id', actor.user.id, {
        after,
        limit: 100,
      });
      for (const index of page) {
        if (tasks.has(index.taskId)) continue;
        const task = await repo.get('task', index.taskId);
        if (
          task?.offers?.some(
            (o) =>
              o.id === task.selectedOfferId && o.operatorId === actor.user.id,
          )
        )
          tasks.set(task.id, { task, side: 'builder' });
      }
      if (page.length < 100) break;
      after = page.at(-1).id;
    }
    const items = [];
    for (const { task, side, approvalOnly } of tasks.values()) {
      for (const event of task.events || []) {
        if (event.type === 'message.added' && event.actorId === actor.user.id)
          continue;
        const title =
          labels[event.type] ||
          (event.type.startsWith('sandbox.')
            ? `Sandbox payment: ${event.type.slice(8).replaceAll('_', ' ').replaceAll('.', ' ')}`
            : null);
        if (
          !title ||
          (approvalOnly && !event.type.startsWith('approval.')) ||
          (side === 'builder' &&
            !supplierTypes.has(event.type) &&
            !event.type.startsWith('sandbox.'))
        )
          continue;
        const id = createHash('sha256')
          .update(`${task.id}:${event.sequence}:${event.type}`)
          .digest('hex');
        items.push({
          id,
          title,
          taskTitle: task.title,
          taskId: task.id,
          tenantId: task.tenantId,
          side,
          destination: approvalOnly ? 'business' : 'task',
          createdAt: event.createdAt,
        });
      }
    }
    items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    return items.slice(0, 100);
  }
  return {
    async notifications(actor) {
      return repository.read(async (repo) => {
        const items = await collect(repo, actor);
        for (const item of items)
          item.read = !!(await repo.get(
            'notification-read',
            `${actor.user.id}:${item.id}`,
          ));
        return { items, unread: items.filter((item) => !item.read).length };
      });
    },
    async readNotifications(actor, body) {
      exactKeys(body, ['ids']);
      if (
        !Array.isArray(body.ids) ||
        body.ids.length > 100 ||
        body.ids.some(
          (id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id),
        )
      )
        fail(400, 'INVALID_INPUT', 'Choose valid notifications.');
      return repository.transaction(
        `notifications:${actor.user.id}`,
        async (repo) => {
          const allowed = new Set(
            (await collect(repo, actor)).map((item) => item.id),
          );
          if (body.ids.some((id) => !allowed.has(id)))
            fail(404, 'NOT_FOUND', 'Notification is no longer available.');
          for (const id of new Set(body.ids))
            await repo.save('notification-read', {
              id: `${actor.user.id}:${id}`,
              ownerId: actor.user.id,
              readAt: now(),
            });
          return { ok: true };
        },
      );
    },
  };
}
module.exports = { createNotifications };
