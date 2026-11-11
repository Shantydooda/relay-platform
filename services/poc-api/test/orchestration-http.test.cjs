'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../src/database.cjs');
const { openApplicationDatabase } = require('../../application/src/sqlite.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createApp } = require('../src/app.cjs');

test('account boundary exposes parent planning, handover gates, recovery and completion HTTP commands', async t => {
  const authDb = openDatabase(':memory:'), applicationDb = openApplicationDatabase(':memory:');
  const store = await createUnifiedLocalStore({ authDb, applicationDb, localExecution: true });
  const origin = 'http://127.0.0.1:4197';
  const server = createApp({ store, origin, logger: { error() {} } });
  await new Promise(resolve => server.listen(4197, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); applicationDb.close(); authDb.close(); });
  let cookie, csrf;
  async function request(path, body, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:4197', origin,
        ...(authenticated && cookie ? { cookie, 'x-csrf-token': csrf } : {}),
        ...(body ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { response, body: await response.json() };
  }
  const registered = await request('/api/auth/register', { name: 'Plan QA', email: 'plan@qa.test', password: 'Disposable local HTTP password', workspace: 'buyer' }, false);
  assert.equal(registered.response.status, 201);
  cookie = registered.response.headers.get('set-cookie').split(';')[0]; csrf = registered.body.csrf;
  const created = await request('/api/tasks', { tenantId: registered.body.memberships[0].id, title: 'Parent', brief: 'Coordinate outputs' });
  const id = created.body.taskId, step = { title: 'Step', brief: 'CSV normalization', criteria: 'Unique rows', budgetMinor: 100, dependencies: [] };
  const plan = await request(`/api/tasks/${id}/orchestrate`, { expectedVersion: 1, budgetMinor: 200, steps: [step, { ...step, dependencies: [0] }] });
  assert.equal(plan.response.status, 200);
  const [source, target] = plan.body.stepIds;
  const handover = await request(`/api/tasks/${target}/handover`, { expectedVersion: 1, sourceTaskId: source, submissionId: randomUUID(), notes: 'Unaccepted output', consent: 'share-with-step-supplier' });
  assert.equal(handover.body.error.code, 'DELIVERY_NOT_ACCEPTED');
  const recoveryBody = { expectedVersion: 2, stepId: source, expectedStepVersion: 1, reason: 'Review the handover requirements', confirm: 'reset-affected-steps' };
  assert.equal((await request(`/api/tasks/${id}/recover-plan`, recoveryBody, false)).response.status, 401);
  const recovery = await request(`/api/tasks/${id}/recover-plan`, recoveryBody);
  assert.equal(recovery.response.status, 200);
  assert.equal(Object.keys(recovery.body.replacements).length, 2);
  const completed = await request(`/api/tasks/${id}/complete-plan`, { expectedVersion: 3 });
  assert.equal(completed.body.error.code, 'PLAN_INCOMPLETE');
});
