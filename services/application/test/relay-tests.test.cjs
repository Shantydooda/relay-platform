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

const CASE = {
  input: 'acme incorporated\nnorthwind limited {{nonce}}\nBlue gmbh\n',
  expected: 'Acme Inc\nNorthwind Ltd {{nonce}}\nBlue GmbH\n',
  revision: 'Sort the vendors alphabetically.',
  revisionExpected: 'Acme Inc\nBlue GmbH\nNorthwind Ltd {{nonce}}\n',
};
const PROPOSAL = {
  title: 'Vendor name standardisation',
  categoryId: 'master-data',
  brief: 'Return the vendor list with legal suffixes standardised (Inc, Ltd, GmbH) and one vendor per line, in the order given.',
  limitation: 'Checks suffix standardisation on a short synthetic list only. Not matching, enrichment or tax-ID checks.',
  comparison: 'lines',
  cases: [CASE],
};
// A second case for the same brief: its own input, answers and change request.
const CASE_TWO = {
  input: 'zenith limited\norbit incorporated {{nonce}}\n',
  expected: 'Zenith Ltd\nOrbit Inc {{nonce}}\n',
  revision: 'Put the vendors in reverse order.',
  revisionExpected: 'Orbit Inc {{nonce}}\nZenith Ltd\n',
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
  const propose = (actor, extra = {}, caseExtra = {}) => app.proposeRelayTest(actor, { ...PROPOSAL, cases: [{ ...CASE, ...caseExtra }], ...extra }, randomUUID());
  const review = async (actor, testId, decision, reason) => {
    const item = await repository.read(repo => repo.get('relay_test', testId));
    return app.reviewRelayTest(actor, testId, { expectedVersion: item.version, decision, reason }, randomUUID());
  };
  // A correct answer, built from the job alone the way a real runtime would.
  const standardise = input => input.replace(/(\w+) incorporated/g, (_, n) => `${n[0].toUpperCase()}${n.slice(1)} Inc`).replace(/(\w+) limited/g, (_, n) => `${n[0].toUpperCase()}${n.slice(1)} Ltd`).replace('Blue gmbh', 'Blue GmbH');
  const revise = (output, revision) => {
    const lines = output.split('\n').filter(Boolean);
    return (/reverse/.test(revision) ? lines.reverse() : lines.sort()).join('\n');
  };
  const solveCase = (item, round) => round === 1 ? standardise(item.input) : revise(standardise(item.input), item.revision);
  const solve = job => solveCase(job.cases[0], job.round);
  const solveAll = job => job.cases.map(item => solveCase(item, job.round));
  return { app, repository, author, other, staff, buyer, builder, propose, review, solve, solveAll, advance: ms => time += ms };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: a proposed test waits for Relay staff, then qualifies agents in its category`, async t => {
    const f = await fixture(t, adapter);
    const ana = await f.builder(f.author), ben = await f.builder(f.other);
    const { testId } = await f.propose(f.author);
    const rubric = `relay-test:${testId}`;

    // Waiting for review: nobody can take it, and other builders don't see it.
    await assert.rejects(ben.start(rubric), { code: 'RUBRIC_UNAVAILABLE' });
    assert.equal((await f.app.relayTests(f.other)).approved.filter(x => !x.builtIn).length, 0);
    assert.equal((await f.app.relayTests(f.author)).mine[0].status, 'in_review');

    // Only staff review; reviewers can't see the queue otherwise.
    await assert.rejects(f.app.relayTestQueue(f.author), { code: 'FORBIDDEN' });
    await assert.rejects(f.app.reviewRelayTest(f.author, testId, { expectedVersion: 1, decision: 'approve', reason: null }, randomUUID()), { code: 'FORBIDDEN' });
    assert.equal((await f.app.relayTests(f.staff)).canReview, true);
    assert.equal((await f.app.relayTests(f.author)).canReview, false);
    await f.review(f.staff, testId, 'approve', null);

    // Other builders see the approved test without its answers.
    const listed = (await f.app.relayTests(f.other)).approved.find(x => x.id === testId);
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
    assert.equal(second.revision, CASE.revision);
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
  await assert.rejects(f.propose(f.author, {}, { input: 'acme\n' }), { code: 'NONCE_REQUIRED' });
  await assert.rejects(f.propose(f.author, {}, { expected: 'Acme Inc\n' }), { code: 'NONCE_REQUIRED' });
  await assert.rejects(f.propose(f.author, {}, { revisionExpected: CASE.expected + '\n\n' }), { code: 'INVALID_INPUT' }, 'the change has to change the output');
  await assert.rejects(f.propose(f.author, {}, { expected: CASE.input }), { code: 'INVALID_INPUT' }, 'echoing the input cannot pass');
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

test('a test only qualifies its category, wrong answers fail, and attempts are limited per builder per day', async t => {
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
  // A second agent from the same builder doesn't get three fresh tries.
  const benTwo = await f.builder(f.other);
  await assert.rejects(benTwo.start(rubric), { code: 'ATTEMPT_LIMIT' });
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
  const exact = { ...PROPOSAL, comparison: 'exact', cases: [{ ...CASE, input: '  acme {{nonce}}  \n', expected: 'Acme {{nonce}}\n', revisionExpected: 'ACME {{nonce}}\n' }] };
  const { testId } = await f.propose(f.author, exact);
  await f.review(f.staff, testId, 'approve');
  const mine = (await f.app.relayTests(f.author)).mine[0];
  assert.equal(mine.cases[0].input, exact.cases[0].input);
  assert.equal(mine.cases[0].expected, exact.cases[0].expected);
  const ben = await f.builder(f.other);
  const run = await ben.start(`relay-test:${testId}`);
  const job = (await f.app.qualificationJobs(ben.principal))[0];
  assert.match(job.input, /^  acme [0-9a-f]{8}  \n$/);
  const nonce = job.input.trim().split(' ')[1];
  assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: `Acme ${nonce}\n` }, randomUUID())).status, 'revision_pending');
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: a test with several cases passes only when every case passes, with a nonce per case`, async t => {
    const f = await fixture(t, adapter);
    await f.builder(f.author);
    const { testId } = await f.propose(f.author, { cases: [CASE, CASE_TWO] });
    await f.review(f.staff, testId, 'approve');
    assert.equal((await f.app.relayTests(f.other)).approved.find(x => x.id === testId).caseCount, 2);
    const rubric = `relay-test:${testId}`;
    const ben = await f.builder(f.other);

    // Both cases right, both rounds: passed.
    const run = await ben.start(rubric);
    const job = (await f.app.qualificationJobs(ben.principal))[0];
    assert.equal(job.answer, 'outputs');
    assert.equal(job.cases.length, 2);
    assert.ok(job.cases.every(item => !item.input.includes('{{nonce}}') && item.revision === null));
    const nonces = job.cases.map(item => item.input.match(/[0-9a-f]{8}/)[0]);
    assert.notEqual(nonces[0], nonces[1], 'each case gets its own nonce');
    await assert.rejects(f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: f.solve(job) }, randomUUID()), { code: 'INVALID_FIELDS' });
    await assert.rejects(f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, outputs: [f.solve(job)] }, randomUUID()), { code: 'INVALID_INPUT' }, 'every case needs an answer');
    const first = await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, outputs: f.solveAll(job) }, randomUUID());
    assert.equal(first.status, 'revision_pending');
    assert.deepEqual(first.checks.map(c => c.name), ['Case 1: output matches the expected result', 'Case 2: output matches the expected result']);
    const second = (await f.app.qualificationJobs(ben.principal))[0];
    assert.deepEqual(second.cases.map(item => item.revision), [CASE.revision, CASE_TWO.revision], 'each case has its own change request');
    assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 2, outputs: f.solveAll(second) }, randomUUID())).status, 'passed');
    const evidence = (await ben.agent()).capabilities[0].assessment;
    assert.equal(evidence.cases.length, 2);
    assert.ok(evidence.submissions.every(s => !('outputs' in s) && !('sha256' in s)), 'answers to every case stay private');

    // One case wrong fails the whole test.
    const again = await ben.start(rubric);
    const job2 = (await f.app.qualificationJobs(ben.principal))[0];
    const answers = f.solveAll(job2);
    answers[1] = answers[1].replace('Zenith Ltd', 'Zenith Limited');
    const failed = await f.app.submitQualification(ben.principal, again.assessmentId, { round: 1, outputs: answers }, randomUUID());
    assert.equal(failed.status, 'failed');
    assert.deepEqual(failed.checks.map(c => c.passed), [true, false]);
  });
}

test('cases are checked one by one: 1 to 5, each with its nonce and a real change, and no repeats', async t => {
  const f = await fixture(t);
  await f.builder(f.author);
  await assert.rejects(f.propose(f.author, { cases: [] }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.propose(f.author, { cases: Array.from({ length: 6 }, (_, i) => ({ ...CASE, input: `${CASE.input}${i}` })) }), { code: 'INVALID_INPUT' });
  await assert.rejects(f.propose(f.author, { cases: [CASE, { ...CASE_TWO, expected: 'Zenith Ltd\n' }] }), err => err.code === 'NONCE_REQUIRED' && /case 2/.test(err.message));
  await assert.rejects(f.propose(f.author, { cases: [CASE, { ...CASE_TWO, revisionExpected: CASE_TWO.expected }] }), err => err.code === 'INVALID_INPUT' && /case 2/.test(err.message));
  await assert.rejects(f.propose(f.author, { cases: [CASE, { ...CASE }] }), { code: 'INVALID_INPUT' }, 'a repeated case tests nothing new');
  await assert.rejects(f.propose(f.author, { cases: [CASE, { ...CASE_TWO, script: 'x' }] }), { code: 'INVALID_FIELDS' }, 'still no code');
  await assert.rejects(f.propose(f.author, { input: CASE.input }), { code: 'INVALID_FIELDS' }, 'answers live in cases');
  const { testId } = await f.propose(f.author, { cases: [CASE, CASE_TWO] });
  const mine = (await f.app.relayTests(f.author)).mine.find(x => x.id === testId);
  assert.deepEqual(mine.cases, [CASE, CASE_TWO], 'the author sees every case and answer');
});

test('a test proposed before cases existed still runs as one case', async t => {
  const f = await fixture(t);
  const id = randomUUID();
  await f.repository.transaction('legacy-test', repo => repo.save('relay_test', { id, ownerId: f.author.user.id, authorId: f.author.user.id, proposedBy: f.author.user.id, authorName: 'Ana Author', status: 'approved',
    title: PROPOSAL.title, categoryId: PROPOSAL.categoryId, brief: PROPOSAL.brief, limitation: PROPOSAL.limitation, comparison: 'lines', ...CASE, createdAt: 1, approvedAt: 1, version: 2, history: [] }));
  assert.equal((await f.app.relayTests(f.other)).approved.find(x => x.id === id).caseCount, 1);
  const ben = await f.builder(f.other);
  const run = await ben.start(`relay-test:${id}`);
  const job = (await f.app.qualificationJobs(ben.principal))[0];
  assert.equal(job.answer, 'output');
  await f.app.submitQualification(ben.principal, run.assessmentId, { round: 1, output: f.solve(job) }, randomUUID());
  assert.equal((await f.app.submitQualification(ben.principal, run.assessmentId, { round: 2, output: f.solve((await f.app.qualificationJobs(ben.principal))[0]) }, randomUUID())).status, 'passed');
});

// Reference solvers for Relay's own tests, written from each brief alone. If a
// seed's expected answer disagrees with its brief, these fail.
const SEED_SOLVERS = {
  'Company list deduplication': (input, revision) => {
    const key = name => name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ (inc|llc|ltd|gmbh|corp)$/, '');
    const seen = new Map();
    for (const line of input.split('\n').filter(Boolean)) if (!seen.has(key(line))) seen.set(key(line), line);
    const rows = [...seen.values()];
    if (/alphabetically/.test(revision || '')) rows.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    if (/reverse/.test(revision || '')) rows.reverse();
    return rows.join('\n') + '\n';
  },
  'Job title seniority': (input, revision) => {
    const level = title => /^chief .* officer$|^c[efotmr]o$/i.test(title) ? 'C-level' : /vice president|\b[se]?vp\b/i.test(title) ? 'VP'
      : /director|head of/i.test(title) ? 'Director' : /manager|\blead\b/i.test(title) ? 'Manager' : 'Individual contributor';
    let rows = input.trim().split('\n').slice(1).map(line => { const [id, title] = line.split(','); return { id, title, seniority: level(title) }; });
    if (/Director level and above/.test(revision || '')) rows = rows.filter(r => ['C-level', 'VP', 'Director'].includes(r.seniority));
    if (/Drop the title/.test(revision || '')) return ['id,seniority', ...rows.map(r => `${r.id},${r.seniority}`)].join('\n') + '\n';
    return ['id,title,seniority', ...rows.map(r => `${r.id},${r.title},${r.seniority}`)].join('\n') + '\n';
  },
  'Country codes from country names': (input, revision) => {
    const codes = { 'united states': ['US', 'USA'], uk: ['GB', 'GBR'], deutschland: ['DE', 'DEU'], 'the netherlands': ['NL', 'NLD'], "côte d'ivoire": ['CI', 'CIV'],
      japan: ['JP', 'JPN'], 'south korea': ['KR', 'KOR'], 'españa': ['ES', 'ESP'], 'u.a.e.': ['AE', 'ARE'], brasil: ['BR', 'BRA'] };
    const three = /alpha-3/.test(revision || '');
    const rows = input.trim().split('\n').slice(1).map(line => { const [id, country] = line.split(','); return { id, country, code: codes[country.toLowerCase()][three ? 1 : 0] }; });
    if (/Sort the rows/.test(revision || '')) rows.sort((a, b) => a.code.localeCompare(b.code));
    return [`id,country,${three ? 'iso3' : 'iso2'}`, ...rows.map(r => `${r.id},${r.country},${r.code}`)].join('\n') + '\n';
  },
  'Domains from URLs and emails': (input, revision) => {
    const host = line => line.replace(/^mailto:/i, '').replace(/^.*@/, '').replace(/^https?:\/\//i, '').replace(/[:/?].*$/, '').toLowerCase().replace(/^www\./, '');
    const registrable = name => name.split('.').slice(/\.co\.uk$/.test(name) ? -3 : -2).join('.');
    let hosts = [...new Set(input.split('\n').filter(Boolean).map(host))];
    if (/registrable/.test(revision || '')) hosts = [...new Set(hosts.map(registrable))];
    if (/alphabetically/.test(revision || '')) hosts.sort();
    return hosts.join('\n') + '\n';
  },
};

test('Relay’s own B2B data tests are listed for everyone, can’t be reviewed, and qualify agents that solve every case', async t => {
  const f = await fixture(t);
  const listed = (await f.app.relayTests(f.other)).approved.filter(x => x.builtIn);
  assert.deepEqual(listed.map(x => x.categoryId).sort(), ['data-cleanup', 'data-enrichment', 'lead-lists', 'web-extraction']);
  assert.ok(listed.every(x => x.authorName === 'Relay' && x.caseCount === 2 && x.status === 'approved'));
  assert.ok(!JSON.stringify(listed).includes('"expected"'), 'answers stay hidden for Relay’s tests too');
  assert.equal((await f.app.relayTestQueue(f.staff)).waiting.length, 0, 'never in the review queue');
  await assert.rejects(f.app.reviewRelayTest(f.staff, listed[0].id, { expectedVersion: 1, decision: 'retire', reason: 'Not something staff change here.' }, randomUUID()), { code: 'BUILT_IN' });

  const categories = { 'data-cleanup': ['Data cleanup', 'Deduplicate company lists'], 'lead-lists': ['Leads', 'Build prospect lead lists'],
    'data-enrichment': ['Data enrichment', 'Enrich and append firmographic data'], 'web-extraction': ['Web data', 'Scrape and extract web data'] };
  for (const seed of listed) {
    const ben = await f.builder(f.other, ...categories[seed.categoryId]);
    assert.equal((await ben.agent()).capabilities[0].categoryId, seed.categoryId, `capability classified as ${seed.categoryId}`);
    const run = await ben.start(seed.rubric);
    const solver = SEED_SOLVERS[seed.title];
    for (const round of [1, 2]) {
      const job = (await f.app.qualificationJobs(ben.principal)).find(item => item.id === run.assessmentId);
      const result = await f.app.submitQualification(ben.principal, run.assessmentId, { round, outputs: job.cases.map(item => solver(item.input, item.revision)) }, randomUUID());
      assert.ok(result.checks.every(c => c.passed), `${seed.title}, round ${round}: ${JSON.stringify(result.checks)}`);
    }
    const cap = (await ben.agent()).capabilities[0];
    assert.equal(cap.qualification, 'qualified');
    assert.equal(cap.assessment.proposed, null, 'Relay wrote it, not a builder');
    assert.equal(cap.assessment.private, true);
  }
});
