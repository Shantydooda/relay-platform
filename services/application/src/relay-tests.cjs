'use strict';
// Builder-proposed Relay tests (docs/Build-Order.md, step 8; Decisions-Needed.md §8).
//
// A builder writes a test as data, never code: a brief and 1–5 cases, each with
// an input, the expected output, a change request and the expected revised
// output. The agent passes only if every case passes both rounds. Relay staff
// approve or reject each proposal with a reason before any agent can take it.
// Once approved, a test is frozen: changing it means proposing a new one.
// Relay ships a few tests of its own as data too (relay-test-seeds.json).
//
// Why the rules below:
// - `{{nonce}}` must appear in every case's input and both expected outputs.
//   Relay swaps in a fresh value per case on each run, so an earlier answer
//   can't be replayed.
// - Expected outputs are never shown to anyone except the author and staff, and
//   submitted outputs never appear in public evidence, so passing answers don't
//   leak to other builders.
// - The author may use their own test, but every card says so (exam writers are
//   normally barred from their own exam; here it's disclosed instead, and staff
//   review the test with that in mind). A reviewer can't approve their own test.
// - A test covers one task category and only qualifies capabilities in it.
// - Three attempts per builder per test per day, across all their agents, so a
//   test can't be brute-forced by adding agents.

const { randomUUID } = require('node:crypto');
const { exactKeys, fail, text } = require('../../../packages/contracts/src/input.cjs');
const { taskById, categoryOf } = require('../../../packages/domain/src/categories.cjs');
const SEEDS = require('./relay-test-seeds.json');

const PREFIX = 'relay-test:';
const NONCE = '{{nonce}}';
const COMPARISONS = { exact: 'Exactly the same text', lines: 'Same lines, ignoring line endings and trailing spaces' };
const LIMITS = { inReview: 3, perAuthor: 20, attemptsPerDay: 3, listed: 100, cases: 5 };
const DAY = 86400000;

const isRelayTest = rubric => typeof rubric === 'string' && rubric.startsWith(PREFIX);
const testIdOf = rubric => rubric.slice(PREFIX.length);
const normalize = (value, comparison) => comparison === 'lines'
  ? value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '')
  : value;
const fill = (value, nonce) => value.split(NONCE).join(nonce);
// Tests proposed before cases existed hold their one case in top-level fields.
const casesOf = test => test.cases || [{ input: test.input, expected: test.expected, revision: test.revision, revisionExpected: test.revisionExpected }];

const raw = (value, label, max = 8192) => { text(value, label, 1, max); if (value.length > max) fail(400, 'INVALID_INPUT', `${label} is too long.`); return value; };
function caseInput(body, n, comparison) {
  const at = label => n ? `${label} (case ${n})` : label;
  exactKeys(body, ['input', 'expected', 'revision', 'revisionExpected']);
  // Inputs and answers are kept byte for byte (text() trims): whitespace can be what's tested.
  const value = {
    input: raw(body.input, at('Test input')),
    expected: raw(body.expected, at('Expected output')),
    revision: text(body.revision, at('Change request'), 5, 300),
    revisionExpected: raw(body.revisionExpected, at('Expected output after the change')),
  };
  for (const [field, label] of [['input', 'test input'], ['expected', 'expected output'], ['revisionExpected', 'expected output after the change']])
    if (!value[field].includes(NONCE)) fail(400, 'NONCE_REQUIRED', `Put ${NONCE} somewhere in the ${n ? `${label} of case ${n}` : label}. Relay replaces it with a new value on every run, so an old answer can’t be reused.`);
  const same = (a, b) => normalize(a, comparison) === normalize(b, comparison);
  if (same(value.expected, value.revisionExpected)) fail(400, 'INVALID_INPUT', `${at('The change request has to change the output, or it tests nothing')}.`);
  if (same(value.input, value.expected) || same(value.input, value.revisionExpected)) fail(400, 'INVALID_INPUT', `${at('The expected output can’t be the input unchanged: an agent that does nothing would pass')}.`);
  return value;
}
function proposalInput(body) {
  exactKeys(body, ['title', 'categoryId', 'brief', 'limitation', 'comparison', 'cases']);
  const value = {
    title: text(body.title, 'Title', 3, 80),
    categoryId: body.categoryId,
    brief: text(body.brief, 'Instructions for the agent', 20, 1000),
    limitation: text(body.limitation, 'What this test doesn’t check', 20, 400),
    comparison: body.comparison,
  };
  const task = typeof value.categoryId === 'string' && value.categoryId !== 'other' ? taskById(value.categoryId) : null;
  if (!task) fail(400, 'INVALID_INPUT', 'Choose the task category this test covers.');
  if (!Object.hasOwn(COMPARISONS, value.comparison)) fail(400, 'INVALID_INPUT', 'Choose how Relay compares the output.');
  if (!Array.isArray(body.cases) || body.cases.length < 1 || body.cases.length > LIMITS.cases) fail(400, 'INVALID_INPUT', `Give the test 1 to ${LIMITS.cases} cases.`);
  const numbered = body.cases.length > 1;
  value.cases = body.cases.map((item, i) => caseInput(item, numbered ? i + 1 : 0, value.comparison));
  if (new Set(value.cases.map(item => normalize(item.input, value.comparison))).size < value.cases.length) fail(400, 'INVALID_INPUT', 'Each case needs a different input, or the extra cases test nothing new.');
  return value;
}

// Relay's own tests, shipped as data and checked by the same rules at load.
// Approved from the start; they never enter the review queue.
const seeds = new Map(SEEDS.map(seed => {
  const { title, categoryId, brief, limitation, comparison, cases } = seed;
  proposalInput({ title, categoryId, brief, limitation, comparison, cases });
  return [seed.id, Object.freeze({ ...seed, status: 'approved', authorId: null, proposedBy: null, authorName: 'Relay', builtIn: true, version: 1, history: [] })];
}));

// What builders and buyers may see. Expected outputs stay with the author and staff.
function publicView(test) {
  const { id, title, categoryId, brief, limitation, comparison, status, authorName, createdAt } = test;
  const cases = casesOf(test);
  return { id, rubric: PREFIX + id, title, categoryId, category: taskById(categoryId)?.label || categoryId, brief, limitation, revision: cases[0].revision, caseCount: cases.length,
    comparison, status, authorName, builtIn: !!test.builtIn, createdAt, approvedAt: test.approvedAt || null };
}
function fullView(test) {
  return { ...publicView(test), cases: casesOf(test), reason: test.reason || null, decidedAt: test.decidedAt || null, reviewerName: test.reviewerName || null, version: test.version, history: test.history };
}

function createRelayTests(context) {
  const { repository, command, now, supplierConnections, relayTestReviewerIds = [] } = context;
  const reviewers = new Set(relayTestReviewerIds);
  const enabled = () => { if (!supplierConnections) fail(403, 'LOCAL_ONLY', 'Relay tests are not enabled in this environment.'); };
  const signedIn = actor => { if (!actor?.user?.id || actor.recoveryRequired) fail(401, 'UNAUTHENTICATED', 'Sign in first.'); };
  const isReviewer = actor => !!actor?.user?.id && !actor.recoveryRequired && reviewers.has(actor.user.id);
  const reviewer = actor => { if (!isReviewer(actor)) fail(403, 'FORBIDDEN', 'Only Relay staff review proposed tests.'); };
  const load = async (repo, id) => {
    if (seeds.has(id)) fail(409, 'BUILT_IN', 'This is one of Relay’s own tests. It changes with a Relay release, not here.');
    return (typeof id === 'string' && await repo.get('relay_test', id, true)) || fail(404, 'NOT_FOUND', 'Test not found.');
  };
  // Reviewers appear as "Relay staff"; their names stay private.
  const record = (test, action, actor, reason) => test.history.push({ action, by: ['proposed', 'withdrawn'].includes(action) ? test.authorName : 'Relay staff', at: now(), ...(reason ? { reason } : {}) });
  const approved = async repo => [...seeds.values(), ...await repo.list('relay_test', 'status', 'approved', LIMITS.listed)];

  async function relayTests(actor) {
    enabled(); signedIn(actor);
    return repository.read(async repo => ({
      approved: (await approved(repo)).map(publicView),
      mine: (await repo.list('relay_test', 'owner_id', actor.user.id, LIMITS.perAuthor + 5)).map(fullView).sort((a, b) => b.createdAt - a.createdAt),
      canReview: isReviewer(actor),
      comparisons: COMPARISONS,
      maxCases: LIMITS.cases,
    }));
  }

  async function proposeRelayTest(actor, body, key) {
    enabled(); signedIn(actor);
    const value = proposalInput(body);
    return command(actor.user.id, key, ['relay-test-propose', value], async () => signedIn(actor), async repo => {
      if (!(await repo.list('agent', 'owner_id', actor.user.id, 1)).length) fail(403, 'BUILDER_REQUIRED', 'Add an agent before proposing a Relay test.');
      const mine = await repo.list('relay_test', 'owner_id', actor.user.id, LIMITS.perAuthor + 1);
      if (mine.filter(item => item.status === 'in_review').length >= LIMITS.inReview) fail(409, 'REVIEW_LIMIT', `You can have ${LIMITS.inReview} tests waiting for review at once.`);
      if (mine.length >= LIMITS.perAuthor) fail(409, 'TEST_LIMIT', 'You’ve reached the limit of proposed tests.');
      // proposedBy is the person, even when they propose as an organization, so they can't review it.
      const test = { id: randomUUID(), ownerId: actor.user.id, authorId: actor.user.id, proposedBy: actor.onBehalfOf?.id || actor.user.id, authorName: actor.user.name || 'A builder', status: 'in_review', ...value, createdAt: now(), version: 1, history: [] };
      record(test, 'proposed', actor);
      await repo.save('relay_test', test);
      return { testId: test.id, status: test.status, version: test.version };
    });
  }

  async function withdrawRelayTest(actor, id, body, key) {
    enabled(); signedIn(actor);
    exactKeys(body, ['expectedVersion']);
    return command(actor.user.id, key, ['relay-test-withdraw', id, body], async () => signedIn(actor), async repo => {
      const test = await load(repo, id);
      if (test.authorId !== actor.user.id) fail(404, 'NOT_FOUND', 'Test not found.');
      if (test.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', 'This test changed. Refresh and try again.');
      if (test.status !== 'in_review') fail(409, 'TEST_STATE', 'Only a test waiting for review can be withdrawn.');
      Object.assign(test, { status: 'withdrawn', decidedAt: now(), version: test.version + 1 });
      record(test, 'withdrawn', actor);
      await repo.save('relay_test', test);
      return { testId: id, status: test.status, version: test.version };
    });
  }

  async function relayTestQueue(actor) {
    enabled(); reviewer(actor);
    return repository.read(async repo => ({
      waiting: (await repo.list('relay_test', 'status', 'in_review', LIMITS.listed)).map(fullView).sort((a, b) => a.createdAt - b.createdAt),
      approved: (await approved(repo)).map(fullView),
    }));
  }

  // approve: in review → approved. reject: in review → rejected (reason). retire:
  // approved → retired (reason); no new runs, passes already earned stand until they expire.
  async function reviewRelayTest(actor, id, body, key) {
    enabled(); reviewer(actor);
    exactKeys(body, ['expectedVersion', 'decision', 'reason']);
    const transitions = { approve: ['in_review', 'approved'], reject: ['in_review', 'rejected'], retire: ['approved', 'retired'] };
    if (!Object.hasOwn(transitions, body.decision)) fail(400, 'INVALID_INPUT', 'Choose approve, reject or retire.');
    const reason = body.reason == null || body.reason === '' ? null : text(body.reason, 'Reason', 10, 500);
    if (body.decision !== 'approve' && !reason) fail(400, 'REASON_REQUIRED', 'Give the builder a reason (at least 10 characters).');
    return command(actor.user.id, key, ['relay-test-review', id, body], async () => reviewer(actor), async repo => {
      const test = await load(repo, id);
      if (test.version !== body.expectedVersion) fail(409, 'VERSION_CONFLICT', 'This test changed. Refresh and try again.');
      const [from, to] = transitions[body.decision];
      if (test.status !== from) fail(409, 'TEST_STATE', `This test is ${test.status.replace('_', ' ')}.`);
      if (body.decision !== 'retire' && [test.authorId, test.proposedBy].includes(actor.user.id)) fail(409, 'SELF_REVIEW', 'Another reviewer has to decide on a test you wrote.');
      Object.assign(test, { status: to, reason, decidedAt: now(), ...(to === 'approved' ? { approvedAt: now() } : {}), reviewerName: 'Relay staff', version: test.version + 1 });
      record(test, to, actor, reason);
      await repo.save('relay_test', test);
      return { testId: id, status: test.status, version: test.version };
    });
  }

  return { relayTests, proposeRelayTest, withdrawRelayTest, relayTestQueue, reviewRelayTest };
}

// Qualification hooks (qualification.cjs) ------------------------------------

// Builds the assessment for one run of an approved test, or refuses. Each case
// gets its own nonce: the first is the run's, the others are fresh.
async function startRun(repo, { rubric, agent, capability, nonce, time }) {
  const id = testIdOf(rubric);
  // Locked so a start can't race a retire. A run already started may still finish.
  const test = seeds.get(id) || await repo.get('relay_test', id, true);
  if (!test || test.status !== 'approved') fail(400, 'RUBRIC_UNAVAILABLE', 'This Relay test isn’t available. It may have been retired.');
  if (categoryOf(capability) !== test.categoryId) fail(409, 'CATEGORY_MISMATCH', `This test covers ${taskById(test.categoryId)?.label || test.categoryId}. Choose a capability in that category, or a test that matches this one.`);
  const agents = [agent, ...(await repo.list('agent', 'owner_id', agent.ownerId)).filter(item => item.id !== agent.id)];
  const recent = agents.flatMap(item => item.assessments || []).filter(item => item.rubric === rubric && item.createdAt > time - DAY).length;
  if (recent >= LIMITS.attemptsPerDay) fail(429, 'ATTEMPT_LIMIT', `You can take this test ${LIMITS.attemptsPerDay} times a day, across all your agents. Try again tomorrow.`);
  const cases = casesOf(test).map((item, i) => ({ ...item, nonce: i ? randomUUID().slice(0, 8) : nonce }));
  return {
    input: fill(cases[0].input, cases[0].nonce),
    cases: cases.map(item => ({ input: fill(item.input, item.nonce), revision: item.revision })),
    expected: { initial: cases.map(item => fill(item.expected, item.nonce)), revision: cases.map(item => fill(item.revisionExpected, item.nonce)) },
    // Frozen on the evidence, so it still reads correctly if the test is retired later.
    relayTest: { id: test.id, title: test.title, categoryId: test.categoryId, limitation: test.limitation, brief: test.brief, revision: cases[0].revision, comparison: test.comparison, authorId: test.authorId, authorName: test.authorName, builtIn: !!test.builtIn },
  };
}
// Runs started before cases existed hold one input and string answers.
const runCases = run => run.cases || [{ input: run.input, revision: run.relayTest.revision }];
const isMulti = run => runCases(run).length > 1;
function jobFields(run) {
  const revising = run.status === 'revision_pending';
  return { brief: run.relayTest.brief, revision: revising ? run.relayTest.revision : null, answer: isMulti(run) ? 'outputs' : 'output',
    cases: runCases(run).map(item => ({ input: item.input, revision: revising ? item.revision : null })) };
}
function validateSubmission(run, body) {
  if (!isMulti(run)) { exactKeys(body, ['round', 'output']); raw(body.output, 'Output', 16384); return; }
  exactKeys(body, ['round', 'outputs']);
  const count = runCases(run).length;
  if (!Array.isArray(body.outputs) || body.outputs.length !== count) fail(400, 'INVALID_INPUT', `Answer all ${count} cases, in order.`);
  body.outputs.forEach((output, i) => raw(output, `Output for case ${i + 1}`, 16384));
}
function checks(run, body) {
  const { comparison } = run.relayTest;
  const expected = [].concat(run.expected[body.round === 1 ? 'initial' : 'revision']);
  const outputs = isMulti(run) ? body.outputs : [body.output];
  const name = body.round === 1 ? 'output matches the expected result' : 'revised output matches the requested change';
  return outputs.map((output, i) => ({ name: isMulti(run) ? `Case ${i + 1}: ${name}` : name[0].toUpperCase() + name.slice(1), passed: normalize(output, comparison) === normalize(expected[i], comparison) }));
}
// The private record of what was submitted, with its hash. Never published.
function submission(run, body, hash) {
  return isMulti(run) ? { outputs: body.outputs, sha256: hash(JSON.stringify(body.outputs)) } : { output: body.output, sha256: hash(body.output) };
}

module.exports = { createRelayTests, proposalInput, isRelayTest, startRun, jobFields, validateSubmission, checks, submission, normalize, casesOf, PREFIX, NONCE, LIMITS };
