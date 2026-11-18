'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readConfig, adminPool, migrateLocal } = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createApplication } = require('../../src/service.cjs');

test('native saved-agent updates serialize across connections and survive reconnect', async t => {
  const config = readConfig(), database = 'relay_saved_qa_' + Date.now(), admin = adminPool(config);
  let first, second;
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  t.after(async () => { await first?.close(); await second?.close(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); });
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = { ...config, runtime: { ...config.runtime, database }, migrator: { ...config.migrator, database } };
  await migrateLocal(qa);
  first = await openLocalPostgres(qa.runtime);
  second = await openLocalPostgres(qa.runtime);
  const actor = { user: { id: randomUUID() }, memberships: [] };
  const ids = [randomUUID(), randomUUID()];
  await first.repository.transaction('seed', async repo => {
    for (const id of ids) await repo.save('agent', { id, ownerId: randomUUID(), status: 'listed', version: 1,
      listingStatus: 'published', name: 'Research', purpose: 'Research markets', capabilities: [] });
  });
  const app = connection => createApplication({ repository: connection.repository });
  const results = await Promise.allSettled([first, second].map((connection, i) =>
    app(connection).marketplace.saveAgent(actor, ids[i], { saved: true, expectedVersion: 0 }, randomUUID())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  const winner = results.find(result => result.status === 'fulfilled').value.agentId;
  await second.close();
  second = await openLocalPostgres(qa.runtime);
  const restored = await app(second).marketplace.discover(actor, { savedOnly: true });
  assert.equal(restored.total, 1);
  assert.equal(restored.agents[0].id, winner);
  assert.equal(restored.agents[0].savedVersion, 1);
  await app(second).marketplace.saveAgent(actor, winner, { saved: false, expectedVersion: 1 }, randomUUID());
  assert.equal((await app(first).marketplace.discover(actor, { savedOnly: true })).total, 0);
});
