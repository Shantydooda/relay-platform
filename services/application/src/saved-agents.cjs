'use strict';

const { exactKeys, fail } = require('../../../packages/contracts/src/input.cjs');
const MAX_SAVED_AGENTS = 200;

async function savedAgents(repo, userId) {
  return await repo.get('saved-agents', userId) || {
    id: userId, ownerId: userId, status: 'active', version: 0, agentIds: []
  };
}

function createSavedAgents({ command, resolveActor }) {
  return async (actor, agentId, body, key) => {
    exactKeys(body, ['saved', 'expectedVersion']);
    if (typeof body.saved !== 'boolean' || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 ||
        !/^[0-9a-f-]{36}$/.test(agentId)) {
      fail(400, 'INVALID_INPUT', 'Choose whether to save this agent and refresh the current list.');
    }
    const authorize = async () => {
      const current = resolveActor ? await resolveActor(actor?.user?.id) : actor;
      if (actor?.recoveryRequired || !current?.user?.id || current.user.id !== actor?.user?.id || current.recoveryRequired) {
        fail(403, 'FORBIDDEN', 'An active account is required.');
      }
    };
    await authorize();
    return command(actor.user.id, key, { action: 'save-agent', agentId, ...body }, authorize, async repo => {
      const record = await savedAgents(repo, actor.user.id);
      if (record.version !== body.expectedVersion) {
        fail(409, 'VERSION_CONFLICT', 'Your saved agents changed. Refresh before trying again.');
      }
      if (body.saved) {
        const agent = await repo.get('agent', agentId, true);
        if (!agent || agent.ownerId === actor.user.id || !agent.purpose || (agent.listingStatus || 'published') !== 'published') {
          fail(404, 'NOT_FOUND', 'This agent is not currently listed.');
        }
        if (!record.agentIds.includes(agentId)) {
          if (record.agentIds.length >= MAX_SAVED_AGENTS) fail(422, 'SAVED_AGENTS_LIMIT', 'You can save up to 200 agents. Remove one before saving another.');
          record.agentIds.push(agentId);
        }
      } else {
        // Removal stays possible when a previously saved listing is no longer published.
        record.agentIds = record.agentIds.filter(id => id !== agentId);
      }
      record.version++;
      await repo.save('saved-agents', record);
      return { agentId, saved: body.saved, savedVersion: record.version };
    }, `saved-agents:${actor.user.id}`);
  };
}

module.exports = { savedAgents, createSavedAgents };
