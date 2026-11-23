'use strict';
// Milestone plans in the web app (engagements-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const money = (minor, currency = 'USD') => `${currency} ${(minor / 100).toFixed(2)}`;
function load(state) {
  const context = vm.createContext({ state, escape, money, deliveryDuration: m => `${m} min`, buyerPrice: o => o?.totalMinor ?? o?.amountMinor, priceSplit: () => '' });
  vm.runInContext(fs.readFileSync(require.resolve('../public/engagements-ui.js'), 'utf8'), context);
  return context;
}
const form = entries => ({ get: key => entries[key] ?? null });

test('the offer form turns filled rows into milestones and refuses half-filled or single rows', () => {
  const ctx = load({});
  const run = () => vm.runInContext('RelayEngagements.formMilestones(state.form)', ctx);
  ctx.state.form = form({ 'm-title-0': 'Mapping', 'm-price-0': '10', 'm-minutes-0': '60', 'm-criteria-0': 'All mapped\n\n Totals agree ',
    'm-title-1': 'Load', 'm-price-1': '20.5', 'm-minutes-1': '120', 'm-criteria-1': 'Loads cleanly' });
  const rows = JSON.parse(JSON.stringify(run()));
  assert.deepEqual(rows, [
    { title: 'Mapping', amountMinor: 1000, deliveryMinutes: 60, criteria: ['All mapped', 'Totals agree'] },
    { title: 'Load', amountMinor: 2050, deliveryMinutes: 120, criteria: ['Loads cleanly'] },
  ]);
  ctx.state.form = form({});
  assert.equal(run(), null, 'no rows means a single-price offer');
  ctx.state.form = form({ 'm-title-0': 'Mapping', 'm-price-0': '10', 'm-minutes-0': '60', 'm-criteria-0': 'x' });
  assert.throws(run, /at least 2 milestones/);
  ctx.state.form = form({ 'm-title-0': 'Mapping', 'm-price-0': '10', 'm-title-1': 'Load', 'm-price-1': '1', 'm-minutes-1': '1', 'm-criteria-1': 'x' });
  assert.throws(run, /milestone 1/);
});

test('buyers see each milestone’s price and checklist, escaped, and the plan page shows where it stands', () => {
  const ctx = load({ detail: {} });
  const offer = { agentName: 'Agent', currency: 'USD', totalMinor: 3000, milestones: [
    { title: 'Map <fields>', amountMinor: 1000, totalMinor: 1200, deliveryMinutes: 60, criteria: [{ id: 'c1', text: 'All <b>mapped</b>' }] },
    { title: 'Load', amountMinor: 1500, totalMinor: 1800, deliveryMinutes: 90, criteria: [{ id: 'c1', text: 'Loads' }] }] };
  const summary = vm.runInContext(`RelayEngagements.planSummary(${JSON.stringify(offer)})`, ctx);
  assert.match(summary, /Map &#60;fields&#62;/);
  assert.doesNotMatch(summary, /<b>mapped/);
  assert.match(summary, /USD 12\.00/, 'the buyer sees the all-in price per milestone');
  assert.equal(vm.runInContext('RelayEngagements.planSummary({})', ctx), '');

  const detail = { engagement: { status: 'active', agentName: 'Agent', operatorName: 'Builder', currency: 'USD',
    totals: { totalMinor: 3000, acceptedMinor: 1200, cancelledMinor: 0 },
    milestones: [{ taskId: 'a', sequence: 1, title: 'Map', status: 'accepted', totalMinor: 1200, deliveryMinutes: 60, criteria: 1 },
      { taskId: 'b', sequence: 2, title: 'Load', status: 'ready', totalMinor: 1800, deliveryMinutes: 90, criteria: 2 }] } };
  const panel = vm.runInContext(`RelayEngagements.panel(${JSON.stringify(detail)})`, ctx);
  assert.match(panel, /USD 12\.00 accepted so far/);
  assert.match(panel, /href="\/tasks\/b"[\s\S]*Start →/, 'the next milestone is the one to start');
  assert.match(panel, /End the remaining milestones/);
  detail.engagement.status = 'ended';
  assert.doesNotMatch(vm.runInContext(`RelayEngagements.panel(${JSON.stringify(detail)})`, ctx), /End the remaining/);
});

test('a milestone page waits for the previous one, and the Work list shows the plan once with its current milestone', () => {
  const ctx = load({ detail: { milestone: { engagementId: 'p', sequence: 2, of: 3, title: 'Load', engagementTitle: 'ERP migration', previousAccepted: false } } });
  const page = vm.runInContext(`RelayEngagements.agreement({ acceptanceCriteria: [{ text: 'Loads' }] }, { agentName: 'Agent', amountMinor: 1800, currency: 'USD', deliveryMinutes: 90 })`, ctx);
  assert.match(page, /Milestone 2 of 3/);
  assert.match(page, /Starts after milestone 1 is accepted/);
  assert.doesNotMatch(page, /review-start/);

  const parent = { id: 'p', engagement: { milestones: 3, endedAt: null } };
  const tasks = [parent,
    { id: 'a', status: 'accepted', milestone: { engagementId: 'p', sequence: 1, of: 3 } },
    { id: 'b', status: 'selected', milestone: { engagementId: 'p', sequence: 2, of: 3 } },
    { id: 'c', status: 'selected', milestone: { engagementId: 'p', sequence: 3, of: 3 } }];
  const call = expr => vm.runInContext(expr, Object.assign(ctx, { tasks, parent }));
  assert.equal(call('RelayEngagements.label(parent, tasks)'), 'Milestone 2 of 3 · Ready to start');
  assert.equal(call('RelayEngagements.group(parent, tasks)'), 'Needs you');
  tasks[2].status = 'cancelled'; tasks[3].status = 'cancelled'; parent.engagement.endedAt = 1;
  assert.equal(call('RelayEngagements.label(parent, tasks)'), 'Plan ended · 1 of 3 accepted');
  assert.equal(call('RelayEngagements.group(parent, tasks)'), 'Completed');
});
