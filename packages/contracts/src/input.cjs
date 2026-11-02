'use strict';

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new HttpError(status, code, message); }

function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || value.includes('\0')) {
    fail(400, 'INVALID_INPUT', `${label} must contain ${min}–${max} characters.`);
  }
  return value.trim();
}

function exactKeys(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) {
    fail(400, 'INVALID_FIELDS', 'The request contains unsupported fields.');
  }
}

module.exports = { HttpError, fail, text, exactKeys };
