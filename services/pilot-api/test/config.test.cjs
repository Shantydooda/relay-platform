'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/config.cjs');

// The private pilot must refuse to start in any configuration that could touch
// another environment's database, connect payments, or run without its own keys.
// Values below are disposable test strings, not credentials.
const CERTIFICATE = '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----';
function pilotEnv(overrides = {}) {
  return {
    RELAY_ENVIRONMENT: 'private-pilot',
    RELAY_APP_ORIGIN: 'https://relay-pilot-app.onrender.com',
    SUPABASE_URL: 'https://nnxtpkksvurcrajyjqmn.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
    SUPABASE_SECRET_KEY: 'test-secret',
    RELAY_SESSION_KEY: 'a'.repeat(64),
    RELAY_MEMBERSHIP_KEY: 'b'.repeat(64),
    RELAY_PILOT_DATABASE_PASSWORD: 'test-password',
    RELAY_DATABASE_CA: CERTIFICATE,
    ...overrides,
  };
}

test('a complete pilot configuration loads with storage disabled by default', () => {
  const config = loadConfig(pilotEnv());
  assert.equal(config.origin, 'https://relay-pilot-app.onrender.com');
  assert.equal(config.database.projectRef, 'nnxtpkksvurcrajyjqmn');
  assert.equal(config.storageEnabled, false);
  assert.equal(config.port, 10000);
  assert.equal(config.membershipKey.length, 32);
  assert.equal(loadConfig(pilotEnv({ RELAY_PILOT_STORAGE: 'private-bucket' })).storageEnabled, true);
});

test('the pilot refuses another environment, project or origin', () => {
  for (const overrides of [
    { RELAY_ENVIRONMENT: 'staging' },
    { RELAY_ENVIRONMENT: undefined },
    { SUPABASE_URL: 'https://pjnhmlhaabjqqifjixio.supabase.co' },
    { RELAY_APP_ORIGIN: 'https://relay-staging.onrender.com' },
    { RELAY_APP_ORIGIN: 'https://example.com' },
  ]) assert.throws(() => loadConfig(pilotEnv(overrides)), /PILOT_ENVIRONMENT_REQUIRED/, JSON.stringify(overrides));
});

test('any Stripe setting stops the pilot from starting', () => {
  for (const key of ['STRIPE_SECRET_KEY', 'RELAY_STRIPE_WEBHOOK_SECRET', 'STRIPE_ANYTHING']) {
    assert.throws(() => loadConfig(pilotEnv({ [key]: 'set' })), /PILOT_PAYMENTS_NOT_CONFIGURED/, key);
  }
  assert.doesNotThrow(() => loadConfig(pilotEnv({ STRIPE_SECRET_KEY: '' })), 'an empty value is not a configured key');
});

test('missing or malformed keys, certificate, storage mode and port are rejected', () => {
  assert.throws(() => loadConfig(pilotEnv({ RELAY_MEMBERSHIP_KEY: undefined })), /PILOT_MEMBERSHIP_KEY_REQUIRED/);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_MEMBERSHIP_KEY: 'short' })), /PILOT_MEMBERSHIP_KEY_REQUIRED/);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_DATABASE_CA: undefined })), /PILOT_DATABASE_CA_REQUIRED/);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_DATABASE_CA: 'not a certificate' })), /INVALID_PILOT_DATABASE_CONFIG/);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_PILOT_DATABASE_PASSWORD: '' })), /INVALID_PILOT_DATABASE_CONFIG/);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_PILOT_STORAGE: 'public' })), /INVALID_PILOT_STORAGE_MODE/);
  for (const PORT of ['80', '70000', 'abc']) assert.throws(() => loadConfig(pilotEnv({ PORT })), /INVALID_PORT/, PORT);
});

test('unpaid supplier execution is off unless explicitly enabled, and payments stay refused', () => {
  assert.equal(loadConfig(pilotEnv()).unpaidExecution, false);
  assert.equal(loadConfig(pilotEnv({ RELAY_PILOT_UNPAID_EXECUTION: 'disabled' })).unpaidExecution, false);
  assert.equal(loadConfig(pilotEnv({ RELAY_PILOT_UNPAID_EXECUTION: 'enabled' })).unpaidExecution, true);
  for (const value of ['true', '1', 'yes', 'ENABLED'])
    assert.throws(() => loadConfig(pilotEnv({ RELAY_PILOT_UNPAID_EXECUTION: value })), /INVALID_PILOT_UNPAID_EXECUTION/, value);
  assert.throws(() => loadConfig(pilotEnv({ RELAY_PILOT_UNPAID_EXECUTION: 'enabled', STRIPE_SECRET_KEY: 'set' })), /PILOT_PAYMENTS_NOT_CONFIGURED/);
});

test('Relay test reviewers are named by user id; anything else refuses to start', () => {
  assert.deepEqual(loadConfig(pilotEnv()).relayTestReviewerIds, []);
  const a = '62c74a37-f69a-4c43-97e2-d057295ad7ef', b = '0b8e2c1d-3f4a-4b5c-8d9e-0f1a2b3c4d5e';
  assert.deepEqual(loadConfig(pilotEnv({ RELAY_TEST_REVIEWER_USER_IDS: `${a}, ${b}` })).relayTestReviewerIds, [a, b]);
  for (const value of ['founder@example.com', `${a},not-an-id`, 'all'])
    assert.throws(() => loadConfig(pilotEnv({ RELAY_TEST_REVIEWER_USER_IDS: value })), /INVALID_RELAY_TEST_REVIEWERS/, value);
});
