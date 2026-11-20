'use strict';
// Builder-proposed Relay tests (docs/Build-Order.md, step 8): builders write a test
// as data, Relay staff approve or reject it, and approved tests qualify agents.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');

const PROPOSAL = {
  title: 'Vendor name standardisation',
  categoryId: 'master-data',
  brief: 'Return the vendor list with legal suffixes standardised (Inc, Ltd, GmbH) and one vendor per line, in the order given.',
  limitation: 'Checks suffix standardisation on a short synthetic list only. Not matching, enrichment or tax-ID checks.',
  input: 'acme incorporated\nnorthwind limited {{nonce}}\nBlue gmbh\n',
  expected: 'Acme Inc\nNorthwind Ltd {{nonce}}\nBlue GmbH\n',
  revision: 'Sort the vendors alphabetically.',
  revisionExpected: 'Acme Inc\nBlue GmbH\nNorthwind Ltd {{nonce}}\n',
  comparison: 'lines',
};

async function fixture(t, adapter = 'sqlite') {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const author = person('Ana Author'), other = person('Ben Builder'), staff = person('Sam Staff'), buyer = person('Bea Buyer');
  const actors = [author, other, staff, buyer];
  let time = Date.parse('2026-11-20T10:00:00Z');
  const app = createApplication({ repository, localExecution: true, now: () => time, resolveOperator: async id => actors.find(a => a.user.id === id), relayTestReviewerIds: [staff.user.id] });
  async function builder(actor, category = 'Master data', task = 'Standardise vendor master names') {
    const { agentId } = await app.marketplace.addAgent(actor, { name: `${actor.user.name} agent`, kind: 'general', purpose: 'Vendor master cleanup', integration: 'api', capabilities: [{ category, task }] }, randomUUID());
    const credential = await app.issueSupplierCredential(actor, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
    const principal = await app.runtimePrincipal(credential.token);
    await app.heartbeat(principal, { runtimeName: 'Reference', runtimeVersion: '1' });
    const agent = async () => (await app.marketplace.agents(actor)).find(a => a.id === agentId);
    const start = async rubric => { const a = await agent(); return app.startQualification(actor, agentId, { expectedVersion: a.version, capabilityId: a.capabilities[0].id, rubric }, randomUUID()); };
    return { agentId, principal, agent, start };
  }
  const propose = (actor, extra = {}) => app.proposeRelayTest(actor, { ...PROPOSAL, ...extra }, randomUUID());
  const review = async (actor, testId, decision, reason) => {
    const item = await repository.read(repo => repo.get('relay_test', testId));
    return app.reviewRelayTest(actor, testId, { expectedVersion: item.version, decision, reason }, randomUUID());
  };
  // A correct answer, built from the job alone the way a real runtime would.
  const solve = job => job.round === 1
    ? job.input.replace('acme incorporated', 'Acme Inc').replace('northwind limited', 'Northwind Ltd').replace('Blue gmbh', 'Blue GmbH')
    : job.input.replace('acme incorporated', 'Acme Inc').replace('northwind limited', 'Northwind Ltd').replace('Blue gmbh', 'Blue GmbH').split('\n').filter(Boolean).sort().join('\n');
  return { app, repository, author, other, staff, buyer, builder, propose, review, solve, advance: ms => time += ms };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: a proposed test waits for Relay staff, then qualifies agents in its category`, async t => {
    const f = await fixture(t, adapter);
    const ana = await f.builder(f.author), ben = await f.builder(f.other);
    const { testId } = await f.propose(f.author);
    const rubric = `relay-test:${testId}`;

    // Waiting for review: nobody can take it, and other builders don't see it.
    await assert.rejects(ben.start(rubric), { code: 'RUBRIC_UNAVAILABLE' });
    assert.equal((await f.app.relayTests(f.other)).approved.length, 0);
    assert.equal((await f.app.relayTests(f.author)).mine[0].status, 'in_review');

    // Only staff review; reviewers can't see the queue otherwise.
    await assert.rejects(f.app.relayTestQueue(f.author), { code: 'FORBIDDEN' });
    await assert.rejects(f.app.reviewRelayTest(f.author, testId, { expectedVersion: 1, decision: 'approve', reason: null }, randomUUID()), { code: 'FORBIDDEN' });
    assert.equal((await f.app.relayTests(f.staff)).canReview, true);
    assert.equal((await f.app.relayTests(f.author)).canReview, false);
    await f.review(f.staff, testId, 'approve', null);

    // Other builders see the approved test without its answers.
    const listed = (await f.app.relayTests(f.other)).approved[0];
    assert.equal(listed.rubric, rubric);
    assert.equal(listed.authorName, 'Ana Author');
    assert.ok(!('expected' in listed) && !('revisionExpected' in listed) && !('input' in listed));

    // Ben's agent takes it: a fresh nonce per run, two rounds, then qualified.
    const run = await ben.start(rubric);
    const job = (await f.app.qualificationJobs(ben.principal))[0];
    assert.equal(job.answer, 'output');
    assert.ok(!job.input.includes('{{nonce}}'), 'the nonce is filled in');
    assert.equal(job.brief, PROPOSAL.brief);
    assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: f.solve(job) + '  \r\n' }, randomUUID())).status, 'revision_pending', 'line comparison ignores trailing spaces and line endings');
    const second = (await f.app.qualificationJobs(ben.principal))[0];
    assert.equal(second.revision, PROPOSAL.revision);
    assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 2, output: f.solve(second) }, randomUUID())).status, 'passed');
    const cap = (await ben.agent()).capabilities[0];
    assert.equal(cap.qualification, 'qualified');
    assert.equal(cap.assessment.title, PROPOSAL.title);
    assert.equal(cap.assessment.limitation, PROPOSAL.limitation);
    assert.deepEqual(cap.assessment.proposed, { authorName: 'Ana Author', byThisBuilder: false });
    assert.ok(cap.assessment.submissions.every(s => !('output' in s) && !('sha256' in s)), 'submitted answers stay private, hashes too (the input is public, so a hash could be checked offline)');
    assert.ok(!('authorId' in listed));
    assert.ok(!JSON.stringify(await ben.agent()).includes('"expected"'));

    // The author can take their own test; it says so.
    const own = await ana.start(rubric);
    const ownJob = (await f.app.qualificationJobs(ana.principal))[0];
    assert.notEqual(ownJob.input, job.input, 'every run gets a new nonce');
    await f.app.submitQualification(ana.principal, own.assessmentId, { round: 1, output: f.solve(ownJob) }, randomUUID());
    await f.app.submitQualification(ana.principal, own.assessmentId, { round: 2, output: f.solve((await f.app.qualificationJobs(ana.principal))[0]) }, randomUUID());
    assert.equal((await ana.agent()).capabilities[0].assessment.proposed.byThisBuilder, true);

    // Retiring stops new runs; the passes already earned still stand.
    await assert.rejects(f.review(f.staff, testId, 'retire', ''), { code: 'REASON_REQUIRED' });
    await f.review(f.staff, testId, 'retire', 'Suffix list is too short to tell agents apart.');
    await assert.rejects(ben.start(rubric), { code: 'RUBRIC_UNAVAILABLE' });
    assert.equal((await ben.agent()).capabilities[0].qualification, 'qualified');
    assert.equal((await ben.agent()).capabilities[0].assessment.title, PROPOSAL.title, 'evidence is frozen at run time');
    const history = (await f.app.relayTests(f.author)).mine[0].history;
    assert.deepEqual(history.map(h => h.action), ['proposed', 'approved', 'retired']);
    assert.deepEqual(history.map(h => h.by), ['Ana Author', 'Relay staff', 'Relay staff'], 'reviewer names stay private');
    assert.ok((await f.app.relayTests(f.author)).mine[0].approvedAt, 'retiring keeps the approval date');
  });
}

test('proposals are data with a nonce, a real change and an output that differs from the input', async t => {
  const f = await fixture(t);
  await assert.rejects(f.propose(f.author), { code: 'BUILDER_REQUIRED' }, 'only builders propose tests');
  await f.builder(f.author);
  await assert.rejects(f.propose(f.author, { input: 'acme\n' }), { code: 'NONCE_REQUIRED' });
  await assert.rejects(f.propose(f.author, { expected: 'Acme Inc\n' }), { code: 'NONCE_REQUIRED' });
  await assert.rejects(f.propose(f.author, { revisionExpected: PROPOSAL.expected + '\n\n' }), { code: 'INVALID_INPUT' }, 'the change has to change the output');
  await assert.rejects(f.propose(f.author, { expected: PROPOSAL.input }), { code: 'INVALID_INPUT' }, 'echoing the input cannot pass');
  await assert.rejects(f.propose(f.author, { categoryId: 'other' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.propose(f.author, { comparison: 'regex' }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.propose(f.author, { script: 'return true' }), { code: 'INVALID_FIELDS' }, 'no code');
  for (let i = 0; i < 3; i++) await f.propose(f.author, { title: `Test ${i}` });
  await assert.rejects(f.propose(f.author, { title: 'One more' }), { code: 'REVIEW_LIMIT' });
});

test('rejection needs a reason, staff can’t approve their own test, and authors can withdraw', async t => {
  const f = await fixture(t);
  await f.builder(f.author); await f.builder(f.staff);
  const { testId } = await f.propose(f.author);
  await assert.rejects(f.review(f.staff, testId, 'reject', 'no'), { code: 'INVALID_INPUT' });
  await assert.rejects(f.review(f.staff, testId, 'reject'), { code: 'REASON_REQUIRED' });
  await f.review(f.staff, testId, 'reject', 'The expected output keeps a lowercase vendor name; fix and resubmit.');
  const rejected = (await f.app.relayTests(f.author)).mine[0];
  assert.equal(rejected.status, 'rejected');
  assert.match(rejected.reason, /lowercase/);
  await assert.rejects(f.review(f.staff, testId, 'approve'), { code: 'TEST_STATE' });

  const staffOwn = await f.propose(f.staff);
  await assert.rejects(f.review(f.staff, staffOwn.testId, 'approve'), { code: 'SELF_REVIEW' });

  const second = await f.propose(f.author, { title: 'Second try' });
  await assert.rejects(f.app.withdrawRelayTest(f.other, second.testId, { expectedVersion: 1 }, randomUUID()), { code: 'NOT_FOUND' });
  assert.equal((await f.app.withdrawRelayTest(f.author, second.testId, { expectedVersion: 1 }, randomUUID())).status, 'withdrawn');
  assert.equal((await f.app.relayTestQueue(f.staff)).waiting.filter(x => x.id === second.testId).length, 0);
});

test('a test only qualifies its category, wrong answers fail, and attempts are limited per day', async t => {
  const f = await fixture(t);
  await f.builder(f.author);
  const { testId } = await f.propose(f.author);
  await f.review(f.staff, testId, 'approve');
  const rubric = `relay-test:${testId}`;
  const leads = await f.builder(f.other, 'Leads', 'Build prospect lead lists');
  await assert.rejects(leads.start(rubric), { code: 'CATEGORY_MISMATCH' });

  const ben = await f.builder(f.other);
  for (let i = 0; i < 3; i++) {
    const run = await ben.start(rubric);
    const job = (await f.app.qualificationJobs(ben.principal))[0];
    const wrong = job.input.replace(/[^\n]*\{?[0-9a-f]{8}[^\n]*/, 'Northwind Ltd 00000000');
    const result = await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: wrong }, randomUUID());
    assert.equal(result.status, 'failed');
    assert.equal(result.checks[0].passed, false);
  }
  await assert.rejects(ben.start(rubric), { code: 'ATTEMPT_LIMIT' });
  f.advance(86400001);
  await f.app.heartbeat(ben.principal, { runtimeName: 'Reference', runtimeVersion: '1' });
  await ben.start(rubric);
});

test('relay tests are off where supplier connections are off', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const actor = { user: { id: randomUUID(), name: 'A' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  const app = createApplication({ repository: createSqliteRepository(db), resolveOperator: async () => actor });
  await assert.rejects(app.relayTests(actor), { code: 'LOCAL_ONLY' });
  await assert.rejects(app.proposeRelayTest(actor, PROPOSAL, randomUUID()), { code: 'LOCAL_ONLY' });
});

test('a reviewer can’t approve a test they proposed for an organization', async t => {
  const f = await fixture(t);
  const orgId = randomUUID();
  const asOrg = { user: { id: orgId, name: 'Staff Co' }, memberships: [], organization: true, onBehalfOf: { id: f.staff.user.id, name: 'Sam Staff', role: 'owner' } };
  await f.repository.transaction('org-agent', repo => repo.save('agent', { id: randomUUID(), ownerId: orgId, name: 'Org agent', capabilities: [], version: 1 }));
  const { testId } = await f.app.proposeRelayTest(asOrg, PROPOSAL, randomUUID());
  await assert.rejects(f.review(f.staff, testId, 'approve'), { code: 'SELF_REVIEW' });
});

test('inputs and answers are kept byte for byte, so exact tests and whitespace tests work', async t => {
  const f = await fixture(t);
  await f.builder(f.author);
  const exact = { ...PROPOSAL, comparison: 'exact', input: '  acme {{nonce}}  \n', expected: 'Acme {{nonce}}\n', revisionExpected: 'ACME {{nonce}}\n' };
  const { testId } = await f.propose(f.author, exact);
  await f.review(f.staff, testId, 'approve');
  const mine = (await f.app.relayTests(f.author)).mine[0];
  assert.equal(mine.input, exact.input);
  assert.equal(mine.expected, exact.expected);
  const ben = await f.builder(f.other);
  const run = await ben.start(`relay-test:${testId}`);
  const job = (await f.app.qualificationJobs(ben.principal))[0];
  assert.match(job.input, /^  acme [0-9a-f]{8}  \n$/);
  const nonce = job.input.trim().split(' ')[1];
  assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: `Acme ${nonce}\n` }, randomUUID())).status, 'revision_pending');
});
