'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../../../packages/ui/src/components.cjs');
function fixture() {
  const state = {
    features: { notifications: true },
    account: { user: { id: 'me' } },
    notifications: {
      unread: 1,
      items: [
        {
          id: 'a',
          title: 'Permission requested',
          taskTitle: '<img src=x onerror=bad>',
          side: 'buyer',
          createdAt: 1,
          read: false,
        },
      ],
    },
  };
  const ctx = vm.createContext({ state, escape: text, date: () => 'Today' });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, '../public/notifications-ui.js'),
      'utf8',
    ),
    ctx,
  );
  return { state, ui: vm.runInContext('RelayNotifications', ctx) };
}
test('bell exposes unread status and safely renders task titles', () => {
  const { ui } = fixture();
  const html = ui.view();
  assert.match(html, /Notifications, 1 unread/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /Mark all read/);
});
test('empty inbox and signed-out states do not expose old notifications', () => {
  const { ui, state } = fixture();
  state.notifications = { items: [], unread: 0 };
  assert.match(ui.view(), /You’re all caught up/);
  assert.match(ui.view(), /notification-read-all" disabled/);
  state.account = null;
  assert.equal(ui.view(), '');
});
test('a decision on your Relay test opens Build → Relay tests', async () => {
  const item = { id: 'd'.repeat(64), title: 'Your Relay test was rejected', taskTitle: 'Vendor suffixes', taskId: null, side: 'builder', destination: 'relay-test', createdAt: 1, read: false };
  const state = { features: { notifications: true }, account: { user: { id: 'me', workspace: 'builder' } }, notifications: { unread: 1, items: [item] } };
  const calls = [];
  const ctx = vm.createContext({ state, escape: text, date: () => 'Today', Date,
    api: async path => { calls.push(path); return path === '/api/notifications' ? { unread: 0, items: [{ ...item, read: true }] } : {}; },
    refresh: async () => {}, render: () => {}, root: { querySelectorAll: () => [], querySelector: () => null },
    history: { pushState: (_a, _b, url) => calls.push(`push ${url}`) }, location: { hash: '' } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/notifications-ui.js'), 'utf8'), ctx);
  await vm.runInContext('RelayNotifications', ctx).click({ dataset: { action: 'notification-open', id: item.id } });
  assert.equal(state.builderTab, 'tests');
  assert.ok(calls.includes('push /build/tests'), calls.join(', '));
  assert.match(vm.runInContext('RelayNotifications', ctx).view(), /Your Relay test was rejected[\s\S]*Vendor suffixes/);
});
