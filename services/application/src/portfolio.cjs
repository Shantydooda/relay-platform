'use strict';
const { saveTask } = require('./supplier-feed.cjs');
const { randomUUID } = require('node:crypto');
const { fail, exactKeys, text } = require('../../../packages/contracts/src/input.cjs');

// Publication is a separate, immutable excerpt, never a grant to task artifacts.
function publicExample(example) {
  const { id, title, summary, sample, kind, createdAt } = example;
  return { id, title, summary, sample, kind, createdAt };
}
function createPortfolio(context) {
  const { command, agentFor, taskFor, expected, now, resolveActor, touch, event } = context;
  async function customer(repo, actor, taskId) {
    const task = await taskFor(repo, actor, taskId);
    const current = resolveActor ? await resolveActor(actor.user.id) : actor;
    if (current.recoveryRequired || !current.memberships.some(m => m.id === task.tenantId && m.role === 'owner'))
      fail(403, 'PORTFOLIO_OWNER_REQUIRED', 'Only a current workspace owner can authorize sharing this work.');
    return task;
  }
  async function add(actor, agentId, body, key) {
    exactKeys(body, ['expectedVersion', 'kind', 'taskId', 'title', 'summary', 'sample', 'consent']);
    if (!['owned', 'relay-task'].includes(body.kind)) fail(400, 'INVALID_INPUT', 'Choose an original example or accepted Relay work.');
    const content = { title: text(body.title, 'Title', 1, 120), summary: text(body.summary, 'Summary', 1, 1200), sample: text(body.sample, 'Sample output', 1, 6000) };
    if (body.consent !== 'redacted-sharing-rights') fail(400, 'CONSENT_REQUIRED', 'Confirm the excerpt is redacted and you have the rights to propose sharing it.');
    if (body.kind === 'owned' && body.taskId) fail(400, 'INVALID_INPUT', 'Original examples cannot reference customer work.');
    async function authorize(repo) {
      // Task mutations elsewhere use task -> agent order. Keep that order here.
      if (body.kind === 'relay-task') {
        if (typeof body.taskId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.taskId))
          fail(400, 'INVALID_INPUT', 'Choose accepted Relay work.');
        await repo.get('task', body.taskId, true);
      }
      return agentFor(repo, actor, agentId);
    }
    return command(actor.user.id, key, ['portfolio-add', agentId, body], authorize, async repo => {
      const agent = await agentFor(repo, actor, agentId);
      expected(agent, body.expectedVersion);
      if ((await repo.portfolioRecords('agentId', agentId)).length >= 20)
        fail(409, 'PORTFOLIO_LIMIT', 'This agent has reached the 20-example history limit.');
      let task = null;
      if (body.kind === 'relay-task') {
        task = typeof body.taskId === 'string' ? await repo.get('task', body.taskId, true) : null;
        if (!task || task.assignment?.agentId !== agentId || task.assignment?.status !== 'accepted')
          fail(404, 'NOT_FOUND', 'Choose accepted work completed by this agent.');
        if ((await repo.portfolioRecords('taskId', task.id)).length >= 20)
          fail(409, 'PORTFOLIO_LIMIT', 'This task has reached the sharing-request history limit.');
      }
      const stamp = now();
      const example = { id: randomUUID(), ownerId: actor.user.id, tenantId: task?.tenantId || '', agentId,
        agentName: agent.name, taskId: task?.id || null, kind: body.kind, ...content,
        status: task ? 'pending' : 'published', version: 1, createdAt: stamp,
        history: [{ action: task ? 'requested' : 'rights-attested', actorId: actor.user.id, at: stamp }] };
      await repo.save('portfolio', example);
      if (task) { touch(task, stamp); event(task, actor.user.id, 'portfolio.requested', stamp); await saveTask(repo, task); }
      agent.version++;
      await repo.save('agent', agent);
      return { exampleId: example.id, status: example.status };
    }, `agent:${agentId}`);
  }
  async function decide(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'action']);
    if (!['approve', 'decline', 'revoke', 'withdraw'].includes(body.action)) fail(400, 'INVALID_INPUT', 'Invalid sharing decision.');
    async function authorize(repo) {
      const example = await repo.get('portfolio', id, true);
      if (!example) fail(404, 'NOT_FOUND', 'Example not found.');
      if (body.action === 'withdraw') {
        if (example.taskId) await repo.get('task', example.taskId, true);
        await agentFor(repo, actor, example.agentId);
      }
      else if (example.kind === 'relay-task') await customer(repo, actor, example.taskId);
      else fail(403, 'FORBIDDEN', 'This example has no customer approval.');
      return example;
    }
    return command(actor.user.id, key, ['portfolio-decision', id, body], authorize, async repo => {
      const example = await authorize(repo);
      expected(example, body.expectedVersion);
      const allowed = body.action === 'withdraw' ? ['pending', 'published'] : body.action === 'revoke' ? ['published'] : ['pending'];
      if (!allowed.includes(example.status)) fail(409, 'INVALID_STATE', 'This sharing request has already changed.');
      example.status = { approve: 'published', decline: 'declined', revoke: 'revoked', withdraw: 'withdrawn' }[body.action];
      example.version++;
      example.history.push({ action: body.action, actorId: actor.user.id, at: now() });
      await repo.save('portfolio', example);
      if (example.taskId) {
        const task = await repo.get('task', example.taskId, true);
        touch(task, now()); event(task, actor.user.id, 'portfolio.' + body.action, now()); await saveTask(repo, task);
      }
      return { exampleId: id, status: example.status };
    }, `portfolio:${id}`);
  }
  async function forTask(repo, actor, task) {
    const current = resolveActor ? await resolveActor(actor.user.id) : actor;
    const canDecide = !current.recoveryRequired && current.memberships.some(m => m.id === task.tenantId && m.role === 'owner');
    return (await repo.portfolioRecords('taskId', task.id)).map(({ history, ownerId, tenantId, ...item }) => ({ ...item, canDecide }));
  }
  return { add, decide, forTask, publicExample };
}
module.exports = { createPortfolio, publicExample };
