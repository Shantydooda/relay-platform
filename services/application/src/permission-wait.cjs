'use strict';

// Waiting for a human is not supplier execution time. Keep the assignment queued
// so it remains discoverable, but fence its old worker until all requests resolve.
function pauseForPermission(task, now) {
  const job = task.assignment;
  if (!job.permissionWait) {
    job.permissionWait = { startedAt: now, remainingMs: Math.max(1, (job.deadlineAt || now + 300000) - now) };
    if (job.status === 'running') job.attemptLimit = (job.attemptLimit || 3) + 1;
  }
  job.status = 'queued';
  job.leaseHash = null;
  job.leaseUntil = 0;
  job.progress = 'Waiting for your permission. Execution time is paused.';
}

function resumeAfterPermission(task, now) {
  const job = task.assignment;
  if (!job.permissionWait || task.permissionRequests.some(request => request.assignmentId === job.id && ['pending', 'declined'].includes(request.status))) return;
  job.queueDeadlineAt = now + 120000;
  job.deadlineAt = now + 120000 + job.permissionWait.remainingMs;
  job.permissionWait = null;
  job.progress = 'Permission approved. Waiting for the agent to resume.';
}

module.exports = { pauseForPermission, resumeAfterPermission };
