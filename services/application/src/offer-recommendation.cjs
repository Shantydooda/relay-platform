'use strict';

const POLICY = 'evidence-concepts-v3';
const {matchCapability} = require('./capability-matching.cjs');

// A recommendation is advice about current quotes, never authorization to hire.
// Only existing qualification/readiness gates can admit an offer to this policy.
function discoveryPreferences(task) {
  const preferences = { priority: 'balanced', alternatives: false, budget: null };
  // Only explicit buyer messages can influence discovery. Supplier text and model replies are untrusted.
  for (const message of task.messages || []) {
    if (!task.ownerId || message.authorId !== task.ownerId || (message.role && message.role !== 'user')) continue;
    const body = String(message.body || '').trim();
    if (/^(?:please )?(?:show|see|give me|can i see) (?:me )?(?:three |3 |some |other )?(?:alternatives|agents|options)[.!?]?$/i.test(body)) preferences.alternatives = true;
    if (/^(?:please )?(?:use|show me|prefer) (?:the )?(cheapest|cheaper|fastest|balanced)(?: (?:agent|option))?[.!]?$/i.test(body)) {
      preferences.priority = /cheap/i.test(body) ? 'price' : /fast/i.test(body) ? 'speed' : 'balanced';
    }
    const success = body.match(/^use the cheapest agent that still has at least (100|[0-9]{1,2})% success rate[.!]?$/i);
    if (success) preferences.requiredSuccessRate = Number(success[1]);
    const budget = body.match(/^(?:please )?keep it under ([$€£])([0-9]+(?:\.[0-9]{1,2})?)[.!]?$/i);
    if (budget) {
      const minor = Math.round(Number(budget[2]) * 100);
      if (Number.isSafeInteger(minor) && minor > 0) preferences.budget = {currency: {'$':'USD','€':'EUR','£':'GBP'}[budget[1]], amountMinor:minor};
    }
    if (/^(?:please )?(?:reset|clear) (?:my )?(?:matching |discovery )?preferences[.!]?$/i.test(body)) { Object.assign(preferences, {priority:'balanced', alternatives:false, budget:null}); delete preferences.requiredSuccessRate; }
  }
  return preferences;
}

function recommendOffers(task, offers, now) {
  const preferences = discoveryPreferences(task);
  const candidates = offers.filter(offer => preferences.requiredSuccessRate === undefined && offer.exposure?.eligible &&
    offer.qualificationCurrent && offer.scopeVersion === task.scopeVersion &&
    offer.expiresAt > now && (!preferences.budget || (offer.currency === preferences.budget.currency && offer.amountMinor <= preferences.budget.amountMinor)) && Number.isSafeInteger(offer.amountMinor) && offer.amountMinor > 0 &&
    Number.isFinite(offer.deliveryMinutes) && offer.deliveryMinutes > 0)
    .map(offer => {
      const match = matchCapability(task.brief, offer.capability, offer.capabilityMetadata);
      return {offer, matched: match.matches, match};
    }).filter(candidate => candidate.matched.length > 0);
  const sameCurrency = new Set(candidates.map(({offer}) => offer.currency)).size === 1;
  const minPrice = Math.min(...candidates.map(({offer}) => offer.amountMinor));
  const minTime = Math.min(...candidates.map(({offer}) => offer.deliveryMinutes));
  const ranked = candidates.map(candidate => {
    const {offer, matched} = candidate;
    const history = Math.max(0, Number(offer.trackRecord?.capabilityAccepted) || 0);
    const fit = candidate.match.score;
    const score = 50 * fit + 20 * Math.min(history, 5) / 5 +
      (sameCurrency ? (preferences.priority === 'price' ? 40 : 15) * minPrice / offer.amountMinor : 0) +
      (preferences.priority === 'speed' ? 40 : 15) * minTime / offer.deliveryMinutes;
    return {...candidate, score, history};
  }).sort((a, b) => b.score - a.score || a.offer.id.localeCompare(b.offer.id));
  const best = ranked[0];
  return offers.map(offer => ({...offer, recommendation: {
    policy: POLICY,
    preferences,
    eligibleCount: candidates.length,
    blockedReason: preferences.requiredSuccessRate !== undefined ? 'Verified capability success rates are not available yet, so I cannot recommend an agent against that requirement.' : null,
    recommended: offer.id === best?.offer.id,
    scopeVersion: task.scopeVersion,
    reasons: offer.id === best?.offer.id ? [
      `Declared capability matches words or related concepts in your brief: ${best.matched.slice(0, 5).join(', ')}.`,
      ...(best.match.detailMatches.length ? [`Supplier-declared details also match: ${best.match.detailMatches.join(', ')}. These are not independently verified.`] : []),
      'This quoted capability has a current assessment and a recently connected runtime.',
      best.history ? `${best.history} accepted deliveries for this capability in this environment.` : 'New capability history: assessment evidence is available, but accepted deliveries are not established.',
      sameCurrency ? `Price and supplier delivery estimate were balanced across ${candidates.length} eligible ${offer.currency} quote${candidates.length === 1 ? '' : 's'}.` : 'Delivery estimates were compared; prices in different currencies were not compared.'
    ] : [],
    limitations: 'Provisional match based on declared capability, current assessment, local acceptance history and supplier estimates. Not a verified success rate or a guarantee of scope coverage, compliance, availability or delivery. Review the agreement before selecting.'
  }}));
}
module.exports = {recommendOffers, discoveryPreferences};
