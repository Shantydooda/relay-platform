'use strict';
// A posted request is a commission with offers, not a chat: the request page
// (apps/poc-web/public/request-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function page(state, extra = {}) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`), ...extra });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js', 'request-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayRequestPage', context);
}
const ORG = 'c0000000-0000-4000-8000-000000000001';
const account = { user: { id: 'u1', name: 'Arun Mehta' }, memberships: [{ id: 'p1', role: 'owner' }, { id: ORG, name: 'Northwind ERP', role: 'employee', company: true }] };
const task = (over = {}) => ({ id: 't1', tenantId: ORG, projectId: 'pr1', title: 'Deduplicate vendor master export', brief: 'Remove duplicate vendors; keep the newest record.', status: 'posted', scopeVersion: 1, createdAt: Date.now(), acceptanceCriteria: [{ id: 'c1', text: 'No duplicate vendor IDs' }], ...over });
const detail = (over = {}) => ({ task: task(over.task), mine: true, postedBy: 'Arun Mehta', project: { id: 'pr1', name: 'NetSuite migration – Wave 2', status: 'active' },
  messages: [{ id: 'm0', body: 'Remove duplicate vendors; keep the newest record.', authorName: 'Arun Mehta' }], events: [{ type: 'task.created', createdAt: Date.now() }, { type: 'task.posted', createdAt: Date.now() }],
  execution: null, approval: null, ...over, ...(over.task ? { task: task(over.task) } : {}) });

test('only posted requests and packages use the request page', () => {
  const r = page({ account });
  assert.equal(r.applies(detail()), true);
  assert.equal(r.applies(detail({ task: { status: 'draft' } })), false);
  assert.equal(r.applies(detail({ task: { orchestrationPlan: { steps: [] } } })), false);
  assert.equal(r.applies(detail({ task: { scheduleId: 's1' } })), false);
});

test('a posted request reads as a commission: request, offers, no chat before hiring', () => {
  const html = page({ account, detail: detail(), offers: [] }).view();
  assert.match(html, /northwind-erp<\/a> <span aria-hidden="true">\/<\/span> <a href="\/org\/c0000000-0000-4000-8000-000000000001\/projects\/pr1"/, 'breadcrumb to the organization and project');
  assert.match(html, /<h1 class="mk-request-title">Deduplicate vendor master export/);
  assert.match(html, /posted by Arun Mehta/);
  assert.match(html, /No offers yet/);
  assert.match(html, /Waiting for offers/);
  assert.match(html, /Messages open once you choose an agent/);
  assert.doesNotMatch(html, /Relay<\/span>|I’ll show|Message the agent/, 'no assistant voice or premature message box');
  assert.match(html, /data-action="edit"/);
  assert.match(html, /data-action="cancel"/);
});

test('project members see the request read-only', () => {
  const html = page({ account, detail: detail({ mine: false, postedBy: 'Lena Ortiz' }), offers: [] }).view();
  assert.match(html, /you’re in the project. Only the person who posted it can change it/);
  assert.doesNotMatch(html, /data-action="cancel"/);
  assert.doesNotMatch(html, /data-action="edit"/, 'only the poster edits the request');
});

test('after hiring, the message thread opens and offers become the agreed offer', () => {
  const composer = () => '<form id="message"></form>';
  const html = page({ account, detail: detail({ execution: { status: 'running' }, task: { status: 'running' }, messages: [{ id: 'm0', body: 'x' }, { id: 'm1', body: 'Starting now', role: 'supplier', authorName: 'CSV Cleaner', createdAt: Date.now() }] }), offers: [{ id: 'o1', selected: true }] },
    { composer, offerCards: () => '<div class="offer">agreed</div>' }).view();
  assert.match(html, /<form id="message">/);
  assert.match(html, /Agreed offer/);
  assert.match(html, /<strong>CSV Cleaner<\/strong>/);
  assert.doesNotMatch(html, /data-action="cancel"/, 'work under way can’t be closed from here');
});

test('the activity tab lists events in plain words, newest first', () => {
  const html = page({ account, detail: detail(), offers: [], requestTab: 'activity' }).view();
  assert.ok(html.indexOf('Posted to agents') < html.indexOf('Request created'));
});
