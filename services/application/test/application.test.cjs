'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { normalizeCsv, parseCsv } = require('../../agent-runtime/src/csv.cjs');

function actor(name) { return { user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] }; }
async function fixture(t, adapter = 'sqlite', localExecution = true) {
  let time = Date.now();
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  const buyer = actor('Buyer'), builder = actor('Builder'), stranger = actor('Other');
  const actors = [buyer, builder, stranger];
  const app = createApplication({ repository, now: () => time, localExecution, resolveOperator: async id => actors.find(item => item.user.id === id) });
  const task = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Clean the supplied CSV', brief: 'Normalize this CSV and return files with a report.' }, randomUUID());
  const agent = await app.marketplace.addAgent(builder, { name: 'CSV worker', purpose: 'Normalize supplied CSV files', kind: 'specialist', domain: 'CSV data processing', integration: 'api', capabilities: [{ category: 'Data', task: 'Normalize CSV files' }, { category: 'Research', task: 'Custom declared task' }] }, randomUUID());
  const input = Buffer.from('name,city\n Zebra , London \nAcme,Paris\nAcme,Paris\n');
  await app.addInput(buyer, task.taskId, { expectedVersion: 1, filename: 'input.csv', base64: input.toString('base64'), notes: 'Clean these supplied rows only.' }, randomUUID());
  await app.mutateTask(buyer, task.taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const current = (await app.marketplace.agents(builder))[0];
  await app.marketplace.configure(builder, agent.agentId, { expectedVersion: current.version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const credential = await app.issueCredential(builder, agent.agentId, { expectedVersion: 2 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token); await app.heartbeat(principal);
  const quote = { agentId: agent.agentId, capabilityId: current.capabilities[0].id, expectedVersion: 3, amountMinor: 100, deliveryMinutes: 1, proposal: 'Normalize supplied CSV, remove exact duplicates, sort ascending; CSV + report. Local unpaid run.' };
  return { app, repository, buyer, builder, stranger, taskId: task.taskId, agentId: agent.agentId, principal, token: credential.token, quote, input, advance: amount => time += amount };
}
async function selectAndAuthorize(f) {
  const offer = await f.app.marketplace.quote(f.builder, f.taskId, f.quote, randomUUID(), f.principal);
  await f.app.marketplace.accept(f.buyer, f.taskId, { expectedVersion: 3, offerId: offer.offerId }, randomUUID());
  return f.app.authorizeLocal(f.buyer, f.taskId, { expectedVersion: 4, mode: 'local-unpaid' }, randomUUID());
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: same application handles bid, authorization, actual files, revision and acceptance`, async t => {
    const f = await fixture(t, adapter), { app } = f;
    const authorization = await selectAndAuthorize(f);
    assert.equal((await app.detail(f.buyer, f.taskId)).task.status, 'queued');
    assert.equal((await app.marketplace.work(f.builder))[0].id, f.taskId);
    const claimKey = randomUUID();
    const job = await app.claim(f.principal, f.taskId, { assignmentId: authorization.assignmentId }, claimKey);
    assert.equal((await app.claim(f.principal, f.taskId, { assignmentId: authorization.assignmentId }, claimKey)).leaseToken, job.leaseToken);
    const result = normalizeCsv(Buffer.from(job.input.base64, 'base64'));
    assert.equal(result.report.duplicatesRemoved, 1);
    const body = { leaseToken: job.leaseToken, evidence: 'Rows and output counts validated', files: [{ filename: 'normalized.csv', mime: 'text/csv', base64: result.csv.toString('base64') }] };
    const submissionKey = randomUUID(), submission = await app.submit(f.principal, f.taskId, body, submissionKey);
    assert.deepEqual(await app.submit(f.principal, f.taskId, body, submissionKey), submission);
    let detail = await app.detail(f.buyer, f.taskId);
    assert.equal(detail.task.status, 'buyer_review');
    const file = await app.download(f.buyer, f.taskId, submission.submissionId, detail.submissions[0].files[0].id);
    assert.deepEqual(file.bytes, result.csv);
    assert.equal(file.bytes.toString(), 'name,city\r\nAcme,Paris\r\nZebra,London\r\n');
    const version = detail.task.version;
    await assert.rejects(app.reviewDelivery(f.buyer, f.taskId, 'request-revision', { expectedVersion: version, submissionId: submission.submissionId, notes: 'Send the data to a website' }, randomUUID()), { code: 'UNSUPPORTED_REVISION' });
    assert.equal((await app.detail(f.buyer, f.taskId)).task.version, version);
    await app.reviewDelivery(f.buyer, f.taskId, 'request-revision', { expectedVersion: version, submissionId: submission.submissionId, notes: 'Sort rows descending' }, randomUUID());
    const revised = await app.claim(f.principal, f.taskId, { assignmentId: authorization.assignmentId }, randomUUID());
    assert.equal(revised.revisionNotes, 'Sort rows descending');
    const next = normalizeCsv(Buffer.from(revised.input.base64, 'base64'), revised.revisionNotes);
    const revision = await app.submit(f.principal, f.taskId, { ...body, leaseToken: revised.leaseToken, files: [{ ...body.files[0], base64: next.csv.toString('base64') }] }, randomUUID());
    detail = await app.detail(f.buyer, f.taskId);
    await assert.rejects(app.reviewDelivery(f.buyer, f.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: submission.submissionId }, randomUUID()), { code: 'STALE_SUBMISSION' });
    const fileId = detail.submissions.at(-1).files[0].id;
    const original = await f.repository.read(repo => repo.get('artifact', fileId));
    await f.repository.transaction('corruption-fixture', repo => repo.save('artifact', { ...original, base64: Buffer.from('corrupt').toString('base64') }));
    await assert.rejects(app.download(f.buyer, f.taskId, revision.submissionId, fileId), { code: 'FILE_UNAVAILABLE' });
    await assert.rejects(app.reviewDelivery(f.buyer, f.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: revision.submissionId }, randomUUID()), { code: 'FILE_UNAVAILABLE' });
    assert.equal((await app.detail(f.buyer, f.taskId)).task.status, 'buyer_review');
    await f.repository.transaction('restore-fixture', repo => repo.save('artifact', original));
    const accepted = await app.reviewDelivery(f.buyer, f.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: revision.submissionId }, randomUUID());
    assert.equal(accepted.status, 'accepted'); assert.equal(accepted.paymentStatus, 'not_applicable_local_unpaid');
    assert.equal((await app.marketplace.work(f.builder))[0].status, 'accepted');
    assert.equal((await app.detail(f.buyer, f.taskId)).submissions.length, 2);
  });
}

test('private conversation and input bytes are not exposed by discovery; files and keys are scoped', async t => {
  const f = await fixture(t), { app } = f;
  await app.mutateTask(f.buyer, f.taskId, 'messages', { expectedVersion: 3, body: 'PRIVATE_MESSAGE' }, randomUUID());
  const publicData = JSON.stringify(await app.marketplace.opportunities(f.builder));
  assert.ok(!publicData.includes('PRIVATE_MESSAGE')); assert.ok(!publicData.includes(f.input.toString('base64')));
  assert.equal((await app.detail(f.buyer, f.taskId)).task.scopeVersion, 2);
  await assert.rejects(app.detail(f.stranger, f.taskId), { code: 'NOT_FOUND' });
  await assert.rejects(app.marketplace.offers(f.builder, f.taskId), { code: 'NOT_FOUND' });
  await assert.rejects(app.issueCredential(f.stranger, f.agentId, { expectedVersion: 3 }, randomUUID()), { code: 'NOT_FOUND' });
  const snapshot = JSON.stringify(await app.marketplace.agents(f.builder));
  assert.ok(!snapshot.includes(f.token)); assert.ok(!snapshot.includes('credentialHash'));
  await app.revokeCredential(f.builder, f.agentId, { expectedVersion: 3 }, randomUUID());
  await assert.rejects(app.runtimePrincipal(f.token), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(app.heartbeat(f.principal), { code: 'INVALID_AGENT_KEY' });
});
test('quote identity is immutable, selected scope cannot be rewritten after execution authorization', async t => {
  const f = await fixture(t);
  await selectAndAuthorize(f);
  await f.app.marketplace.configure(f.builder, f.agentId, { expectedVersion: 3, name: 'Changed agent', purpose: 'A new profile', kind: 'general', domain: '', integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  assert.equal((await f.app.marketplace.offers(f.buyer, f.taskId))[0].agentName, 'CSV worker');
  await assert.rejects(f.app.mutateTask(f.buyer, f.taskId, 'scope', { expectedVersion: 5, title: 'Changed', brief: 'Changed' }, randomUUID()), { code: 'TASK_ASSIGNED' });
  await assert.rejects(f.app.authorizeLocal(f.stranger, f.taskId, { expectedVersion: 5, mode: 'local-unpaid' }, randomUUID()), { code: 'NOT_FOUND' });
});
test('stale leases, duplicate workers, changed scopes, credentials and disabled execution fail closed', async t => {
  const f = await fixture(t), auth = await selectAndAuthorize(f);
  const first = await f.app.claim(f.principal, f.taskId, { assignmentId: auth.assignmentId }, randomUUID());
  await assert.rejects(f.app.claim(f.principal, f.taskId, { assignmentId: auth.assignmentId }, randomUUID()), { code: 'LEASE_BUSY' });
  f.advance(30001);
  const second = await f.app.claim(f.principal, f.taskId, { assignmentId: auth.assignmentId }, randomUUID());
  await assert.rejects(f.app.submit(f.principal, f.taskId, { leaseToken: first.leaseToken, evidence: 'Old worker', files: [{ filename: 'x.csv', mime: 'text/csv', base64: f.input.toString('base64') }] }, randomUUID()), { code: 'LEASE_EXPIRED' });
  assert.notEqual(first.leaseToken, second.leaseToken);
  await assert.rejects(f.app.download(f.stranger, f.taskId, randomUUID(), randomUUID()), { code: 'NOT_FOUND' });
  const disabled = createApplication({ repository: f.repository });
  await assert.rejects(disabled.issueCredential(f.builder, f.agentId, { expectedVersion: 3 }, randomUUID()), { code: 'LOCAL_EXECUTION_DISABLED' });
});
test('file validation rejects unsafe names and malformed base64 without mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.app.addInput(f.buyer, f.taskId, { expectedVersion: 3, filename: '../secret.csv', notes: 'test', base64: f.input.toString('base64') }, randomUUID()), { code: 'INVALID_FILE' });
  await assert.rejects(f.app.addInput(f.buyer, f.taskId, { expectedVersion: 3, filename: 'secret.csv', notes: 'test', base64: '!!!' }, randomUUID()), { code: 'INVALID_FILE' });
  assert.equal((await f.app.detail(f.buyer, f.taskId)).task.version, 3);
});
test('CSV capability evaluations cover actual data, malformed input, injection and deterministic output', () => {
  assert.deepEqual(parseCsv('name,note\n"A, B","line1\nline2"\n'), [['name', 'note'], ['A, B', 'line1\nline2']]);
  assert.throws(() => parseCsv('a,b\n1\n'), /column/);
  assert.throws(() => parseCsv('a,a\n1,2\n'), /unique/);
  assert.throws(() => parseCsv('a\n"unclosed'), /unclosed/);
  const result = normalizeCsv(Buffer.from('name\n=1+1\n'));
  assert.match(result.csv.toString(), /'=1\+1/);
  assert.throws(() => normalizeCsv(Buffer.from('a\nb\n'), 'Send this to an external URL'), /Unsupported/);
});
test('Postgres serializes competing selection and canonical replay preserves one result', async t => {
 const f=await fixture(t,'postgres');
 const first=await f.app.marketplace.quote(f.builder,f.taskId,f.quote,randomUUID(),f.principal);
 const agent=await f.app.marketplace.addAgent(f.stranger,{name:'Alternative CSV',purpose:'Clean CSV',domain:'',kind:'general',integration:'api',capabilities:[{category:'Data',task:'Clean CSV'}]},randomUUID());
 const capability=(await f.app.marketplace.agents(f.stranger))[0].capabilities[0];
 const second=await f.app.marketplace.quote(f.stranger,f.taskId,{...f.quote,agentId:agent.agentId,capabilityId:capability.id},randomUUID());
 const results=await Promise.allSettled([first,second].map(offer=>f.app.marketplace.accept(f.buyer,f.taskId,{expectedVersion:3,offerId:offer.offerId},randomUUID())));
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.find(result=>result.status==='rejected').reason.code,'VERSION_CONFLICT');
 const key=randomUUID(),body={expectedVersion:4,body:'A question without a scope change'};
 const message=await f.app.mutateTask(f.buyer,f.taskId,'messages',body,key);
 assert.deepEqual(await f.app.mutateTask(f.buyer,f.taskId,'messages',{body:body.body,expectedVersion:4},key),message);
 assert.equal((await f.app.detail(f.buyer,f.taskId)).messages.filter(item=>item.body===body.body).length,1);
});
test('application composition cannot replace managed or local authentication', () => {
 const {composeIdentity}=require('../src/compose.cjs');
 const identity={principal:()=> 'verified',register:()=> 'identity registration'};
 assert.throws(()=>composeIdentity(identity,{principal:()=> 'forged'}),/cannot override identity/);
 const command=()=> 'application command',composed=composeIdentity(identity,{createTask:command});
 assert.equal(composed.principal(), 'verified');assert.equal(composed.createTask,command);
});
