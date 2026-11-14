'use strict';

const POLICY = 'evidence-balanced-v1';
const STOP_WORDS = new Set('a an and are as at be by for from i in is it me my of on or our please that the their this to we with work task need want find create build make'.split(' '));
function terms(value) {
  return new Set((String(value || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
    .filter(word => word.length > 2 && !STOP_WORDS.has(word)));
}

// A recommendation is advice about current quotes, never authorization to hire.
// Only existing qualification/readiness gates can admit an offer to this policy.
function recommendOffers(task, offers, now) {
  const requestTerms = terms(task.brief);
  const candidates = offers.filter(offer => offer.exposure?.eligible &&
    offer.qualificationCurrent && offer.scopeVersion === task.scopeVersion &&
    offer.expiresAt > now && Number.isSafeInteger(offer.amountMinor) && offer.amountMinor > 0 &&
    Number.isFinite(offer.deliveryMinutes) && offer.deliveryMinutes > 0)
    .map(offer => {
      const matched = [...terms(offer.capability)].filter(word => requestTerms.has(word));
      return {offer, matched};
    }).filter(candidate => candidate.matched.length > 0);
  const sameCurrency = new Set(candidates.map(({offer}) => offer.currency)).size === 1;
  const minPrice = Math.min(...candidates.map(({offer}) => offer.amountMinor));
  const minTime = Math.min(...candidates.map(({offer}) => offer.deliveryMinutes));
  const ranked = candidates.map(candidate => {
    const {offer, matched} = candidate;
    const history = Math.max(0, Number(offer.trackRecord?.capabilityAccepted) || 0);
    const fit = matched.length / Math.max(1, requestTerms.size);
    const score = 50 * fit + 20 * Math.min(history, 5) / 5 +
      (sameCurrency ? 15 * minPrice / offer.amountMinor : 0) +
      15 * minTime / offer.deliveryMinutes;
    return {...candidate, score, history};
  }).sort((a, b) => b.score - a.score || a.offer.id.localeCompare(b.offer.id));
  const best = ranked[0];
  return offers.map(offer => ({...offer, recommendation: {
    policy: POLICY,
    recommended: offer.id === best?.offer.id,
    scopeVersion: task.scopeVersion,
    reasons: offer.id === best?.offer.id ? [
      `Declared capability overlaps your brief: ${best.matched.slice(0, 5).join(', ')}.`,
      'This quoted capability has a current assessment and a recently connected runtime.',
      best.history ? `${best.history} accepted deliveries for this capability in this environment.` : 'New capability history: assessment evidence is available, but accepted deliveries are not established.',
      sameCurrency ? `Price and supplier delivery estimate were balanced across ${candidates.length} eligible ${offer.currency} quote${candidates.length === 1 ? '' : 's'}.` : 'Delivery estimates were compared; prices in different currencies were not compared.'
    ] : [],
    limitations: 'Provisional match based on declared capability, current assessment, local acceptance history and supplier estimates. Not a verified success rate or a guarantee of scope coverage, compliance, availability or delivery. Review the agreement before selecting.'
  }}));
}
module.exports = {recommendOffers};
