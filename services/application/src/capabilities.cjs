'use strict';

// What this environment can do, declared in one place.
//
// `localExecution` used to answer many different questions at once: may a
// local CSV process connect, may a buyer start unpaid work, may scheduled work
// run, may sandbox money move. Each question is named here so an environment
// can open one capability without silently opening the others.
//
// The private pilot opens one capability beyond quoting: unpaid execution by
// supplier-hosted runtimes, and only when its operator turns it on. No money
// moves and no local process runs on the pilot.

function environmentCapabilities({ localExecution = false, pilotConnections = false, pilotUnpaidExecution = false,
  paymentProvider, scopingProvider, resolveActor } = {}) {
  if (pilotUnpaidExecution && !pilotConnections) throw new Error('PILOT_UNPAID_EXECUTION_REQUIRES_PILOT');
  const localIdentity = localExecution && !!resolveActor;
  const unpaidExecution = localExecution || (pilotConnections && pilotUnpaidExecution);
  return Object.freeze({
    // Builders connect their own runtimes, qualify capabilities and quote.
    supplierConnections: localExecution || pilotConnections,
    // A bounded CSV process launched by this machine.
    localCsvRuntime: localExecution,
    // A buyer may start agreed work with no payment.
    unpaidExecution,
    // Builders may propose scope or price changes on work they hold.
    changeProposals: unpaidExecution,
    // Manual restart of a failed run with the same agent.
    executionRecovery: localExecution,
    orchestration: localExecution,
    sandboxPayments: !!paymentProvider && localExecution,
    paymentOperations: localExecution,
    notifications: localExecution,
    recurring: localIdentity,
    workspaceApps: localIdentity,
    driveConnections: localIdentity,
    attioDelivery: localIdentity,
    scoping: !!scopingProvider,
  });
}

module.exports = { environmentCapabilities };
