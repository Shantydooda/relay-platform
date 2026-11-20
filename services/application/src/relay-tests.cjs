'use strict';
// Builder-proposed Relay tests (docs/Build-Order.md, step 8; Decisions-Needed.md §8).
//
// A builder writes a test as data, never code: a brief, an input, the expected
// output, a change request and the expected revised output. Relay staff approve
// or reject each proposal with a reason before any agent can take it. Once
// approved, a test is frozen: changing it means proposing a new one.
//
// Why the rules below:
// - `{{nonce}}` must appear in the input and both expected outputs. Relay swaps
//   in a fresh value each run, so an earlier answer can't be replayed.
// - Expected outputs are never shown to anyone except the author and staff, and
//   submitted outputs never appear in public evidence, so passing answers don't
//   leak to other builders.
// - The author may use their own test, but every card says so (exam writers are
//   normally barred from their own exam; here it's disclosed instead, and staff
//   review the test with that in mind). A reviewer can't approve their own test.
// - A test covers one task category and only qualifies capabilities in it.
// - Three attempts per agent per test per day, so a test can't be brute-forced.

const { randomUUID } = require('node:crypto');
const { exactKeys, fail, text } = require('../../../packages/contracts/src/input.cjs');
const { taskById, categoryOf } = require('../../../packages/domain/src/categories.cjs');

const PREFIX = 'relay-test:';
const NONCE = '{{nonce}}';
const COMPARISONS = { exact: 'Exactly the same text', lines: 'Same lines, ignoring line endings and trailing spaces' };
const LIMITS = { inReview: 3, perAuthor: 20, attemptsPerDay: 3, listed: 100 };
const DAY = 86400000;

const isRelayTest = rubric => typeof rubric === 'string' && rubric.startsWith(PREFIX);
const testIdOf = rubric => rubric.slice(PREFIX.length);
const normalize = (value, comparison) => comparison === 'lines'
  ? value.replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/[ \t]+$/, '')).join('\n').replace(/\n+$/, '')
  : value;
const fill = (value, nonce) => value.split(NONCE).join(nonce);

const raw = (value, label, max = 8192) => { text(value, label, 1, max); if (value.length > max) fail(400, 'INVALID_INPUT', `${label} is too long.`); return value; };
function proposalInput(body) {
  exactKeys(body, ['title', 'categoryId', 'brief', 'limitation', 'input', 'expected', 'revision', 'revisionExpected', 'comparison']);
  const value = {
    title: text(body.title, 'Title', 3, 80),
    categoryId: body.categoryId,
    brief: text(body.brief, 'Instructions for the agent', 20, 1000),
    limitation: text(body.limitation, 'What this test doesn’t check', 20, 400),
    // Inputs and answers are kept byte for byte (text() trims): whitespace can be what's tested.
    input: raw(body.input, 'Test input'),
    expected: raw(body.expected, 'Expected output'),
    revision: text(body.revision, 'Change request', 5, 300),
    revisionExpected: raw(body.revisionExpected, 'Expected output after the change'),
    comparison: body.comparison,
  };
  const task = typeof value.categoryId === 'string' && value.categoryId !== 'other' ? taskById(value.categoryId) : null;
  if (!task) fail(400, 'INVALID_INPUT', 'Choose the task category this test covers.');
  if (!Object.hasOwn(COMPARISONS, value.comparison)) fail(400, 'INVALID_INPUT', 'Choose how Relay compares the output.');
  for (const [field, label] of [['input', 'test input'], ['expected', 'expected output'], ['revisionExpected', 'expected output after the change']])
    if (!value[field].includes(NONCE)) fail(400, 'NONCE_REQUIRED', `Put ${NONCE} somewhere in the ${label}. Relay replaces it with a new value on every run, so an old answer can’t be reused.`);
  const same = (a, b) => normalize(a, value.comparison) === normalize(b, value.comparison);
  if (same(value.expected, value.revisionExpected)) fail(400, 'INVALID_INPUT', 'The change request has to change the output, or it tests nothing.');
  if (same(value.input, value.expected) || same(value.input, value.revisionExpected)) fail(400, 'INVALID_INPUT', 'The expected output can’t be the input unchanged: an agent that does nothing would pass.');
  return value;
}

// What builders and buyers may see. Expected outputs stay with the author and staff.
function publicView(test) {
  const { id, title, categoryId, brief, limitation, revision, comparison, status, authorName, createdAt } = test;
  return { id, rubric: PREFIX + id, title, categoryId, category: taskById(categoryId)?.label || categoryId, brief, limitation, revision, comparison, status, authorName, createdAt, approvedAt: test.approvedAt || null };
}
function fullView(test) {
  return { ...publicView(test), input: test.input, expected: test.expected, revisionExpected: test.revisionExpected, reason: test.reason || null, decidedAt: test.decidedAt || null, reviewerName: test.reviewerName || null, version: test.version, history: test.history };
}

function createRelayTests(context) {
  const { repository, command, now, supplierConnections, relayTestReviewerIds = [] } = context;
  const reviewers = new Set(relayTestReviewerIds);
  const enabled = () => { if (!supplierConnections) fail(403, 'LOCAL_ONLY', 'Relay tests are not enabled in this environment.'); };
  const signedIn = actor => { if (!actor?.user?.id || actor.recoveryRequired) fail(401, 'UNAUTHENTICATED', 'Sign in first.'); };
  const isReviewer = actor => !!actor?.user?.id && !actor.recoveryRequired && reviewers.has(actor.user.id);
  const reviewer = actor => { if (!isReviewer(actor)) fail(403, 'FORBIDDEN', 'Only Relay staff review proposed tests.'); };
  const load = async (repo, id) => (typeof id === 'string' && await repo.get('relay_test', id, true)) || fail(404, 'NOT_FOUND', 'Test not found.');
  // Reviewers appear as "Relay staff"; their names stay private.
  const record = (test, action, actor, reason) => test.history.push({ action, by: ['proposed', 'withdrawn'].includes(action) ? test.authorName : 'Relay staff', at: now(), ...(reason ? { reason } : {}) });

  async function relayTests(actor) {
    enabled(); signedIn(actor);
    return repository.read(async repo => ({
      approved: (await repo.list('relay_test', 'status', 'approved', LIMITS.listed)).map(publicView),
      mine: (await repo.list('relay_test', 'owner_id', actor.user.id, LIMITS.perAuthor + 5)).map(fullView).sort((a, b) => b.createdAt - a.createdAt),
      canReview: isReviewer(actor),
      comparisons: COMPARISONS,
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
      approved: (await repo.list('relay_test', 'status', 'approved', LIMITS.listed)).map(fullView),
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

// Builds the assessment for one run of an approved test, or refuses.
async function startRun(repo, { rubric, agent, capability, nonce, time }) {
  // Locked so a start can't race a retire. A run already started may still finish.
  const test = await repo.get('relay_test', testIdOf(rubric), true);
  if (!test || test.status !== 'approved') fail(400, 'RUBRIC_UNAVAILABLE', 'This Relay test isn’t available. It may have been retired.');
  if (categoryOf(capability) !== test.categoryId) fail(409, 'CATEGORY_MISMATCH', `This test covers ${taskById(test.categoryId)?.label || test.categoryId}. Choose a capability in that category, or a test that matches this one.`);
  const recent = (agent.assessments || []).filter(item => item.rubric === rubric && item.createdAt > time - DAY).length;
  if (recent >= LIMITS.attemptsPerDay) fail(429, 'ATTEMPT_LIMIT', `You can take this test ${LIMITS.attemptsPerDay} times a day per agent. Try again tomorrow.`);
  return {
    input: fill(test.input, nonce),
    expected: { initial: fill(test.expected, nonce), revision: fill(test.revisionExpected, nonce) },
    // Frozen on the evidence, so it still reads correctly if the test is retired later.
    relayTest: { id: test.id, title: test.title, categoryId: test.categoryId, limitation: test.limitation, brief: test.brief, revision: test.revision, comparison: test.comparison, authorId: test.authorId, authorName: test.authorName },
  };
}
function jobFields(test) { return { brief: test.relayTest.brief, revision: test.status === 'revision_pending' ? test.relayTest.revision : null, answer: 'output' }; }
function validateSubmission(body) {
  exactKeys(body, ['round', 'output']);
  raw(body.output, 'Output', 16384);
}
function checks(test, body) {
  const { comparison } = test.relayTest;
  const expected = test.expected[body.round === 1 ? 'initial' : 'revision'];
  return [{ name: body.round === 1 ? 'Output matches the expected result' : 'Revised output matches the requested change', passed: normalize(body.output, comparison) === normalize(expected, comparison) }];
}

module.exports = { createRelayTests, proposalInput, isRelayTest, startRun, jobFields, validateSubmission, checks, normalize, PREFIX, NONCE, LIMITS };
