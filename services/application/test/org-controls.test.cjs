'use strict';
// Organization controls: "Members can publish agents" and the owners' audit log.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { auditCsv } = require('../src/org-controls.cjs');

function setup(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const company = { id: randomUUID(), name: 'Northwind', company: true };
  const person = (name, role) => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }, ...(role ? [{ ...company, role }] : [])] });
  const owner = person('Olivia Owner', 'owner'), member = person('Mel Member', 'member'), outsider = person('Other Builder');
  const actors = [owner, member, outsider];
  let time = Date.now();
  const repository = createSqliteRepository(db);
  const app = createApplication({ repository, now: () => time, localExecution: true, resolveOperator: async id => actors.find(a => a.user.id === id) });
  const agentBody = { name: 'Vendor dedupe', purpose: 'Deduplicate vendor masters', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Deduplicate vendors' }] };
  return { app, repository, company, owner, member, outsider, agentBody, advance: ms => { time += ms; } };
}

test('owners can stop members publishing agents or sending offers; owners and outsiders are unaffected', async t => {
  const f = setup(t);
  const memberAgent = await f.app.marketplace.addAgent(f.member, f.agentBody, randomUUID());
  assert.deepEqual(await f.app.publishing(f.member), { allowed: true, blockedBy: [] });
  assert.equal((await f.app.orgPolicy(f.member, f.company.id)).membersCanPublish, true, 'on by default');
  await assert.rejects(f.app.setOrgPolicy(f.member, f.company.id, { membersCanPublish: false, expectedVersion: 0 }, randomUUID()), { code: 'FORBIDDEN' });
  await assert.rejects(f.app.orgPolicy(f.outsider, f.company.id), { code: 'FORBIDDEN' });

  const saved = await f.app.setOrgPolicy(f.owner, f.company.id, { membersCanPublish: false, expectedVersion: 0 }, randomUUID());
  assert.deepEqual(saved, { tenantId: f.company.id, membersCanPublish: false, version: 1 });
  await assert.rejects(f.app.setOrgPolicy(f.owner, f.company.id, { membersCanPublish: true, expectedVersion: 0 }, randomUUID()), { code: 'VERSION_CONFLICT' });

  const blocked = await f.app.publishing(f.member);
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockedBy, [{ id: f.company.id, name: 'Northwind' }]);
  await assert.rejects(f.app.marketplace.addAgent(f.member, f.agentBody, randomUUID()), err => err.code === 'ORG_PUBLISHING_OFF' && /Northwind/.test(err.message));
  const current = (await f.app.marketplace.agents(f.member)).find(a => a.id === memberAgent.agentId);
  await assert.rejects(f.app.marketplace.updateListing(f.member, memberAgent.agentId, { status: 'published', expectedVersion: current.version }, randomUUID()), { code: 'ORG_PUBLISHING_OFF' });

  // A request from someone else: the member's agent may not offer on it.
  const buyer = f.outsider;
  const task = await f.app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Dedupe vendors', brief: 'Deduplicate the vendor export and return a report.' }, randomUUID());
  await f.app.addInput(buyer, task.taskId, { expectedVersion: 1, filename: 'vendors.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Dedupe these.' }, randomUUID());
  await f.app.mutateTask(buyer, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  await assert.rejects(f.app.marketplace.quote(f.member, task.taskId, { agentId: memberAgent.agentId, capabilityId: current.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Dedupe it.' }, randomUUID()), { code: 'ORG_PUBLISHING_OFF' });

  assert.ok((await f.app.marketplace.addAgent(f.owner, f.agentBody, randomUUID())).agentId, 'owners can still publish');
  assert.deepEqual(await f.app.publishing(f.owner), { allowed: true, blockedBy: [] });
});

test('every preview and download of a company file is in the owners’ audit log, with a safe CSV export', async t => {
  const f = setup(t);
  const tenantId = f.company.id;
  const task = await f.app.createTask(f.owner, { tenantId, title: '=SUM(1) vendor cleanup', brief: 'Clean the vendor master export for NetSuite.' }, randomUUID());
  const submissionId = randomUUID(), fileId = randomUUID(), bytes = Buffer.from('vendor,city\nAcme,Paris\n');
  const metadata = { id: fileId, filename: 'vendors-clean.csv', mime: 'text/csv', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  await f.repository.transaction('fixture-delivery', async repo => {
    const saved = await repo.get('task', task.taskId);
    saved.assignment = { operatorId: f.outsider.user.id, status: 'buyer_review' };
    saved.submissions = [{ id: submissionId, version: 1, status: 'ready', files: [metadata] }];
    await repo.save('task', saved);
    await repo.save('artifact', { ...metadata, ownerId: f.owner.user.id, taskId: task.taskId, submissionId, base64: bytes.toString('base64') });
  });
  f.advance(1000);
  await f.app.previewFile(f.owner, task.taskId, submissionId, fileId);
  await assert.rejects(f.app.previewFile(f.member, task.taskId, submissionId, fileId), { code: 'NOT_FOUND' }, 'work outside projects stays private to its owner');
  f.advance(1000);
  await f.app.download(f.outsider, task.taskId, submissionId, fileId);

  await assert.rejects(f.app.orgAudit(f.member, tenantId), { code: 'FORBIDDEN' }, 'members cannot read the audit log');
  const audit = await f.app.orgAudit(f.owner, tenantId);
  const [latest, previous] = audit.entries;
  assert.deepEqual([latest.action, latest.actor, latest.filename], ['File downloaded', 'Other Builder', 'vendors-clean.csv']);
  assert.deepEqual([previous.action, previous.actor], ['File previewed', 'Olivia Owner']);
  assert.ok(audit.entries.some(e => e.action === 'Request drafted' && e.actor === 'Olivia Owner'), 'task events are included');
  assert.equal(audit.entries.filter(e => /File/.test(e.action)).length, 2, 'a refused preview is not logged');

  const csv = auditCsv(audit);
  assert.match(csv.split('\n')[0], /^Time \(UTC\),Who,Action,Request,File,Detail$/);
  assert.match(csv, /,'=SUM\(1\) vendor cleanup,/);
  assert.doesNotMatch(csv, /,=SUM/, 'cells starting with = cannot run as spreadsheet formulas');
});
