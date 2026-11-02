'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createFairQueue } = require('../../scoping/src/fair-queue.cjs');
test('model queue rotates workspaces, preserves per-workspace order and releases after failure', async () => {
  const q = createFairQueue({ perWorkspace: 3 });
  let release;
  const order = [];
  const first = q.run(
    'a',
    () =>
      new Promise((r) => {
        release = r;
        order.push('a0');
      }),
  );
  await Promise.resolve();
  const jobs = [
    ['a', 'a1'],
    ['a', 'a2'],
    ['b', 'b1'],
    ['b', 'b2'],
    ['c', 'c1'],
  ].map(([workspace, label]) =>
    q
      .run(workspace, async () => {
        order.push(label);
        if (label === 'b1') throw Error('fixture failure');
      })
      .catch(() => {}),
  );
  release();
  await Promise.all([first, ...jobs]);
  assert.deepEqual(order, ['a0', 'b1', 'a1', 'c1', 'b2', 'a2']);
});
test('waiting capacity and deadlines bound queued work without invoking expired requests', async () => {
  const q = createFairQueue({ maxPending: 2, perWorkspace: 1, waitMs: 15 });
  let release,
    called = false;
  const active = q.run('a', () => new Promise((r) => (release = r)));
  await Promise.resolve();
  const expired = assert.rejects(
    q.run('b', () => {
      called = true;
    }),
    /wait expired/,
  );
  await assert.rejects(
    q.run('b', () => {}),
    /queue full/,
  );
  await expired;
  assert.equal(called, false);
  release();
  await active;
  await q.run('c', () => {
    called = true;
  });
  assert.equal(called, true);
});
