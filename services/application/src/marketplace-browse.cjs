'use strict';

// The browse-first marketplace (docs/specs/Marketplace-Model.md → "Layout").
//
// One row per published agent: what the builder declares (name, purpose,
// categories, connectors) next to what Relay recorded (the Relay test, verified
// runs, repeat buyers). The two are labelled separately and never mixed, and
// nothing here is ranked by payment.
//
// Ways to buy that are not built yet stay empty rather than invented: today an
// agent can only be commissioned through a custom quote, so `waysToBuy` is
// ['commission'], `packages` is [] and `fromPrice` is null.

const linkAssessment = require('./link-assessment.cjs');
const { taskOutcome, summarizeOutcomes, LEDGER_WINDOW_MS } = require('./outcome-ledger.cjs');

const SORTS = Object.freeze(['runs', 'newest']);
const MAX_ROWS = 500;

// Connectors this environment can really use: the capability is on and a
// provider is configured. An agent appears under "Works with" only when it
// declares one of these; declaring a tool grants no access.
function workingConnectors({ capabilities, driveProvider, attioProvider }) {
  return [
    ...(capabilities.driveConnections && driveProvider ? ['Google Drive'] : []),
    ...(capabilities.attioDelivery && attioProvider ? ['Attio'] : []),
  ];
}

function buyersFor(history, agent, now) {
  const accepted = new Map();
  const tenants = new Set();
  for (const task of history) {
    const record = taskOutcome(task);
    if (!record || record.agentId !== agent.id || record.operatorId !== agent.ownerId || record.at === null ||
        record.at < now - LEDGER_WINDOW_MS || record.at > now || record.outcome === 'cancelled') continue;
    tenants.add(task.tenantId);
    if (record.outcome.startsWith('accepted_')) accepted.set(task.tenantId, (accepted.get(task.tenantId) || 0) + 1);
  }
  // A repeat buyer came back and accepted work at least twice in the window.
  return { total: tenants.size, repeat: [...accepted.values()].filter(count => count >= 2).length };
}

function relayTest(agent, listing) {
  const passed = listing.capabilities.find(item => item.qualification === 'qualified');
  const source = passed && agent.capabilities.find(item => item.id === passed.id);
  const test = source && (agent.assessments || []).find(item => item.id === source.assessmentId);
  return test
    ? { passed: true, title: test.rubric === linkAssessment.rubric ? linkAssessment.title : 'CSV normalization', rubric: test.rubric, runtimeVersion: test.runtimeVersion || null, completedAt: test.completedAt || null }
    : { passed: false, title: null, rubric: null, runtimeVersion: null, completedAt: null };
}

function browseRow({ agent, listing, history, now, connectors, actor }) {
  const categories = [...new Set(listing.capabilities.map(item => item.category))];
  const lead = listing.capabilities.find(item => item.qualification === 'qualified') || listing.capabilities[0];
  const declared = [...new Set(listing.capabilities.flatMap(item => item.metadata?.tools || []))];
  const test = relayTest(agent, listing);
  const evidence = summarizeOutcomes(history, { operatorId: agent.ownerId, agentId: agent.id, now });
  return {
    id: agent.id,
    builder: agent.operatorName || 'Independent builder',
    name: agent.name,
    purpose: agent.purpose,
    kind: agent.kind,
    domain: agent.domain || null,
    category: lead?.category || null,
    categories,
    capabilities: listing.capabilities.map(({ id, category, task, qualification, metadata }) => ({ id, category, task, qualification, metadata })),
    availability: listing.availability,
    own: agent.ownerId === actor.user.id,
    waysToBuy: ['commission'],
    packages: [],
    fromPrice: null,
    relayTest: test,
    evidence,
    buyers: buyersFor(history, agent, now),
    hostedOnRelay: agent.runtimeKind === 'bounded-csv-automation',
    worksWith: declared.filter(name => connectors.includes(name)),
    declaredTools: declared,
    version: agent.runtimeVersion || null,
    versionSince: agent.runtimeVersionSince || null,
    listedAt: agent.createdAt || null,
    isNew: test.passed && evidence.runs === 0,
  };
}

function sortRows(rows, sort) {
  const byName = (a, b) => `${a.builder}/${a.name}`.localeCompare(`${b.builder}/${b.name}`);
  if (sort === 'newest') return rows.sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0) || byName(a, b));
  return rows.sort((a, b) => b.evidence.runs - a.evidence.runs || byName(a, b));
}

function createBrowse({ repository, now, listingView, connectors: available }) {
  const operatorHistory = require('./fair-exposure.cjs').operatorHistory;
  async function rows(repo, actor, agents) {
    const time = now();
    const connectors = available;
    const histories = new Map();
    const result = [];
    for (const agent of agents) {
      if (!histories.has(agent.ownerId)) histories.set(agent.ownerId, await operatorHistory(repo, agent.ownerId));
      result.push(browseRow({ agent, listing: listingView(agent, time), history: histories.get(agent.ownerId), now: time, connectors, actor }));
    }
    return result;
  }
  function allowed(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) require('../../../packages/contracts/src/input.cjs').fail(403, 'FORBIDDEN', 'An active account is required.');
  }
  return {
    // Every published agent with a profile, plus the builder's own listings so a
    // builder can see how theirs reads. Filtering happens in the browser while the
    // catalogue is small.
    browse: (actor, { sort = 'runs' } = {}) => {
      allowed(actor);
      if (!SORTS.includes(sort)) require('../../../packages/contracts/src/input.cjs').fail(400, 'INVALID_SORT', 'Sort by most verified runs or newest.');
      return repository.read(async repo => {
        const published = (await repo.catalogAgents()).filter(agent => (agent.listingStatus || 'published') === 'published' && agent.purpose).slice(0, MAX_ROWS);
        const agents = sortRows(await rows(repo, actor, published), sort);
        return { agents, sort, sorts: SORTS, connectors: available, windowDays: LEDGER_WINDOW_MS / 86400000,
          basis: 'verified-outcomes-in-this-environment' };
      });
    },
    row: async (repo, actor, agent) => (await rows(repo, actor, [agent]))[0],
  };
}

module.exports = { createBrowse, browseRow, buyersFor, workingConnectors, SORTS };
