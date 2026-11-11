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
    quote: (taskId, body, key) => taskCommand('offers', taskId, body, key),
    requestPermission: (taskId, body, key) => taskCommand('permission-requests', taskId, body, key),
    message: (taskId, body, key) => taskCommand('messages', taskId, body, key),
    proposeChange: (taskId, body, key) => taskCommand('change-proposals', taskId, body, key),
    readTool: (taskId, body, key) => taskCommand('tool-read', taskId, body, key),
    claim: (taskId, body, key) => taskCommand('claim', taskId, body, key),
    progress: (taskId, body, key) => taskCommand('progress', taskId, body, key),
    submit: (taskId, body, key) => taskCommand('submit', taskId, body, key),
    fail: (taskId, body, key) => taskCommand('fail', taskId, body, key)
  });
}
module.exports = { createSupplierClient, SupplierError };
