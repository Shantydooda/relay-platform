'use strict';

const { createTransport, SupplierError } = require('./transport.cjs');

function id(value) {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value)) throw new SupplierError('INVALID_ID');
  return value;
}
function page({ after = '', limit = 50 } = {}) {
  if (typeof after !== 'string' || !/^[A-Za-z0-9:_-]{0,150}$/.test(after) || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new SupplierError('INVALID_PAGE');
  }
  return `?after=${encodeURIComponent(after)}&limit=${limit}`;
}

// Whether a runtime should claim this assignment now. Servers that send `next`
// decide it; for older servers it falls back to status, holds and the lease.
// A true result is a hint: the claim itself still checks every guard.
function shouldClaim(assignment, now = Date.now()) {
  if (assignment?.next) return assignment.next.action === 'claim';
  return !!assignment && !assignment.waitingForPermission && !assignment.pausedByBuyer &&
    !(assignment.status === 'running' && assignment.leaseUntil > now);
}

function createSupplierClient(options) {
  const request = createTransport(options);
  const taskCommand = (action, taskId, body, key) => request(`/tasks/${id(taskId)}/${action}`, body, key, 'POST');
  return Object.freeze({
    heartbeat: body => request('/heartbeat', body, undefined, 'POST'),
    opportunities: options => request(`/opportunities${page(options)}`),
    assignments: options => request(`/assignments${page(options)}`),
    events: options => request(`/events${page(options)}`),
    task: taskId => request(`/tasks/${id(taskId)}`),
    qualifications: () => request('/qualifications'),
    submitQualification: (testId, body, key) => request(`/qualifications/${id(testId)}`, body, key, 'POST'),
    evaluations: () => request('/evaluations'),
    submitEvaluation: (runId, body, key) => request(`/evaluations/${id(runId)}`, body, key, 'POST'),
    quote: (taskId, body, key) => taskCommand('offers', taskId, body, key),
    requestPermission: (taskId, body, key) => taskCommand('permission-requests', taskId, body, key),
    message: (taskId, body, key) => taskCommand('messages', taskId, body, key),
    proposeChange: (taskId, body, key) => taskCommand('change-proposals', taskId, body, key),
    readTool: (taskId, body, key) => taskCommand('tool-read', taskId, body, key),
    // Buyer connections: ask for read access, read through Relay, or end as blocked.
    requestAccess: (taskId, body, key) => taskCommand('access-requests', taskId, body, key),
    readAccess: (taskId, body, key) => taskCommand('access-read', taskId, body, key),
    endBlocked: (taskId, body, key) => taskCommand('blocked', taskId, body, key),
    claim: (taskId, body, key) => taskCommand('claim', taskId, body, key),
    progress: (taskId, body, key) => taskCommand('progress', taskId, body, key),
    submit: (taskId, body, key) => taskCommand('submit', taskId, body, key),
    fail: (taskId, body, key) => taskCommand('fail', taskId, body, key)
  });
}
module.exports = { createSupplierClient, SupplierError, shouldClaim };
