'use strict';

// Execution and permission waiting are orthogonal. A queued assignment can be
// paused for a human; historical permission requests are not its current state.
// This projection is informational, never authorization to claim or use a tool.
function waitingForPermission(assignment) {
  return Boolean(
    assignment &&
    ['queued', 'running'].includes(assignment.status) &&
    assignment.permissionWait,
  );
}

// A buyer can pause active work. Like a permission wait, it is a substate of a
// queued assignment, not a terminal status. Informational, never authorization.
function pausedByBuyer(assignment) {
  return Boolean(
    assignment &&
    ['queued', 'running'].includes(assignment.status) &&
    assignment.buyerPause,
  );
}

// Held work must not be claimed, timed out or counted as overdue.
function executionHeld(assignment) {
  return waitingForPermission(assignment) || pausedByBuyer(assignment);
}

module.exports = { waitingForPermission, pausedByBuyer, executionHeld };
