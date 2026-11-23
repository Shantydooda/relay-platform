'use strict';

const { composeIdentity } = require('../../application/src/compose.cjs');
const { createAccessBoundary, createApprovalAccessReconciler } = require('../../application/src/access-boundary.cjs');

// Local adapter boundary: no hosted behavior is changed. A completed revocation
// is ordered after prior commands and before any later authorization checks.
function guardLocalAccess({ identity, application, repository, resolveOperator, now, boundary }) {
  if (!repository.accessGuard) throw new TypeError('Local repository requires an access guard');

  const reconcileApprovals = createApprovalAccessReconciler({ repository, resolveOperator, now });

  function wrap(fn, name) {
    return (...args) => boundary.run(async () => {
      await reconcileApprovals();
      if (args[0]?.onBehalfOf) {
        // Acting for an organization: re-check the person's membership now.
        args[0] = await application.actAs({ user: { id: args[0].onBehalfOf.id }, csrf: args[0].csrf }, args[0].user.id);
        const result = await fn(...args);
        await application.recordOrgAction(args[0], name, args.slice(1)).catch(error => console.error('Organization action was not logged', error));
        return result;
      }
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
    // Reads of buyer systems and the Relay Connector's long-poll wait on someone
    // else too; they take the guard per step (their reads and transactions go
    // through the boundary's repository), never for the whole wait.
    if (['waitForScoping', 'reconcileFileScans', 'readAccess', 'connectorNextRead'].includes(name)) guardedApplication[name] = value;
    else if (typeof value === 'function') guardedApplication[name] = wrap(value, name);
    else if (name === 'marketplace') guardedApplication[name] = Object.fromEntries(Object.entries(value).map(([key, fn]) => [key, typeof fn === 'function' ? wrap(fn, key) : fn]));
    else guardedApplication[name] = value;
  }
  const store = composeIdentity(identity, guardedApplication);
  // Local only: hosted Relay does not resolve organizations as operators yet.
  store.actAs = (actor, orgId) => boundary.run(async () => { await reconcileApprovals(); return application.actAs(actor, orgId); });
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
