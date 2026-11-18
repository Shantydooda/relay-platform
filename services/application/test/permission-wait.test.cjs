'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pauseForPermission, resumeAfterPermission } = require('../src/permission-wait.cjs');

test('human wait fences the worker, preserves execution budget and waits for every decision', () => {
  const task = { assignment: { id: 'job', status: 'running', deadlineAt: 10000, leaseHash: 'old', leaseUntil: 5000 }, permissionRequests: [{ assignmentId: 'job', status: 'pending' }, { assignmentId: 'job', status: 'declined' }] };
  pauseForPermission(task, 1000);
  assert.equal(task.assignment.leaseHash, null);
  assert.equal(task.assignment.status, 'queued');
  pauseForPermission(task, 5000);
  assert.equal(task.assignment.attemptLimit, 4);
  task.permissionRequests[0].status = 'approved';
  resumeAfterPermission(task, 86400000);
  assert.ok(task.assignment.permissionWait);
  task.permissionRequests[1].status = 'approved';
  resumeAfterPermission(task, 86400000);
  assert.equal(task.assignment.permissionWait, null);
  assert.equal(task.assignment.deadlineAt, 86400000 + 120000 + 9000);
  const deadline = task.assignment.deadlineAt;
  resumeAfterPermission(task, 99999999);
  assert.equal(task.assignment.deadlineAt, deadline);
});
