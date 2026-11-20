'use strict';
// Match alerts (docs/Build-Order.md, step 4): a builder hears about a new request
// that fits one of their agents, in the notifications they already have.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');

function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const buyer = person('Bea Buyer'), dedupe = person('Dee Builder'), translator = person('Tran Builder');
  const actors = [buyer, dedupe, translator];
  let time = Date.parse('2026-11-20T10:00:00Z');
  const repository = createSqliteRepository(db);
  const app = createApplication({ repository, now: () => time, localExecution: true, resolveOperator: async id => actors.find(a => a.user.id === id) });
  const agent = (actor, name, task) => app.marketplace.addAgent(actor, { name, purpose: task, kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task }] }, randomUUID());
  async function post(title, brief, patch = {}) {
    const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title, brief }, randomUUID());
    await app.addInput(buyer, taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Input.' }, randomUUID());
    if (Object.keys(patch).length) await repository.transaction('fixture', async repo => { const task = await repo.get('task', taskId); Object.assign(task, patch); await repo.save('task', task); });
    await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
    return taskId;
  }
  const alerts = async actor => (await app.notifications(actor)).items.filter(item => item.destination === 'opportunity');
  return { app, repository, buyer, dedupe, translator, agent, post, alerts, advance: ms => { time += ms; } };
}

test('a builder is alerted to a new request that fits an agent, until they offer on it', async t => {
  const f = setup(t);
  const { agentId } = await f.agent(f.dedupe, 'Vendor dedupe', 'Deduplicate vendor master records');
  await f.agent(f.translator, 'Copywriter', 'Translate marketing copy into French');
  const taskId = await f.post('Dedupe our vendors', 'Deduplicate the vendor master export and return a report.');

  const [alert] = await f.alerts(f.dedupe);
  assert.equal(alert.taskId, taskId);
  assert.equal(alert.title, 'New request that fits Vendor dedupe');
  assert.equal(alert.side, 'builder');
  assert.equal(alert.tenantId, null, 'the buyer’s workspace is never revealed');
  assert.equal(alert.read, false);
  assert.deepEqual(await f.alerts(f.translator), [], 'an unrelated agent is not alerted');
  assert.deepEqual(await f.alerts(f.buyer), [], 'buyers are not alerted to their own requests');

  await f.app.readNotifications(f.dedupe, { ids: [alert.id] });
  assert.equal((await f.alerts(f.dedupe))[0].read, true);

  const agent = (await f.app.marketplace.agents(f.dedupe))[0];
  await f.app.marketplace.quote(f.dedupe, taskId, { agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Dedupe it.' }, randomUUID());
  assert.deepEqual(await f.alerts(f.dedupe), [], 'once you have offered, the alert has done its job');
});

test('direct requests always alert; paused agents, other builders’ direct requests and old requests do not', async t => {
  const f = setup(t);
  const { agentId } = await f.agent(f.translator, 'Copywriter', 'Translate marketing copy into French');
  await f.post('French copy', 'Translate our launch email.', { preferredAgentId: agentId, preferredOperatorId: f.translator.user.id });
  const [direct] = await f.alerts(f.translator);
  assert.equal(direct.title, 'Sent to you directly: Copywriter');
  await f.agent(f.dedupe, 'Translator two', 'Translate marketing copy into French');
  assert.deepEqual(await f.alerts(f.dedupe), [], 'a request reserved for another builder is not offered around');

  const paused = await f.agent(f.dedupe, 'Vendor dedupe', 'Deduplicate vendor master records');
  const version = (await f.app.marketplace.agents(f.dedupe)).find(a => a.id === paused.agentId).version;
  await f.app.marketplace.updateListing(f.dedupe, paused.agentId, { status: 'paused', expectedVersion: version }, randomUUID());
  await f.post('Dedupe our vendors', 'Deduplicate the vendor master export.');
  assert.deepEqual(await f.alerts(f.dedupe), [], 'a paused agent is not looking for work');

  f.advance(8 * 86400000);
  assert.deepEqual(await f.alerts(f.translator), [], 'requests posted over a week ago no longer alert');
});

test('Opportunities names the agents that fit, by the same rule as the alert', async t => {
  const f = setup(t);
  await f.agent(f.dedupe, 'Vendor dedupe', 'Deduplicate vendor master records');
  await f.agent(f.dedupe, 'Copywriter', 'Translate marketing copy into French');
  await f.post('Dedupe our vendors', 'Deduplicate the vendor master export and return a report.');
  const [request] = await f.app.marketplace.opportunities(f.dedupe);
  assert.deepEqual([...request.fits], ['Vendor dedupe']);
});

test('the buyer’s chosen category decides; an uncategorized request is classified like the agent', async t => {
  const f = setup(t);
  await f.agent(f.dedupe, 'CSV Cleaner', 'Normalize CSV data');
  await f.post('Clean a customer CSV export', 'Clean the customer CSV export: fix formatting, remove duplicate rows and return a clean CSV.');
  assert.deepEqual((await f.alerts(f.dedupe)).map(a => a.title), ['New request that fits CSV Cleaner'], 'no shared wording beyond "CSV", but the same category');
  const { taskId } = await f.app.createTask(f.buyer, { tenantId: f.buyer.memberships[0].id, title: 'Find companies', brief: 'Find 20 UK SaaS companies with websites and source links. Deliver a CSV.', categoryId: 'market-research' }, randomUUID());
  await f.app.addInput(f.buyer, taskId, { expectedVersion: 1, filename: 'seed.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Seed list.' }, randomUUID());
  await f.app.mutateTask(f.buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  assert.equal((await f.alerts(f.dedupe)).length, 1, 'a market-research request that wants a CSV back is not CSV cleanup');
});

test('agents saved before capabilities had categories are matched the same way', () => {
  const { agentFits } = require('../src/capability-matching.cjs');
  const legacy = { capabilities: [{ category: 'Data', task: 'Normalize CSV data' }] };
  assert.equal(agentFits(legacy, { title: 'Clean a customer CSV export', brief: 'Fix formatting and remove duplicate rows.' }), true);
  assert.equal(agentFits(legacy, { title: 'Launch email', brief: 'Translate our launch email into French.' }), false);
});
