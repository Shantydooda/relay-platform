'use strict';
// Opt-in real-model integration evaluation. All records live in a disposable database.
const root = require('node:path').resolve(__dirname, '../../..');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, rmSync, readFileSync } = require('node:fs');
const { fork } = require('node:child_process');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const {
  readConfig,
  adminPool,
  migrateLocal,
} = require('../../application/scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../application/src/postgres.cjs');
const { openDatabase } = require('../../poc-api/src/database.cjs');
const {
  createUnifiedLocalStore,
} = require('../../poc-api/src/unified-store.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
async function waitFor(check, label) {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) {
      console.log('PASS:', label);
      return result;
    }
    await delay(1000);
  }
  throw new Error('Evaluation timeout: ' + label);
}
async function main() {
  const config = readConfig(),
    database = 'relay_model_eval_' + Date.now();
  const admin = adminPool(config);
  let native, authDb, server, child;
  const dir = mkdtempSync(join(tmpdir(), 'relay-model-eval-'));
  try {
    await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
    const qaConfig = {
      ...config,
      runtime: { ...config.runtime, database },
      migrator: { ...config.migrator, database },
    };
    await migrateLocal(qaConfig);
    native = await openLocalPostgres(qaConfig.runtime);
    authDb = openDatabase(join(dir, 'identity.sqlite'));
    const objectStore =
      require('../../storage/src/local-objects.cjs').localObjects(
        join(dir, 'objects'),
      );
    const scanConfig = JSON.parse(
      readFileSync(join(root, '.poc-data/scanner.json'), 'utf8'),
    );
    const fileScanner = require('../../storage/src/scanner.cjs').clamScanner(
      scanConfig.executable,
      scanConfig,
    );
    const store = await createUnifiedLocalStore({
      objectStore,
      fileScanner,
      authDb,
      repository: native.repository,
      storage: 'postgres',
      localExecution: true,
    });
    const accounts = {};
    for (const role of ['buyer', 'builder'])
      accounts[role] = await store.register(
        {
          name: 'Model QA ' + role,
          email: role + '@model-eval.example.test',
          password: 'isolated disposable evaluation only',
          workspace: 'buyer',
        },
        role,
      );
    const actor = (role) => store.principal(accounts[role]);
    const agent = await store.marketplace.addAgent(
      actor('builder'),
      {
        name: 'Local AI link extractor',
        kind: 'specialist',
        domain: 'Text extraction',
        purpose: 'Extract supplied web links using a local model',
        integration: 'sdk',
        capabilities: [
          { category: 'Data', task: 'Extract web links from supplied text' },
        ],
      },
      randomUUID(),
    );
    await store.marketplace.configure(
      actor('builder'),
      agent.agentId,
      {
        expectedVersion: 1,
        integration: 'sdk',
        setupStage: 3,
        automaticRequested: true,
        minimumPayout: 100,
        concurrency: 1,
      },
      randomUUID(),
    );
    const credential = await store.issueSupplierCredential(
      actor('builder'),
      agent.agentId,
      { expectedVersion: 2, expiresInSeconds: 3600 },
      randomUUID(),
    );
    const origin = 'http://127.0.0.1:4184';
    server = createApp({ store, origin });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(4184, '127.0.0.1', resolve);
    });
    const configPath = join(dir, 'supplier.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        origin,
        token: credential.token,
        agentId: agent.agentId,
      }),
      { mode: 0o600 },
    );
    child = fork(
      join(root, 'services/model-runtime/src/cli.cjs'),
      ['--config', configPath],
      {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env: {
          ...process.env,
          RELAY_STRIPE_SANDBOX_KEY: '',
          RELAY_STRIPE_WEBHOOK_SECRET: '',
        },
      },
    );
    const principal = await store.runtimePrincipal(credential.token, {
      kind: 'supplier-api',
    });
    await waitFor(async () => {
      const a = (await store.marketplace.agents(actor('builder')))[0];
      return a.runtime?.name?.includes('local AI') && a;
    }, 'SDK heartbeat');
    const metadata = (await store.marketplace.agents(actor('builder')))[0];
    await store.startQualification(
      actor('builder'),
      agent.agentId,
      {
        expectedVersion: metadata.version,
        capabilityId: metadata.capabilities[0].id,
        rubric: 'link-inventory-v1',
      },
      randomUUID(),
    );
    await waitFor(async () => {
      const jobs = await store.qualificationJobs(principal);
      const a = (await store.marketplace.agents(actor('builder')))[0];
      return jobs.length === 0 && JSON.stringify(a).includes('passed');
    }, 'real model qualification plus revision');
    const task = await store.createTask(
      actor('buyer'),
      {
        tenantId: actor('buyer').memberships[0].id,
        title: 'Extract links from the supplied notes',
        brief:
          'Extract web links from this text:\nhttps://zeta.example/docs https://alpha.example/docs https://alpha.example/docs.',
      },
      randomUUID(),
    );
    await store.mutateTask(
      actor('buyer'),
      task.taskId,
      'post',
      { expectedVersion: 1 },
      randomUUID(),
    );
    const offer = await waitFor(
      async () =>
        (await store.marketplace.offers(actor('buyer'), task.taskId))[0],
      'automatic SDK offer',
    );
    let detail = await store.detail(actor('buyer'), task.taskId);
    await store.marketplace.accept(
      actor('buyer'),
      task.taskId,
      { expectedVersion: detail.task.version, offerId: offer.id },
      randomUUID(),
    );
    detail = await store.detail(actor('buyer'), task.taskId);
    await store.authorizeLocal(
      actor('buyer'),
      task.taskId,
      { expectedVersion: detail.task.version, mode: 'local-unpaid' },
      randomUUID(),
    );
    for (let round = 0; round < 2; round++) {
      detail = await waitFor(
        async () => {
          await store.reconcileFileScans();
          const d = await store.detail(actor('buyer'), task.taskId);
          return (
            d.submissions.length === round + 1 &&
            d.submissions.at(-1).status === 'ready' &&
            d
          );
        },
        'model delivery ' + (round + 1) + ' scanned and ready',
      );
      const submission = detail.submissions.at(-1);
      const file = submission.files.find((f) => f.filename === 'links.json');
      const downloaded = await store.download(
        actor('buyer'),
        task.taskId,
        submission.id,
        file.id,
      );
      const links = JSON.parse(downloaded.bytes.toString()).links;
      assert.deepEqual(
        links,
        round
          ? ['https://zeta.example/docs', 'https://alpha.example/docs']
          : ['https://alpha.example/docs', 'https://zeta.example/docs'],
      );
      await store.reviewDelivery(
        actor('buyer'),
        task.taskId,
        round ? 'accept-delivery' : 'request-revision',
        {
          expectedVersion: detail.task.version,
          submissionId: submission.id,
          ...(round ? {} : { notes: 'Sort links descending.' }),
        },
        randomUUID(),
      );
    }
    console.log(
      'PASS: actual local model, qualification, bid, award, execution, scanned download, revision and acceptance. No money or external services.',
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(5000),
      ]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    if (authDb) authDb.close();
    if (native) await native.close();
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await admin.end();
    rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error.code || error.message);
  process.exitCode = 1;
});
