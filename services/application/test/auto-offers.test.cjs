'use strict';
// Builders choose how far automatic offers go: any matching request, or only
// small ones (up to their limit, never ERP data requests) so bigger work waits for them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { automaticRefusal, automaticRules } = require('../src/auto-offers.cjs');

test('limited automatic offers stop at the builder limit and never cover ERP data requests', () => {
  const limited = { automaticScope: 'limited', automaticLimitMinor: 50000 };
  assert.equal(automaticRefusal(limited, {}, 50000), null);
  assert.match(automaticRefusal(limited, {}, 50001), /above your automatic limit/);
  assert.match(automaticRefusal(limited, { intake: { kind: 'erp-data' } }, 100), /ERP data/);
  assert.equal(automaticRefusal({ automaticScope: 'all' }, { intake: { kind: 'erp-data' } }, 9999999), null);
  assert.equal(automaticRefusal({}, {}, 100), null, 'agents saved before this option keep offering on any match');
});

test('the option is validated: a limited scope needs a positive limit', () => {
  assert.deepEqual(automaticRules({}), { automaticScope: 'all', automaticLimitMinor: null });
  assert.deepEqual(automaticRules({ automaticScope: 'limited', automaticLimitMinor: 25000 }), { automaticScope: 'limited', automaticLimitMinor: 25000 });
  assert.throws(() => automaticRules({ automaticScope: 'limited' }), /limit/);
  assert.throws(() => automaticRules({ automaticScope: 'everything' }), /Choose/);
});

test('a runtime offer above the limit is refused; the builder can still offer it by hand', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const actor = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = actor('Buyer'), builder = actor('Builder');
  const app = createApplication({ repository: createSqliteRepository(db), now: () => Date.now(), localExecution: true, resolveOperator: async id => [buyer, builder].find(a => a.user.id === id) });
  const task = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Clean the supplied CSV', brief: 'Normalize this CSV and return files with a report.' }, randomUUID());
  const agent = await app.marketplace.addAgent(builder, { name: 'CSV worker', purpose: 'Normalize supplied CSV files', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Normalize CSV files' }] }, randomUUID());
  await app.addInput(buyer, task.taskId, { expectedVersion: 1, filename: 'input.csv', base64: Buffer.from('a\n1\n').toString('base64'), notes: 'Clean these rows.' }, randomUUID());
  await app.mutateTask(buyer, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const [open] = await app.marketplace.opportunities(builder);
  assert.ok(open.postedAt > 0, 'builders see when a request was posted');
  assert.equal(open.direct, false);
  const current = (await app.marketplace.agents(builder))[0];
  await app.marketplace.configure(builder, agent.agentId, { expectedVersion: current.version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1, automaticScope: 'limited', automaticLimitMinor: 5000 }, randomUUID());
  const saved = (await app.marketplace.agents(builder))[0];
  assert.equal(saved.rules.automaticScope, 'limited');
  assert.equal(saved.rules.automaticLimitMinor, 5000);
  const credential = await app.issueCredential(builder, agent.agentId, { expectedVersion: saved.version }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token); await app.heartbeat(principal);
  const offer = { agentId: agent.agentId, capabilityId: current.capabilities[0].id, expectedVersion: 3, amountMinor: 6000, deliveryMinutes: 5, proposal: 'Clean it.' };
  await assert.rejects(app.marketplace.quote(builder, task.taskId, offer, randomUUID(), principal), { code: 'AUTOMATIC_LIMIT' });
  const manual = await app.marketplace.quote(builder, task.taskId, offer, randomUUID());
  assert.ok(manual.offerId, 'a hand-made offer is not limited');
});
