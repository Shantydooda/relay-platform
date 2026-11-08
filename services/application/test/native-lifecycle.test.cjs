'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { stopChild, eventually } = require('./native/lifecycle.cjs');

test('fixture cleanup handles graceful and already signaled exits', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
  await once(child, 'spawn');
  await stopChild(child);
  assert.equal(child.signalCode, 'SIGTERM');
  await stopChild(child);
});

test('fixture cleanup kills an unresponsive child and reports failure', async () => {
  const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)"]);
  await once(child.stdout, 'data');
  await assert.rejects(stopChild(child, { timeoutMs: 100 }), /did not stop/);
  assert.equal(child.signalCode, 'SIGKILL');
});

test('polling has a wall-clock bound even when a read never returns', async () => {
  await assert.rejects(eventually(() => new Promise(() => {}), () => true, { timeoutMs: 30 }), /within 30ms/);
  let attempts = 0;
  assert.equal(await eventually(() => ++attempts, value => value === 2, { intervalMs: 1 }), 2);
  await assert.rejects(eventually(() => { throw new Error('offline'); }, () => true, { timeoutMs: 20, intervalMs: 1 }), error => error.cause.message === 'offline');
});
