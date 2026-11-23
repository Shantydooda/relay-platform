'use strict';

const POLICY = 'evidence-concepts-v3';
const {matchCapability} = require('./capability-matching.cjs');
const {ledgerLabel, MIN_RATE_SAMPLE} = require('./outcome-ledger.cjs');

// A success requirement can only be met by verified outcomes with enough runs behind them.
function meetsSuccessRequirement(offer, required) {
  if (required === undefined) return true;
  const rate = offer.trackRecord?.outcomes?.acceptedRate;
  return Number.isFinite(rate) && rate * 100 >= required;
}

// Evidence points reward both volume and outcome quality: failures and refunds lower the score.
function evidencePoints(offer) {
  const outcomes = offer.trackRecord?.outcomes;
  if (!outcomes) return 20 * Math.min(Math.max(0, Number(offer.trackRecord?.capabilityAccepted) || 0), 5) / 5;
  if (!outcomes.runs) return 0;
  const confidence = Math.min(outcomes.runs, 5) / 5;
  const quality = (outcomes.accepted + 1) / (outcomes.runs + 2);
  return 20 * confidence * quality;
}
const PLEASE = '(?:,? please)?';
const ALTERNATIVES = new RegExp(`^(?:please )?(?:(?:can|could) you )?(?:show|see|give me|can i see) (?:me )?(?:three |3 |some |other |more )?(?:alternatives|agents|options)${PLEASE}[.!?]?$`, 'i');
const PRIORITY = new RegExp(`^(?:please )?(?:(?:use|show me|prefer|i(?:'|’)?d prefer|go with) )?(?:the )?(cheapest|cheaper|fastest|quickest|balanced)(?: (?:one|agent|option))?${PLEASE}[.!]?$`, 'i');
// Thousands separators are accepted ("$1,000"); at most two decimal places.
const AMOUNT = '(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\\.[0-9]{1,2})?';
const BUDGET = new RegExp(`^(?:please )?(?:keep it under|(?:my )?budget is|no more than|max(?:imum)?(?: of)?) ([$€£])(${AMOUNT})${PLEASE}[.!]?$`, 'i');
// A budget stated inside a brief ("Budget: $150", "my budget is $150", "budget up to €2,000").
// Only an explicit ceiling counts: "around $150" is a target, "$5M ARR" or "$2 per lead" are not budgets.
// The budget must be the buyer's: at the start of a sentence or after my/our/a/the/total/max,
// so "their marketing budget is $50" describes the target companies, not this task.
const BRIEF_BUDGET = new RegExp(`(?:^\\s*|\\b(?:my|our|a|the|total|max|maximum)\\s+)budget\\b\\s*(?:is|of|:|=)?\\s*(?:under|below|max(?:imum)?(?: of)?|up to|no more than|at most)?\\s*([$€£])(${AMOUNT})(?![0-9.,]*\\s*(?:k|m|bn|b|million|billion|thousand|per|each|a|an)\\b|[0-9a-z/])`, 'i');
// Sentences that are questions or conditions are never applied as instructions.
const HYPOTHETICAL = /\?|\b(?:if|suppose|supposing|imagine|would|could|might)\b/i;
const CURRENCY = {'$':'USD','€':'EUR','£':'GBP'};
function budgetFrom(match) {
  const minor = Math.round(Number(match[2].replace(/,/g, '')) * 100);
  return Number.isSafeInteger(minor) && minor > 0 ? {currency: CURRENCY[match[1]], amountMinor: minor} : null;
}
function briefBudget(body) {
  let found = null;
  for (const sentence of body.split(/(?<=[.!?])\s+|\n+/)) {
    if (HYPOTHETICAL.test(sentence)) continue;
    const match = sentence.trim().match(BRIEF_BUDGET);
    if (match) found = budgetFrom(match) || found;
  }
  return found;
}
const PRIORITY_REASON = {
  balanced: 'Price and supplier delivery estimate were balanced',
  price: 'Lower price was prioritized, as you asked,',
  speed: 'Faster delivery was prioritized, as you asked,',
};

// A recommendation is advice about current quotes, never authorization to hire.
// Only existing qualification/readiness gates can admit an offer to this policy.
function discoveryPreferences(task) {
  const preferences = { priority: 'balanced', alternatives: false, budget: null };
  // Only explicit buyer messages can influence discovery. Supplier text and model replies are untrusted.
  for (const message of task.messages || []) {
    if (!task.ownerId || message.authorId !== task.ownerId || (message.role && message.role !== 'user')) continue;
    const body = String(message.body || '').trim();
    // Whole-message commands only: a hypothetical or quoted phrase inside a longer message never matches.
    if (ALTERNATIVES.test(body)) preferences.alternatives = true;
    const priority = body.match(PRIORITY);
    if (priority) {
      preferences.priority = /cheap/i.test(priority[1]) ? 'price' : /fast|quick/i.test(priority[1]) ? 'speed' : 'balanced';
    }
    const success = body.match(/^use the cheapest agent that still has at least (100|[0-9]{1,2})% success rate[.!]?$/i);
    if (success) preferences.requiredSuccessRate = Number(success[1]);
    const budget = body.match(BUDGET);
    const stated = budget ? budgetFrom(budget) : briefBudget(body);
    if (stated) preferences.budget = stated;
    if (/^(?:please )?(?:reset|clear) (?:my )?(?:matching |discovery )?preferences[.!]?$/i.test(body)) { Object.assign(preferences, {priority:'balanced', alternatives:false, budget:null}); delete preferences.requiredSuccessRate; }
  }
  return preferences;
}

function recommendOffers(task, offers, now) {
  const preferences = discoveryPreferences(task);
  const candidates = offers.filter(offer => meetsSuccessRequirement(offer, preferences.requiredSuccessRate) && offer.exposure?.eligible &&
    offer.qualificationCurrent && offer.scopeVersion === task.scopeVersion &&
    offer.expiresAt > now && (!preferences.budget || (offer.currency === preferences.budget.currency && require('./pricing.cjs').buyerTotal(offer) <= preferences.budget.amountMinor)) && Number.isSafeInteger(require('./pricing.cjs').buyerTotal(offer)) && require('./pricing.cjs').buyerTotal(offer) > 0 &&
    Number.isFinite(offer.deliveryMinutes) && offer.deliveryMinutes > 0)
    .map(offer => {
      const match = matchCapability(task.brief, offer.capability, offer.capabilityMetadata);
      return {offer, matched: match.matches, match};
    }).filter(candidate => candidate.matched.length > 0);
  const sameCurrency = new Set(candidates.map(({offer}) => offer.currency)).size === 1;
  const minPrice = Math.min(...candidates.map(({offer}) => require('./pricing.cjs').buyerTotal(offer)));
  const minTime = Math.min(...candidates.map(({offer}) => offer.deliveryMinutes));
  const ranked = candidates.map(candidate => {
    const {offer, matched} = candidate;
    const history = Math.max(0, Number(offer.trackRecord?.capabilityAccepted) || 0);
    const fit = candidate.match.score;
    const score = 50 * fit + evidencePoints(offer) +
      (sameCurrency ? (preferences.priority === 'price' ? 40 : 15) * minPrice / require('./pricing.cjs').buyerTotal(offer) : 0) +
      (preferences.priority === 'speed' ? 40 : 15) * minTime / offer.deliveryMinutes;
    return {...candidate, score, history};
  }).sort((a, b) => b.score - a.score || a.offer.id.localeCompare(b.offer.id));
  const best = ranked[0];
  return offers.map(offer => ({...offer, recommendation: {
    policy: POLICY,
    preferences,
    eligibleCount: candidates.length,
    blockedReason: preferences.requiredSuccessRate !== undefined && !candidates.length ?
      `No quoted agent has at least ${MIN_RATE_SAMPLE} verified runs with ${preferences.requiredSuccessRate}% or more accepted, so I cannot recommend one against that requirement yet.` : null,
    recommended: offer.id === best?.offer.id,
    scopeVersion: task.scopeVersion,
    reasons: offer.id === best?.offer.id ? [
      // Ordered by decision weight: the inline card shows the first three (fit, evidence, price/time).
      `Declared capability matches words or related concepts in your brief: ${best.matched.slice(0, 5).join(', ')}.`,
      best.offer.trackRecord?.outcomes?.runs ? `Verified outcomes for this capability: ${ledgerLabel(best.offer.trackRecord.outcomes)}.` :
        best.history ? `${best.history} accepted deliveries for this capability in this environment.` : 'New capability history: assessment evidence is available, but verified runs are not established.',
      sameCurrency ? `${PRIORITY_REASON[preferences.priority]} across ${candidates.length} eligible ${offer.currency} quote${candidates.length === 1 ? '' : 's'}.` : 'Delivery estimates were compared; prices in different currencies were not compared.',
      'This quoted capability has a current assessment and a recently connected runtime.',
      ...(best.match.detailMatches.length ? [`Supplier-declared details also match: ${best.match.detailMatches.join(', ')}. These are not independently verified.`] : [])
    ] : [],
    limitations: 'Provisional match based on declared capability, current assessment, verified outcomes in this environment and supplier estimates. Outcome counts are not a guarantee or a guarantee of scope coverage, compliance, availability or delivery. Review the agreement before selecting.'
  }}));
}
module.exports = {recommendOffers, discoveryPreferences};
