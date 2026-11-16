'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createActivity, labelFor, actorFor } = require('../src/activity.cjs');

function repository(tasks) {
  return { read: work => work({ list: async (kind, field, value) => tasks.filter(task => task[field.replace('_id', 'Id')] === value) }) };
}
const actor = { user: { id: 'buyer' }, memberships: [{ id: 'ws' }] };
const task = (id, ownerId, tenantId, events) => ({ id, ownerId, tenantId, title: `Task ${id}`, offers: [{ operatorId: 'builder' }],
  assignment: { operatorId: 'builder' }, events });

test('activity lists your work across tasks, newest first, with who did what', async () => {
  const { activity } = createActivity({ repository: repository([
    task('a', 'buyer', 'ws', [{ type: 'task.created', actorId: 'buyer', createdAt: 1, sequence: 1 }, { type: 'execution.paused', actorId: 'buyer', createdAt: 5, sequence: 2 }]),
    task('b', 'buyer', 'ws', [{ type: 'submission.received', actorId: 'builder', createdAt: 3, sequence: 1 }, { type: 'execution.failed', actorId: 'system', createdAt: 4, sequence: 2 }]),
  ]) });
  const { items, truncated } = await activity(actor);
  assert.deepEqual(items.map(item => [item.taskId, item.label, item.actor]), [
    ['a', 'Work paused', 'you'], ['b', 'Work failed', 'relay'], ['b', 'Delivery received', 'agent'], ['a', 'Brief saved', 'you'],
  ]);
  assert.equal(truncated, false);
});

test('other people’s tasks and workspaces you left are not visible', async () => {
  const { activity } = createActivity({ repository: repository([
    task('mine', 'buyer', 'ws', [{ type: 'task.created', actorId: 'buyer', createdAt: 1 }]),
    task('theirs', 'someone', 'ws', [{ type: 'task.created', actorId: 'someone', createdAt: 2 }]),
    task('old-job', 'buyer', 'former-employer', [{ type: 'task.created', actorId: 'buyer', createdAt: 3 }]),
  ]) });
  assert.deepEqual((await activity(actor)).items.map(item => item.taskId), ['mine']);
  await assert.rejects(activity({ user: null }), /Sign in/);
  await assert.rejects(activity({ ...actor, recoveryRequired: true }), /Sign in/);
});

test('long histories are capped and say so', async () => {
  const events = Array.from({ length: 150 }, (_, index) => ({ type: 'execution.progress', actorId: 'builder', createdAt: index, sequence: index + 1 }));
  const { activity } = createActivity({ repository: repository([task('busy', 'buyer', 'ws', events)]) });
  const result = await activity(actor);
  assert.equal(result.items.length, 100);
  assert.equal(result.truncated, true);
  assert.equal(result.items[0].createdAt, 149);
});

test('unknown event types stay readable and workspace colleagues are distinguished', () => {
  assert.equal(labelFor('portfolio.requested'), 'Portfolio requested');
  assert.equal(labelFor('sandbox.refund.requested'), 'Sandbox refund requested');
  assert.equal(actorFor({ actorId: 'colleague' }, task('x', 'buyer', 'ws', []), 'buyer'), 'workspace');
  assert.equal(actorFor({ actorId: 'agent:123' }, task('x', 'buyer', 'ws', []), 'buyer'), 'agent');
});
