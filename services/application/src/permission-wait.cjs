'use strict';

const { holdThroughPermission } = require('./buyer-pause.cjs');

// Waiting for a human is not supplier execution time. Keep the assignment queued
// so it remains discoverable, but fence its old worker until all requests resolve.
function pauseForPermission(task, now) {
  const job = task.assignment;
  if (!job.permissionWait) {
    // Frozen time lives in exactly one place. If the buyer already paused the work, its
    // deadline is stale: take the time the pause froze, and let the permission wait hold it.
    const pausedTime = job.buyerPause?.remainingMs;
    job.permissionWait = {
      startedAt: now,
      remainingMs: Number.isFinite(pausedTime) ? pausedTime : Math.max(1, (job.deadlineAt || now + 300000) - now),
    };
    if (job.buyerPause) job.buyerPause.remainingMs = null;
    if (job.status === 'running') job.attemptLimit = (job.attemptLimit || 3) + 1;
  }
  job.status = 'queued';
  job.leaseHash = null;
  job.leaseUntil = 0;
  job.progress = job.buyerPause
    ? 'Paused by you. The agent has also asked for permission; execution time is paused.'
    : 'Waiting for your permission. Execution time is paused.';
}

function resumeAfterPermission(task, now) {
  const job = task.assignment;
  if (!job.permissionWait || task.permissionRequests.some(request => request.assignmentId === job.id && ['pending', 'declined'].includes(request.status))) return;
  if (holdThroughPermission(job)) return;
  job.queueDeadlineAt = now + 120000;
  job.deadlineAt = now + 120000 + job.permissionWait.remainingMs;
  job.permissionWait = null;
  job.progress = 'Permission approved. Waiting for the agent to resume.';
}

module.exports = { pauseForPermission, resumeAfterPermission };
