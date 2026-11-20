'use strict';

// Packages: "Hire it" (docs/specs/Marketplace-Model.md, "What has to be built" §2).
//
// A package is a builder's standing offer for one capability: a fixed scope, price,
// delivery time and acceptance checklist, agreed before anyone buys. Buying one goes
// through the same task → offer → selection → authorization path as a quoted request,
// so start checks, revisions, "end as unmet", the outcome ledger and agent-card
// evidence all apply without a second implementation.
//
// Rules:
// - Only a capability that currently passes its Relay test can be sold as a package
//   (evidence is verified, never self-reported). This is re-checked at purchase.
// - The price respects the agent's minimum payout and the shared quote limits, the
//   same bounds a quote must meet, so a package can never be authorized at a price a
//   quote couldn't be.
// - A package must carry a checklist of 1–12 criteria; the acceptance rules need it.
// - Editing a package creates a new version. A bought task keeps a frozen copy of the
//   terms it was bought on.
// - Inputs are limited to what a runtime can take today: a CSV file (plus the buyer's
//   notes, which every task allows).

const { randomUUID } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { normalizeCriteria } = require('./acceptance.cjs');
const { QUOTE_LIMITS } = require('./quote-limits.cjs');

const MAX_EXTRA_ROUNDS = 3;
const PACKAGE_INPUTS = Object.freeze(['csv']);
const PACKAGE_FIELDS = ['capabilityId', 'title', 'included', 'priceMinor', 'deliveryMinutes', 'criteria', 'inputs', 'extraRounds'];

function bounded(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'INVALID_INPUT', `${label} is outside the supported range.`);
  return value;
}

function qualifiedCapability(agent, capabilityId, qualificationOf) {
  const capability = (agent.capabilities || []).find(item => item.id === capabilityId);
  if (!capability) fail(400, 'INVALID_INPUT', 'Choose one of this agent’s capabilities.');
  if (qualificationOf(agent, capability) !== 'qualified')
    fail(409, 'CAPABILITY_NOT_QUALIFIED', 'Only a capability that has passed its Relay test can be sold as a package.');
  return capability;
}

function minimumPrice(agent, priceMinor) {
  if (priceMinor < (agent.rules?.minimumPayout || 1))
    fail(409, 'PRICE_LIMIT', 'The package price is below this agent’s minimum payout.');
}

function normalizePackage(body, agent, qualificationOf) {
  exactKeys(body, PACKAGE_FIELDS);
  qualifiedCapability(agent, body.capabilityId, qualificationOf);
  const priceMinor = bounded(body.priceMinor, 'Price', 1, QUOTE_LIMITS.maxAmountMinor);
  minimumPrice(agent, priceMinor);
  const criteria = normalizeCriteria(body.criteria);
  if (!criteria.length) fail(400, 'INVALID_INPUT', 'A package needs at least one acceptance criterion.');
  if (!Array.isArray(body.inputs) || !body.inputs.length || new Set(body.inputs).size !== body.inputs.length ||
    body.inputs.some(item => !PACKAGE_INPUTS.includes(item)))
    fail(400, 'INVALID_INPUT', 'Packages can require a CSV file today.');
  return {
    capabilityId: body.capabilityId,
    title: text(body.title, 'Package title', 3, 80),
    included: text(body.included, 'What’s included', 3, 2000),
    priceMinor,
    currency: agent.rules?.currency || 'USD',
    deliveryMinutes: bounded(body.deliveryMinutes, 'Delivery time', 1, QUOTE_LIMITS.maxDeliveryMinutes),
    criteria,
    inputs: [...body.inputs],
    extraRounds: body.extraRounds === undefined ? 0 : bounded(body.extraRounds, 'Extra rounds', 0, MAX_EXTRA_ROUNDS),
  };
}

function checkPurchasable(agent, packageId, qualificationOf) {
  const pkg = (agent.packages || []).find(item => item.id === packageId);
  if (!pkg) fail(404, 'NOT_FOUND', 'Package not found.');
  if (pkg.status !== 'published' || (agent.listingStatus || 'published') !== 'published')
    fail(409, 'PACKAGE_UNAVAILABLE', 'This package isn’t available right now.');
  qualifiedCapability(agent, pkg.capabilityId, qualificationOf);
  minimumPrice(agent, pkg.priceMinor);
  return pkg;
}

function packageTerms(pkg) {
  return Object.freeze({
    packageId: pkg.id, packageVersion: pkg.version, capabilityId: pkg.capabilityId, title: pkg.title, included: pkg.included,
    priceMinor: pkg.priceMinor, currency: pkg.currency, deliveryMinutes: pkg.deliveryMinutes,
    criteria: pkg.criteria.map(item => ({ ...item })), inputs: [...pkg.inputs], extraRounds: pkg.extraRounds,
  });
}

function packageView(pkg) {
  const { id, version, status, capabilityId, title, included, priceMinor, currency, deliveryMinutes, criteria, inputs, extraRounds, updatedAt } = pkg;
  return { id, version, status, capabilityId, title, included, priceMinor, currency, deliveryMinutes,
    criteria: criteria.map(item => ({ ...item })), inputs: [...inputs], extraRounds, updatedAt };
}

// What buyers see: published packages whose capability still passes its Relay test,
// on a published agent. The same rule as checkPurchasable, so nothing is shown that
// can't be bought.
function publicPackages(agent, qualificationOf) {
  if ((agent.listingStatus || 'published') !== 'published') return [];
  return (agent.packages || []).filter(pkg => {
    if (pkg.status !== 'published' || pkg.priceMinor < (agent.rules?.minimumPayout || 1)) return false;
    const capability = (agent.capabilities || []).find(item => item.id === pkg.capabilityId);
    return !!capability && qualificationOf(agent, capability) === 'qualified';
  }).map(packageView).sort((a, b) => a.priceMinor - b.priceMinor || a.title.localeCompare(b.title));
}

function createPackages({ command, agentFor, expected, now, positive, qualificationOf }) {
  async function savePackage(actor, agentId, packageId, body, key) {
    const { expectedVersion, ...fields } = body || {};
    positive(expectedVersion, 'Agent version');
    return command(actor.user.id, key, ['package', agentId, packageId, body], repo => agentFor(repo, actor, agentId), async repo => {
      const agent = await agentFor(repo, actor, agentId); expected(agent, expectedVersion);
      const terms = normalizePackage(fields, agent, qualificationOf), time = now();
      agent.packages = agent.packages || [];
      let pkg;
      if (packageId) {
        pkg = agent.packages.find(item => item.id === packageId);
        if (!pkg) fail(404, 'NOT_FOUND', 'Package not found.');
        Object.assign(pkg, terms, { version: pkg.version + 1, updatedAt: time });
      } else {
        if (agent.packages.length >= MAX_PACKAGES) fail(409, 'PACKAGE_LIMIT', `An agent can offer up to ${MAX_PACKAGES} packages.`);
        pkg = { id: randomUUID(), version: 1, status: 'draft', ...terms, createdAt: time, updatedAt: time };
        agent.packages.push(pkg);
      }
      agent.version++;
      await repo.save('agent', agent);
      return { agentId, packageId: pkg.id, version: pkg.version, status: pkg.status, agentVersion: agent.version };
    });
  }

  async function setPackageStatus(actor, agentId, packageId, body, key) {
    exactKeys(body, ['expectedVersion', 'status']);
    if (!['draft', 'published', 'paused'].includes(body.status)) fail(400, 'INVALID_INPUT', 'Choose draft, published or paused.');
    return command(actor.user.id, key, ['package-status', agentId, packageId, body], repo => agentFor(repo, actor, agentId), async repo => {
      const agent = await agentFor(repo, actor, agentId); expected(agent, body.expectedVersion);
      const pkg = (agent.packages || []).find(item => item.id === packageId);
      if (!pkg) fail(404, 'NOT_FOUND', 'Package not found.');
      // Publishing re-checks the rules: the capability may have lost its Relay test
      // or the minimum payout may have risen since the package was saved.
      if (body.status === 'published') normalizePackage(editable(pkg), agent, qualificationOf);
      pkg.status = body.status; pkg.updatedAt = now();
      agent.version++;
      await repo.save('agent', agent);
      return { agentId, packageId, version: pkg.version, status: pkg.status, agentVersion: agent.version };
    });
  }

  return { savePackage, setPackageStatus };
}

// Bought terms hold for 30 days: the buyer can attach inputs and start any time in
// that window without the builder re-quoting.
const PACKAGE_OFFER_DAYS = 30;

// The package offer is an ordinary offer record built from the frozen terms, so
// selection, the start checks and the agreement treat it like any quote.
function packageOffer({ agent, capability, qualification, task, terms, time }) {
  return {
    id: randomUUID(), agentId: agent.id, operatorId: agent.ownerId, agentName: agent.name, agentType: agent.kind,
    operatorName: agent.operatorName, category: capability.category, capability: capability.task, capabilityId: capability.id,
    qualification: qualification.qualification, qualificationEvidence: qualification.assessment,
    taskVersion: task.version, scopeVersion: task.scopeVersion,
    amountMinor: terms.priceMinor, deliveryMinutes: terms.deliveryMinutes, proposal: terms.included, currency: terms.currency,
    createdAt: time, expiresAt: time + PACKAGE_OFFER_DAYS * 86400000, runtimeBid: false, runtimeKind: null,
    packageId: terms.packageId, packageVersion: terms.packageVersion, extraRounds: terms.extraRounds,
  };
}

// Attaching an input is a scope change. The package's price and checklist don't
// depend on the file, so its offer follows the new scope and stays selected.
function rebindPackageOffer(task) {
  const offer = task.offers.find(item => item.packageId === task.package.packageId);
  offer.scopeVersion = task.scopeVersion;
  offer.taskVersion = task.version;
  task.selectedOfferId = offer.id;
}

// An offer a runtime has committed to: its own quote, or a package its builder
// published. The one definition used to start work and shown to the buyer's screen.
function runtimeCommitted(offer) {
  return !!(offer?.runtimeBid || offer?.packageId);
}

function assertNotPackage(task) {
  if (task.package) fail(409, 'PACKAGE_FIXED', 'Package terms are fixed. Propose a change request instead.');
}

// Fixes for unmet checklist items are free (acceptance.cjs). A revision that names
// none of them is a polish round, limited to what the package includes.
function checkPolishRound(task, unmetCriteria) {
  if (!task.package || unmetCriteria.length) return;
  const used = task.submissions.filter(item => item.status === 'revision_requested' && !item.unmetCriteria?.length).length;
  if (used >= task.package.extraRounds)
    fail(409, 'POLISH_LIMIT', task.package.extraRounds
      ? `This package includes ${task.package.extraRounds} extra round${task.package.extraRounds === 1 ? '' : 's'}, already used. Name the checklist items that aren’t met, or propose a change request.`
      : 'This package doesn’t include extra rounds. Name the checklist items that aren’t met, or propose a change request.');
}

function editable(pkg) {
  const { capabilityId, title, included, priceMinor, deliveryMinutes, criteria, inputs, extraRounds } = pkg;
  return { capabilityId, title, included, priceMinor, deliveryMinutes, criteria: criteria.map(item => item.text), inputs, extraRounds };
}

const MAX_PACKAGES = 10;

module.exports = { normalizePackage, checkPurchasable, packageTerms, packageView, publicPackages, createPackages,
  packageOffer, rebindPackageOffer, assertNotPackage, runtimeCommitted, checkPolishRound, MAX_EXTRA_ROUNDS, MAX_PACKAGES, PACKAGE_INPUTS, PACKAGE_OFFER_DAYS };
