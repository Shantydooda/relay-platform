'use strict';

// The connector's loop. It only ever calls out to Relay, so no inbound port or
// firewall change is needed:
//   1. hello: say which objects this connector serves;
//   2. wait for a granted read (Relay holds the request up to 25 s);
//   3. read the rows from the export and send them back, or a plain error.
// Each answered read is written to a local audit log (what was read, by which
// agent, for which request, how many rows: never the rows themselves), so the
// buyer's IT team has its own record alongside Relay's.
const { appendFileSync } = require('node:fs');
const { SourceError } = require('./source.cjs');

const VERSION = require('../package.json').version;

class StopError extends Error {}

function createConnector({ config, source, fetchImpl = fetch, log = () => {}, sleep = ms => new Promise(r => setTimeout(r, ms)), waitSeconds = 25 }) {
  async function call(method, path, body) {
    let response;
    try {
      response = await fetchImpl(config.relay + path, { method, redirect: 'error', signal: AbortSignal.timeout((waitSeconds + 15) * 1000),
        headers: { authorization: `Bearer ${config.key}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined });
    } catch (error) { throw Object.assign(new Error('Relay couldn’t be reached.'), { retry: true, cause: error }); }
    if (response.status === 204) return null;
    const json = await response.json().catch(() => ({}));
    if (response.status === 401) throw new StopError(json.error?.message || 'Relay refused this connector key.');
    if (!response.ok) throw Object.assign(new Error(json.error?.message || `Relay answered ${response.status}.`), { retry: response.status >= 500 || response.status === 429, status: response.status });
    return json;
  }

  function audit(entry) {
    try { appendFileSync(config.auditLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n', { mode: 0o600 }); }
    catch (error) { log(`Couldn’t write the audit log: ${error.message}`); }
  }

  async function hello() {
    const result = await call('POST', '/api/connector/hello', { version: VERSION, objects: source.objects() });
    log(`Connected as “${result.label}” (${result.environment}), serving ${result.objects.join(', ')}.`);
    return result;
  }

  async function handle(job) {
    const base = { readId: job.readId, grantId: job.grantId, agent: job.agent, request: job.request, object: job.object, cursor: job.cursor };
    let answer;
    try { answer = source.read(job.object, { cursor: job.cursor, limit: job.limit }); }
    catch (error) {
      const failure = error instanceof SourceError ? { code: error.code, message: error.message } : { code: 'SOURCE_ERROR', message: 'The export couldn’t be read.' };
      audit({ ...base, outcome: 'error', error: failure.code });
      log(`Read for ${job.agent} (${job.object}) failed: ${failure.message}`);
      return call('POST', `/api/connector/reads/${job.readId}`, { error: failure });
    }
    try {
      await call('POST', `/api/connector/reads/${job.readId}`, answer);
      audit({ ...base, outcome: 'sent', rows: answer.rows.length });
      log(`Sent ${answer.rows.length} ${job.object} rows to ${job.agent} for “${job.request}”.`);
    } catch (error) {
      audit({ ...base, outcome: 'refused', error: error.message });
      if (error instanceof StopError) throw error;
      log(`Relay didn’t accept the answer: ${error.message}`);
    }
  }

  // One poll: returns true if a read was handled.
  async function once() {
    const job = await call('GET', `/api/connector/reads?wait=${waitSeconds}`);
    if (!job) return false;
    await handle(job);
    return true;
  }

  async function run({ signal } = {}) {
    let backoff = 1000, greeted = false;
    while (!signal?.aborted) {
      try {
        if (!greeted) { await hello(); greeted = true; }
        await once();
        backoff = 1000;
      } catch (error) {
        if (error instanceof StopError) { log(`Stopping: ${error.message}`); return { stopped: error.message }; }
        if (!error.retry) greeted = false;
        log(`${error.message} Retrying in ${Math.round(backoff / 1000)} s.`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30000);
      }
    }
    return { stopped: 'signal' };
  }

  return { hello, once, run };
}

module.exports = { createConnector, StopError, VERSION };
