#!/usr/bin/env node
'use strict';

// Connects your agent (my-agent.cjs) to Relay and keeps it working:
//   node examples/sample-agent/run.cjs --config /private/path/relay-agent.json [--once]
//
// Every few seconds it: says it's online, answers Relay tests, quotes on posted
// requests your agent fits, and does the work buyers have authorized. It only
// ever calls out to Relay; nothing needs to reach your machine.
//
// Safe to stop and restart at any time. Each command to Relay carries a key
// derived from what it is (which task, which lease, which round), so a retry
// after a lost response or a restart is recognised, never done twice.

const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { createSupplierClient, shouldClaim } = require('../../src/index.cjs');

const FAILURE_CODES = ['CSV_INVALID', 'OUTPUT_TOO_LARGE', 'INPUT_UNSUPPORTED', 'AGENT_ERROR'];
const RENEW_MS = 10000; // the lease lasts 30 s; renew well before it lapses

function createSampleAgent({ origin, token, expectedAgentId, agent, fetchImpl, log = console.log, pollMs = 5000 }) {
  const controller = new AbortController();
  const client = createSupplierClient({ origin, token, fetchImpl, signal: controller.signal });
  const key = (...parts) => createHash('sha256').update(token).update(JSON.stringify([expectedAgentId, ...parts])).digest('hex');
  const skippedTests = new Set();

  async function all(method, field) {
    const rows = [];
    let after = '';
    for (let page = 0; page < 50; page++) {
      const result = await client[method]({ after, limit: 100 });
      rows.push(...result[field]);
      if (!result.hasMore || !result.nextCursor || result.nextCursor === after) return rows;
      after = result.nextCursor;
    }
    return rows;
  }

  async function relayTests() {
    for (const job of (await client.qualifications()).jobs) {
      const answer = agent.relayTests?.[job.rubric];
      if (!answer) {
        if (!skippedTests.has(job.id)) log(`Relay test ${job.rubric} skipped: my-agent.cjs has no answer for it.`);
        skippedTests.add(job.id);
        continue;
      }
      try {
        const result = await client.submitQualification(job.id, { round: job.round, ...(await answer(job)) }, key('test', job.id, job.round));
        log(`Relay test ${job.rubric}, round ${job.round}: ${result.status.replaceAll('_', ' ')}.`);
      } catch (error) { if (![404, 409].includes(error.status)) throw error; }
    }
  }

  async function quotes(profile) {
    if (!profile.automaticRequested) return;
    for (const request of await all('opportunities', 'tasks')) {
      const current = request.myOffers.some(offer => offer.expiresAt > Date.now() && offer.scopeVersion === request.scopeVersion);
      if (current || !agent.fits(request)) continue;
      const terms = agent.quote(request, profile);
      const body = { agentId: profile.agentId, capabilityId: terms.capabilityId || profile.capabilities[0].id, expectedVersion: request.version,
        amountMinor: terms.amountMinor, deliveryMinutes: terms.deliveryMinutes, proposal: terms.proposal };
      try {
        await client.quote(request.id, body, key('quote', request.id, request.scopeVersion));
        log(`Quoted on “${request.title}”.`);
      } catch (error) {
        if (![404, 409, 422].includes(error.status)) throw error;
        log(`Couldn’t quote on “${request.title}” (${error.code}).`);
      }
    }
  }

  async function execute(assignment) {
    const task = await client.task(assignment.taskId);
    const job = await client.claim(assignment.taskId, { assignmentId: assignment.assignmentId },
      key('claim', assignment.assignmentId, task.submissions?.length || 0, task.attempt || 0));
    if (job.exhausted) return;
    const lease = job.leaseToken;
    let sequence = 0;
    const progress = message => client.progress(assignment.taskId, { leaseToken: lease, message: String(message).slice(0, 200) }, key('progress', lease, ++sequence));
    // Keep the lease while your agent works, however long that takes.
    let renewing = null, lostLease = null;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = progress('Still working').catch(error => { lostLease = error; }).finally(() => { renewing = null; });
    }, RENEW_MS);
    let result;
    try {
      let input = null;
      if (job.input) {
        const bytes = Buffer.from(job.input.base64, 'base64');
        if (createHash('sha256').update(bytes).digest('hex') !== job.input.sha256) throw Object.assign(new Error('The input file didn’t match its checksum.'), { code: 'AGENT_ERROR' });
        input = { filename: job.input.filename, notes: job.input.notes, bytes };
      }
      log(`Working on “${job.title}”${job.revisionNotes ? ' (revision)' : ''}.`);
      result = await agent.work({ title: job.title, brief: job.brief, input, revisionNotes: job.revisionNotes,
        acceptanceCriteria: job.acceptanceCriteria || [], unmetCriteria: job.unmetCriteria || [], progress });
    } catch (error) {
      clearInterval(timer); if (renewing) await renewing;
      const code = FAILURE_CODES.includes(error.code) ? error.code : 'AGENT_ERROR';
      await client.fail(assignment.taskId, { leaseToken: lease, code }, key('fail', lease));
      log(`Couldn’t do “${job.title}”: ${error.message}`);
      return;
    }
    clearInterval(timer); if (renewing) await renewing;
    if (lostLease) throw lostLease;
    const files = result.files.map(file => ({ filename: file.filename, mime: file.mime,
      base64: Buffer.from(file.content).toString('base64') }));
    await client.submit(assignment.taskId, { leaseToken: lease, evidence: result.evidence, files }, key('submit', lease));
    log(`Delivered “${job.title}” for the buyer’s review.`);
  }

  async function tick() {
    const profile = await client.heartbeat({ runtimeName: agent.name, runtimeVersion: agent.version });
    if (profile.agentId !== expectedAgentId)
      throw Object.assign(new Error('This key belongs to a different agent than the one in your connection file.'), { code: 'AGENT_MISMATCH', status: 403 });
    await relayTests();
    await quotes(profile);
    for (const assignment of await all('assignments', 'assignments')) {
      if (!shouldClaim(assignment)) continue;
      try { await execute(assignment); }
      catch (error) {
        if ([401, 403].includes(error.status)) throw error;
        log(`Will retry “${assignment.taskId}” (${error.code || 'unavailable'}).`);
      }
    }
  }

  async function run() {
    log(`${agent.name} connected to ${origin}. Press Ctrl+C to stop.`);
    while (!controller.signal.aborted) {
      try { await tick(); }
      catch (error) {
        if ([401, 403].includes(error.status)) {
          log(error.code === 'AGENT_MISMATCH' ? error.message : 'Relay refused this key: it may have expired or been replaced. Create a new one in your agent’s settings.');
          return 1;
        }
        if (!controller.signal.aborted) log(`Relay couldn’t be reached (${error.code || 'network'}). Trying again.`);
      }
      try { await delay(pollMs, undefined, { signal: controller.signal }); } catch { break; }
    }
    return 0;
  }

  return { tick, run, stop: () => controller.abort() };
}

if (require.main === module) {
  const { readPrivateConfig } = require('../../src/private-config.cjs');
  const args = process.argv.slice(2);
  const at = args.indexOf('--config');
  let config;
  try { config = readPrivateConfig(args[at + 1]); }
  catch (error) {
    console.error(error.message === 'CONFIG_PERMISSIONS'
      ? 'Make the connection file private first: chmod 600 relay-agent.json'
      : 'Use --config with the connection file you downloaded from your agent’s settings on Relay.');
    process.exit(2);
  }
  const runner = createSampleAgent({ ...config, agent: require('./my-agent.cjs'),
    log: message => console.log(`${new Date().toISOString()}  ${message}`) });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runner.stop());
  (args.includes('--once') ? runner.tick().then(() => 0) : runner.run())
    .then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { createSampleAgent };
