'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
function actor(name, tenant = randomUUID(), role = 'owner') { return { user: { id: randomUUID(), name }, memberships: [{ id: tenant, role }] }; }
async function fixture(t, postgres) {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = postgres ? await createPostgresRepository(db, { initialize: true }) : createSqliteRepository(db);
  const buyer = actor('Customer'), builder = actor('Supplier'), other = actor('Other');
  const employee = actor('Employee', buyer.memberships[0].id, 'employee');
  const users = [buyer, builder, other, employee];
  const app = createApplication({ repository, resolveActor: async id => users.find(a => a.user.id === id) });
  const { agentId } = await app.marketplace.addAgent(builder, { name: 'Agent', purpose: 'Research', kind: 'general', integration: 'api', capabilities: [{ category: 'Research', task: 'Research' }] }, randomUUID());
  await app.marketplace.updateListing(builder, agentId, { expectedVersion: 1, status: 'published' }, randomUUID());
  const { taskId } = await app.createTask(employee, { tenantId: buyer.memberships[0].id, title: 'PRIVATE TITLE', brief: 'PRIVATE BRIEF' }, randomUUID());
  await repository.transaction('seed-accepted', async repo => {
    const task = await repo.get('task', taskId);
    task.assignment = { id: randomUUID(), agentId, operatorId: builder.user.id, status: 'accepted' };
    task.input = { filename: 'secret.csv', base64: 'SECRET', notes: 'PRIVATE NOTES' };
    await repo.save('task', task);
  });
  const body = { expectedVersion: 2, kind: 'relay-task', taskId, title: 'Public example', summary: 'Redacted outcome', sample: 'Approved text only', consent: 'redacted-sharing-rights' };
  return { app, repository, buyer, builder, other, employee, agentId, taskId, body };
}
for (const postgres of [false, true]) {
  test(`${postgres ? 'postgres' : 'sqlite'} portfolio approval publishes only immutable excerpts; revoke and withdraw remove them`, async t => {
    const f = await fixture(t, postgres), m = f.app.marketplace, key = randomUUID();
    const added = await m.addPortfolio(f.builder, f.agentId, f.body, key);
    assert.deepEqual(await m.addPortfolio(f.builder, f.agentId, f.body, key), added);
    assert.equal((await m.listing(f.other, f.agentId)).portfolio.length, 0);
    const detail = await f.app.detail(f.buyer, f.taskId);
    assert.equal(detail.portfolioRequests[0].canDecide, true);
    assert.equal((await f.app.detail(f.employee, f.taskId)).portfolioRequests[0].canDecide, false);
    const decide = (actor, action, expectedVersion = 1, requestKey = randomUUID()) => m.decidePortfolio(actor, added.exampleId, { expectedVersion, action }, requestKey);
    await assert.rejects(decide(f.employee, 'approve'), { code: 'PORTFOLIO_OWNER_REQUIRED' });
    await assert.rejects(decide(f.other, 'approve'), { code: 'NOT_FOUND' });
    await assert.rejects(decide(f.builder, 'approve'), { code: 'NOT_FOUND' });
    const approvalKey = randomUUID();
    await decide(f.buyer, 'approve', 1, approvalKey);
    const page = await m.listing(f.other, f.agentId);
    assert.equal(page.portfolio[0].sample, 'Approved text only');
    assert.doesNotMatch(JSON.stringify(page), /PRIVATE|SECRET|taskId|ownerId|history/);
    await decide(f.buyer, 'revoke', 2);
    await decide(f.buyer, 'approve', 1, approvalKey); // receipt replay cannot republish
    assert.equal((await m.listing(f.other, f.agentId)).portfolio.length, 0);
    await assert.rejects(decide(f.buyer, 'approve', 3), { code: 'INVALID_STATE' });
    await assert.rejects(m.addPortfolio(f.builder, f.agentId, { ...f.body, expectedVersion: 3, sample: 'Changed', consent: '' }, randomUUID()), { code: 'CONSENT_REQUIRED' });
    const original = await m.addPortfolio(f.builder, f.agentId, { ...f.body, expectedVersion: 3, kind: 'owned', taskId: null }, randomUUID());
    assert.equal((await m.listing(f.other, f.agentId)).portfolio.length, 1);
    await m.decidePortfolio(f.builder, original.exampleId, { expectedVersion: 1, action: 'withdraw' }, randomUUID());
    assert.equal((await m.listing(f.other, f.agentId)).portfolio.length, 0);
  });
  test(`${postgres ? 'postgres' : 'sqlite'} portfolio prevents forged sources, conflicting decisions and approval after access removal`, async t => {
    const f = await fixture(t, postgres), m = f.app.marketplace;
    await assert.rejects(m.addPortfolio(f.other, f.agentId, f.body, randomUUID()), { code: 'NOT_FOUND' });
    await assert.rejects(m.addPortfolio(f.builder, f.agentId, { ...f.body, taskId: randomUUID() }, randomUUID()), { code: 'NOT_FOUND' });
    await assert.rejects(m.addPortfolio(f.builder, f.agentId, { ...f.body, kind: 'owned' }, randomUUID()), { code: 'INVALID_INPUT' });
    const added = await m.addPortfolio(f.builder, f.agentId, f.body, randomUUID());
    const decisions = await Promise.allSettled(['approve', 'decline'].map(action => m.decidePortfolio(f.buyer, added.exampleId, { expectedVersion: 1, action }, randomUUID())));
    assert.equal(decisions.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(decisions.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
    const stale = structuredClone(f.buyer); f.buyer.memberships = [];
    await assert.rejects(m.decidePortfolio(stale, added.exampleId, { expectedVersion: 2, action: 'revoke' }, randomUUID()), { code: 'NOT_FOUND' });
    await assert.rejects(m.addPortfolio(f.builder, f.agentId, f.body, randomUUID()), { code: 'VERSION_CONFLICT' });
  });
}
