'use strict';
// Your work, Activity and How evidence works use the marketplace layout: a filter
// rail and dense rows, the same pattern as the Agents page.
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

test('Your work is a filter rail and dense rows, grouped by the shared work states', () => {
  const m = ui({ tasks, account: { user: { name: 'B' } } });
  const html = m.work();
  assert.match(html, /class="mk-browse"/);
  assert.match(html, /<aside class="mk-rail"/);
  assert.match(html, /Your work <span class="mk-total">3<\/span>/, 'drafts are not listed');
  assert.match(html, /Needs you[^<]*<\/button>|data-value="Needs you"/);
  assert.match(html, /test-builder\/csv-cleaner/, 'the agent handle as on the Agents page');
  assert.match(html, /Package/);
  assert.match(html, /\$25\.00/);
  assert.match(html, /2 offers/);
  assert.match(html, /Ready to start/, 'status words come from RelayWorkState');
  assert.match(html, /href="\/tasks\/a0000000-0000-4000-8000-000000000001" data-route/);
  assert.match(html, /href="\/post" data-route/);
  assert.doesNotMatch(html, /My tasks|Start a conversation/);
  const f = m.workFilters();
  f.status = ['Under way'];
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Dedupe contacts']);
  f.status = []; f.ways = ['package'];
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Clean one CSV export']);
  f.ways = []; f.q = 'customer';
  assert.deepEqual(m.visibleWork().map(t => t.title), ['Clean a customer CSV']);
  assert.match(ui({ tasks: [], account: { user: { name: 'B' } } }).work(), /No work yet/);
});

test('Activity is grouped by day with who-filters, linking to real task pages', () => {
  const items = [
    { id: 'e1', actor: 'agent', label: 'Delivery submitted', taskId: tasks[0].id, taskTitle: 'Clean one CSV export', createdAt: now },
    { id: 'e2', actor: 'you', label: 'Package hired', taskId: tasks[0].id, taskTitle: 'Clean one CSV export', createdAt: now - 1000 },
    { id: 'e3', actor: 'you', label: 'Request posted', taskId: tasks[1].id, taskTitle: 'Clean a customer CSV', createdAt: now - 3 * 86400000 },
  ];
  const m = ui({ activity: { items } });
  const html = m.activity();
  assert.match(html, /<aside class="mk-rail"/);
  assert.match(html, /Activity <span class="mk-total">3<\/span>/);
  assert.match(html, />Today</);
  assert.match(html, /href="\/tasks\/a0000000-0000-4000-8000-000000000001" data-route/);
  assert.doesNotMatch(html, /href="#task=/, 'no old hash links');
  m.activityFilters().who = ['agent'];
  assert.deepEqual(m.visibleActivity().map(i => i.id), ['e1']);
  assert.match(ui({ activity: { items: [] } }).activity(), /No activity yet/);
});

test('How evidence works has a section rail and states the Relay test rule the backend enforces', () => {
  const html = ui({}).evidencePage();
  assert.match(html, /<aside class="mk-rail"/);
  for (const id of ['what-counts', 'percentages', 'relay-test', 'not-evidence']) assert.match(html, new RegExp(`href="#${id}"`), id);
  assert.match(html, /listed|appear in browse/i);
  assert.match(html, /packages?/i);
  assert.match(html, /can still quote/i, 'quoting without a test is allowed and labelled');
  assert.doesNotMatch(html, /Before an agent can quote/);
});

test('repeated system updates on one task collapse into one row with a count', () => {
  const t = tasks[0].id;
  const items = [1, 2, 3].map(i => ({ id: `s${i}`, actor: 'relay', label: 'Safety scan finished', taskId: t, taskTitle: 'Clean one CSV export', createdAt: now - i * 1000 }))
    .concat([{ id: 'd', actor: 'agent', label: 'Delivery received', taskId: t, taskTitle: 'Clean one CSV export', createdAt: now - 9000 }]);
  const html = ui({ activity: { items } }).activity();
  assert.equal((html.match(/Safety scan finished/g) || []).length, 1);
  assert.match(html, /×3/);
  assert.match(html, /Delivery received/);
});

test('on phones every rail folds behind a Filters button', () => {
  for (const [render, extra] of [['work', { tasks }], ['activity', { activity: { items: [] } }], ['browse', { market: { agents: [], sort: 'runs', windowDays: 90, connectors: [] } }]]) {
    const closed = ui(extra)[render]();
    assert.match(closed, /data-action="page-rail-toggle"[^>]*aria-expanded="false"/, render);
    assert.match(closed, /class="mk-rail"/, render);
    assert.match(ui({ ...extra, railOpen: true })[render](), /class="mk-rail mk-rail-open"/, render);
  }
});
