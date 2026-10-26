'use strict';
const { randomBytes, createHash, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const derive = promisify(scrypt);
const SCRYPT = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const DUMMY = `scrypt$131072$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
let hashing = 0;

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
function fail(status, code, message) { throw new HttpError(status, code, message); }
async function kdf(password, salt) {
  // Bound memory use independently of the network rate limiter.
  if (hashing >= 2) fail(503, 'AUTH_BUSY', 'Sign-in is busy. Please try again shortly.');
  hashing++;
  try { return await derive(password, salt, 64, SCRYPT); }
  finally { hashing--; }
}
async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await kdf(password, salt);
  return `scrypt$131072$8$1$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, stored = DUMMY) {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts.slice(0,4).join('$') !== 'scrypt$131072$8$1') return false;
  const actual = await kdf(password, parts[4]);
  const expected = Buffer.from(parts[5], 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
function text(value, label, min, max) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max || value.includes('\0')) {
    fail(400, 'INVALID_INPUT', `${label} must contain ${min}–${max} characters.`);
  }
  return value.trim();
}
function passwordInput(value) {
  if (typeof value !== 'string' || [...value].length < 15 || [...value].length > 128 || Buffer.byteLength(value) > 1024) {
    fail(400, 'INVALID_PASSWORD', 'Use a password of 15–128 characters. Spaces are welcome.');
  }
  return value;
}
function emailInput(value) {
  const email = text(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
}
function exactKeys(body, allowed) {
  if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(key => !allowed.includes(key))) {
    fail(400, 'INVALID_FIELDS', 'The request contains unsupported fields.');
  }
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x,y);
}
module.exports = { HttpError, fail, digest, token, hashPassword, verifyPassword, text, passwordInput, emailInput, exactKeys, equal };
