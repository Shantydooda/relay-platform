'use strict';
// Your work, Activity and Docs follow Hugging Face's information architecture
// (community list, profile activity timeline, docs) with Relay's own content.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state = {}) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return vm.runInContext('RelayMarketplace', context);
}
const now = Date.now();
const work = (reason, phase, waitingOn) => ({ reason, phase, waitingOn });
const tasks = [
  { id: 'a0000000-0000-4000-8000-000000000001', title: 'Clean one CSV export', status: 'selected', updatedAt: now, work: work('READY_TO_START', 'starting', 'buyer'),
    package: { packageId: 'p1' }, chosenOffer: { agentName: 'CSV Cleaner', operatorName: 'Test Builder', amountMinor: 2500, currency: 'USD', packageId: 'p1' }, offerCount: 1 },
  { id: 'a0000000-0000-4000-8000-000000000002', title: 'Clean a customer CSV', status: 'posted', updatedAt: now - 3 * 86400000, work: work('OFFERS_READY', 'finding_agent', 'buyer'),
    package: null, chosenOffer: null, offerCount: 2 },
  { id: 'a0000000-0000-4000-8000-000000000003', title: 'Dedupe contacts', status: 'running', updatedAt: now, work: work('WORKING', 'working', 'agent'),
    package: null, chosenOffer: { agentName: 'Dedupe', operatorName: 'Ledgerline', amountMinor: 900, currency: 'USD', packageId: null }, offerCount: 3 },
  { id: 'a0000000-0000-4000-8000-000000000004', title: 'Old draft', status: 'draft', updatedAt: now, work: work('BRIEF_DRAFT', 'drafting', 'buyer'), package: null, chosenOffer: null, offerCount: 0 },
];

test('Your work follows the community-list pattern: side actions, type tabs, completed hidden, needs-you first', () => {
  const done = { id: 'a0000000-0000-4000-8000-000000000005', title: 'Accepted export', status: 'accepted', updatedAt: now + 5, work: work('ACCEPTED', 'done', 'none'), package: null, chosenOffer: null, offerCount: 1 };
  const m = ui({ tasks: [...tasks, done], account: { user: { name: 'B' } } });
  const html = m.work();
  assert.match(html, /class="mk-cols"/);
  assert.match(html, /<aside class="mk-side"/);
  assert.match(html, /href="\/post" data-route/, 'Post a request is the primary side action');
  assert.match(html, /href="\/docs\/revisions" data-route/, 'resources link to the docs');
  assert.match(html, /Your work <span class="mk-total">3<\/span>/, 'drafts and completed work are not listed by default');
  assert.match(html, /data-action="page-set"[^>]*data-value="package"/);
  assert.match(html, /Show completed \(1\)/);
  assert.match(html, /test-builder\/csv-cleaner/, 'the agent handle as on the Agents page');
  assert.match(html, /\$25\.00/);
  assert.match(html, /2 offers/);
  assert.match(html, /Ready to start/, 'status words come from RelayWorkState');
  assert.match(html, /href="\/tasks\/a0000000-0000-4000-8000-000000000001" data-route/);
  assert.doesNotMatch(html, /My tasks|Start a conversation/);
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Clean one CSV export', 'Clean a customer CSV', 'Dedupe contacts'], 'needs you first, then most recent');
  const f = m.workFilters();
  f.type = 'package';
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Clean one CSV export']);
  f.type = 'all'; f.q = 'customer';
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Clean a customer CSV']);
  f.q = ''; f.completed = true;
  assert.ok(m.visibleWork().some(t => t.title === 'Accepted export'));
  f.completed = false; f.sort = 'updated';
  assert.equal(m.visibleWork()[0].title, 'Clean one CSV export');
  assert.match(ui({ tasks: [], account: { user: { name: 'B' } } }).work(), /No work yet/);
});

test('Activity is a day-grouped timeline with who-tabs, linking to real task pages', () => {
  const items = [
    { id: 'e1', actor: 'agent', label: 'Delivery submitted', taskId: tasks[0].id, taskTitle: 'Clean one CSV export', createdAt: now },
    { id: 'e2', actor: 'you', label: 'Package hired', taskId: tasks[0].id, taskTitle: 'Clean one CSV export', createdAt: now - 1000 },
    { id: 'e3', actor: 'you', label: 'Request posted', taskId: tasks[1].id, taskTitle: 'Clean a customer CSV', createdAt: now - 3 * 86400000 },
  ];
  const m = ui({ activity: { items } });
  const html = m.activity();
  assert.match(html, /<ol class="mk-timeline"/);
  assert.match(html, /Activity <span class="mk-total">3<\/span>/);
  assert.match(html, />Today</);
  assert.match(html, /data-action="page-set"[^>]*data-group="who"[^>]*data-value="agent"/);
  assert.match(html, /href="\/tasks\/a0000000-0000-4000-8000-000000000001" data-route/);
  assert.doesNotMatch(html, /href="#task=/, 'no old hash links');
  m.activityFilters().who = 'agent';
  assert.deepEqual(m.visibleActivity().map(i => i.id), ['e1']);
  assert.match(ui({ activity: { items: [] } }).activity(), /No activity yet/);
});

test('Docs use a guide nav, prose and an on-this-page list, and state only enforced rules', () => {
  const m = ui({});
  assert.deepEqual({ ...m.parse('/docs/revisions') }, { page: 'docs', id: 'revisions' });
  assert.deepEqual({ ...m.parse('/evidence') }, { page: 'docs', id: 'evidence' }, 'the old link still opens');
  assert.deepEqual({ ...m.parse('/docs/nope') }, { page: null, id: null });
  const s = {}; m.apply({ page: 'docs', id: 'packages' }, s);
  assert.equal(m.path(s), '/docs/packages');
  const html = m.docsPage('evidence');
  assert.match(html, /<nav class="mk-docs-nav"/);
  assert.match(html, /<nav class="mk-docs-toc"/);
  for (const slug of ['evidence', 'relay-tests', 'packages', 'revisions']) assert.match(html, new RegExp(`href="/docs/${slug}" data-route`), slug);
  for (const id of ['what-counts', 'percentages', 'not-evidence']) assert.match(html, new RegExp(`href="#${id}"`), id);
  const tests = m.docsPage('relay-tests');
  assert.match(tests, /appear in browse/i);
  assert.match(tests, /can still quote/i, 'quoting without a test is allowed and labelled');
  assert.doesNotMatch(tests, /Before an agent can quote/);
  const revisions = m.docsPage('revisions');
  assert.match(revisions, /after 2 rounds/i);
  assert.match(revisions, /10 rounds/);
  assert.match(revisions, /isn’t on yet/, 'auto-accept is off until payments are live');
  assert.match(m.docsPage('packages'), /30 days/);
});

test('repeated system updates on one task collapse into one row with a count', () => {
  const t = tasks[0].id;
  const items = [1, 2, 3].map(i => ({ id: `s${i}`, actor: 'relay', label: 'Safety scan finished', taskId: t, taskTitle: 'Clean one CSV export', createdAt: now - i * 1000 }))
    .concat([{ id: 'd', actor: 'agent', label: 'Delivery received', taskId: t, taskTitle: 'Clean one CSV export', createdAt: now - 9000 }]);
  const html = ui({ activity: { items } }).activity();
  assert.equal((html.match(/Safety scan finished/g) || []).length, 1);
  assert.match(html, /×3/);
  assert.match(html, /Delivery received/);
  const named = ui({ activity: { items: [{ id: 'n', actor: 'agent', label: 'Agent started work', taskId: t, taskTitle: 'x', createdAt: now }] } }).activity();
  assert.doesNotMatch(named, /Agent<\/span> <span>Agent started/, 'the actor is not named twice');
  assert.match(named, /<span>started work<\/span>/);
});

test('on phones the browse rail folds behind a Filters button', () => {
  const extra = { market: { agents: [], sort: 'runs', windowDays: 90, connectors: [] } };
  assert.match(ui(extra).browse(), /data-action="page-rail-toggle"[^>]*aria-expanded="false"/);
  assert.match(ui({ ...extra, railOpen: true }).browse(), /class="mk-rail mk-rail-open"/);
});
