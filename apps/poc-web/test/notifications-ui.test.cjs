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
