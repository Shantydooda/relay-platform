'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function fixture() {
  const state = { payments: { configured: true }, detail: { task: { id: 'task' }, actions: { payments: {}, approvals: {} } } };
  const context = vm.createContext({ state, escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), money: n => `$${n / 100}` });
  for (const file of ['payments-ui.js', 'approvals-ui.js', 'execution-ui.js', 'recurring-ui.js']) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return { state, context, render: code => vm.runInContext(code, context) };
}
test('payment controls follow server eligibility and visibly explain blocked or missing guidance', () => {
  const f = fixture();
  const render = () => f.render('RelayPayments.task({id:"task",version:3,selectedOfferId:"offer"},null)');
  assert.match(render(), /button disabled/);
  assert.match(render(), /Refresh to check/);
  f.state.detail.actions.payments.fund = { allowed: false, code: 'APPROVAL_REQUIRED', reason: 'Request <fresh> approval.' };
  assert.match(render(), /Request &lt;fresh> approval/);
  assert.doesNotMatch(render(), /data-operation="fund"/);
  f.state.detail.actions.payments.fund = { allowed: true };
  assert.match(render(), /data-operation="fund"/);
  assert.doesNotMatch(render(), /button disabled/);
});
test('builder uses its own payment availability, not the buyer detail', () => {
  const f = fixture();
  f.context.task = { id: 'task', version: 4, actions: { payments: { payout: { allowed: false, reason: 'Refresh operator readiness.' } } } };
  f.state.detail.actions.payments.payout = { allowed: true };
  const html = f.render('RelayPayments.task(task,{status:"transferred",amountMinor:500},true,{status:"accepted"})');
  assert.match(html, /Refresh operator readiness/);
  assert.doesNotMatch(html, /data-operation="payout"/);
});
test('company requests cannot submit when server reports an expired offer', () => {
  const f = fixture();
  f.state.detail.actions.approvals.request = { allowed: false, code: 'OFFER_UNAVAILABLE', reason: 'Choose a current offer first.' };
  const html = f.render('RelayApprovals.task({id:"task",selectedOfferId:"offer"},{status:"stale"})');
  assert.match(html, /type="submit" disabled/);
  assert.match(html, /Choose a current offer first/);
});

test('execution controls and recovery explain blocked actions without optimistic fallback', () => {
  const f = fixture();
  f.state.detail.execution = {status:'failed'};
  f.state.detail.actions.execution = { retry: {allowed:false,reason:'Reconnect the runtime.'}, accept:{allowed:false,reason:'File bytes unavailable.'} };
  assert.match(f.render('RelayExecution.control({id:"task"},"accept","Accept delivery")'), /disabled/);
  assert.match(f.render('RelayRecurring.recovery({id:"task"})'), /Reconnect the runtime/);
  f.state.detail.actions.execution.retry = {allowed:true};
  assert.doesNotMatch(f.render('RelayRecurring.recovery({id:"task"})'), /disabled/);
});
