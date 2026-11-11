'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');

for (const postgres of [false, true]) test(`${postgres ? 'postgres' : 'sqlite'} saved agents remain private, versioned, and subject to current publication`, async t => {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = postgres ? await createPostgresRepository(db, { initialize: true }) : createSqliteRepository(db);
  const actor = { user: { id: 'buyer' }, memberships: [] };
  const app = createApplication({ repository });
  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  await repository.transaction('seed', async repo => {
    for (const id of ids) await repo.save('agent', { id, ownerId: 'builder', status: 'listed', version: 1,
      name: 'Research agent', purpose: 'Property reports', kind: 'specialist', capabilities: [], listingStatus: 'published' });
  });
  const save = (id, version, saved = true, key = randomUUID()) => app.marketplace.saveAgent(actor, id, { saved, expectedVersion: version }, key);
  const key = randomUUID();
  const first = await save(ids[0], 0, true, key);
  assert.deepEqual(await save(ids[0], 0, true, key), first, 'idempotent replay');
  await assert.rejects(save(ids[0], 0, false, key), { code: 'IDEMPOTENCY_CONFLICT' });
  const competing = await Promise.allSettled([save(ids[1], 1), save(ids[2], 1)]);
  assert.equal(competing.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(competing.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
  const page = await app.marketplace.discover(actor, { savedOnly: true, limit: 1 });
  assert.equal(page.total, 2); assert.equal(page.agents[0].saved, true);
  assert.equal((await app.marketplace.discover({ user: { id: 'other' } }, { savedOnly: true })).total, 0);
  await assert.rejects(app.marketplace.discover(actor, { savedOnly: false, after: page.nextCursor }), { code: 'INVALID_DISCOVERY_CURSOR' });
  assert.equal((await app.marketplace.listing(actor, ids[0])).saved, true);
  assert.equal((await app.marketplace.listing({ user: { id: 'other' } }, ids[0])).saved, false);
  await repository.transaction('pause', async repo => {
    const agent = await repo.get('agent', ids[0]); agent.listingStatus = 'paused'; await repo.save('agent', agent);
  });
  const hidden = await app.marketplace.discover(actor, { savedOnly: true });
  assert.equal(hidden.total, 1);
  assert.deepEqual(hidden.unavailableSaved, [{ id: ids[0], saved: true, savedVersion: 2 }]);
  await assert.rejects(app.marketplace.listing(actor, ids[0]), { code: 'NOT_FOUND' });
  await assert.rejects(save(ids[0], 2), { code: 'NOT_FOUND' });
  await save(ids[0], 2, false);
  assert.equal((await app.marketplace.discover(actor, { savedOnly: true })).unavailableSaved.length, 0);
  await assert.rejects(app.marketplace.saveAgent({ user: { id: 'builder' } }, ids[1], { saved: true, expectedVersion: 0 }, randomUUID()), { code: 'NOT_FOUND' });
  await assert.rejects(app.marketplace.saveAgent({ ...actor, recoveryRequired: true }, ids[1], { saved: true, expectedVersion: 3 }, randomUUID()), { code: 'FORBIDDEN' });
  await assert.rejects(save(ids[1], -1), { code: 'INVALID_INPUT' });
  await repository.transaction('limit', async repo => {
    const saved = await repo.get('saved-agents', 'buyer'); saved.agentIds = Array.from({ length: 200 }, randomUUID); await repo.save('saved-agents', saved);
  });
  await assert.rejects(save(ids[1], 3), { code: 'SAVED_AGENTS_LIMIT' });
  const reopened = createApplication({ repository });
  assert.equal((await reopened.marketplace.discover(actor, { savedOnly: true })).unavailableSaved.length, 200);
});
