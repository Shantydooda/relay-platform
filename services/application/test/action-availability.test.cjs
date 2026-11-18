'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
const { availability } = require('../src/action-availability.cjs');

test('availability propagates unexpected failures instead of disguising a broken read', async () => {
  const failure = new Error('database unavailable');
  await assert.rejects(availability(() => { throw failure; }), error => error === failure);
});
for (const adapter of ['sqlite', 'postgres']) test(`${adapter}: availability is read-only guidance and stale readiness is rechecked on execution`, async t => {
  const f = await fixture(t, adapter);
  const before = await f.get(), calls = structuredClone(f.calls);
  const detail = await f.app.detail(f.buyer, f.taskId);
  assert.equal(detail.actions.version, before.version);
  assert.equal(detail.actions.payments.fund.allowed, true);
  assert.deepEqual(await f.get(), before);
  assert.deepEqual(f.calls, calls);
  f.advance(300001);
  const refreshed = await f.app.detail(f.buyer, f.taskId);
  assert.equal(refreshed.actions.payments.fund.code, 'OPERATOR_NOT_READY');
  await assert.rejects(f.app.sandboxPayment(f.buyer, f.taskId, 'fund', { expectedVersion: detail.actions.version }, randomUUID()), { code: 'OPERATOR_NOT_READY' });
  assert.deepEqual(f.calls, calls);
  const disconnected = createApplication({ ...f.options, paymentProvider: undefined });
  assert.equal((await disconnected.detail(f.buyer, f.taskId)).actions.payments.fund.code, 'SANDBOX_NOT_CONNECTED');
  await assert.rejects(f.app.detail(f.stranger, f.taskId), { code: 'NOT_FOUND' });
});
