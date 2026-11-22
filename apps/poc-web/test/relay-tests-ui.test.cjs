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
const mine = { ...approved, id: 't2', status: 'rejected', reason: 'Expected output is wrong.', brief: 'Fix suffixes', cases: [{ input: 'acme {{nonce}}', expected: 'SECRET-ANSWER', revision: 'Sort', revisionExpected: 'SECRET-2' }], comparison: 'lines', version: 2 };
const seed = { id: 's1', rubric: 'relay-test:s1', title: 'Company list deduplication', categoryId: 'data-cleanup', category: 'Data cleanup & deduplication', limitation: 'Name-level only.', authorName: 'Relay', builtIn: true, caseCount: 2, status: 'approved' };

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

test('evidence says how quickly the agent answered each round', () => {
  const ctx = load({}, ['supplier-ui.js']);
  const t0 = Date.parse('2026-11-20T10:00:00Z');
  const evidence = { rubric: 'csv-normalize-v1', limitation: 'x', runtimeName: 'R', runtimeVersion: '1', input: 'x', createdAt: t0,
    submissions: [{ round: 1, passed: true, checks: [], createdAt: t0 + 4000 }, { round: 2, passed: true, checks: [], createdAt: t0 + 4000 + 125000 }] };
  const html = vm.runInContext(`RelaySupplier.evidence(${JSON.stringify(evidence)})`, ctx);
  assert.match(html, /Answered 4 s after the test was sent; the change 2 min 5 s after it was requested\./);
  const pending = { ...evidence, submissions: [] };
  assert.doesNotMatch(vm.runInContext(`RelaySupplier.evidence(${JSON.stringify(pending)})`, ctx), /Answered/);
});

test('Relay’s own tests are listed apart from builders’ tests, with their case counts', () => {
  const ctx = load({ relayTests: { approved: [seed, approved], mine: [], canReview: false, comparisons: {} }, taxonomy: [] }, ['build-ui.js', 'relay-tests-ui.js']);
  const html = vm.runInContext('RelayTests.page()', ctx);
  const [relayPart, builderPart] = html.split('Tests other builders wrote');
  assert.match(relayPart, /Relay’s tests[\s\S]*Company list deduplication[\s\S]*2 cases/);
  assert.doesNotMatch(relayPart, /Vendor/);
  assert.match(builderPart, /Vendor &#60;names&#62;[\s\S]*1 case</);
});

test('the proposal form has five cases, the first required; filled cases are sent in order', () => {
  const ctx = load({ relayTests: { approved: [], mine: [mine], canReview: false, comparisons: { lines: 'Same lines' }, maxCases: 5 }, taxonomy: [] }, ['build-ui.js', 'relay-tests-ui.js']);
  const html = vm.runInContext('RelayTests.form()', ctx);
  assert.match(html, /<legend>Case 1<\/legend>[\s\S]*name="input-0"[^>]*required/);
  for (const i of [1, 2, 3, 4]) assert.match(html, new RegExp(`Case ${i + 1} <span class="mk-optional">optional[\\s\\S]*name="input-${i}"(?![^>]*required)`));
  assert.match(html, /every case right/);
  const values = { title: 'T', categoryId: 'data-cleanup', brief: 'B', limitation: 'L', comparison: 'lines',
    'input-0': 'a {{nonce}}', 'expected-0': 'A {{nonce}}', 'revision-0': 'Sort it', 'revisionExpected-0': 'Z {{nonce}}', 'input-2': 'b {{nonce}}', 'expected-2': 'B', 'revision-2': '', 'revisionExpected-2': '' };
  ctx.values = values;
  const body = JSON.parse(JSON.stringify(vm.runInContext('RelayTests.body({ get: k => values[k] ?? null })', ctx)));
  assert.equal(body.cases.length, 2, 'empty optional cases are left out');
  assert.deepEqual(body.cases[1], { input: 'b {{nonce}}', expected: 'B', revision: '', revisionExpected: '' });
  assert.ok(!('input' in body), 'answers go in cases');
  // Editing a past proposal as a new one refills each case.
  ctx.state.relayTestDraft = 't2';
  assert.match(vm.runInContext('RelayTests.form()', ctx), /name="expected-0"[^>]*>SECRET-ANSWER</);
});

test('staff read Relay’s own tests in the approved list but can’t retire them', () => {
  const ctx = load({ relayTests: { approved: [], mine: [], canReview: true, comparisons: {} }, relayTestQueue: { waiting: [], approved: [{ ...seed, cases: mine.cases, brief: 'B' }, { ...mine, status: 'approved', id: 't9' }] }, taxonomy: [] }, ['build-ui.js', 'relay-tests-ui.js']);
  const html = vm.runInContext('RelayTests.queue()', ctx);
  assert.match(html, /ships with Relay/);
  assert.equal((html.match(/value="retire"/g) || []).length, 1, 'only the builder’s test can be retired');
});

test('evidence for a test with several cases shows each input, never the answers', () => {
  const ctx = load({}, ['supplier-ui.js']);
  const evidence = { rubric: 'relay-test:s1', title: 'Company list deduplication', limitation: 'Name-level only.', revision: 'Sort', runtimeName: 'R', runtimeVersion: '1', input: 'one', private: true, proposed: null,
    cases: [{ input: 'one', revision: 'Sort' }, { input: 'two', revision: 'Reverse' }],
    submissions: [{ round: 1, passed: true, checks: [{ name: 'Case 1: output matches the expected result', passed: true }, { name: 'Case 2: output matches the expected result', passed: true }] }] };
  const html = vm.runInContext(`RelaySupplier.evidence(${JSON.stringify(evidence)})`, ctx);
  assert.match(html, /2 cases, all must pass/);
  assert.match(html, /Case 1 input[\s\S]*one[\s\S]*Case 2 input[\s\S]*two/);
  assert.match(html, /isn’t shown for this test/);
  assert.doesNotMatch(html, /rubric relay-test|Written by/, 'Relay wrote it; no rubric id');
});
