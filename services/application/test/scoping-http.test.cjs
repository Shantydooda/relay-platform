'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../../poc-api/src/database.cjs');
const { createUnifiedLocalStore } = require('../../poc-api/src/unified-store.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');

test('scoping HTTP persists a real asynchronous reply and fences cross-account, CSRF, retries and stale confirmation', async t => {
  const authDb = openDatabase(':memory:'), applicationDb = new DatabaseSync(':memory:');
  let finish;
  const provider = { propose: () => new Promise(resolve => { finish = resolve; }) };
  const store = await createUnifiedLocalStore({ authDb, applicationDb, scopingProvider: provider });
  const users = [];
  for (const name of ['Buyer', 'Other']) {
    const token = await store.register({ name, email: name + '@example.test', password: 'isolated scoping HTTP test passphrase', workspace: 'buyer' }, name);
    users.push({ token, actor: store.principal(token) });
  }
  const [buyer, other] = users;
  const reservation = require('node:net').createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = `http://127.0.0.1:${port}`, server = createApp({ store, origin });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  t.after(async () => { if (finish) finish({}); await store.waitForScoping(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); applicationDb.close(); authDb.close(); });
  const request = (path, user, body, key = randomUUID(), csrf = user.actor.csrf) => fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Cookie: `relay_local_session_${port}=${user.token}`, Origin: origin, ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': key } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const task = await store.createTask(buyer.actor, { tenantId: buyer.actor.memberships[0].id, title: 'Research', brief: 'Find 20 companies and return CSV.' }, randomUUID());
  const path = `/api/tasks/${task.taskId}/assist`, body = { expectedVersion: 1, message: 'UK SaaS only.' }, key = randomUUID();
  assert.equal((await fetch(origin + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 401);
  assert.equal((await request(path, other, body)).status, 404);
  assert.equal((await request(path, buyer, body, randomUUID(), 'wrong')).status, 403);
  assert.equal((await request(path, buyer, { ...body, role: 'assistant' })).status, 400);
  const accepted = await request(path, buyer, body, key); assert.equal(accepted.status, 202);
  const job = await accepted.json();
  assert.deepEqual(await (await request(path, buyer, body, key)).json(), job);
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  let detail = await (await request(`/api/tasks/${task.taskId}`, buyer)).json();
  assert.equal(detail.task.scoping.status, 'pending'); assert.equal(detail.messages.length, 2);
  assert.equal((await request(`/api/tasks/${task.taskId}/post`, buyer, { expectedVersion: detail.task.version })).status, 409);
  finish({ reply: 'Here is a proposed scope.', title: 'UK SaaS research', brief: 'Find 20 UK SaaS companies and return CSV.', intent: 'change', cadence: 'once', questions: [], assumptions: [], schedule: null, timezone: null, perRunBudget: null, monthlyCap: null });
  await store.waitForScoping(); finish = null;
  detail = await (await request(`/api/tasks/${task.taskId}`, buyer)).json();
  assert.equal(detail.messages.at(-1).role, 'assistant'); assert.equal(detail.task.scopeVersion, 1);
  assert.equal((await request(`/api/tasks/${task.taskId}/confirm-scope`, other, { expectedVersion: detail.task.version, proposalId: job.jobId })).status, 404);
  assert.equal((await request(`/api/tasks/${task.taskId}/confirm-scope`, buyer, { expectedVersion: detail.task.version, proposalId: job.jobId })).status, 200);
  assert.equal((await store.detail(buyer.actor, task.taskId)).task.scopeVersion, 2);
});
