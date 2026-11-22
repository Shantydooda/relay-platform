'use strict';
// Engagements and milestones (docs/specs/Engagements-and-Milestones.md; Build-Order step 9).
//
// A builder can offer a request in 2–6 milestones, each with its own title,
// checklist, price and delivery time. When the buyer chooses that offer, the
// request becomes an engagement (the plan) and each milestone becomes its own
// task, reserved for the builder's agent, with its terms already selected.
// From there a milestone is an ordinary piece of work: it is funded, approved,
// started, delivered, revised and accepted through the existing code, and the
// outcome ledger counts it as one run of the agent.
//
// The rules, from how milestone marketplaces work (Upwork, Fiverr, Contra) and
// from statements of work:
// - The builder proposes the stages in their offer; the buyer accepts the plan
//   as a whole or chooses another offer. Accepted terms are frozen.
// - One milestone at a time: a milestone can be funded or started only after
//   the one before it is accepted. Money is never held for work that can't start.
// - Ending the plan cancels the milestones not started. Accepted milestones
//   stand; one in progress finishes or ends through its own page.
// - Relay's fee is the same as for one offer of the whole amount: each
//   milestone carries its slice of the tiered fee, so the stages add up exactly
//   to the plan's price.
//
// One-off requests are untouched: they never carry `engagement` or `milestone`.

const { randomUUID } = require('node:crypto');
const { exactKeys, fail, text } = require('../../../packages/contracts/src/input.cjs');
const { normalizeCriteria } = require('./acceptance.cjs');
const { saveTask } = require('./supplier-feed.cjs');

// Payment states that hold no money (payments.cjs#assertUnfunded uses the same set).
const SETTLED = new Set(['expired', 'refunded']);

const LIMITS = { min: 2, max: 6 };
// A milestone's terms are part of the accepted plan, so they don't lapse while
// earlier milestones take their time. Ending the plan is how they're withdrawn.
const NO_EXPIRY = Number.MAX_SAFE_INTEGER;

// Validates the builder's stages. The offer's amount and delivery time must be
// their sums, so the buyer and builder agree on the same total.
function milestonesInput(value, { amountMinor, deliveryMinutes, maxDeliveryMinutes }) {
  if (!Array.isArray(value) || value.length < LIMITS.min || value.length > LIMITS.max)
    fail(400, 'INVALID_INPUT', `Split the work into ${LIMITS.min}–${LIMITS.max} milestones, or offer one price.`);
  const titles = new Set();
  const milestones = value.map((item, index) => {
    exactKeys(item, ['title', 'criteria', 'amountMinor', 'deliveryMinutes']);
    const title = text(item.title, `Milestone ${index + 1} title`, 3, 80);
    if (titles.has(title.toLowerCase())) fail(400, 'INVALID_INPUT', 'Give each milestone a different title.');
    titles.add(title.toLowerCase());
    const criteria = normalizeCriteria(item.criteria);
    if (!criteria.length) fail(400, 'INVALID_INPUT', `Say how the buyer checks milestone ${index + 1}.`);
    if (!Number.isSafeInteger(item.amountMinor) || item.amountMinor < 1) fail(400, 'INVALID_INPUT', `Give milestone ${index + 1} a price.`);
    if (!Number.isSafeInteger(item.deliveryMinutes) || item.deliveryMinutes < 1 || item.deliveryMinutes > maxDeliveryMinutes)
      fail(400, 'INVALID_INPUT', `Give milestone ${index + 1} a delivery time.`);
    return { title, criteria, amountMinor: item.amountMinor, deliveryMinutes: item.deliveryMinutes };
  });
  const sum = key => milestones.reduce((total, item) => total + item[key], 0);
  if (sum('amountMinor') !== amountMinor || sum('deliveryMinutes') !== deliveryMinutes)
    fail(400, 'MILESTONE_TOTAL', 'The offer’s price and delivery time must be the totals of its milestones.');
  return milestones;
}

// Each milestone's fee is its slice of the fee on the whole amount, taken in
// order: fee(first k) − fee(first k−1). The slices add up to exactly the fee of
// one offer for the total, so splitting work never changes what Relay takes.
function priceMilestones(milestones, price) {
  let before = 0, feeBefore = 0;
  return milestones.map(item => {
    const through = before + item.amountMinor, feeThrough = price(through).feeMinor;
    const feeMinor = feeThrough - feeBefore;
    before = through; feeBefore = feeThrough;
    return { ...item, feeMinor, totalMinor: item.amountMinor + feeMinor };
  });
}

// Work that keeps its agreed terms: the accepted plan, and each milestone.
function assertOpen(task) {
  if (task.engagement) fail(409, 'ENGAGEMENT_ACCEPTED', 'This plan is accepted. Work on each milestone from its own page, or end the remaining milestones.');
  if (task.milestone) fail(409, 'MILESTONE_FIXED', 'Milestone terms are fixed. Once it starts, propose a change request.');
}

// Funding or starting: never the plan itself, and a milestone only after the one before it is accepted.
async function assertTurn(repo, task) {
  // A plan offer is never paid or run as a whole, even if it is somehow selected without being accepted.
  if (task.engagement || task.offers?.find(item => item.id === task.selectedOfferId)?.milestones)
    fail(409, 'ENGAGEMENT_PARENT', 'Start each milestone from its own page.');
  if (!task.milestone?.previousId) return;
  const previous = await repo.get('task', task.milestone.previousId);
  if (previous?.assignment?.status !== 'accepted')
    fail(409, 'MILESTONE_ORDER', `Accept milestone ${task.milestone.sequence - 1} before starting this one.`);
}

// A milestone's terms don't depend on its input file, so attaching one keeps its offer selected.
function rebindMilestoneOffer(task) {
  const offer = task.offers.find(item => item.id === task.selectedOfferId) || task.offers.find(item => item.milestoneOf);
  offer.scopeVersion = task.scopeVersion;
  offer.taskVersion = task.version;
  task.selectedOfferId = offer.id;
}

function milestoneStatus(task, previousAccepted) {
  if (task.status === 'cancelled') return 'cancelled';
  const job = task.assignment?.status;
  if (job) return { buyer_review: 'in_review', queued: 'in_progress', running: 'in_progress' }[job] || job;
  if (task.settlement?.status === 'funded') return 'funded';
  return previousAccepted ? 'ready' : 'waiting';
}

function createEngagements(context) {
  const { command, taskFor, expected, now, touch, event } = context;

  // Called from select, inside its command, once the plan offer has passed every check.
  async function acceptPlan(repo, actor, parent, offer) {
    const time = now(), n = offer.milestones.length, ids = offer.milestones.map(() => randomUUID());
    const { milestones, ...terms } = offer;
    for (const [index, item] of milestones.entries()) {
      const brief = `Milestone ${index + 1} of ${n}: ${item.title}\n\nPart of: ${parent.title}\n\n${parent.brief}`;
      const criteria = item.criteria.map(criterion => ({ ...criterion }));
      const child = {
        id: ids[index], tenantId: parent.tenantId, ownerId: parent.ownerId, title: item.title, brief,
        preferredAgentId: offer.agentId, preferredOperatorId: null, acquisition: parent.acquisition || null, repeatHireOf: null, retryOf: null,
        companyApprovalRequired: parent.companyApprovalRequired, status: 'posted', version: 1, scopeVersion: 1, createdAt: time, updatedAt: time,
        messages: [], scopes: [{ version: 1, title: item.title, brief, acceptanceCriteria: criteria, createdAt: time }], events: [],
        offers: [], selectedOfferId: null, assignment: null, submissions: [], acceptanceCriteria: criteria,
        requiredRegion: parent.requiredRegion || null, ...(parent.regionChoice ? { regionChoice: parent.regionChoice } : {}),
        ...(parent.projectId ? { projectId: parent.projectId } : {}), ...(parent.categoryId ? { categoryId: parent.categoryId } : {}),
        milestone: { engagementId: parent.id, sequence: index + 1, of: n, title: item.title, previousId: ids[index - 1] || null },
      };
      // The first milestone starts from the request's file, if there is one.
      if (index === 0 && parent.input) {
        const bytes = await context.verifiedBytes(parent.input, await repo.get('artifact', parent.input.artifactId), parent.id);
        const artifactId = randomUUID();
        child.input = { ...parent.input, artifactId };
        child.scopes[0].inputHash = parent.input.sha256;
        await repo.save('artifact', { id: artifactId, ownerId: parent.ownerId, tenantId: parent.tenantId, taskId: child.id,
          filename: parent.input.filename, sha256: parent.input.sha256, size: bytes.length, base64: bytes.toString('base64') });
      }
      const childOffer = { ...terms, id: randomUUID(), amountMinor: item.amountMinor, feeMinor: item.feeMinor, totalMinor: item.totalMinor,
        deliveryMinutes: item.deliveryMinutes, taskVersion: 1, scopeVersion: 1, createdAt: time, expiresAt: NO_EXPIRY,
        milestoneOf: { engagementId: parent.id, offerId: offer.id, sequence: index + 1 } };
      child.offers.push(childOffer);
      child.selectedOfferId = childOffer.id;
      event(child, actor.user.id, 'milestone.created', time);
      await saveTask(repo, child);
      await repo.save('offer-index', { id: childOffer.id, ownerId: offer.operatorId, taskId: child.id, offerId: childOffer.id });
    }
    parent.status = 'engaged';
    parent.selectedOfferId = offer.id;
    parent.engagement = { offerId: offer.id, agentId: offer.agentId, operatorId: offer.operatorId, agentName: offer.agentName,
      operatorName: offer.operatorName, currency: offer.currency || 'USD', milestoneIds: ids, acceptedAt: time, endedAt: null };
    return ids;
  }

  async function endEngagement(actor, id, body, key) {
    exactKeys(body, ['expectedVersion']);
    const lockAll = async repo => {
      const parent = await taskFor(repo, actor, id, true);
      for (const childId of [...(parent.engagement?.milestoneIds || [])].sort()) await taskFor(repo, actor, childId, true);
    };
    const result = await command(actor.user.id, key, ['engagement-end', id, body], lockAll, async repo => {
      const parent = await taskFor(repo, actor, id, true); expected(parent, body.expectedVersion);
      if (!parent.engagement) fail(404, 'NOT_FOUND', 'This request has no milestone plan.');
      if (parent.engagement.endedAt) fail(409, 'ENGAGEMENT_ENDED', 'This plan has already ended.');
      const time = now(), children = [];
      for (const childId of parent.engagement.milestoneIds) children.push(await taskFor(repo, actor, childId, true));
      const unstarted = children.filter(child => child.status !== 'cancelled' && !child.assignment);
      // A paid milestone that hasn't started is refunded in full when the deployment allows it (payments.cjs `refunds`).
      const refunds = context.refunds, refunding = [];
      for (const child of unstarted) {
        if (!child.settlement || SETTLED.has(child.settlement.status)) continue;
        if (refunds?.plan(child) !== 'refund') fail(409, 'REFUND_REQUIRED', refunds?.enabled
          ? `The plan can’t end yet: for milestone ${child.milestone.sequence}, ${refunds.reason(child)}`
          : `Milestone ${child.milestone.sequence} has a held payment. Refund it from its page first.`);
        await refunds.authorize(repo, actor, child);
        refunding.push(child);
      }
      for (const child of unstarted) {
        child.status = 'cancelled'; child.selectedOfferId = null;
        event(child, actor.user.id, 'milestone.cancelled', time);
        if (refunding.includes(child)) await refunds.queue(repo, child, actor.user.id, time);
        touch(child, time); await saveTask(repo, child);
      }
      parent.engagement.endedAt = time;
      touch(parent, time); event(parent, actor.user.id, 'engagement.ended', time); await saveTask(repo, parent);
      return { taskId: id, version: parent.version, cancelled: unstarted.map(child => child.id), refunds: refunding.map(child => child.id) };
    });
    if (result.refunds?.length) await context.refunds.settle(result.refunds);
    return result;
  }

  // The plan, for the request's page; or, on a milestone's page, where it sits in the plan.
  async function view(repo, task) {
    if (task.milestone) {
      const parent = await repo.get('task', task.milestone.engagementId);
      const previous = task.milestone.previousId ? await repo.get('task', task.milestone.previousId) : null;
      const { engagementId, sequence, of, title } = task.milestone;
      return { milestone: { engagementId, sequence, of, title, engagementTitle: parent?.title || null,
        previousAccepted: !previous || previous.assignment?.status === 'accepted' } };
    }
    if (!task.engagement) return {};
    const milestones = [];
    let previousAccepted = true;
    for (const childId of task.engagement.milestoneIds) {
      const child = await repo.get('task', childId);
      const terms = child.assignment?.agreement || child.offers.find(item => item.id === child.selectedOfferId) || child.offers.find(item => item.milestoneOf);
      const status = milestoneStatus(child, previousAccepted);
      milestones.push({ taskId: child.id, sequence: child.milestone.sequence, title: child.title, status,
        amountMinor: terms.amountMinor, feeMinor: terms.feeMinor ?? 0, totalMinor: terms.totalMinor ?? terms.amountMinor,
        deliveryMinutes: terms.deliveryMinutes, criteria: (child.acceptanceCriteria || []).length,
        paymentReview: status === 'funded' && (await repo.get('payment-job', `task:${child.id}`))?.status === 'review' });
      previousAccepted = status === 'accepted';
    }
    const sum = list => list.reduce((total, item) => total + item.totalMinor, 0);
    const status = task.engagement.endedAt ? 'ended' : milestones.every(item => item.status === 'accepted') ? 'completed' : 'active';
    const { agentId, agentName, operatorName, currency, acceptedAt, endedAt } = task.engagement;
    return { engagement: { status, agentId, agentName, operatorName, currency, acceptedAt, endedAt, milestones,
      refundsOnEnd: !!context.refunds?.enabled,
      totals: { totalMinor: sum(milestones), acceptedMinor: sum(milestones.filter(item => item.status === 'accepted')),
        cancelledMinor: sum(milestones.filter(item => item.status === 'cancelled')) } } };
  }

  return { acceptPlan, endEngagement, view };
}

module.exports = { createEngagements, milestonesInput, priceMilestones, assertOpen, assertTurn, rebindMilestoneOffer, LIMITS };
