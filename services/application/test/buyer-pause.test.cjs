'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { pauseByBuyer, resumeByBuyer } = require('../src/buyer-pause.cjs');
const { pauseForPermission, resumeAfterPermission } = require('../src/permission-wait.cjs');
const { pausedByBuyer, executionHeld, waitingForPermission } = require('../../../packages/domain/src/execution-state.cjs');

const running = () => ({
  assignment: { id: 'job', status: 'running', deadlineAt: 100000, queueDeadlineAt: 0, leaseHash: 'lease', leaseUntil: 60000, attempt: 1 },
  permissionRequests: [],
});

test('pausing running work fences the runtime, freezes remaining time and does not spend a retry', () => {
  const task = running();
  pauseByBuyer(task, 40000, 'buyer');
  const job = task.assignment;
  assert.equal(job.status, 'queued');
  assert.equal(job.leaseHash, null);
  assert.equal(job.leaseUntil, 0);
  assert.equal(job.buyerPause.remainingMs, 60000);
  assert.equal(job.buyerPause.pausedBy, 'buyer');
  assert.equal(job.attemptLimit, 4);
  assert.equal(pausedByBuyer(job), true);
  assert.equal(executionHeld(job), true);
  assert.throws(() => pauseByBuyer(task, 41000, 'buyer'), /already paused/);
});

test('resuming restarts the clock from the frozen remaining time, however long the pause lasted', () => {
  const task = running();
  pauseByBuyer(task, 40000, 'buyer');
  resumeByBuyer(task, 10_000_000);
  const job = task.assignment;
  assert.equal(job.buyerPause, null);
  assert.equal(job.deadlineAt, 10_000_000 + 120000 + 60000);
  assert.equal(job.queueDeadlineAt, 10_000_000 + 120000);
  assert.equal(pausedByBuyer(job), false);
  assert.throws(() => resumeByBuyer(task, 10_000_001), /not paused/);
});

test('only waiting or running work can be paused', () => {
  for (const status of ['buyer_review', 'accepted', 'failed', 'cancelled']) {
    const task = running();
    task.assignment.status = status;
    assert.throws(() => pauseByBuyer(task, 1, 'buyer'), /Only work that is waiting or running/, status);
  }
  assert.throws(() => pauseByBuyer({ assignment: null }, 1, 'buyer'), /Only work/);
});

test('approving permission does not restart work the buyer paused', () => {
  const task = running();
  task.permissionRequests = [{ assignmentId: 'job', status: 'pending' }];
  pauseForPermission(task, 40000); // 60s remaining frozen by the permission wait
  pauseByBuyer(task, 50000, 'buyer');
  assert.equal(task.assignment.buyerPause.remainingMs, null);
  task.permissionRequests[0].status = 'approved';
  resumeAfterPermission(task, 70000);
  const job = task.assignment;
  assert.equal(waitingForPermission(job), false);
  assert.equal(pausedByBuyer(job), true, 'still paused by the buyer');
  assert.equal(job.buyerPause.remainingMs, 60000, 'frozen time carried over, not reset');
  assert.equal(job.deadlineAt, 100000, 'clock not restarted by the permission approval');
  resumeByBuyer(task, 90000);
  assert.equal(job.deadlineAt, 90000 + 120000 + 60000);
});

test('resuming while permission is still pending leaves the clock to the permission flow', () => {
  const task = running();
  task.permissionRequests = [{ assignmentId: 'job', status: 'pending' }];
  pauseForPermission(task, 40000);
  pauseByBuyer(task, 50000, 'buyer');
  resumeByBuyer(task, 60000);
  const job = task.assignment;
  assert.equal(pausedByBuyer(job), false);
  assert.equal(waitingForPermission(job), true);
  assert.equal(job.deadlineAt, 100000, 'no deadline set while permission is pending');
  task.permissionRequests[0].status = 'approved';
  resumeAfterPermission(task, 80000);
  assert.equal(job.deadlineAt, 80000 + 120000 + 60000);
});

test('terminal assignments never report a live pause from retained metadata', () => {
  const task = running();
  pauseByBuyer(task, 40000, 'buyer');
  task.assignment.status = 'cancelled';
  assert.equal(pausedByBuyer(task.assignment), false);
  assert.equal(executionHeld(task.assignment), false);
});
