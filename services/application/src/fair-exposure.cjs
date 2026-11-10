'use strict';

const { createHash } = require('node:crypto');
const { exactKeys, fail } = require('../../../packages/contracts/src/input.cjs');
const { capabilityView } = require('./qualification.cjs');
const POLICY = 'qualified-newcomer-v1';

// Counts are outcomes in this environment, never inferred paid-customer claims.
async function operatorHistory(repo, operatorId) {
  const tasks = new Map();
  let after = '';
  while (true) {
    const batch = await repo.page('offer-index', 'owner_id', operatorId, { after, limit: 100 });
    for (const index of batch) {
      if (!tasks.has(index.taskId)) tasks.set(index.taskId, await repo.get('task', index.taskId));
    }
    if (batch.length < 100) break;
    after = batch.at(-1).id;
  }
  return [...tasks.values()].filter(Boolean);
}
function acceptedFor(tasks, operatorId, agentId, capabilityId) {
  return tasks.filter(task => {
    const job = task.assignment;
    const offer = task.offers.find(item => item.id === job?.offerId);
    return job?.status === 'accepted' && job.operatorId === operatorId &&
      (!agentId || job.agentId === agentId) && (!capabilityId || offer?.capabilityId === capabilityId);
  }).length;
}
function rotation(task, operatorId) {
  return createHash('sha256').update(`${POLICY}:${task.id}:${task.scopeVersion}:${operatorId}`).digest('hex');
}
async function offersWithExposure(repo, task, now) {
  const histories = new Map();
  const results = [];
  for (const offer of task.offers) {
    const agent = offer.agentId ? await repo.get('agent', offer.agentId) : null;
    const cap = agent?.capabilities.find(item => item.id === offer.capabilityId);
    const current = cap ? capabilityView(agent, cap, now) : null;
    if (offer.operatorId && !histories.has(offer.operatorId)) histories.set(offer.operatorId, await operatorHistory(repo, offer.operatorId));
    const history = histories.get(offer.operatorId) || [];
    const operatorAccepted = acceptedFor(history, offer.operatorId);
    const capabilityAccepted = acceptedFor(history, offer.operatorId, offer.agentId, offer.capabilityId);
    const qualificationCurrent = offer.qualification === 'qualified' && current?.qualification === 'qualified' && current.assessment?.id === offer.qualificationEvidence?.id;
    const eligible = task.status === 'posted' && !task.assignment && !task.selectedOfferId && !task.preferredAgentId && !task.preferredOperatorId &&
      !task.scheduleId && !task.recurringScheduleId && agent && (agent.listingStatus || 'published') === 'published' &&
      agent.ownerId === offer.operatorId && qualificationCurrent && offer.runtimeBid &&
      agent.credentialHash && agent.credentialExpiresAt > now && agent.connectedAt > now - 120000 &&
      offer.scopeVersion === task.scopeVersion && offer.expiresAt > now;
    results.push({ ...offer, qualificationCurrent,
      selected: task.assignment?.offerId === offer.id || (task.selectedOfferId === offer.id && offer.expiresAt > now),
      trackRecord: { capabilityAccepted, operatorAccepted, basis: 'accepted-deliveries-in-this-environment' },
      exposure: { policy: POLICY, eligible: Boolean(eligible), newcomer: Boolean(eligible && operatorAccepted < 3),
        featured: false, shortlisted: false, reason: null },
      // Internal ordering inputs are removed before returning to callers.
      _created: agent?.createdAt || 0
    });
  }
  const eligible = results.filter(item => item.exposure.eligible);
  // Preserve normal offer order; do not invent a quality score or currency comparison.
  // Each operator has one ticket, regardless of how many agents it registers.
  const newcomers = new Map();
  for (const offer of eligible.filter(item => item.exposure.newcomer).sort((a,b) => a._created-b._created || a.agentId.localeCompare(b.agentId))) {
    if (!newcomers.has(offer.operatorId)) newcomers.set(offer.operatorId, offer);
  }
  const featured = [...newcomers.values()].sort((a,b) => rotation(task,a.operatorId).localeCompare(rotation(task,b.operatorId)))[0];
  const first = [], operators = new Set();
  for (const offer of eligible) {
    if (offer.operatorId === featured?.operatorId || operators.has(offer.operatorId)) continue;
    if (first.length === (featured ? 3 : 4)) break;
    first.push(offer); operators.add(offer.operatorId);
  }
  if (featured) {
    first.push(featured);
    featured.exposure.featured = true;
    featured.exposure.reason = 'Qualified newcomer opportunity. This capability passed its assessment; the builder has fewer than three accepted deliveries here. Compare scope and evidence before choosing.';
  }
  for (const offer of first) offer.exposure.shortlisted = true;
  const chosen = new Set(first.map(item => item.id));
  return [...first, ...results.filter(item => !chosen.has(item.id))].map(({_created, ...offer}) => offer);
}
function createExposure(context) {
  const { repository, command, taskFor, agentFor, now } = context;
  async function record(actor, taskId, body, key) {
    exactKeys(body, ['offerIds', 'stage']);
    if (!['shortlisted', 'reviewed'].includes(body.stage) || !Array.isArray(body.offerIds) || body.offerIds.length < 1 || body.offerIds.length > 4 ||
      body.offerIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id))) fail(400, 'INVALID_EXPOSURE', 'Choose up to four current offers.');
    return command(actor.user.id, key, ['offer-exposure', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true);
      const offers = await offersWithExposure(repo, task, now());
      for (const id of new Set(body.offerIds)) {
        const offer = offers.find(item => item.id === id);
        if (!offer || offer.operatorId === actor.user.id || offer.scopeVersion !== task.scopeVersion || offer.expiresAt <= now() ||
          (body.stage === 'shortlisted' && !offer.exposure.shortlisted)) fail(409, 'EXPOSURE_STALE', 'Refresh the current offers.');
        const recordId = `${task.id}:${task.scopeVersion}:${id}:${body.stage}`;
        if (!await repo.get('offer-exposure', recordId)) await repo.save('offer-exposure', {
          id: recordId, ownerId: offer.operatorId, tenantId: offer.agentId, taskId: task.id,
          scopeVersion: task.scopeVersion, offerId: id, stage: body.stage, policy: POLICY, createdAt: now()
        });
      }
      return { recorded: true };
    });
  }
  async function funnel(repo, actor, agentId) {
    await agentFor(repo, actor, agentId);
    const tasks = await operatorHistory(repo, actor.user.id);
    const counters = Object.fromEntries(['quoted','shortlisted','reviewed','selected','accepted'].map(key => [key,new Set()]));
    for (const task of tasks) {
      const offers = task.offers.filter(item => item.agentId === agentId && item.operatorId === actor.user.id);
      if (!offers.length) continue;
      counters.quoted.add(task.id);
      const selected = new Set(task.events.filter(e => ['offer.selected','schedule.offer_selected'].includes(e.type)).map(e => e.offerId));
      selected.add(task.selectedOfferId); selected.add(task.assignment?.offerId);
      if (offers.some(o => selected.has(o.id))) counters.selected.add(task.id);
      if (task.assignment?.agentId === agentId && task.assignment.operatorId === actor.user.id && task.assignment.status === 'accepted') counters.accepted.add(task.id);
    }
    let after = '';
    while (true) {
      const batch = await repo.page('offer-exposure','tenant_id',agentId,{after,limit:100});
      for (const row of batch) if (row.ownerId === actor.user.id && counters[row.stage] && counters.quoted.has(row.taskId)) counters[row.stage].add(row.taskId);
      if (batch.length < 100) break;
      after = batch.at(-1).id;
    }
    return { basis: 'unique-tasks-all-sources-v1', eligible: null, invited: null,
      ...Object.fromEntries(Object.entries(counters).map(([key,value])=>[key,value.size])),
      exposureHistory: 'Since exposure tracking was enabled. Earlier impressions are unknown.',
      limitation: 'Local unpaid and sandbox work included. Selection is not funding. Qualified fit and invitations are not yet measured.' };
  }
  return { record, funnel };
}
module.exports = { offersWithExposure, createExposure, operatorHistory };
