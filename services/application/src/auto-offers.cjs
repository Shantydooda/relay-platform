'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');

// How far a builder lets their connected agent offer on its own (decided 20 Nov 2026):
// 'all' offers on any matching request (the default, and what agents saved earlier keep);
// 'limited' offers only up to the builder's amount and never on ERP data requests,
// so bigger work waits for the builder to offer by hand. Hand-made offers aren't limited.
function automaticRules(body = {}) {
  const scope = body.automaticScope === undefined ? 'all' : body.automaticScope;
  if (!['all', 'limited'].includes(scope)) fail(400, 'INVALID_INPUT', 'Choose which requests your agent may offer on automatically.');
  if (scope === 'all') return { automaticScope: 'all', automaticLimitMinor: null };
  const limit = body.automaticLimitMinor;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000000) fail(400, 'INVALID_INPUT', 'Set an automatic offer limit between 0.01 and 100,000.');
  return { automaticScope: 'limited', automaticLimitMinor: limit };
}

function automaticRefusal(rules = {}, task = {}, amountMinor) {
  if (rules.automaticScope !== 'limited') return null;
  if (task.intake?.kind === 'erp-data') return 'ERP data requests wait for you to offer by hand.';
  if (amountMinor > rules.automaticLimitMinor) return 'This offer is above your automatic limit. Offer it by hand if you want it.';
  return null;
}

module.exports = { automaticRules, automaticRefusal };
