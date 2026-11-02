'use strict';

// A conversational model must not silently turn an impossible monthly date
// into an executable plan. The calendar editor remains authoritative.
function clarifyMonthlyDate(proposal) {
  if (
    !['request', 'change'].includes(proposal.intent) ||
    proposal.cadence !== 'monthly'
  )
    return proposal;
  if (
    !/\b(?:29th|30th|31st)\b|\b(?:day|on(?: the)?)\s+(?:29|30|31)\b/i.test(
      proposal.schedule || '',
    )
  )
    return proposal;
  if (/\b(?:skip|last day)\b/i.test(proposal.schedule || '')) return proposal;
  const question =
    'For months without that date, should we skip the run or use the last day of the month?';
  if (
    proposal.questions.some((item) =>
      /shorter|without that date|last day|skip.*month/i.test(item),
    )
  )
    return proposal;
  // This is a clarification only, never a default calendar rule or activation.
  return {
    ...proposal,
    questions: [question, ...proposal.questions].slice(0, 3),
  };
}

module.exports = { clarifyMonthlyDate };
