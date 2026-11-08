'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { createTransport } = require('../../../packages/supplier-sdk/src/transport.cjs');
const { normalizeCsv } = require('./csv.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function createRuntime({ origin, token, fetchImpl = fetch, pollMs = 2000, transport = 'local-csv', expectedAgentId, cursor = '', onCursor = () => {}, onEvent = () => {} }) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Reference runtime only connects to an explicit loopback origin');
  if (!['local-csv', 'supplier-api'].includes(transport)) throw new Error('Unknown runtime transport');
  const prefix = transport === 'supplier-api' ? '/v1/supplier' : '/api/runtime';
  let stopped = false;
  const controller = new AbortController();
  const supplierRequest = transport === 'supplier-api' ? createTransport({ origin, token, fetchImpl, signal: controller.signal }) : null;
  async function request(path, body, key = randomUUID(), method = 'POST') {
    if (supplierRequest) return supplierRequest(path.replace('/api/runtime', ''), body === null ? undefined : body, key, method);
    let lastError;
    for (let attempt = 0; attempt < 3 && !stopped; attempt++) {
      try {
        const response = await fetchImpl(`${origin}${path.replace('/api/runtime', prefix)}`, { method, redirect: 'error',
          headers: { Authorization: `Bearer ${token}`, 'X-Relay-Protocol': '1', ...(body ? { 'Content-Type': 'application/json' } : {}), 'Idempotency-Key': key },
          ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        const result = await response.json();
        if (response.ok) return result;
        const error = new Error(result.error?.code || 'RUNTIME_HTTP_ERROR');
        error.code = result.error?.code; error.status = response.status;
        if (response.status < 500) throw error;
        lastError = error;
      } catch (error) {
        if (error.status && error.status < 500) throw error;
        lastError = error;
      }
      if (attempt < 2) await sleep(200 * 2 ** attempt);
    }
    throw lastError || new Error('Runtime stopped');
  }
  async function collection(path, field) {
    const rows = [];
    let after = '';
    for (let page = 0; page < 50; page++) {
      const response = await request(`/api/runtime/${path}${transport === 'supplier-api' ? `?after=${encodeURIComponent(after)}&limit=100` : ''}`, null, undefined, 'GET');
      rows.push(...response[field]);
      if (!response.hasMore || response.nextCursor === after) return rows;
      after = response.nextCursor;
    }
    return rows;
  }
  async function tick() {
    const agent = await request('/api/runtime/heartbeat', transport === 'supplier-api' ? { runtimeName: 'Relay CSV reference', runtimeVersion: '1' } : {});
    if (expectedAgentId && agent.agentId !== expectedAgentId) { const error = new Error('AGENT_MISMATCH'); error.status = 403; throw error; }
    if (transport === 'supplier-api') {
      const page = await request(`/api/runtime/events?after=${encodeURIComponent(cursor)}&limit=100`, null, undefined, 'GET');
      // Persist only the cursor, never task contents, file bytes or credentials.
      if (page.nextCursor !== cursor) { onCursor(page.nextCursor); cursor = page.nextCursor; }
    }
    const assessments = await request('/api/runtime/qualifications', null, undefined, 'GET');
    for (const test of assessments.jobs) {
      if (test.rubric !== 'csv-normalize-v1') continue;
      const result = normalizeCsv(Buffer.from(test.input), test.revision);
      const { inputRows, outputRows, duplicatesRemoved, sort } = result.report;
      try {
        await request(`/api/runtime/qualifications/${test.id}`, {
          round: test.round, csv: result.csv.toString('utf8'), report: { inputRows, outputRows, duplicatesRemoved, sort }
        }, `assessment_${test.id}_${test.round}`);
        onEvent('qualification.submitted');
      } catch (error) { if (![404, 409].includes(error.status)) throw error; }
    }
    if (agent.automaticRequested) {
      const tasks = await collection('opportunities', 'tasks');
      for (const task of tasks) {
        if (stopped || task.input?.operation !== 'csv-normalize-v1' || task.myOffers.some(offer => offer.expiresAt > Date.now() && offer.scopeVersion === task.scopeVersion)) continue;
        const capability = agent.capabilities.find(item => /csv|spreadsheet/i.test(item.task));
        if (!capability) continue;
        try {
          await request(`/api/runtime/tasks/${task.id}/offers`, { agentId: agent.agentId, capabilityId: capability.id, expectedVersion: task.version,
            amountMinor: agent.minimumPayout, currency: agent.currency || 'USD', deliveryMinutes: 1,
            proposal: 'Local CSV automation: trim cells, remove empty rows and exact duplicate rows, sort rows ascending, and return a CSV plus a JSON report. No external enrichment or AI model. Local testing only; no real money is collected or paid.' });
          onEvent('offer.submitted');
        } catch (error) { if (![404, 409].includes(error.status)) throw error; }
      }
    }
    const assignments = await collection('assignments', 'assignments');
    for (const assignment of assignments) {
      if (stopped || assignment.status === 'running' && assignment.leaseUntil > Date.now()) continue;
      let job;
      try {
        job = await request(`/api/runtime/tasks/${assignment.taskId}/claim`, { assignmentId: assignment.assignmentId });
        if (job.exhausted) continue;
        onEvent('execution.started');
        const bytes = Buffer.from(job.input.base64, 'base64');
        if (createHash('sha256').update(bytes).digest('hex') !== job.input.sha256) throw new Error('INPUT_INTEGRITY');
        let result;
        try { result = normalizeCsv(bytes, job.revisionNotes); }
        catch (error) { await request(`/api/runtime/tasks/${assignment.taskId}/fail`, { leaseToken: job.leaseToken, code: error.message === 'Unsupported revision' ? 'INPUT_UNSUPPORTED' : 'CSV_INVALID' }); onEvent('execution.failed'); continue; }
        if (result.csv.length > 262144) { await request(`/api/runtime/tasks/${assignment.taskId}/fail`, { leaseToken: job.leaseToken, code: 'OUTPUT_TOO_LARGE' }); continue; }
        await request(`/api/runtime/tasks/${assignment.taskId}/progress`, { leaseToken: job.leaseToken, message: `Validated ${result.report.inputRows} rows; preparing delivery` });
        await request(`/api/runtime/tasks/${assignment.taskId}/submit`, { leaseToken: job.leaseToken,
          evidence: `Processed the supplied CSV locally. ${result.report.inputRows} input rows; ${result.report.outputRows} output rows; ${result.report.duplicatesRemoved} exact duplicates removed. Headers and column counts validated. See report.json for transformations.`,
          files: [{ filename: 'normalized.csv', mime: 'text/csv', base64: result.csv.toString('base64') },
            { filename: 'report.json', mime: 'application/json', base64: Buffer.from(JSON.stringify(result.report, null, 2)).toString('base64') }] });
        onEvent('delivery.submitted');
      } catch (error) {
        // A lost response never causes a fabricated success. Leases expire and
        // the server bounds attempts; invalid credentials stop this runtime.
        if ([401, 403].includes(error.status)) throw error;
        onEvent('execution.retry_wait');
      }
    }
  }
  return {
    tick,
    stop() { stopped = true; controller.abort(); },
    async run() {
      while (!stopped) {
        try { await tick(); }
        catch (error) { if ([401, 403].includes(error.status)) { stopped = true; onEvent('runtime.revoked'); break; } onEvent('runtime.retry_wait'); }
        if (!stopped) await sleep(pollMs);
      }
    }
  };
}
// IPC keeps credentials out of arguments, environment variables and output.
if (require.main === module) {
  process.once('message', config => {
    const runtime = createRuntime(config);
    process.on('SIGTERM', () => { runtime.stop(); process.exitCode = 0; });
    process.on('disconnect', () => { runtime.stop(); process.exitCode = 0; });
    runtime.run().finally(() => { if (process.connected) process.disconnect(); });
  });
}
module.exports = { createRuntime };
