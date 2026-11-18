'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const CRITERIA = [{ id: 'c1', text: 'Duplicates <removed>' }, { id: 'c2', text: 'Sorted by email' }];

function fixture(detail = {}) {
  const state = { detail: { task: { id: 'task', version: 5, status: 'posted', acceptanceCriteria: CRITERIA }, actions: { execution: {} }, submissions: [], ...detail } };
  const calls = [];
  const context = vm.createContext({
    state, calls, notice: {},
    escape: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    command: async (...args) => { calls.push(args); return {}; }, refresh: async () => {}, render: () => {},
  });
  for (const file of ['execution-ui.js', 'acceptance-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return { state, calls, context, run: code => vm.runInContext(code, context) };
}

test('the checklist is editable before work starts and read-only once it is authorized', () => {
  const f = fixture();
  let html = f.run('RelayAcceptance.scope(state.detail.task)');
  assert.match(html, /Acceptance checklist · 2 items/);
  assert.match(html, /id="acceptance-criteria"/);
  assert.match(html, /Duplicates &lt;removed>/, 'criteria text is escaped');
  assert.match(html, /current offers will need updating/);
  f.state.detail.task.status = 'draft';
  assert.doesNotMatch(f.run('RelayAcceptance.scope(state.detail.task)'), /offers will need updating/);
  f.state.detail.task.acceptanceCriteria = [];
  assert.match(f.run('RelayAcceptance.scope(state.detail.task)'), /Add an acceptance checklist · optional/);

  f.state.detail.task.acceptanceCriteria = CRITERIA;
  f.state.detail.execution = { status: 'running' };
  html = f.run('RelayAcceptance.scope(state.detail.task)');
  assert.doesNotMatch(html, /<form/);
  assert.match(html, /Done when/);
  f.state.detail.execution = null;
  f.state.detail.payment = { status: 'funded' };
  assert.doesNotMatch(f.run('RelayAcceptance.scope(state.detail.task)'), /<form/, 'a funded task keeps its checklist');
  assert.equal(f.run('RelayAcceptance.scope({id:"x",status:"posted",acceptanceCriteria:[],orchestrationStep:{}})'), '');
});

test('pasted lists are cleaned into one criterion per line', () => {
  const f = fixture();
  assert.deepEqual([...f.run('RelayAcceptance.parse("- Rows deduplicated\\n\\n2) Sorted by email\\n • Report attached  ")')],
    ['Rows deduplicated', 'Sorted by email', 'Report attached']);
});

test('saving sends a PUT with the task version, and over-long lists are refused before sending', async () => {
  const f = fixture();
  await f.run('RelayAcceptance.save({}, "One check\\nTwo check")');
  assert.equal(JSON.stringify(f.calls[0]), JSON.stringify(['/api/tasks/task/acceptance-criteria', 'PUT', { expectedVersion: 5, criteria: ['One check', 'Two check'] }]));
  await assert.rejects(f.run(`RelayAcceptance.save({}, ${JSON.stringify(Array.from({ length: 13 }, (_, i) => `Check ${i}`).join('\n'))})`), /12 items/);
  assert.equal(f.calls.length, 1);
});

test('the revision form names unmet checks and counts down to the exit', () => {
  const f = fixture({ acceptance: { criteria: CRITERIA, revisionRounds: 0, endAfterRounds: 2, unmetCriteria: [] } });
  let html = f.run('RelayAcceptance.revisionFields()');
  assert.match(html, /name="unmet" value="c1"/);
  assert.match(html, /After 2 rounds of changes/);
  f.state.detail.acceptance.revisionRounds = 1;
  assert.match(f.run('RelayAcceptance.revisionFields()'), /After this round/);
  f.state.detail.acceptance.revisionRounds = 2;
  html = f.run('RelayAcceptance.revisionFields()');
  assert.doesNotMatch(html, /After/);
});

test('"End as unmet" appears only when the server allows it and pre-ticks the last unmet checks', async () => {
  const f = fixture({ acceptance: { criteria: CRITERIA, revisionRounds: 2, endAfterRounds: 2, unmetCriteria: [] },
    submissions: [{ status: 'revision_requested', unmetCriteria: ['c1'] }, { status: 'revision_requested', unmetCriteria: ['c2'] }] });
  f.state.detail.actions.execution.end = { allowed: false, reason: 'Not yet.' };
  assert.equal(f.run('RelayAcceptance.end(state.detail.task)'), '');
  f.state.detail.actions.execution.end = { allowed: true };
  const html = f.run('RelayAcceptance.end(state.detail.task)');
  assert.match(html, /id="end-unmet"/);
  assert.match(html, /value="c2" checked/);
  assert.doesNotMatch(html, /value="c1" checked/);
  assert.doesNotMatch(html, /disabled/);

  f.context.data = { get: () => 'Still has duplicates', getAll: () => ['c2'] };
  await f.run('RelayAcceptance.endUnmet({}, data)');
  assert.equal(JSON.stringify(f.calls[0]), JSON.stringify(['/api/tasks/task/end-unmet', 'POST', { expectedVersion: 5, reason: 'Still has duplicates', unmetCriteria: ['c2'] }]));
});

test('an ended run explains itself to the buyer and marks what was not met', () => {
  const f = fixture({ acceptance: { criteria: CRITERIA, revisionRounds: 2, endAfterRounds: 2, unmetCriteria: ['c1'] } });
  assert.equal(f.run('RelayAcceptance.ended({error:"AGENT_ERROR"})'), '');
  const html = f.run('RelayAcceptance.ended({error:"BUYER_ENDED_UNMET"})');
  assert.match(html, /You ended this work/);
  assert.match(html, /class="unmet">Duplicates &lt;removed> <span class="tag">Not met/);
});
