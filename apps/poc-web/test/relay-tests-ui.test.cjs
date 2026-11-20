'use strict';
// Build → Relay tests (relay-tests-ui.js) and how builder-written tests read on cards.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function load(state, files) {
  const context = vm.createContext({ state, escape, date: () => 'Date', Date, Intl });
  for (const file of files) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return context;
}
const approved = { id: 't1', rubric: 'relay-test:t1', title: 'Vendor <names>', categoryId: 'master-data', category: 'Master-data cleanup', limitation: 'Suffixes only.', authorName: 'Ana', status: 'approved', createdAt: Date.now() };
const mine = { ...approved, id: 't2', status: 'rejected', reason: 'Expected output is wrong.', brief: 'Fix suffixes', input: 'acme {{nonce}}', expected: 'SECRET-ANSWER', revision: 'Sort', revisionExpected: 'SECRET-2', comparison: 'lines', version: 2 };

test('builders see approved tests without answers, their own proposals with reasons, and no staff queue', () => {
  const ctx = load({ relayTests: { approved: [approved], mine: [mine], canReview: false, comparisons: { lines: 'Same lines' } }, taxonomy: [] }, ['build-ui.js', 'relay-tests-ui.js']);
  const html = vm.runInContext('RelayTests.page()', ctx);
  assert.match(html, /Vendor &#60;names&#62;/, 'builder-written text is escaped');
  assert.doesNotMatch(html, /Vendor <names>/);
  assert.match(html, /Expected output is wrong\./);
  assert.match(html, /Edit as a new proposal/);
  assert.doesNotMatch(html, /Waiting for your review/);
  assert.match(html, /\{\{nonce\}\}/, 'the form explains the nonce');
  // The author sees their own expected output; the approved list never carries it.
  assert.match(html, /SECRET-ANSWER/);
  assert.equal(vm.runInContext('RelayTests.available(state.relayTests.approved)', ctx).includes('SECRET'), false);
});

test('staff see the queue with a checklist and decision buttons', () => {
  const waiting = { ...mine, status: 'in_review', id: 't3' };
  const ctx = load({ relayTests: { approved: [], mine: [], canReview: true, comparisons: {} }, relayTestQueue: { waiting: [waiting], approved: [] }, taxonomy: [] }, ['build-ui.js', 'relay-tests-ui.js']);
  const html = vm.runInContext('RelayTests.page()', ctx);
  assert.match(html, /Waiting for your review/);
  assert.match(html, /Its author can take it/);
  assert.match(html, /value="approve"/);
  assert.match(html, /value="reject"/);
});

test('a capability lists approved tests in its category only, and evidence names who wrote the test', () => {
  const ctx = load({ relayTests: { approved: [approved] } }, ['supplier-ui.js']);
  const tests = cap => JSON.parse(JSON.stringify(vm.runInContext(`RelaySupplier.testsFor(${JSON.stringify(cap)})`, ctx)));
  assert.equal(tests({ categoryId: 'master-data' }).length, 3);
  assert.equal(tests({ categoryId: 'lead-lists' }).length, 2);
  const evidence = { rubric: 'relay-test:t1', title: 'Vendor names', limitation: 'Suffixes only.', revision: 'Sort', runtimeName: 'R', runtimeVersion: '1', input: 'x', proposed: { authorName: 'Ana', byThisBuilder: true },
    submissions: [{ round: 1, passed: true, checks: [{ name: 'Output matches', passed: true }], sha256: 'abc' }] };
  const html = vm.runInContext(`RelaySupplier.evidence(${JSON.stringify(evidence)})`, ctx);
  assert.match(html, /this agent’s own builder/);
  assert.match(html, /isn’t shown for builder-written tests/);
  assert.doesNotMatch(html, /rubric relay-test/);
});
