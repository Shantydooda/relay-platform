'use strict';
const { createHash } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');

function discoveryOptions(input = {}, ownerId) {
  const { q = '', category = 'All agents', type = 'All types', after = '', limit = 25, savedOnly = false } = input;
  if (typeof savedOnly !== 'boolean' || typeof q !== 'string' || q.length > 200 || typeof category !== 'string' || category.length > 100 ||
      !['All types', 'general', 'specialist'].includes(type) || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      typeof after !== 'string' || after.length > 400) fail(400, 'INVALID_DISCOVERY', 'Invalid discovery filters or page.');
  const query = q.trim().toLowerCase();
  const fingerprint = createHash('sha256').update(JSON.stringify([ownerId, query, category, type, savedOnly])).digest('hex');
  let cursor = '';
  if (after) {
    try {
      const value = JSON.parse(Buffer.from(after, 'base64url').toString());
      if (value.filter !== fingerprint || !/^[0-9a-f-]{36}$/.test(value.id)) throw new Error();
      cursor = value.id;
    } catch { fail(400, 'INVALID_DISCOVERY_CURSOR', 'Restart the search after changing filters.'); }
  }
  return { query, category, type, limit, cursor, fingerprint, savedOnly };
}
function createDiscovery({ repository, now, listingView }) {
  return async (actor, input) => {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'An active account is required.');
    const options = discoveryOptions(input, actor.user.id);
    return repository.read(async repo => {
      const saved = await require('./saved-agents.cjs').savedAgents(repo, actor.user.id);
      const savedIds = new Set(saved.agentIds);
      const agents = [], categories = new Set(), publishedIds = new Set();
      let batchAfter = '', total = 0, hasMore = false;
      const time = now();
      // Bound working memory; inspect every published row so sparse matches and
      // categories beyond the first batch remain discoverable. Not ranked search.
      while (true) {
        const batch = await repo.discoveryBatch(actor.user.id, batchAfter);
        for (const agent of batch) {
          if (!agent.purpose || (options.savedOnly && !savedIds.has(agent.id))) continue;
          if (savedIds.has(agent.id)) publishedIds.add(agent.id);
          for (const cap of agent.capabilities) categories.add(cap.category);
          const text = [agent.name, agent.operatorName, agent.purpose, agent.domain,
            ...agent.capabilities.flatMap(cap => [cap.category, cap.task])].join(' ').toLowerCase();
          if (!text.includes(options.query) || (options.type !== 'All types' && agent.kind !== options.type)) continue;
          if (!['All agents', 'Available'].includes(options.category) && !agent.capabilities.some(cap => cap.category === options.category)) continue;
          const view = { ...listingView(agent, time), saved: savedIds.has(agent.id), savedVersion: saved.version };
          if (options.category === 'Available' && view.availability !== 'available') continue;
          total++;
          if (agent.id <= options.cursor) continue;
          if (agents.length < options.limit) agents.push(view);
          else hasMore = true;
        }
        if (batch.length < 250) break;
        batchAfter = batch.at(-1).id;
      }
      return { agents, unavailableSaved: options.savedOnly ? saved.agentIds.filter(id => !publishedIds.has(id)).map(id => ({ id, saved: true, savedVersion: saved.version })) : [], categories: [...categories].sort((a,b)=>a.localeCompare(b)), total, hasMore,
        nextCursor: hasMore ? Buffer.from(JSON.stringify({ id: agents.at(-1).id, filter: options.fingerprint })).toString('base64url') : '' };
    });
  };
}
module.exports = { createDiscovery, discoveryOptions };
