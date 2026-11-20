'use strict';
// Processing region (docs/Build-Order.md, step 6): builders declare where an
// agent processes data; a company can require a region, and Relay refuses
// every meeting point with an agent that hasn't declared it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');

function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const company = { id: randomUUID(), name: 'Northwind', company: true };
  const person = (name, role) => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }, ...(role ? [{ ...company, role }] : [])] });
  const owner = person('Olivia Owner', 'owner'), member = person('Mel Member', 'employee'), eu = person('Eva Builder'), us = person('Uma Builder');
  const actors = [owner, member, eu, us];
  let time = Date.parse('2026-11-20T10:00:00Z');
  const repository = createSqliteRepository(db);
  const app = createApplication({ repository, now: () => time, localExecution: true, resolveOperator: async id => actors.find(a => a.user.id === id) });
  const agent = async (actor, name, processingRegion) => (await app.marketplace.addAgent(actor, { name, purpose: 'Deduplicate vendor master records', kind: 'general', domain: '', integration: 'api',
    capabilities: [{ category: 'Data', task: 'Deduplicate vendor master records' }], ...(processingRegion !== undefined ? { processingRegion } : {}) }, randomUUID())).agentId;
  // Stands in for a passed Relay test, so the agent can take direct requests.
  const publish = id => repository.transaction('publish-fixture', async repo => {
    const a = await repo.get('agent', id);
    a.listingStatus = 'published'; a.credentialExpiresAt = time + 1e9;
    a.capabilities[0].assessmentId = 'assessment'; a.assessments = [{ id: 'assessment', status: 'passed', expiresAt: time + 1e9 }];
    await repo.save('agent', a);
  });
  async function draft(actor, extra = {}) {
    const { taskId } = await app.createTask(actor, { tenantId: company.id, title: 'Dedupe our vendors', brief: 'Deduplicate the vendor master export.', ...extra }, randomUUID());
    await app.addInput(actor, taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Input.' }, randomUUID());
    return taskId;
  }
  const post = async (actor, taskId) => app.mutateTask(actor, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const require_ = (region, version) => app.setOrgPolicy(owner, company.id, { requiredRegion: region, expectedVersion: version }, randomUUID());
  const offer = async (actor, agentId, taskId) => {
    const a = (await app.marketplace.agents(actor)).find(item => item.id === agentId);
    const version = (await app.detail(member, taskId)).task.version;
    return app.marketplace.quote(actor, taskId, { agentId, capabilityId: a.capabilities[0].id, expectedVersion: version, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Dedupe it.' }, randomUUID());
  };
  return { publish, app, repository, company, owner, member, eu, us, agent, draft, post, require: require_, offer };
}

test('builders declare a processing region; only the EU, the US or not declared are accepted', async t => {
  const f = setup(t);
  const euAgent = await f.agent(f.eu, 'EU dedupe', 'eu');
  const plain = await f.agent(f.us, 'Plain dedupe');
  await assert.rejects(f.agent(f.us, 'Bad', 'apac'), { code: 'INVALID_INPUT' });
  const mine = async (actor, id) => (await f.app.marketplace.agents(actor)).find(a => a.id === id);
  assert.equal((await mine(f.eu, euAgent)).processingRegion, 'eu');
  assert.equal((await mine(f.us, plain)).processingRegion, null, 'not declared by default');

  const current = await mine(f.us, plain);
  const rules = { integration: current.integration, automaticRequested: false, minimumPayout: 100, concurrency: 1, setupStage: current.setupStage };
  await f.app.marketplace.configure(f.us, plain, { ...rules, expectedVersion: current.version, processingRegion: 'us' }, randomUUID());
  assert.equal((await mine(f.us, plain)).processingRegion, 'us');
  const after = await mine(f.us, plain);
  await f.app.marketplace.configure(f.us, plain, { ...rules, expectedVersion: after.version }, randomUUID());
  assert.equal((await mine(f.us, plain)).processingRegion, 'us', 'saving other settings keeps the declaration');
});

test('owners set the required region; members can read it, the change is logged', async t => {
  const f = setup(t);
  assert.equal((await f.app.orgPolicy(f.member, f.company.id)).requiredRegion, null, 'no requirement by default');
  await assert.rejects(f.app.setOrgPolicy(f.member, f.company.id, { requiredRegion: 'eu', expectedVersion: 0 }, randomUUID()), { code: 'FORBIDDEN' });
  await assert.rejects(f.require('mars', 0), { code: 'INVALID_INPUT' });
  const saved = await f.require('eu', 0);
  assert.deepEqual({ ...saved }, { tenantId: f.company.id, membersCanPublish: true, requiredRegion: 'eu', version: 1 });
  assert.equal((await f.app.orgPolicy(f.member, f.company.id)).requiredRegion, 'eu');
  const audit = await f.app.orgAudit(f.owner, f.company.id);
  assert.ok(audit.entries.some(e => e.detail === 'Agents must process data in: EU'), JSON.stringify(audit.entries.map(e => e.detail)));
});

test('with EU required, US and undeclared agents can’t be requested directly, offer, be chosen or hear about it', async t => {
  const f = setup(t);
  const euAgent = await f.agent(f.eu, 'EU dedupe', 'eu');
  const usAgent = await f.agent(f.us, 'US dedupe', 'us');
  // An offer made before the rule is switched on can't be chosen after it.
  const early = await f.draft(f.member); await f.post(f.member, early);
  const { offerId } = await f.offer(f.us, usAgent, early);
  await f.require('eu', 0);
  const earlyVersion = (await f.app.detail(f.member, early)).task.version;
  await assert.rejects(f.app.marketplace.accept(f.member, early, { offerId, expectedVersion: earlyVersion }, randomUUID()), err => err.code === 'REGION_REQUIRED' && /the EU/.test(err.message));

  await f.publish(usAgent); await f.publish(euAgent);
  await assert.rejects(f.draft(f.member, { preferredAgentId: usAgent, preferenceMode: 'agent' }), { code: 'REGION_REQUIRED' });
  await f.draft(f.member, { preferredAgentId: euAgent, preferenceMode: 'agent' });

  const taskId = await f.draft(f.member); await f.post(f.member, taskId);
  const [seen] = (await f.app.marketplace.opportunities(f.us)).filter(o => o.id === taskId);
  assert.equal(seen.requiredRegion, 'eu', 'builders see the requirement');
  assert.deepEqual([...seen.fits], [], 'a US agent doesn’t fit');
  assert.deepEqual([...(await f.app.marketplace.opportunities(f.eu)).find(o => o.id === taskId).fits], ['EU dedupe']);
  const alerts = async actor => (await f.app.notifications(actor)).items.filter(i => i.destination === 'opportunity' && i.taskId === taskId);
  assert.equal((await alerts(f.us)).length, 0, 'no alert for an agent that can’t serve it');
  assert.equal((await alerts(f.eu)).length, 1);
  await assert.rejects(f.offer(f.us, usAgent, taskId), err => err.code === 'REGION_REQUIRED' && /Declare it on the agent/.test(err.message));
  const ok = await f.offer(f.eu, euAgent, taskId);
  const version = (await f.app.detail(f.member, taskId)).task.version;
  await f.app.marketplace.accept(f.member, taskId, { offerId: ok.offerId, expectedVersion: version }, randomUUID());
});

test('requests outside a company, and companies without a requirement, are unaffected', async t => {
  const f = setup(t);
  const usAgent = await f.agent(f.us, 'US dedupe', 'us');
  const plain = await f.agent(f.us, 'Plain dedupe');
  const taskId = await f.draft(f.member); await f.post(f.member, taskId);
  await f.offer(f.us, usAgent, taskId);
  await f.offer(f.us, plain, taskId);
  assert.equal((await f.app.marketplace.opportunities(f.eu)).length, 0, 'builders without agents see nothing');
});

test('a direct request drafted before the rule can’t be posted to an agent that breaks it', async t => {
  const f = setup(t);
  const plain = await f.agent(f.us, 'Plain dedupe');
  await f.publish(plain);
  const taskId = await f.draft(f.member, { preferredAgentId: plain, preferenceMode: 'agent' });
  await f.require('us', 0);
  await assert.rejects(f.post(f.member, taskId), err => err.code === 'REGION_REQUIRED' && /the US/.test(err.message) && /Plain dedupe/.test(err.message));
});

test('the marketplace tells a buyer which of their companies require a region', async t => {
  const f = setup(t);
  assert.deepEqual([...(await f.app.marketplace.browse(f.member)).regionRules], []);
  await f.require('eu', 0);
  assert.deepEqual((await f.app.marketplace.browse(f.member)).regionRules.map(r => ({ ...r })), [{ tenantId: f.company.id, name: 'Northwind', region: 'eu' }]);
  assert.deepEqual([...(await f.app.marketplace.browse(f.eu)).regionRules], [], 'outsiders don’t see it');
});
