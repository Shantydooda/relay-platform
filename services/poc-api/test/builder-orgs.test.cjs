'use strict';
// Builder organizations (docs/specs/Enterprise-and-Projects.md, step 2): a firm
// publishes under its own name. Its agents, connection keys, offers and work
// belong to the organization, and members act for it from the Build area.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../src/database.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createSqliteRepository } = require('../../application/src/repository.cjs');

async function fixture(t) {
  const authDb = openDatabase(':memory:'), dataDb = openDatabase(':memory:');
  t.after(() => { authDb.close(); dataDb.close(); });
  const repository = createSqliteRepository(dataDb);
  const store = await createUnifiedLocalStore({ authDb, repository, localExecution: true });
  const actors = {};
  for (const name of ['Olivia Owner', 'Mel Member', 'Bea Buyer']) {
    const session = await store.register({ name, email: `${name.split(' ')[0].toLowerCase()}@example.test`, password: 'local builder org password only', workspace: 'buyer' }, name);
    actors[name.split(' ')[0].toLowerCase()] = () => store.principal(session);
  }
  const { tenantId: orgId } = store.createTeam(actors.olivia(), { name: 'Acme ERP' }, randomUUID());
  const invite = store.inviteTeamMember(actors.olivia(), orgId, { email: 'mel@example.test', role: 'employee' });
  await store.acceptTeamInvite(actors.mel(), { token: invite.token });
  const agentBody = { name: 'Vendor dedupe', purpose: 'Deduplicate vendor masters', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Deduplicate vendors' }] };
  return { store, repository, actors, orgId, agentBody };
}

test('members act for the organization: its agents, offers and work are shared, and nobody else can act for it', async t => {
  const f = await fixture(t);
  const options = await f.store.publishing(f.actors.mel());
  assert.deepEqual(options.organizations, [{ id: f.orgId, name: 'Acme ERP', role: 'employee', canAct: true, agents: 0 }]);

  const asAcme = await f.store.actAs(f.actors.mel(), f.orgId);
  assert.equal(asAcme.user.id, f.orgId);
  assert.equal(asAcme.user.name, 'Acme ERP');
  assert.equal(asAcme.onBehalfOf.name, 'Mel Member');
  await assert.rejects(f.store.actAs(f.actors.bea(), f.orgId), { code: 'FORBIDDEN' });

  const { agentId } = await f.store.marketplace.addAgent(asAcme, f.agentBody, randomUUID());
  const [agent] = await f.store.marketplace.agents(await f.store.actAs(f.actors.olivia(), f.orgId));
  assert.equal(agent.id, agentId, 'the owner sees the agent a member created');
  const stored = await f.repository.read(repo => repo.get('agent', agentId));
  assert.deepEqual([stored.ownerId, stored.operatorName], [f.orgId, 'Acme ERP'], 'the organization is the operator');
  assert.equal((await f.store.marketplace.agents(f.actors.mel())).length, 0, 'it is not Mel’s personal agent');
  assert.equal((await f.store.publishing(f.actors.olivia())).organizations[0].agents, 1);

  // A buyer's request: the organization offers, and the offer carries its name.
  const bea = f.actors.bea();
  const task = await f.store.createTask(bea, { tenantId: bea.memberships[0].id, title: 'Dedupe vendors', brief: 'Deduplicate the vendor export and return a report.' }, randomUUID());
  await f.store.addInput(bea, task.taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Dedupe these.' }, randomUUID());
  await f.store.mutateTask(bea, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  assert.equal((await f.store.marketplace.opportunities(asAcme)).length, 1);
  await f.store.marketplace.quote(asAcme, task.taskId, { agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Dedupe it.' }, randomUUID());
  const [quote] = await f.store.marketplace.quotes(await f.store.actAs(f.actors.olivia(), f.orgId));
  assert.equal(quote.title, 'Dedupe vendors');
  assert.equal((await f.store.marketplace.offers(bea, task.taskId))[0].operatorName, 'Acme ERP');

  // The owner's audit log says which person acted for the organization.
  const audit = await f.store.orgAudit(f.actors.olivia(), f.orgId);
  const actions = audit.entries.map(e => `${e.actor}: ${e.action}`);
  assert.ok(actions.includes('Mel Member: Agent created'), actions.join('; '));
  assert.ok(actions.includes('Mel Member: Offer sent'), actions.join('; '));

  // Leaving the organization ends access on the next request; the agent stays with Acme.
  await f.store.removeTeamAccess(f.actors.olivia(), f.orgId, { memberId: f.actors.mel().user.id });
  await assert.rejects(f.store.actAs(f.actors.mel(), f.orgId), { code: 'FORBIDDEN' });
  await assert.rejects(f.store.marketplace.agents(asAcme), { code: 'FORBIDDEN' }, 'an identity obtained earlier stops working');
  assert.equal((await f.store.marketplace.agents(await f.store.actAs(f.actors.olivia(), f.orgId))).length, 1);
});

test('"Members can publish agents" off: only owners act for the organization', async t => {
  const f = await fixture(t);
  await f.store.setOrgPolicy(f.actors.olivia(), f.orgId, { membersCanPublish: false, expectedVersion: 0 }, randomUUID());
  assert.equal((await f.store.publishing(f.actors.mel())).organizations[0].canAct, false);
  await assert.rejects(f.store.actAs(f.actors.mel(), f.orgId), { code: 'ORG_PUBLISHING_OFF' });
  const asAcme = await f.store.actAs(f.actors.olivia(), f.orgId);
  assert.ok((await f.store.marketplace.addAgent(asAcme, f.agentBody, randomUUID())).agentId);
});

test('an organization cannot offer on its own requests, and an organization identity cannot buy', async t => {
  const f = await fixture(t);
  const olivia = f.actors.olivia(), asAcme = await f.store.actAs(olivia, f.orgId);
  const { agentId } = await f.store.marketplace.addAgent(asAcme, f.agentBody, randomUUID());
  const [agent] = await f.store.marketplace.agents(asAcme);
  const task = await f.store.createTask(olivia, { tenantId: f.orgId, title: 'Internal cleanup', brief: 'Deduplicate our own vendor export.' }, randomUUID());
  await f.store.addInput(olivia, task.taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Dedupe these.' }, randomUUID());
  await f.store.mutateTask(olivia, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  await assert.rejects(f.store.marketplace.quote(asAcme, task.taskId, { agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Dedupe it.' }, randomUUID()), { code: 'NOT_FOUND' });
  await assert.rejects(f.store.createTask(asAcme, { tenantId: f.orgId, title: 'x', brief: 'Not allowed as the organization.' }, randomUUID()));
  await assert.rejects(f.store.detail(asAcme, task.taskId), { code: 'NOT_FOUND' }, 'acting for the organization gives no buyer access to its requests');
});

test('connection keys belong to the organization: its agent connects and works as the organization', async t => {
  const f = await fixture(t);
  const asAcme = await f.store.actAs(f.actors.mel(), f.orgId);
  const { agentId } = await f.store.marketplace.addAgent(asAcme, f.agentBody, randomUUID());
  const [agent] = await f.store.marketplace.agents(asAcme);
  const { token } = await f.store.issueCredential(asAcme, agentId, { expectedVersion: agent.version }, randomUUID());
  await f.store.removeTeamAccess(f.actors.olivia(), f.orgId, { memberId: f.actors.mel().user.id });
  const principal = await f.store.runtimePrincipal(token, { kind: 'local-csv' });
  assert.equal(principal.actor.user.id, f.orgId, 'the key keeps working after the member who made it leaves');
  assert.equal((await f.store.heartbeat(principal)).connected, true);
  const audit = await f.store.orgAudit(f.actors.olivia(), f.orgId);
  assert.ok(audit.entries.some(e => e.actor === 'Mel Member' && e.action === 'Connection key created' && e.detail === 'Vendor dedupe'));
});

test('an agent created for an organization is marked as an organization’s', async t => {
  const f = await fixture(t);
  const { agentId } = await f.store.marketplace.addAgent(await f.store.actAs(f.actors.olivia(), f.orgId), f.agentBody, randomUUID());
  const { agentId: own } = await f.store.marketplace.addAgent(f.actors.olivia(), f.agentBody, randomUUID());
  const kinds = await f.repository.read(async repo => [(await repo.get('agent', agentId)).operatorKind, (await repo.get('agent', own)).operatorKind]);
  assert.deepEqual(kinds, ['organization', 'person']);
});

test('members who can build as the organization get a way to manage its agents from the agent page', async t => {
  const f = await fixture(t);
  const { agentId } = await f.store.marketplace.addAgent(await f.store.actAs(f.actors.olivia(), f.orgId), f.agentBody, randomUUID());
  // A draft agent: its members can open its page to manage it; outsiders can't see it.
  const forMel = await f.store.marketplace.listing(f.actors.mel(), agentId);
  assert.deepEqual({ ...forMel.manageAs }, { id: f.orgId, name: 'Acme ERP' });
  assert.equal(forMel.ownerPreview, false, 'Mel isn’t the owner: package drafts stay in Build');
  assert.ok(!('ownerPackages' in forMel));
  assert.deepEqual({ ...(await f.store.marketplace.listing(f.actors.olivia(), agentId)).manageAs }, { id: f.orgId, name: 'Acme ERP' }, 'owners of the organization too');
  await assert.rejects(f.store.marketplace.listing(f.actors.bea(), agentId), { code: 'NOT_FOUND' });

  // With member publishing switched off, only the organization’s owners manage it.
  await f.store.setOrgPolicy(f.actors.olivia(), f.orgId, { membersCanPublish: false, expectedVersion: 0 }, randomUUID());
  await assert.rejects(f.store.marketplace.listing(f.actors.mel(), agentId), { code: 'NOT_FOUND' });
  assert.ok((await f.store.marketplace.listing(f.actors.olivia(), agentId)).manageAs);
});
