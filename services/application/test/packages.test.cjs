'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePackage, checkPurchasable, packageTerms, MAX_EXTRA_ROUNDS } = require('../src/packages.cjs');

const rejects = (fn, code) => assert.throws(fn, error => error.code === code, `expected ${code}`);

const agent = (overrides = {}) => ({
  id: 'a1', listingStatus: 'published', rules: { minimumPayout: 500, currency: 'USD' },
  capabilities: [{ id: 'cap-ok', task: 'Normalize CSV data' }, { id: 'cap-new', task: 'Enrich companies' }],
  ...overrides,
});
// Stands in for qualification.cjs#capabilityView: only cap-ok has a current Relay test pass.
const qualified = (_agent, capability) => capability.id === 'cap-ok' ? 'qualified' : 'unverified';

const body = (overrides = {}) => ({
  capabilityId: 'cap-ok', title: '  Clean one CSV  ', included: 'Duplicates removed, rows sorted, validation report.',
  priceMinor: 2500, deliveryMinutes: 60, criteria: ['No duplicate rows', 'Header row kept'], inputs: ['csv'], extraRounds: 1,
  ...overrides,
});

test('a valid package is trimmed, its checklist numbered and its currency taken from the agent', () => {
  assert.deepEqual(normalizePackage(body(), agent(), qualified), {
    capabilityId: 'cap-ok', title: 'Clean one CSV', included: 'Duplicates removed, rows sorted, validation report.',
    priceMinor: 2500, currency: 'USD', deliveryMinutes: 60,
    criteria: [{ id: 'c1', text: 'No duplicate rows' }, { id: 'c2', text: 'Header row kept' }],
    inputs: ['csv'], extraRounds: 1,
  });
  assert.equal(normalizePackage(body({ extraRounds: undefined }), agent(), qualified).extraRounds, 0, 'extra rounds default to none');
});

test('only a capability that currently passes its Relay test can be sold as a package', () => {
  rejects(() => normalizePackage(body({ capabilityId: 'cap-new' }), agent(), qualified), 'CAPABILITY_NOT_QUALIFIED');
  rejects(() => normalizePackage(body({ capabilityId: 'missing' }), agent(), qualified), 'INVALID_INPUT');
});

test('the price respects the agent minimum and the shared quote limits', () => {
  rejects(() => normalizePackage(body({ priceMinor: 499 }), agent(), qualified), 'PRICE_LIMIT');
  rejects(() => normalizePackage(body({ priceMinor: 10_000_001 }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ priceMinor: 25.5 }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ deliveryMinutes: 0 }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ deliveryMinutes: 525_601 }), agent(), qualified), 'INVALID_INPUT');
});

test('a package needs an agreed checklist of 1–12 distinct items', () => {
  rejects(() => normalizePackage(body({ criteria: [] }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ criteria: Array.from({ length: 13 }, (_, i) => `Check ${i}`) }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ criteria: ['Same', 'same'] }), agent(), qualified), 'INVALID_INPUT');
});

test('inputs are limited to what a runtime can take today, and extra rounds are bounded', () => {
  rejects(() => normalizePackage(body({ inputs: [] }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ inputs: ['pdf'] }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ inputs: ['csv', 'csv'] }), agent(), qualified), 'INVALID_INPUT');
  assert.equal(MAX_EXTRA_ROUNDS, 3);
  rejects(() => normalizePackage(body({ extraRounds: 4 }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ extraRounds: -1 }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ title: 'ab' }), agent(), qualified), 'INVALID_INPUT');
  rejects(() => normalizePackage(body({ surprise: true }), agent(), qualified), 'INVALID_FIELDS');
});

test('a package can be bought only while it, its agent and its capability are all live', () => {
  const pkg = { id: 'p1', version: 2, status: 'published', ...normalizePackage(body(), agent(), qualified) };
  const live = agent({ packages: [pkg] });
  assert.equal(checkPurchasable(live, 'p1', qualified), pkg);
  rejects(() => checkPurchasable(live, 'nope', qualified), 'NOT_FOUND');
  rejects(() => checkPurchasable(agent({ packages: [{ ...pkg, status: 'paused' }] }), 'p1', qualified), 'PACKAGE_UNAVAILABLE');
  rejects(() => checkPurchasable(agent({ packages: [pkg], listingStatus: 'paused' }), 'p1', qualified), 'PACKAGE_UNAVAILABLE');
  rejects(() => checkPurchasable(live, 'p1', () => 'expired'), 'CAPABILITY_NOT_QUALIFIED');
  rejects(() => checkPurchasable(agent({ packages: [pkg], rules: { minimumPayout: 3000, currency: 'USD' } }), 'p1', qualified), 'PRICE_LIMIT');
});

test('the terms frozen at purchase record the package id and version', () => {
  const pkg = { id: 'p1', version: 2, status: 'published', ...normalizePackage(body(), agent(), qualified) };
  const terms = packageTerms(pkg);
  assert.equal(terms.packageId, 'p1');
  assert.equal(terms.packageVersion, 2);
  assert.deepEqual(terms.criteria, pkg.criteria);
  assert.notEqual(terms.criteria, pkg.criteria, 'a copy, so later edits to the package never reach a bought task');
  assert.ok(Object.isFrozen(terms));
});
