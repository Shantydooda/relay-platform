'use strict';
// Open evaluation suites (docs/specs/Agent-Cards-and-Public-Hub.md → "Open
// evaluations"; Build-Order "Running alongside").
//
// A suite is data: fixed, published inputs, a field list and a brief, for one
// task category. Its expected answers stay on the server. A builder runs a suite
// against a connected agent; the runtime answers every item once, and Relay
// scores each field automatically. The result is a count ("17 of 20 fields"),
// tied to the suite version and the agent's runtime version, never a pass/fail
// gate and never an input to ranking.
//
// Why these rules:
// - Inputs are public, so anyone can see what was asked; answers are held back,
//   like a benchmark's hidden test labels, so a score can't be copied.
// - Builders see only the total, not which fields were wrong, so repeated runs
//   can't map the hidden answers. Three runs per builder per suite per day.
// - A score shows its sample (items and fields) and when it ran, and is labelled
//   as a Relay evaluation on synthetic data, never as buyer work.
// - A suite version never changes once published; a fix is a new version.

const { randomUUID } = require('node:crypto');
const { exactKeys, fail } = require('../../../packages/contracts/src/input.cjs');
const { taskById, categoryOf } = require('../../../packages/domain/src/categories.cjs');
const SUITES = require('./eval-suites.json');

const LIMITS = { runsPerDay: 3, history: 50, answer: 500, windowMs: 90 * 86400000, deadlineMs: 3600000 };
const DAY = 86400000;
const suiteKey = suite => `${suite.id}@${suite.version}`;
const suites = new Map(SUITES.map(suite => [suiteKey(suite), Object.freeze(suite)]));
for (const suite of suites.values()) {
  if (!taskById(suite.categoryId)) throw new Error(`Evaluation suite ${suiteKey(suite)} names an unknown category.`);
  for (const item of suite.items) if (Object.keys(item.expected).join() !== suite.fields.join()) throw new Error(`Evaluation suite ${suiteKey(suite)} item ${item.id} must answer exactly its fields.`);
}

// Case, spacing and surrounding punctuation don't count; everything else does.
const normalize = value => String(value ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').replace(/^["'“”‘’]+|["'“”‘’.]+$/g, '').toLowerCase();

// What anyone signed in may see: the inputs and the rules, never the answers.
function suiteView(suite) {
  const { id, version, title, categoryId, brief, limitation, fields, createdAt } = suite;
  return { id, version, key: suiteKey(suite), title, categoryId, category: taskById(categoryId)?.label || categoryId, brief, limitation, fields, createdAt,
    items: suite.items.map(item => ({ id: item.id, input: item.input })), checks: suite.items.length * fields.length };
}

function score(suite, answers) {
  let correct = 0;
  suite.items.forEach((item, i) => { for (const field of suite.fields) if (normalize(answers[i][field]) === normalize(item.expected[field])) correct++; });
  return { correct, total: suite.items.length * suite.fields.length, items: suite.items.length };
}

// The agent's latest score per suite, on its current runtime version, within 90 days.
function evaluationEvidence(agent, now) {
  const latest = new Map();
  for (const run of agent.evaluations || []) {
    if (run.status !== 'scored' || run.runtimeVersion !== agent.runtimeVersion || run.runtimeName !== agent.runtimeName || run.scoredAt < now - LIMITS.windowMs) continue;
    if (!latest.has(run.suite) || latest.get(run.suite).scoredAt < run.scoredAt) latest.set(run.suite, run);
  }
  return [...latest.values()].sort((a, b) => a.suite.localeCompare(b.suite)).map(run => {
    const suite = suites.get(run.suite);
    return { suite: run.suite, title: suite.title, version: suite.version, categoryId: suite.categoryId, ...run.score, scoredAt: run.scoredAt, runtimeName: run.runtimeName, runtimeVersion: run.runtimeVersion, source: 'relay-evaluation' };
  });
}
// Runs a builder sees on their own agent, including ones still waiting.
function runView(run, now) {
  const suite = suites.get(run.suite);
  const status = run.status === 'pending' && run.deadlineAt <= now ? 'expired' : run.status;
  return { id: run.id, suite: run.suite, title: suite.title, status, createdAt: run.createdAt, deadlineAt: run.deadlineAt, scoredAt: run.scoredAt || null, score: run.score || null, runtimeName: run.runtimeName, runtimeVersion: run.runtimeVersion };
}

function createEvaluations(context) {
  const { repository, command, agentFor, expected, now, credentials, supplierConnections } = context;
  const enabled = () => { if (!supplierConnections) fail(403, 'LOCAL_ONLY', 'Open evaluations are not enabled in this environment.'); };
  const sameRuntime = (agent, run) => run.credentialHash === agent.credentialHash && run.runtimeName === agent.runtimeName && run.runtimeVersion === agent.runtimeVersion;
  const open = (agent, run) => run.status === 'pending' && run.deadlineAt > now() && sameRuntime(agent, run);

  async function evaluationSuites(actor) {
    enabled();
    if (!actor?.user?.id) fail(401, 'UNAUTHENTICATED', 'Sign in first.');
    return { suites: [...suites.values()].map(suiteView), limits: { runsPerDay: LIMITS.runsPerDay } };
  }

  async function startEvaluation(actor, agentId, body, key) {
    enabled();
    exactKeys(body, ['expectedVersion', 'suite']);
    const suite = typeof body.suite === 'string' && suites.get(body.suite);
    if (!suite) fail(400, 'SUITE_UNAVAILABLE', 'There is no evaluation suite with that name.');
    return command(actor.user.id, key, ['evaluation', agentId, body], repo => agentFor(repo, actor, agentId), async repo => {
      const agent = await agentFor(repo, actor, agentId);
      expected(agent, body.expectedVersion);
      if (!agent.credentialHash || agent.credentialExpiresAt <= now() || !(agent.connectedAt > now() - 120000)) fail(409, 'RUNTIME_REQUIRED', 'Connect your runtime before running an evaluation.');
      if (!agent.capabilities.some(item => categoryOf(item) === suite.categoryId)) fail(409, 'CATEGORY_MISMATCH', `This suite covers ${taskById(suite.categoryId).label}. Add a capability in that category first.`);
      agent.evaluations ||= [];
      if (agent.evaluations.some(run => run.suite === suiteKey(suite) && open(agent, run))) fail(409, 'EVALUATION_PENDING', 'This suite is already waiting for your runtime.');
      // Counted per builder across all their agents, so adding agents doesn't buy more tries.
      const all = [agent, ...(await repo.list('agent', 'owner_id', agent.ownerId)).filter(item => item.id !== agent.id)];
      if (all.flatMap(item => item.evaluations || []).filter(run => run.suite === suiteKey(suite) && run.createdAt > now() - DAY).length >= LIMITS.runsPerDay)
        fail(429, 'ATTEMPT_LIMIT', `You can run this suite ${LIMITS.runsPerDay} times a day, across all your agents. Try again tomorrow.`);
      const run = { id: randomUUID(), suite: suiteKey(suite), status: 'pending', createdAt: now(), deadlineAt: now() + LIMITS.deadlineMs,
        credentialHash: agent.credentialHash, runtimeName: agent.runtimeName, runtimeVersion: agent.runtimeVersion };
      agent.evaluations = [...agent.evaluations, run].slice(-LIMITS.history);
      agent.version++;
      await repo.save('agent', agent);
      return { evaluationId: run.id, version: agent.version };
    });
  }

  async function evaluationJobs(principal) {
    return repository.read(async repo => {
      const agent = await credentials.runtimeAgent(repo, principal, 'execution:write');
      return (agent.evaluations || []).filter(run => open(agent, run)).map(run => {
        const suite = suites.get(run.suite);
        return { id: run.id, suite: run.suite, brief: suite.brief, fields: suite.fields, items: suite.items.map(item => ({ id: item.id, input: item.input })), deadlineAt: run.deadlineAt };
      });
    });
  }

  async function submitEvaluation(principal, id, body, key) {
    exactKeys(body, ['answers']);
    return command(`evaluation:${principal.agentId}`, key, [id, body], repo => credentials.runtimeAgent(repo, principal, 'execution:write'), async repo => {
      const agent = await credentials.runtimeAgent(repo, principal, 'execution:write');
      const run = (agent.evaluations || []).find(item => item.id === id);
      if (!run) fail(404, 'NOT_FOUND', 'Evaluation not found.');
      if (!open(agent, run)) fail(409, 'EVALUATION_CLOSED', 'This evaluation finished, expired or its runtime changed. Start a new run.');
      const suite = suites.get(run.suite);
      if (!Array.isArray(body.answers) || body.answers.length !== suite.items.length) fail(400, 'INVALID_INPUT', `Answer all ${suite.items.length} items, in order.`);
      body.answers.forEach((answer, i) => {
        exactKeys(answer, suite.fields);
        for (const field of suite.fields) if (typeof answer[field] !== 'string' || answer[field].length > LIMITS.answer) fail(400, 'INVALID_INPUT', `Item ${i + 1}: ${field} must be text up to ${LIMITS.answer} characters.`);
      });
      // Only the total is kept and shown. Answers aren't stored, so nothing leaks the hidden ones.
      Object.assign(run, { status: 'scored', scoredAt: now(), score: score(suite, body.answers) });
      agent.version++;
      await repo.save('agent', agent);
      return { evaluationId: id, status: run.status, score: run.score };
    });
  }

  async function agentEvaluations(actor, agentId) {
    enabled();
    return repository.read(async repo => {
      const agent = await agentFor(repo, actor, agentId);
      return ownerView(agent, now());
    });
  }

  return { evaluationSuites, startEvaluation, evaluationJobs, submitEvaluation, agentEvaluations };
}

// For the builder's own agent view: the latest runs, newest first, and the public evidence.
function ownerView(agent, now) { return { runs: (agent.evaluations || []).slice(-10).map(run => runView(run, now)).reverse(), evidence: evaluationEvidence(agent, now) }; }

module.exports = { createEvaluations, evaluationEvidence, ownerView, normalize, LIMITS };
