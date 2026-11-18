'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../../src/database.cjs');
const { createUnifiedLocalStore } = require('../../src/unified-store.cjs');
const { createApp } = require('../../src/app.cjs');
const { createSupplierClient } = require('../../../../packages/supplier-sdk/src/index.cjs');
const { normalizeCsv } = require('../../../agent-runtime/src/csv.cjs');

// Disposable localhost application, real commands and supplier HTTP transport.
// No seed writes to qualification, offers, reputation or production databases.
async function recommendationFlow(port = 4196, { repository, now, autoAcceptAfterMs } = {}) {
  const authDb = openDatabase(':memory:');
  const applicationDb = new DatabaseSync(':memory:');
  let store = await createUnifiedLocalStore({ authDb, applicationDb, repository, localExecution: true, ...(now ? { now } : {}), autoAcceptAfterMs });
  const origin = `http://127.0.0.1:${port}`;
  let server = createApp({ store, origin });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  }).catch(error => {
    authDb.close();
    applicationDb.close();
    throw error;
  });
  async function request(path, account, body, method = body ? 'POST' : 'GET', key = randomUUID()) {
    const response = await fetch(`${origin}${path}`, {
      method,
      signal: AbortSignal.timeout(10000),
      headers: {
        Origin: origin,
        ...(account ? { Cookie: `relay_local_session_${port}=${account.session}` } : {}),
        ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': account?.actor.csrf || '', 'Idempotency-Key': key } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, body: await response.json() };
  }
  async function account(name, workspace) {
    const email = `${name}@example.test`, password = `Local QA ${randomUUID()}`;
    const session = await store.register({ name: `QA ${name}`, email, password, workspace }, name);
    return { email, password, session, actor: await store.principal(session) };
  }
  try {
    const buyer = await account('recommendation-buyer', 'buyer');
    const builders = [];
    for (const [index, name] of ['CSV specialist', 'Data assistant'].entries()) {
      const operator = await account(`recommendation-builder-${index}`, 'builder');
      const created = await store.marketplace.addAgent(operator.actor, {
        name: `QA ${name}`, kind: 'specialist', integration: 'api', purpose: 'Normalize supplied CSV files', domain: 'CSV data processing',
        capabilities: [{ category: 'Data', task: 'Normalize CSV data', metadata: {industries:['Operations'], regions:['UK'], outputs:['CSV'], tools:[]} }]
      }, randomUUID());
      const agentId = created.agentId;
      const saved = (await store.marketplace.agents(operator.actor)).find(item => item.id === agentId);
      assert.deepEqual(saved.capabilities[0].metadata.outputs, ['CSV']);
      const agent = async () => (await store.marketplace.agents(operator.actor)).find(item => item.id === agentId);
      await store.marketplace.configure(operator.actor, agentId, {
        expectedVersion: (await agent()).version, integration: 'api', setupStage: 3,
        automaticRequested: true, minimumPayout: 100, concurrency: 1
      }, randomUUID());
      await store.marketplace.updateListing(operator.actor, agentId, {
        expectedVersion: (await agent()).version, status: 'published'
      }, randomUUID());
      const credential = await store.issueSupplierCredential(operator.actor, agentId, {
        expectedVersion: (await agent()).version, expiresInSeconds: 3600
      }, randomUUID());
      const client = createSupplierClient({ origin, token: credential.token });
      const heartbeat = () => client.heartbeat({ runtimeName: 'Local deterministic CSV QA', runtimeVersion: '1' });
      await heartbeat();
      const capabilityId = (await agent()).capabilities[0].id;
      const assessment = await store.startQualification(operator.actor, agentId, {
        expectedVersion: (await agent()).version, capabilityId, rubric: 'csv-normalize-v1'
      }, randomUUID());
      for (const round of [1, 2]) {
        const job = (await client.qualifications()).jobs[0];
        assert.equal(job.round, round);
        const output = normalizeCsv(Buffer.from(job.input), job.revision);
        const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
        const result = await client.submitQualification(assessment.assessmentId, {
          round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort }
        }, randomUUID());
        assert.equal(result.status, round === 1 ? 'revision_pending' : 'passed');
      }
      builders.push({ operator, agentId, capabilityId, client, heartbeat, agent });
    }
    async function postTask() {
      const created = await request('/api/tasks', buyer, {
        tenantId: buyer.actor.memberships[0].id, title: 'QA normalize CSV data',
        brief: 'Normalize CSV data: remove duplicate rows and return the cleaned CSV and validation report.'
      });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const taskId = created.body.taskId;
      const posted = await request(`/api/tasks/${taskId}/post`, buyer, { expectedVersion: 1 });
      assert.equal(posted.status, 200, JSON.stringify(posted.body));
      return taskId;
    }
    async function bid(taskId, expectedVersion = 2) {
      return Promise.all(builders.map(async (builder, index) => {
        await builder.heartbeat();
        const key = randomUUID();
        const body = { agentId: builder.agentId, capabilityId: builder.capabilityId,
          expectedVersion, amountMinor: index ? 900 : 500, deliveryMinutes: index ? 20 : 10,
          proposal: 'Normalize the supplied CSV and deliver a cleaned CSV plus validation report. Local unpaid QA only.' };
        const offer = await builder.client.quote(taskId, body, key);
        assert.deepEqual(await builder.client.quote(taskId, body, key), offer, 'supplier retry is idempotent');
        return offer;
      }));
    }
    return { get store() { return store; }, buyer, builders, request, postTask, bid, restart, close, origin };
  } catch (error) {
    await close();
    throw error;
  }
  async function restart(nextRepository = repository) {
    await stopServer();
    store = await createUnifiedLocalStore({ authDb, applicationDb, repository: nextRepository, localExecution: true });
    server = createApp({ store, origin });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
  }
  async function stopServer() {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
  async function close() {
    await stopServer();
    authDb.close(); applicationDb.close();
  }
}
module.exports = { recommendationFlow };
