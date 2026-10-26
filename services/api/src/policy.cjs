'use strict';
// A first service boundary, not a running API. Trusted actor/context must come from
// verified sessions and tenant-scoped database reads, never the client's JSON body.
const domain=require('@relay/domain');
function authorize(command,context){const policies={fund:domain.evaluateFunding,accept:domain.evaluateAcceptance,payout:domain.evaluatePayout};if(!Object.hasOwn(policies,command))return {allowed:false,code:'UNKNOWN_COMMAND'};return policies[command](context)}
module.exports={authorize};
