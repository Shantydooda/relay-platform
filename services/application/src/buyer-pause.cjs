'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');

// A buyer pause stops supplier work without ending the agreement. It follows the
// permission-wait model: the assignment returns to queued, the current lease is
// fenced so the runtime must stop, and the remaining execution time is frozen.
// When a permission wait is already active, its frozen time is kept as is and the
// pause only adds a second hold; approving permission does not resume paused work.

function pauseByBuyer(task, now, userId) {
  const job = task.assignment;
  if (!job || !['queued', 'running'].includes(job.status)) fail(409, 'STATE_CONFLICT', 'Only work that is waiting or running can be paused.');
  if (job.buyerPause) fail(409, 'ALREADY_PAUSED', 'This work is already paused.');
  job.buyerPause = {
    startedAt: now,
    pausedBy: userId,
    // While permission is pending, time is already frozen there; it moves here on approval.
    remainingMs: job.permissionWait ? null : Math.max(1, (job.deadlineAt || now + 300000) - now),
  };
  // A pause must not consume one of the runtime's retry attempts.
  if (job.status === 'running') job.attemptLimit = (job.attemptLimit || 3) + 1;
  job.status = 'queued';
  job.leaseHash = null;
  job.leaseUntil = 0;
  job.progress = 'Paused by you. The agent has been told to stop; execution time is paused.';
}

function resumeByBuyer(task, now) {
  const job = task.assignment;
  if (!job?.buyerPause || !['queued', 'running'].includes(job.status)) fail(409, 'NOT_PAUSED', 'This work is not paused.');
  const pause = job.buyerPause;
  job.buyerPause = null;
  if (job.permissionWait) {
    // Permission is still pending; that flow restarts the clock when it is approved.
    job.progress = 'Resumed. Waiting for your permission before the agent continues.';
    return;
  }
  job.queueDeadlineAt = now + 120000;
  job.deadlineAt = now + 120000 + pause.remainingMs;
  job.progress = 'Resumed. Waiting for the agent to continue.';
}

// Called when a permission wait ends while the buyer has also paused the work:
// carry the frozen time into the pause instead of restarting the clock.
function holdThroughPermission(job) {
  if (!job.buyerPause || !job.permissionWait) return false;
  job.buyerPause.remainingMs = job.permissionWait.remainingMs;
  job.permissionWait = null;
  job.progress = 'Permission approved. Still paused by you.';
  return true;
}

module.exports = { pauseByBuyer, resumeByBuyer, holdThroughPermission };
