'use strict';
const { createHash } = require('node:crypto');
const {
  fail,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');
const labels = {
  'portfolio.requested': 'A builder requests permission to share an excerpt',
  'portfolio.approve': 'Portfolio sharing was approved',
  'portfolio.decline': 'Portfolio sharing was declined',
  'portfolio.revoke': 'Portfolio permission was revoked',
  'portfolio.withdraw': 'A portfolio excerpt was withdrawn',
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
  'access.requested': 'An agent is asking for access to your systems',
  'access.granted': 'Access to the buyer’s system was granted',
  'access.declined': 'Access to the buyer’s system was declined',
  'access.revoked': 'Access to the buyer’s system was revoked',
  'execution.blocked_by_buyer': 'Work stopped: the agent couldn’t get the access it needs',
  'approval.requested': 'Budget approval requested',
  'approval.approved': 'Budget was approved',
  'approval.declined': 'Budget was declined',
  'schedule.run_created': 'A scheduled run was created',
};
const supplierTypes = new Set([
  'portfolio.approve', 'portfolio.decline', 'portfolio.revoke',
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
  'access.granted',
  'access.declined',
  'access.revoked',
]);
const MATCH_WINDOW_MS = 7 * 86400000;

// Match alerts: posted requests this builder can still offer on that were sent
// to them directly or fit one of their active agents. Derived on each read, so
// nothing goes stale: offering, a buyer choosing someone, or a week passing
// removes the alert. The buyer's workspace is never included.
async function matchAlerts(repo, actor, current, { now, opportunityView }) {
  const agents = await repo.list('agent', 'owner_id', actor.user.id);
  if (!agents.length || typeof opportunityView !== 'function') return [];
  const { agentFits } = require('./capability-matching.cjs');
  const viewer = { ...actor, memberships: current.memberships || [] };
  const items = [];
  for (const task of await repo.list('task', 'status', 'posted')) {
    const postedAt = [...(task.events || [])].reverse().find(event => event.type === 'task.posted')?.createdAt || task.createdAt;
    if (now() - postedAt > MATCH_WINDOW_MS || !opportunityView(task, viewer)) continue;
    if ((task.offers || []).some(offer => offer.operatorId === actor.user.id)) continue;
    let agent = null, direct = false;
    if (task.preferredAgentId) {
      agent = agents.find(item => item.id === task.preferredAgentId);
      direct = !!agent;
    } else {
      agent = agents.find(item => item.listingStatus !== 'paused' && require('./processing-region.cjs').allows(task.requiredRegion, item) && agentFits(item, task));
    }
    if (!agent || !require('./processing-region.cjs').allows(task.requiredRegion, agent)) continue;
    items.push({
      id: createHash('sha256').update(`match:${task.id}:${task.scopeVersion}`).digest('hex'),
      title: direct ? `Sent to you directly: ${agent.name}` : `New request that fits ${agent.name}`,
      taskTitle: task.title, taskId: task.id, tenantId: null, side: 'builder', destination: 'opportunity', createdAt: postedAt,
    });
  }
  return items;
}

// Decisions on Relay tests this account proposed (relay-tests.cjs): approved,
// rejected with a reason, or retired. Derived from each test's history on read.
const TEST_DECISIONS = { approved: 'Your Relay test was approved', rejected: 'Your Relay test was rejected', retired: 'Your Relay test was retired' };
async function testDecisions(repo, actor) {
  const items = [];
  for (const test of await repo.list('relay_test', 'owner_id', actor.user.id)) {
    for (const entry of test.history || []) {
      if (!TEST_DECISIONS[entry.action]) continue;
      items.push({
        id: createHash('sha256').update(`relay-test:${test.id}:${entry.action}:${entry.at}`).digest('hex'),
        title: TEST_DECISIONS[entry.action], taskTitle: test.title, taskId: null, tenantId: null, side: 'builder', destination: 'relay-test', createdAt: entry.at,
      });
    }
  }
  return items;
}

function createNotifications({ repository, now, resolveActor, opportunityView }) {
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
    items.push(...await matchAlerts(repo, actor, current, { now, opportunityView }));
    items.push(...await testDecisions(repo, actor));
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
