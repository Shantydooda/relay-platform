'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
const SOURCES = ['market', 'storefront', 'builder-link', 'unspecified', 'repeat-hire'];
function acquisition(source, agent, mode, time) {
  if (!SOURCES.includes(source)) fail(400, 'INVALID_ACQUISITION', 'Invalid request entry point.');
  return { version: 1, source, agentId: agent.id, operatorId: agent.ownerId, mode, recordedAt: time };
}
// Historical events without an offer ID cannot establish which supplier won.
// Current selection and assignment are safe evidence for older records.
function selectedByOperator(task, operatorId) {
  if (task.assignment?.operatorId === operatorId) return true;
  const selectedIds = new Set(task.events
    .filter(event => ['offer.selected', 'schedule.offer_selected'].includes(event.type) && event.offerId)
    .map(event => event.offerId));
  if (task.selectedOfferId) selectedIds.add(task.selectedOfferId);
  return task.offers.some(offer => offer.operatorId === operatorId && selectedIds.has(offer.id));
}
function createAcquisition(context) {
  const { repository, agentFor, now } = context;
  return async (actor, agentId) => repository.read(async repo => {
    await agentFor(repo, actor, agentId);
    const rows = SOURCES.map(source => ({ source, requests: 0, quoted: 0, selected: 0, delivered: 0 }));
    let after = '';
    while (true) {
      const batch = await repo.acquisitionBatch(agentId, after);
      for (const task of batch) {
        if (task.acquisition.operatorId !== actor.user.id || !task.events.some(event => event.type === 'task.posted')) continue;
        const row = rows.find(item => item.source === task.acquisition.source);
        if (!row) continue;
        row.requests++;
        if (task.offers.some(offer => offer.operatorId === actor.user.id)) row.quoted++;
        if (selectedByOperator(task, actor.user.id)) row.selected++;
        if (task.assignment?.operatorId === actor.user.id && task.assignment.status === 'accepted') row.delivered++;
      }
      if (batch.length < 100) break;
      after = batch.at(-1).id;
    }
    const totals = rows.reduce((sum, row) => {
      for (const field of ['requests', 'quoted', 'selected', 'delivered']) sum[field] += row[field];
      return sum;
    }, { requests: 0, quoted: 0, selected: 0, delivered: 0 });
    const funnel = await require('./fair-exposure.cjs').createExposure(context).funnel(repo, actor, agentId);
    return { agentId, asOf: now(), rows, totals, funnel, basis: 'posted-direct-requests-v2' };
  });
}
module.exports = { acquisition, createAcquisition };
