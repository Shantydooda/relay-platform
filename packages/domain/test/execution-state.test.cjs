'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { waitingForPermission } = require('../src/execution-state.cjs');

test('permission waiting is a live execution substate, not a terminal or historical label', () => {
  assert.equal(waitingForPermission(null), false);
  for (const status of ['queued', 'running']) {
    assert.equal(waitingForPermission({ status }), false);
    assert.equal(waitingForPermission({ status, permissionWait: { startedAt: 1 } }), true);
  }
  for (const status of ['failed', 'cancelled', 'accepted', 'buyer_review', 'blocked', 'unknown']) {
    assert.equal(waitingForPermission({ status, permissionWait: { startedAt: 1 } }), false);
  }
});
