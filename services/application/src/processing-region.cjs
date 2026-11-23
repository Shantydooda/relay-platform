'use strict';
// Processing region (docs/Build-Order.md, step 6).
//
// A builder declares where an agent processes buyers' data: the EU or the US.
// It is the builder's declaration, not something Relay has verified, and the
// UI says so. A company owner can require one region; Relay then refuses every
// meeting point with an agent that hasn't declared it: a direct request, a
// package, an offer, choosing an offer and starting work. Agents that haven't
// declared a region never meet a requirement.

const { fail } = require('../../../packages/contracts/src/input.cjs');

const REGIONS = { eu: 'the EU', us: 'the US' };

// null or '' clears the declaration.
function regionInput(value, label = 'Processing region') {
  if (value === null || value === '') return null;
  if (!Object.hasOwn(REGIONS, value)) fail(400, 'INVALID_INPUT', `${label}: choose the EU, the US, or not declared.`);
  return value;
}
const allows = (required, agent) => !required || agent?.processingRegion === required;

function assertAllowed(required, agent, side = 'buyer') {
  if (allows(required, agent)) return;
  fail(409, 'REGION_REQUIRED', side === 'buyer'
    ? `Your organization only uses agents that process data in ${REGIONS[required]}. ${agent?.name || 'This agent'} ${agent?.processingRegion ? `declares ${REGIONS[agent.processingRegion]}` : 'hasn’t declared a region'}.`
    : `This request needs an agent that processes data in ${REGIONS[required]}. Declare it on the agent’s profile if that’s where it runs.`);
}

module.exports = { REGIONS, regionInput, allows, assertAllowed };
