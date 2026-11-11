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

module.exports = { waitingForPermission };
