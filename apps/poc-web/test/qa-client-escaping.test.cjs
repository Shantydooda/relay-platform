'use strict';
// QA (adversarial review, 25 Nov 2026): text from other users reaches HTML only escaped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../../../packages/ui/src/components.cjs');
const load = (file, state, extra = {}) => {
  const ctx = vm.createContext({ state, escape: text, date: () => 'Today', money: v => String(v), ...extra });
  const name = { 'notifications-ui.js': 'RelayNotifications' }[file];
  vm.runInContext(`${fs.readFileSync(path.join(__dirname, '../public', file), 'utf8')};globalThis.M=${name};`, ctx);
  return ctx.M;
};
const PAYLOAD = '"><img src=x onerror=alert(1)>';

test('notification titles are escaped in the visible text and in the “Mark … as read” aria-label', () => {
  const html = load('notifications-ui.js', { features: { notifications: true }, account: { user: { id: 'u' } },
    notifications: { unread: 1, items: [{ id: PAYLOAD, title: PAYLOAD, taskTitle: PAYLOAD, side: 'builder', createdAt: 0, read: false }] } }).view();
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /aria-label="Mark &quot;&gt;&lt;img src=x onerror=alert\(1\)&gt; as read"/);
});

test('a notification error message from the server is escaped', () => {
  const html = load('notifications-ui.js', { features: { notifications: true }, account: { user: { id: 'u' } }, notificationError: PAYLOAD, notifications: { unread: 0, items: [] } }).view();
  assert.doesNotMatch(html, /<img/);
});
