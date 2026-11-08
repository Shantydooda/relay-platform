'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
for (const postgres of [false, true]) test(`${postgres ? 'postgres' : 'sqlite'} acquisition preserves validated source, excludes drafts and aggregates all pages privately`, async t => {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');t.after(() => db.close());
  const repository = postgres ? await createPostgresRepository(db, { initialize: true }) : createSqliteRepository(db);
  const user = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = user('Buyer'), builder = user('Builder'), other = user('Other');
  const app = createApplication({ repository });
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'Agent', purpose: 'Research', kind: 'general', integration: 'api', capabilities: [{ category: 'Research', task: 'Reports' }] }, randomUUID());
  await repository.transaction('qualify-fixture', async repo => {
    const agent = await repo.get('agent', agentId);
    agent.listingStatus = 'published';agent.credentialExpiresAt = Date.now()+1000000;
    agent.capabilities[0].assessmentId = 'assessment';
    agent.assessments = [{ id: 'assessment', status: 'passed', expiresAt: Date.now()+1000000 }];
    await repo.save('agent', agent);
  });
  const body = { tenantId: buyer.memberships[0].id, title: 'PRIVATE TITLE', brief: 'SECRET BRIEF', preferredAgentId: agentId, preferenceMode: 'agent', discoverySource: 'builder-link' };
  const key = randomUUID(), first = await app.createTask(buyer, body, key);
  assert.deepEqual(await app.createTask(buyer, body, key), first);
  assert.equal((await app.marketplace.acquisition(builder, agentId)).totals.requests, 0);
  await app.mutateTask(buyer, first.taskId, 'post', { expectedVersion: 1 }, randomUUID());
  await app.mutateTask(buyer, first.taskId, 'scope', { expectedVersion: 2, title: 'Changed', brief: 'Changed brief' }, randomUUID());
  assert.equal((await app.marketplace.acquisition(builder, agentId)).rows.find(row => row.source==='builder-link').requests, 1);
  await assert.rejects(app.marketplace.acquisition(other, agentId), { code: 'NOT_FOUND' });
  await assert.rejects(app.createTask(buyer, { ...body, discoverySource: 'forged-source' }, randomUUID()), { code: 'INVALID_ACQUISITION' });
  await assert.rejects(app.createTask(buyer, { tenantId:body.tenantId,title:'Title',brief:'Brief',discoverySource:'market' }, randomUUID()), { code: 'INVALID_INPUT' });
  await assert.rejects(app.createTask(builder, { ...body, tenantId:builder.memberships[0].id }, randomUUID()), { code: 'NOT_FOUND' });
  await repository.transaction('bulk-fixtures', async repo => {
    for (let i=0;i<205;i++) await repo.save('task', {
      id: randomUUID(), ownerId: buyer.user.id, tenantId: body.tenantId,
      acquisition: { agentId, operatorId: builder.user.id, source:'market',mode:'builder' },
      title:'SECRET', status:'cancelled', events:[{type:'task.posted'},{type:'offer.selected',offerId:'own'},{type:'offer.selected',offerId:'own'}],
      offers:[{id:'own',operatorId:builder.user.id},{id:'other-own',operatorId:builder.user.id}], assignment: i%2 ? null : {operatorId:builder.user.id,status:'accepted'}
    });
    await repo.save('task', { id:randomUUID(),ownerId:buyer.user.id,tenantId:body.tenantId, events:[{type:'task.posted'}],offers:[] });
  });
  const report = await app.marketplace.acquisition(builder, agentId);
  assert.deepEqual(report.totals, { requests:206,quoted:205,selected:205,delivered:103 });
  assert.doesNotMatch(JSON.stringify(report), /SECRET|PRIVATE|ownerId|taskId/);
  const again = await app.marketplace.acquisition(builder, agentId);
  assert.deepEqual(again.totals, report.totals);

  // A different supplier winning must not become this builder's conversion.
  const taskId = randomUUID(), ownOffer = randomUUID(), competingOffer = randomUUID();
  await repository.transaction('selection-fixture', async repo => {
    await repo.save('task', {
      id: taskId, tenantId: body.tenantId, ownerId: buyer.user.id, status: 'posted',
      title: 'Private competing request', brief: 'Private brief', version: 1, scopeVersion: 1,
      acquisition: { agentId, operatorId: builder.user.id, source: 'repeat-hire' },
      events: [{ type: 'task.posted' }], messages: [], scopes: [], submissions: [],
      offers: [
        { id: ownOffer, operatorId: builder.user.id, scopeVersion: 1, expiresAt: Date.now()+100000 },
        { id: competingOffer, operatorId: other.user.id, scopeVersion: 1, expiresAt: Date.now()+100000 }
      ]
    });
  });
  const selection = { offerId: competingOffer, expectedVersion: 1 }, receipt = randomUUID();
  const result = await app.marketplace.accept(buyer, taskId, selection, receipt);
  assert.deepEqual(await app.marketplace.accept(buyer, taskId, selection, receipt), result);
  let row = (await app.marketplace.acquisition(builder, agentId)).rows.find(row => row.source === 'repeat-hire');
  assert.deepEqual(row, { source: 'repeat-hire', requests: 1, quoted: 1, selected: 0, delivered: 0 });
  await app.marketplace.accept(buyer, taskId, { offerId: ownOffer, expectedVersion: 2 }, randomUUID());
  await app.marketplace.accept(buyer, taskId, { offerId: competingOffer, expectedVersion: 3 }, randomUUID());
  row = (await app.marketplace.acquisition(builder, agentId)).rows.find(row => row.source === 'repeat-hire');
  assert.equal(row.selected, 1, 'a prior own selection remains a historical milestone after replacement');
  assert.equal(row.delivered, 0, 'selection does not imply delivery');
  await repository.transaction('legacy-fixture', async repo => {
    const task = await repo.get('task', taskId);
    task.events = task.events.map(({ offerId, ...event }) => event);
    await repo.save('task', task);
  });
  row = (await app.marketplace.acquisition(builder, agentId)).rows.find(row => row.source === 'repeat-hire');
  assert.equal(row.selected, 0, 'unattributable legacy events are not guessed');
  await repository.transaction('assignment-fixture', async repo => {
    const task = await repo.get('task', taskId);
    task.assignment = { operatorId: builder.user.id, status: 'accepted' };
    await repo.save('task', task);
  });
  row = (await app.marketplace.acquisition(builder, agentId)).rows.find(row => row.source === 'repeat-hire');
  assert.equal(row.selected, 1, 'legacy assignment supplies reliable supplier evidence');
  assert.equal(row.delivered, 1);
});
