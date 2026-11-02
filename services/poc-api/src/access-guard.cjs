'use strict';

const { composeIdentity } = require('../../application/src/compose.cjs');
const { createAccessBoundary, createApprovalAccessReconciler } = require('../../application/src/access-boundary.cjs');

// Local adapter boundary: no hosted behavior is changed. A completed revocation
// is ordered after prior commands and before any later authorization checks.
function guardLocalAccess({ identity, application, repository, resolveOperator, now, boundary }) {
  if (!repository.accessGuard) throw new TypeError('Local repository requires an access guard');

  const reconcileApprovals = createApprovalAccessReconciler({ repository, resolveOperator, now });

  function wrap(fn) {
    return (...args) => boundary.run(async () => {
      await reconcileApprovals();
      if (args[0]?.user?.id) {
        const current = await resolveOperator(args[0].user.id);
        args[0] = { ...args[0], memberships: current.memberships };
      }
      return fn(...args);
    });
  }
  const guardedApplication = {};
  for (const [name, value] of Object.entries(application)) {
    // Waiting for an already-started model job must not block access revocation.
    if (['waitForScoping', 'reconcileFileScans'].includes(name)) guardedApplication[name] = value;
    else if (typeof value === 'function') guardedApplication[name] = wrap(value);
    else if (name === 'marketplace') guardedApplication[name] = Object.fromEntries(Object.entries(value).map(([key, fn]) => [key, typeof fn === 'function' ? wrap(fn) : fn]));
    else guardedApplication[name] = value;
  }
  const store = composeIdentity(identity, guardedApplication);
  for (const name of ['changeTeamRole', 'removeTeamAccess', 'acceptTeamInvite']) {
    store[name] = (...args) => boundary.run(async () => {
      const result = identity[name](...args);
      await reconcileApprovals();
      return result;
    });
  }
  return store;
}
module.exports = { guardLocalAccess, createAccessBoundary };
