'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readConfig, adminPool, migrateLocal } = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createApplication } = require('../../src/service.cjs');

test('native repeat-hire duplicate requests create one fresh draft across connections and reconnect', async t => {
  const config = readConfig(), database = 'relay_repeat_qa_' + Date.now(), admin = adminPool(config);
  let first, second;
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  t.after(async () => { await first?.close(); await second?.close(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); });
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = { ...config, runtime: { ...config.runtime, database }, migrator: { ...config.migrator, database } };
  await migrateLocal(qa); first = await openLocalPostgres(qa.runtime); second = await openLocalPostgres(qa.runtime);
  const actor = { user: { id: randomUUID() }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  const app = connection => createApplication({ repository: connection.repository });
  const agentId = randomUUID(), original = await app(first).createTask(actor, { tenantId: actor.memberships[0].id, title: 'Previous', brief: 'Old work' }, randomUUID());
  await first.repository.transaction('fixture', async repo => {
    await repo.save('agent', { id: agentId, ownerId: randomUUID(), status: 'listed', version: 1, listingStatus: 'published',
      credentialExpiresAt: Date.now()+100000, name: 'Research', purpose: 'Reports', capabilities: [{ id: 'cap', assessmentId: 'test' }],
      assessments: [{ id: 'test', status: 'passed', expiresAt: Date.now()+100000 }] });
    const source = await repo.get('task', original.taskId); source.status = 'posted'; source.assignment = { status: 'accepted', agentId };
    await repo.save('task', source);
  });
  const body = { tenantId: actor.memberships[0].id, title: 'New', brief: 'New work', repeatFromTaskId: original.taskId,
    expectedSourceVersion: 1, preferredAgentId: agentId, preferenceMode: 'agent', discoverySource: 'repeat-hire' };
  const key = randomUUID();
  const results = await Promise.all([first, second].map(connection => app(connection).createTask(actor, body, key)));
  assert.deepEqual(results[0], results[1]);
  await second.close(); second = await openLocalPostgres(qa.runtime);
  const tasks = await app(second).list(actor, actor.memberships[0].id);
  assert.equal(tasks.length, 2);
  const fresh = await app(second).detail(actor, results[0].taskId);
  assert.equal(fresh.task.status, 'draft'); assert.equal(fresh.execution, null); assert.equal(fresh.task.input, null);
  assert.deepEqual(await app(second).createTask(actor, body, key), results[0]);
});
