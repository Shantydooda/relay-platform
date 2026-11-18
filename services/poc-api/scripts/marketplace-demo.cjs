'use strict';
// Disposable marketplace demo: `npm run demo:marketplace`.
//
// Starts a separate in-memory Relay on http://127.0.0.1:4210 (RELAY_DEMO_PORT),
// registers three builders, connects their runtimes with the real supplier SDK,
// passes the real Relay CSV test, and runs a few tasks to acceptance or failure
// so the browse page and agent pages have genuine evidence to show. Nothing is
// written to .poc-data, and nothing here is sample data: every number comes from
// runs this process performs. Stop it with Ctrl-C and it's gone.
const R = require('node:path').resolve(__dirname, '../../..');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require(`${R}/services/poc-api/src/database.cjs`);
const { createUnifiedLocalStore } = require(`${R}/services/poc-api/src/unified-store.cjs`);
const { createApp } = require(`${R}/services/poc-api/src/app.cjs`);
const { createSupplierClient } = require(`${R}/packages/supplier-sdk/src/index.cjs`);
const { normalizeCsv } = require(`${R}/services/agent-runtime/src/csv.cjs`);

const DEMO_PASSWORD = 'relay local demo password';
const port = Number(process.env.RELAY_DEMO_PORT || 4210);
(async () => {
  const store = await createUnifiedLocalStore({ authDb: openDatabase(':memory:'), applicationDb: new DatabaseSync(':memory:'), localExecution: true });
  const origin = `http://127.0.0.1:${port}`;
  const server = createApp({ store, origin });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  async function request(path, account, body, method = body ? 'POST' : 'GET') {
    const res = await fetch(origin + path, { method, headers: { Origin: origin, Cookie: `relay_local_session_${port}=${account.session}`,
      ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': account.actor.csrf, 'Idempotency-Key': randomUUID() } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json();
    if (res.status >= 400) throw new Error(path + ' ' + res.status + ' ' + JSON.stringify(json));
    return json;
  }
  async function account(name, workspace, display) {
    const session = await store.register({ name: display, email: `${name}@example.test`, password: DEMO_PASSWORD, workspace }, name);
    return { session, actor: await store.principal(session) };
  }
  async function builder(slug, display, agentSpec, version) {
    const operator = await account(slug, 'builder', display);
    const { agentId } = await store.marketplace.addAgent(operator.actor, agentSpec, randomUUID());
    const agent = async () => (await store.marketplace.agents(operator.actor)).find(item => item.id === agentId);
    await store.marketplace.configure(operator.actor, agentId, { expectedVersion: (await agent()).version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
    await store.marketplace.updateListing(operator.actor, agentId, { expectedVersion: (await agent()).version, status: 'published' }, randomUUID());
    const credential = await store.issueSupplierCredential(operator.actor, agentId, { expectedVersion: (await agent()).version, expiresInSeconds: 7200 }, randomUUID());
    const client = createSupplierClient({ origin, token: credential.token });
    const b = { operator, agentId, client, version, heartbeat: () => client.heartbeat({ runtimeName: `${display} runtime`, runtimeVersion: b.version }) };
    await b.heartbeat();
    const capabilityId = (await agent()).capabilities[0].id;
    b.capabilityId = capabilityId;
    b.qualify = async () => {
      await b.heartbeat();
      const assessment = await store.startQualification(operator.actor, agentId, { expectedVersion: (await agent()).version, capabilityId, rubric: 'csv-normalize-v1' }, randomUUID());
      for (const round of [1, 2]) {
        const job = (await client.qualifications()).jobs[0];
        const output = normalizeCsv(Buffer.from(job.input), job.revision);
        const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
        await client.submitQualification(assessment.assessmentId, { round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } }, randomUUID());
      }
    };
    await b.qualify();
    return b;
  }
  const spec = (name, purpose, domain, category, task, tools = []) => ({ name, kind: 'specialist', integration: 'api', purpose, domain,
    capabilities: [{ category, task, metadata: { industries: ['Operations'], regions: ['UK'], outputs: ['CSV'], tools } }] });
  const builders = [
    await builder('tidy-rows', 'Tidy Rows', spec('csv-normalizer', 'Cleans a CSV you upload: removes duplicate rows, normalises headers and returns a validation report listing every change.', 'CSV data processing', 'CSV cleanup', 'Normalize CSV data'), '1.2.0'),
    await builder('ledgerline', 'Ledgerline', spec('contact-dedupe', 'Deduplicates contact exports by email and returns the cleaned file with a report of removed rows.', 'CRM data hygiene', 'CRM cleanup', 'Deduplicate CSV contact data', ['Google Drive']), '0.4.1'),
    await builder('fresh-agent', 'Fresh Agent Co', spec('row-sorter', 'Sorts and validates tabular data files, then returns the sorted CSV and a short report.', 'CSV data processing', 'CSV cleanup', 'Normalize and sort CSV data'), '1.0.0'),
  ];
  const buyer = await account('qa-buyer', 'buyer', 'Test Buyer');
  const buyer2 = await account('qa-buyer-2', 'buyer', 'Second Buyer');
  async function run(b, who, outcome) {
    const t = await request('/api/tasks', who, { tenantId: who.actor.memberships[0].id, title: 'Normalize CSV data', brief: 'Normalize CSV data: remove duplicate rows and return the cleaned CSV and validation report.' });
    const path = `/api/tasks/${t.taskId}`;
    await request(`${path}/post`, who, { expectedVersion: 1 });
    await b.heartbeat();
    await b.client.quote(t.taskId, { agentId: b.agentId, capabilityId: b.capabilityId, expectedVersion: 2, amountMinor: 500, deliveryMinutes: 10, proposal: 'Normalize the supplied CSV and deliver a cleaned CSV plus validation report.' }, randomUUID());
    const offer = (await request(`${path}/offers`, who)).offers.find(o => o.agentId === b.agentId);
    let d = await request(path, who);
    await request(`${path}/select`, who, { expectedVersion: d.task.version, offerId: offer.id });
    d = await request(path, who);
    await request(`${path}/authorize-local`, who, { expectedVersion: d.task.version, mode: 'local-unpaid' });
    const deliver = async () => {
      await b.heartbeat();
      const assignmentId = (await b.client.assignments()).assignments.find(a => a.taskId === t.taskId).assignmentId;
      const claimed = await b.client.claim(t.taskId, { assignmentId }, randomUUID());
      if (outcome === 'failed') return b.client.fail(t.taskId, { leaseToken: claimed.leaseToken, code: 'AGENT_ERROR' }, randomUUID());
      return b.client.submit(t.taskId, { leaseToken: claimed.leaseToken, evidence: 'Output attached.', files: [{ filename: 'clean.csv', mime: 'text/csv', base64: Buffer.from('email\na@example.test\n').toString('base64') }] }, randomUUID());
    };
    let s = await deliver();
    if (outcome === 'failed') return;
    if (outcome === 'revised') {
      d = await request(path, who);
      await request(`${path}/request-revision`, who, { expectedVersion: d.task.version, submissionId: s.submissionId, notes: 'Sort by email please.' });
      s = await deliver();
    }
    d = await request(path, who);
    await request(`${path}/accept-delivery`, who, { expectedVersion: d.task.version, submissionId: s.submissionId });
  }
  const [tidy, ledger] = builders;
  for (const o of ['ok', 'ok', 'revised', 'failed']) await run(tidy, buyer, o);
  await run(tidy, buyer2, 'ok');
  tidy.version = '1.3.0';
  await tidy.qualify();
  await run(tidy, buyer, 'ok');
  await run(ledger, buyer2, 'ok');
  // Keep runtimes connected for the page's "connected" view.
  setInterval(() => builders.forEach(b => b.heartbeat().catch(() => {})), 60000);
  console.log(`Relay marketplace demo: ${origin}\nSign in as qa-buyer@example.test with the password "${DEMO_PASSWORD}".\nIn-memory only; stop with Ctrl-C.`);
})().catch(error => { console.error(error); process.exit(1); });
