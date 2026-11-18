'use strict';
const { composeIdentity } = require('../../application/src/compose.cjs');
const { fail } = require('../../poc-api/src/security.cjs');

// These methods authorize a supplier credential themselves, or are invoked only
// by internal workers/provider event handlers. New application methods default
// to requiring a fresh browser principal, not to bypassing this boundary.
const INTERNAL = new Set([
  'runtimePrincipal',
  'heartbeat',
  'assignments',
  'claim',
  'progress',
  'submit',
  'failExecution',
  'qualificationJobs',
  'submitQualification',
  'supplierEvents',
  'supplierAssignment',
  'supplierOpportunities',
  'supplierAssignments',
  'reconcileScoping',
  'waitForScoping',
  'reconcileFileScans',
  'reconcileApps',
  'reconcileSchedules',
  'reconcilePayments',
  'reconcileExecutions',
  'receivePaymentEvent',
  'readAgentTool',
  'requestToolPermission',
]);
const SUPPLIER_COMMANDS = new Set([
  'marketplace.quote',
  'supplierMessage',
  'proposeChange',
]);
function composeManagedAccess(identity, application, refreshActor, boundary) {
  const runtimePrincipals = new WeakSet();
  const guarded = (work) => (boundary ? boundary.run(work) : work());
  function wrap(name, fn) {
    if (name === 'runtimePrincipal')
      return (...args) =>
        guarded(async () => {
          const principal = await fn(...args);
          runtimePrincipals.add(principal);
          return principal;
        });
    if (['waitForScoping', 'reconcileFileScans'].includes(name)) return fn;
    if (INTERNAL.has(name)) return (...args) => guarded(() => fn(...args));
    return (actor, ...args) =>
      guarded(async () => {
        // Only principals minted by this store may enter the supplier alternative.
        // The domain command still checks current key, scope and ownership.
        const runtime = args.at(-1);
        if (
          SUPPLIER_COMMANDS.has(name) &&
          runtime &&
          runtimePrincipals.has(runtime) &&
          runtime.actor === actor
        ) {
          return fn(actor, ...args);
        }
        const current = await refreshActor(actor);
        if (current.scope !== 'app')
          fail(
            403,
            'RECOVERY_ONLY',
            'Finish resetting your password before continuing.',
          );
        return fn(current, ...args);
      });
  }
  const guardedApplication = {};
  for (const [name, value] of Object.entries(application)) {
    if (typeof value === 'function')
      guardedApplication[name] = wrap(name, value);
    else if (name === 'marketplace')
      guardedApplication[name] = Object.fromEntries(
        Object.entries(value).map(([method, fn]) => [
          method,
          typeof fn === 'function' ? wrap(`marketplace.${method}`, fn) : fn,
        ]),
      );
    else guardedApplication[name] = value;
  }
  return composeIdentity(identity, guardedApplication);
}
module.exports = { composeManagedAccess };
