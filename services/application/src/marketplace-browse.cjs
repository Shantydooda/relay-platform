'use strict';

// The browse-first marketplace (docs/specs/Marketplace-Model.md → "Layout").
//
// One row per published agent: what the builder declares (name, purpose,
// categories, connectors) next to what Relay recorded (the Relay test, verified
// runs, repeat buyers). The two are labelled separately and never mixed, and
// nothing here is ranked by payment.
//
// Ways to buy that are not built yet stay empty rather than invented. Every agent
// can be commissioned through a custom quote; it is hireable only when it has a
// package a buyer can actually buy (packages.cjs#publicPackages), and `fromPrice`
// is the cheapest such package. Self-serve ("use") isn't built yet.

const linkAssessment = require('./link-assessment.cjs');
const { taskOutcome, summarizeOutcomes, LEDGER_WINDOW_MS } = require('./outcome-ledger.cjs');

const SORTS = Object.freeze(['runs', 'newest', 'price']);
const MAX_ROWS = 500;

// Connectors this environment can really use: the capability is on and a
// provider is configured. An agent appears under "Works with" only when it
// declares one of these; declaring a tool grants no access.
// Only systems that really work in this environment: delivery integrations,
// buyer connections (never the labelled sample) and CSV input, which every request takes.
function workingConnectors({ capabilities, driveProvider, attioProvider, connectionProviders = [] }) {
  return [...new Set([
    ...(capabilities.driveConnections && driveProvider ? ['Google Drive'] : []),
    ...(capabilities.attioDelivery && attioProvider ? ['Attio'] : []),
    ...connectionProviders.filter(p => p.kind !== 'sample-erp').map(p => p.label),
    'CSV upload',
  ])];
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
    ? { passed: true, title: test.relayTest?.title || (test.rubric === linkAssessment.rubric ? linkAssessment.title : 'CSV normalization'), rubric: test.relayTest ? null : test.rubric, runtimeVersion: test.runtimeVersion || null, completedAt: test.completedAt || null,
      // A builder-written test says who wrote it, and whether it was this agent's own builder.
      proposed: test.relayTest && !test.relayTest.builtIn ? { authorName: test.relayTest.authorName, byThisBuilder: test.relayTest.authorId === agent.ownerId } : null }
    : { passed: false, title: null, rubric: null, runtimeVersion: null, completedAt: null, proposed: null };
}

function browseRow({ agent, listing, history, now, connectors, actor }) {
  const categories = [...new Set(listing.capabilities.map(item => item.category))];
  // Fixed category list (packages/domain/src/categories.cjs): the tasks and fields this agent covers.
  const taxonomy = require('../../../packages/domain/src/categories.cjs');
  const categoryIds = [...new Set(listing.capabilities.map(item => taxonomy.categoryOf(item)))];
  const fieldIds = [...new Set(categoryIds.map(id => taxonomy.taskById(id)?.field).filter(Boolean))];
  const lead = listing.capabilities.find(item => item.qualification === 'qualified') || listing.capabilities[0];
  const declared = [...new Set(listing.capabilities.flatMap(item => item.metadata?.tools || []))];
  const test = relayTest(agent, listing);
  const evidence = summarizeOutcomes(history, { operatorId: agent.ownerId, agentId: agent.id, now });
  return {
    id: agent.id,
    builder: agent.operatorName || 'Independent builder',
    // Opaque and stable: groups a builder's agents and addresses their profile
    // without revealing the account id. Display names aren't unique.
    builderId: require('node:crypto').createHash('sha256').update(`builder:${agent.ownerId}`).digest('hex').slice(0, 16),
    builderKind: agent.operatorKind === 'organization' ? 'organization' : 'person',
    name: agent.name,
    purpose: agent.purpose,
    kind: agent.kind,
    domain: agent.domain || null,
    processingRegion: agent.processingRegion || null,
    category: lead?.category || null,
    categories,
    categoryIds,
    fieldIds,
    categoryLabel: lead ? taxonomy.taskById(taxonomy.categoryOf(lead))?.label || null : null,
    capabilities: listing.capabilities.map(({ id, category, categoryId, task, qualification, metadata }) => ({ id, category, categoryId, task, qualification, metadata })),
    availability: listing.availability,
    own: agent.ownerId === actor.user.id,
    waysToBuy: listing.packages?.length ? ['hire', 'commission'] : ['commission'],
    packages: listing.packages || [],
    fromPrice: fromPrice(listing.packages || []),
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

// Packages on one agent share its quoting currency; if an older package kept a
// different one, the price shown is in the most common currency, never converted.
function fromPrice(packages) {
  if (!packages.length) return null;
  const counts = new Map();
  for (const item of packages) counts.set(item.currency, (counts.get(item.currency) || 0) + 1);
  const [currency] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return { amountMinor: Math.min(...packages.filter(item => item.currency === currency).map(item => item.totalMinor ?? item.priceMinor)), currency };
}

const CURRENCY_ORDER = ['USD', 'EUR'];
function sortRows(rows, sort) {
  const byName = (a, b) => `${a.builder}/${a.name}`.localeCompare(`${b.builder}/${b.name}`);
  // Prices in different currencies aren't converted: USD first, then EUR, then quoted-only.
  if (sort === 'price') return rows.sort((a, b) => !a.fromPrice - !b.fromPrice ||
    (a.fromPrice && b.fromPrice && (CURRENCY_ORDER.indexOf(a.fromPrice.currency) - CURRENCY_ORDER.indexOf(b.fromPrice.currency) ||
      a.fromPrice.amountMinor - b.fromPrice.amountMinor)) || byName(a, b));
  if (sort === 'newest') return rows.sort((a, b) => (b.listedAt || 0) - (a.listedAt || 0) || byName(a, b));
  return rows.sort((a, b) => b.evidence.runs - a.evidence.runs || byName(a, b));
}

function createBrowse({ repository, now, listingView, org = null, pricing = null, connectors: available }) {
  const operatorHistory = require('./fair-exposure.cjs').operatorHistory;
  async function rows(repo, actor, agents) {
    const time = now();
    const connectors = available;
    const histories = new Map();
    const result = [];
    for (const agent of agents) {
      if (!histories.has(agent.ownerId)) histories.set(agent.ownerId, await operatorHistory(repo, agent.ownerId));
      const listing = listingView(agent, time);
      // Buyers see each package at its all-in price: the builder's price plus Relay's fee (pricing.cjs).
      if (pricing && listing.packages) listing.packages = listing.packages.map(item => ({ ...item, totalMinor: pricing.price(item.priceMinor).totalMinor }));
      result.push(browseRow({ agent, listing, history: histories.get(agent.ownerId), now: time, connectors, actor }));
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
      if (!SORTS.includes(sort)) require('../../../packages/contracts/src/input.cjs').fail(400, 'INVALID_SORT', 'Sort by most verified runs, newest or price.');
      return repository.read(async repo => {
        // Only agents with a current Relay test are listed (Marketplace-Model.md, "One marketplace" §2).
        const time = now();
        const published = (await repo.catalogAgents()).filter(agent => (agent.listingStatus || 'published') === 'published' && agent.purpose &&
          listingView(agent, time).availability === 'available').slice(0, MAX_ROWS);
        const agents = sortRows(await rows(repo, actor, published), sort);
        // The region each of the viewer's companies requires (processing-region.cjs), so pages can say which agents it rules out.
        const regionRules = org ? await org.regionRules(repo, actor) : [];
        return { agents, regionRules, sort, sorts: SORTS, connectors: available, taxonomy: require('../../../packages/domain/src/categories.cjs').taxonomy(), windowDays: LEDGER_WINDOW_MS / 86400000,
          basis: 'verified-outcomes-in-this-environment' };
      });
    },
    row: async (repo, actor, agent) => (await rows(repo, actor, [agent]))[0],
  };
}

module.exports = { createBrowse, browseRow, buyersFor, workingConnectors, sortRows, fromPrice, SORTS };
