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
