'use strict';
// Open evaluation suites (evaluations.cjs): fixed public inputs, hidden answers,
// automatic field checks, a count tied to the suite and runtime version.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const SUITES = require('../src/eval-suites.json');

const RESEARCH = 'company-research-fields@1', LEADS = 'lead-list-fields@1';
const answersFor = suiteKey => SUITES.find(s => `${s.id}@${s.version}` === suiteKey).items.map(item => ({ ...item.expected }));

async function fixture(t, adapter = 'sqlite') {
  const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
  const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });
  const ana = person('Ana Builder'), ben = person('Ben Buyer');
  let time = Date.parse('2026-11-22T10:00:00Z');
  const app = createApplication({ repository, localExecution: true, now: () => time, resolveOperator: async id => [ana, ben].find(a => a.user.id === id) });
  async function agent(actor = ana, capability = { category: 'Company research', task: 'Research company profiles and market data' }, runtimeVersion = '1') {
    const { agentId } = await app.marketplace.addAgent(actor, { name: 'Research agent', kind: 'general', purpose: 'Company research', integration: 'api', capabilities: [capability] }, randomUUID());
    const credential = await app.issueSupplierCredential(actor, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
    const principal = await app.runtimePrincipal(credential.token);
    await app.heartbeat(principal, { runtimeName: 'Reference', runtimeVersion });
    const view = async () => (await app.marketplace.agents(actor)).find(a => a.id === agentId);
    const start = async suite => app.startEvaluation(actor, agentId, { expectedVersion: (await view()).version, suite }, randomUUID());
    return { agentId, principal, view, start };
  }
  return { app, repository, ana, ben, agent, advance: ms => time += ms };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: a runtime answers a suite once and gets a field count tied to its runtime version`, async t => {
    const f = await fixture(t, adapter);
    const a = await f.agent();
    const { evaluationId } = await a.start(RESEARCH);
    const [job] = await f.app.evaluationJobs(a.principal);
    assert.equal(job.id, evaluationId);
    assert.deepEqual(job.fields, ['company', 'country', 'founded', 'headcount', 'domain']);
    assert.equal(job.items.length, 5);
    assert.ok(!JSON.stringify(job).includes('expected'), 'answers never go to the runtime');

    // Case, spacing and a trailing full stop don't count; one wrong value does.
    const answers = answersFor(RESEARCH);
    answers[0].company = '  halcyon   FREIGHT. ';
    answers[1].headcount = '51-200';
    const result = await f.app.submitEvaluation(a.principal, evaluationId, { answers }, randomUUID());
    assert.deepEqual(result.score, { correct: 24, total: 25, items: 5 });
    assert.deepEqual(await f.app.evaluationJobs(a.principal), [], 'answered once');
    await assert.rejects(f.app.submitEvaluation(a.principal, evaluationId, { answers }, randomUUID()), { code: 'EVALUATION_CLOSED' });

    // The score is public evidence on the agent, with its sample; which fields were wrong is not.
    const own = await f.app.agentEvaluations(f.ana, a.agentId);
    assert.equal(own.runs[0].status, 'scored');
    assert.deepEqual(own.evidence.map(e => [e.title, e.correct, e.total, e.items, e.runtimeVersion, e.source]), [['Company research fields', 24, 25, 5, '1', 'relay-evaluation']]);
    assert.ok(!JSON.stringify(own).includes('headcount'), 'no per-field results');

    // A new runtime version starts with no score: results belong to the version that earned them.
    await f.app.heartbeat(a.principal, { runtimeName: 'Reference', runtimeVersion: '2' });
    assert.deepEqual((await f.app.agentEvaluations(f.ana, a.agentId)).evidence, []);
  });
}

test('buyers see a published agent’s score on browse, and it isn’t counted as buyer work', async t => {
  const f = await fixture(t);
  const { passRelayTest } = require('./helpers/relay-test.cjs');
  const { agentId } = await f.app.marketplace.addAgent(f.ana, { name: 'Research agent', kind: 'general', purpose: 'Company research', integration: 'api',
    capabilities: [{ category: 'Spreadsheets', task: 'Normalize CSV files' }, { category: 'Company research', task: 'Research company profiles and market data' }] }, randomUUID());
  const credential = await f.app.issueSupplierCredential(f.ana, agentId, { expectedVersion: 1, expiresInSeconds: 2592000 }, randomUUID());
  const principal = await f.app.runtimePrincipal(credential.token);
  await f.app.heartbeat(principal, { runtimeName: 'Reference', runtimeVersion: '1' });
  const passed = await passRelayTest(f.app, f.ana, agentId, principal);
  await f.app.marketplace.updateListing(f.ana, agentId, { status: 'published', expectedVersion: passed.version }, randomUUID());
  const rowBefore = (await f.app.marketplace.browse(f.ben, {})).agents.find(r => r.id === agentId);
  assert.deepEqual(rowBefore.evaluations, [], 'no score until a run is answered');
  const version = (await f.app.marketplace.agents(f.ana)).find(a => a.id === agentId).version;
  const { evaluationId } = await f.app.startEvaluation(f.ana, agentId, { expectedVersion: version, suite: RESEARCH }, randomUUID());
  await f.app.submitEvaluation(principal, evaluationId, { answers: answersFor(RESEARCH) }, randomUUID());
  const row = (await f.app.marketplace.browse(f.ben, {})).agents.find(r => r.id === agentId);
  assert.deepEqual(row.evaluations.map(e => [e.suite, e.correct, e.total, e.items, e.source]), [[RESEARCH, 25, 25, 5, 'relay-evaluation']]);
  assert.equal(row.evidence.runs, 0, 'an evaluation is not a run of buyer work');
});

test('only the owner starts a run, on a connected agent with a capability in the suite’s category', async t => {
  const f = await fixture(t);
  const a = await f.agent();
  await assert.rejects(f.app.startEvaluation(f.ben, a.agentId, { expectedVersion: (await a.view()).version, suite: RESEARCH }, randomUUID()), err => [403, 404].includes(err.status));
  await assert.rejects(a.start('made-up@1'), { code: 'SUITE_UNAVAILABLE' });
  await assert.rejects(a.start(LEADS), { code: 'CATEGORY_MISMATCH' });
  await a.start(RESEARCH);
  await assert.rejects(a.start(RESEARCH), { code: 'EVALUATION_PENDING' });
  f.advance(3600001);
  assert.equal((await f.app.agentEvaluations(f.ana, a.agentId)).runs[0].status, 'expired');
  await assert.rejects(f.app.submitEvaluation(a.principal, (await f.app.agentEvaluations(f.ana, a.agentId)).runs[0].id, { answers: answersFor(RESEARCH) }, randomUUID()), { code: 'EVALUATION_CLOSED' });
  f.advance(200000);
  await assert.rejects(a.start(RESEARCH), { code: 'RUNTIME_REQUIRED' }, 'the runtime stopped checking in');
});

test('answers are checked for shape, and runs are limited per builder per suite per day', async t => {
  const f = await fixture(t);
  const a = await f.agent(f.ana, { category: 'Leads', task: 'Build prospect lead lists' });
  const { evaluationId } = await a.start(LEADS);
  const answers = answersFor(LEADS);
  await assert.rejects(f.app.submitEvaluation(a.principal, evaluationId, { answers: answers.slice(1) }, randomUUID()), { code: 'INVALID_INPUT' });
  await assert.rejects(f.app.submitEvaluation(a.principal, evaluationId, { answers: [{ ...answers[0], extra: 'x' }, ...answers.slice(1)] }, randomUUID()), { code: 'INVALID_FIELDS' });
  await assert.rejects(f.app.submitEvaluation(a.principal, evaluationId, { answers: [{ ...answers[0], email: 7 }, ...answers.slice(1)] }, randomUUID()), { code: 'INVALID_INPUT' });
  assert.deepEqual((await f.app.submitEvaluation(a.principal, evaluationId, { answers }, randomUUID())).score, { correct: 20, total: 20, items: 5 });
  for (let i = 0; i < 2; i++) {
    const run = await a.start(LEADS);
    await f.app.submitEvaluation(a.principal, run.evaluationId, { answers }, randomUUID());
  }
  await assert.rejects(a.start(LEADS), { code: 'ATTEMPT_LIMIT' });
  const second = await f.agent(f.ana, { category: 'Leads', task: 'Build prospect lead lists' });
  await assert.rejects(second.start(LEADS), { code: 'ATTEMPT_LIMIT' }, 'a second agent doesn’t buy more tries');
});

test('everyone signed in can read the suites: inputs and rules, never the answers', async t => {
  const f = await fixture(t);
  const { suites, limits } = await f.app.evaluationSuites(f.ben);
  assert.deepEqual(suites.map(s => [s.key, s.categoryId, s.items.length, s.checks]), [[RESEARCH, 'market-research', 5, 25], [LEADS, 'lead-lists', 5, 20]]);
  assert.ok(!JSON.stringify(suites).includes('expected'));
  assert.ok(!JSON.stringify(suites).includes('priya.natarajan@'), 'built answers stay hidden');
  assert.equal(limits.runsPerDay, 3);
});

test('evaluations are off where supplier connections are off', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const actor = { user: { id: randomUUID(), name: 'A' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  const app = createApplication({ repository: createSqliteRepository(db), resolveOperator: async () => actor });
  await assert.rejects(app.evaluationSuites(actor), { code: 'LOCAL_ONLY' });
});

test('every suite’s answers use exactly its fields, and headcount and seniority use the published bands', () => {
  const bands = { headcount: ['1-10', '11-50', '51-200', '201-1000', '1000+'], seniority: ['C-level', 'VP', 'Director', 'Manager', 'Individual contributor'] };
  for (const suite of SUITES) for (const item of suite.items) {
    assert.deepEqual(Object.keys(item.expected), suite.fields);
    for (const [field, allowed] of Object.entries(bands)) if (field in item.expected) assert.ok(allowed.includes(item.expected[field]), `${suite.id} ${item.id} ${field}`);
    assert.ok(suite.brief.length > 40 && suite.limitation.length > 40);
  }
});
