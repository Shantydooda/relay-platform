'use strict';

const { randomUUID } = require('node:crypto');
const { exactKeys, fail, text } = require('../../../packages/contracts/src/input.cjs');
const linkAssessment = require('./link-assessment.cjs');
const RUBRIC = 'csv-normalize-v1';
const LIMIT = 'Bounded CSV normalization only: trim cells, remove exact duplicates, sort, preserve quoted cells and neutralize spreadsheet formulas. No enrichment, research or general data expertise assessed.';
function sameRuntime(agent, test) {
  return test?.credentialHash === agent.credentialHash
    && test?.runtimeName === agent.runtimeName
    && test?.runtimeVersion === agent.runtimeVersion;
}
function pending(test) {
  return ['test_pending', 'revision_pending'].includes(test.status);
}
function current(agent, test, now) {
  return test?.status === 'passed' && test.expiresAt > now
    && agent.credentialExpiresAt > now && sameRuntime(agent, test);
}
function evidence(test, now = Date.now()) {
  if (!test) return null;
  const { id, capabilityId, rubric, status, createdAt, completedAt, expiresAt, runtimeName, runtimeVersion, input, submissions } = test;
  const displayedStatus = pending(test) && test.deadlineAt <= now ? 'expired' : status;
  return { id, capabilityId, rubric, status: displayedStatus, deadlineAt: test.deadlineAt, createdAt, completedAt, expiresAt, runtimeName, runtimeVersion, input, submissions, title: rubric === linkAssessment.rubric ? linkAssessment.title : 'CSV normalization', limitation: rubric === linkAssessment.rubric ? linkAssessment.limitation : LIMIT };
}
function capabilityView(agent, capability, now) {
  const test = (agent.assessments || []).find(item => item.id === capability.assessmentId);
  const assessment = evidence(test, now);
  if (assessment && pending(assessment) && !sameRuntime(agent, test)) assessment.status = 'invalidated';
  return { ...capability, qualification: current(agent, test, now) ? 'qualified' : test?.status === 'passed' ? 'expired' : 'unverified', assessment };
}
function createQualification(context) {
  const { repository, command, agentFor, expected, now, credentials, hash, localExecution } = context;
  async function start(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'capabilityId', 'rubric']);
    if (!localExecution) fail(403, 'LOCAL_ONLY', 'Qualification is available only in local development.');
    if (![RUBRIC, linkAssessment.rubric].includes(body.rubric)) fail(400, 'RUBRIC_UNAVAILABLE', 'There is no assessment for this rubric yet. Other capabilities remain declared.');
    return command(actor.user.id, key, ['qualification', id, body], repo => agentFor(repo, actor, id), async repo => {
      const agent = await agentFor(repo, actor, id);
      expected(agent, body.expectedVersion);
      const capability = agent.capabilities.find(item => item.id === body.capabilityId);
      if (!capability) fail(404, 'NOT_FOUND', 'Capability not found.');
      if (!agent.credentialHash || agent.credentialExpiresAt <= now() || !(agent.connectedAt > now() - 120000)) fail(409, 'RUNTIME_REQUIRED', 'Connect your runtime before requesting a test.');
      agent.assessments ||= [];
      if (agent.assessments.some(item => item.capabilityId === capability.id && pending(item) && item.deadlineAt > now() && sameRuntime(agent, item))) fail(409, 'ASSESSMENT_PENDING', 'This capability already has a pending assessment.');
      if (agent.assessments.length >= 50) fail(409, 'ASSESSMENT_LIMIT', 'This local agent has reached its assessment history limit.');
      const nonce = randomUUID().slice(0, 8);
      const input = `name,company\n Zoe ,Orbit-${nonce}\nAda,"Acme, Inc"\nAda,"Acme, Inc"\n=2+2,Formula\n`;
      // Expected output is constructed independently of the supplier CSV implementation.
      const rows = ["'=2+2,Formula", 'Ada,"Acme, Inc"', `Zoe,Orbit-${nonce}`];
      const test = { id: randomUUID(), capabilityId: capability.id, rubric: body.rubric, status: 'test_pending',
        createdAt: now(), deadlineAt: now() + 3600000, credentialHash: agent.credentialHash,
        runtimeName: agent.runtimeName, runtimeVersion: agent.runtimeVersion, input, submissions: [],
        expected: { initial: `name,company\r\n${rows.join('\r\n')}\r\n`, revision: `name,company\r\n${[...rows].reverse().join('\r\n')}\r\n` } };
      if (body.rubric === linkAssessment.rubric) Object.assign(test, linkAssessment.fixture(nonce));
      agent.assessments.push(test);
      capability.assessmentId = test.id;
      agent.version++;
      await repo.save('agent', agent);
      return { assessmentId: test.id, version: agent.version };
    });
  }
  async function jobs(principal) {
    return repository.read(async repo => {
      const agent = await credentials.runtimeAgent(repo, principal, 'execution:write');
      return (agent.assessments || []).filter(test => pending(test) && test.deadlineAt > now() && sameRuntime(agent, test)).map(test => ({
        id: test.id, capabilityId: test.capabilityId, rubric: test.rubric, round: test.status === 'test_pending' ? 1 : 2,
        input: test.input, deadlineAt: test.deadlineAt,
        brief: test.rubric === linkAssessment.rubric ? linkAssessment.brief : 'Trim cells, remove exact duplicate rows, preserve quoted fields, neutralize spreadsheet formulas, sort rows ascending and return CRLF CSV plus a JSON report.',
        revision: test.status === 'revision_pending' ? (test.rubric === linkAssessment.rubric ? 'Sort links descending' : 'Sort rows descending') : null
      }));
    });
  }
  async function submit(principal, id, body, key) {
    if (!body || ![1, 2].includes(body.round)) fail(400, 'INVALID_INPUT', 'Choose test round 1 or 2.');
    return command(`qualification:${principal.agentId}`, key, [id, body], repo => credentials.runtimeAgent(repo, principal, 'execution:write'), async repo => {
      const agent = await credentials.runtimeAgent(repo, principal, 'execution:write');
      const test = (agent.assessments || []).find(item => item.id === id);
      if (!test) fail(404, 'NOT_FOUND', 'Assessment not found.');
      if (test.rubric === linkAssessment.rubric) linkAssessment.validate(body);
      else {
        exactKeys(body, ['round', 'csv', 'report']);
        text(body.csv, 'CSV', 1, 8192);
        if (body.csv.length > 8192) fail(400, 'INVALID_INPUT', 'CSV exceeds the assessment limit.');
        exactKeys(body.report, ['inputRows', 'outputRows', 'duplicatesRemoved', 'sort']);
        if (!['inputRows', 'outputRows', 'duplicatesRemoved'].every(key => Number.isSafeInteger(body.report[key]) && body.report[key] >= 0 && body.report[key] <= 10000) || !['ascending', 'descending'].includes(body.report.sort)) fail(400, 'INVALID_INPUT', 'Provide bounded row counts and a sort order.');
      }
      if (!sameRuntime(agent, test) || test.deadlineAt <= now()) fail(409, 'ASSESSMENT_EXPIRED', 'The assessment expired or the runtime changed. Request a fresh test.');
      if (test.status !== (body.round === 1 ? 'test_pending' : 'revision_pending')) fail(409, 'ASSESSMENT_STATE', 'This round is no longer accepting submissions.');
      // Do not trim submitted CSV: exact bytes are evidence, including its final newline.
      const exactCsv = body.csv;
      const checks = test.rubric === linkAssessment.rubric ? linkAssessment.checks(test, body) : [
        { name: 'CSV contents, order, quoting and formula safety', passed: exactCsv === test.expected[body.round === 1 ? 'initial' : 'revision'] },
        { name: 'Report agrees with supplied fixture', passed: body.report.inputRows === 4 && body.report.outputRows === 3 && body.report.duplicatesRemoved === 1 && body.report.sort === (body.round === 1 ? 'ascending' : 'descending') }
      ];
      const passed = checks.every(check => check.passed);
      test.submissions.push({ round: body.round, ...(test.rubric === linkAssessment.rubric ? { links: body.links } : { csv: exactCsv }), report: body.report, sha256: hash(test.rubric === linkAssessment.rubric ? JSON.stringify(body.links) : exactCsv), checks, passed, createdAt: now() });
      test.status = !passed ? 'failed' : body.round === 1 ? 'revision_pending' : 'passed';
      if (test.status !== 'revision_pending') { test.completedAt = now(); delete test.expected; }
      if (test.status === 'passed') test.expiresAt = now() + 30 * 86400000;
      agent.version++;
      await repo.save('agent', agent);
      return { assessmentId: id, status: test.status, checks };
    });
  }
  return { startQualification: start, qualificationJobs: jobs, submitQualification: submit };
}
module.exports = { createQualification, capabilityView, evidence, RUBRIC };
