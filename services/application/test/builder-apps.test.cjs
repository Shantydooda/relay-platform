'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { recurringFixture } = require('./helpers/recurring.cjs');
const { localObjects } = require('../../storage/src/local-objects.cjs');
const manifest = {
  format: 'relay-data-app',
  version: 1,
  name: 'Overdue invoices',
  description: 'Prioritize overdue invoices',
  input: 'json-records',
  steps: [
    { op: 'filter', field: 'daysOverdue', compare: 'gt', value: 0 },
    { op: 'sort', field: 'amount', direction: 'desc' },
  ],
};
async function fixture(t, postgres) {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-builder-app-'));
  t.after(async () => {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const repository = postgres
    ? await createPostgresRepository(db, { initialize: true })
    : createSqliteRepository(db);
  const f = await recurringFixture(repository);
  const options = {
    ...f.options,
    objectStore: localObjects(dir),
    fileScanner: {
      name: 'test fixture only',
      scan: async () => ({ status: 'clean' }),
    },
  };
  const app = createApplication(options);
  const { taskId } = await app.createTask(
    f.buyer,
    {
      tenantId: f.buyer.memberships[0].id,
      title: 'Build an invoice report app',
      brief: 'Build a data app for overdue invoice records.',
    },
    randomUUID(),
  );
  await app.addInput(
    f.buyer,
    taskId,
    {
      expectedVersion: 1,
      filename: 'sample.csv',
      base64: Buffer.from('customer,amount\nA,100').toString('base64'),
      notes: 'Example data shape',
    },
    randomUUID(),
  );
  await app.mutateTask(
    f.buyer,
    taskId,
    'post',
    { expectedVersion: 2 },
    randomUUID(),
  );
  const offer = await f.quote(taskId);
  await app.marketplace.accept(
    f.buyer,
    taskId,
    { expectedVersion: 3, offerId: offer.offerId },
    randomUUID(),
  );
  const version = async () => (await app.detail(f.buyer, taskId)).task.version;
  await app.authorizeLocal(
    f.buyer,
    taskId,
    { expectedVersion: await version(), mode: 'local-unpaid' },
    randomUUID(),
  );
  async function deliver(packageValue = manifest) {
    const detail = await app.detail(f.buyer, taskId);
    const claim = await app.claim(
      f.principal,
      taskId,
      { assignmentId: detail.execution.id },
      randomUUID(),
    );
    return app.submit(
      f.principal,
      taskId,
      {
        leaseToken: claim.leaseToken,
        evidence: 'Invoice report example verified.',
        files: [
          {
            filename: 'relay-app.json',
            mime: 'application/json',
            base64: Buffer.from(JSON.stringify(packageValue)).toString(
              'base64',
            ),
          },
        ],
      },
      randomUUID(),
    );
  }
  const submission = await deliver();
  const tenantId = f.buyer.memberships[0].id;
  const source = await app.saveToolSource(
    f.buyer,
    {
      tenantId,
      name: 'Invoices',
      content: JSON.stringify([
        { customer: 'A', amount: 100, daysOverdue: 3 },
        { customer: 'B', amount: 10, daysOverdue: 0 },
      ]),
    },
    randomUUID(),
  );
  const install = async (key = randomUUID()) =>
    app.installApp(
      f.buyer,
      taskId,
      {
        expectedVersion: await version(),
        sourceId: source.sourceId,
        expiresDays: 1,
        consent: 'local-source-read',
      },
      key,
    );
  const accept = async (id = submission.submissionId) =>
    app.reviewDelivery(
      f.buyer,
      taskId,
      'accept-delivery',
      { expectedVersion: await version(), submissionId: id },
      randomUUID(),
    );
  return {
    ...f,
    app,
    options,
    repository,
    taskId,
    version,
    deliver,
    submission,
    tenantId,
    source,
    install,
    accept,
    view: () => app.workspaceApps(f.buyer, tenantId),
  };
}
for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} delivered app requires scanning and acceptance; installs once, runs and saves after restart`, async (t) => {
    const f = await fixture(t, postgres);
    await assert.rejects(f.install(), { code: 'TRIAL_REQUIRED' });
    await assert.rejects(f.accept(), { code: 'FILE_QUARANTINED' });
    await f.app.reconcileFileScans();
    await f.accept();
    const key = randomUUID();
    const installed = await Promise.all([f.install(key), f.install(key)]);
    assert.deepEqual(installed[0], installed[1]);
    await assert.rejects(f.install(), { code: 'ALREADY_INSTALLED' });
    let view = await f.view();
    assert.equal(view.apps.length, 1);
    assert.deepEqual(view.apps[0].appPackage, manifest);
    assert.equal(view.apps[0].calendar, null);
    // Installed behavior is pinned, not loaded again from mutable delivery bytes.
    const deliveryFile = (await f.app.detail(f.buyer, f.taskId)).submissions.at(
      -1,
    ).files[0];
    await f.repository.transaction(f.taskId, async (repo) => {
      const artifact = await repo.get('artifact', deliveryFile.id);
      artifact.objectKey = f.options.objectStore.put(Buffer.from('{}'));
      await repo.save('artifact', artifact);
    });
    const restarted = createApplication(f.options);
    await restarted.controlApp(
      f.buyer,
      installed[0].appId,
      { expectedVersion: 1, action: 'run' },
      randomUUID(),
    );
    view = await f.view();
    const run = view.runs[0];
    assert.equal(run.packageHash, view.apps[0].packageHash);
    assert.equal(run.stepEvidence.length, 2);
    assert.deepEqual(JSON.parse(run.output), [
      { customer: 'A', amount: 100, daysOverdue: 3 },
    ]);
    await assert.rejects(restarted.downloadAppOutput(f.buyer, run.id), {
      code: 'NOT_FOUND',
    });
    await restarted.reviewAppRun(
      f.buyer,
      run.id,
      { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
      randomUUID(),
    );
    assert.equal(
      (await restarted.downloadAppOutput(f.buyer, run.id)).bytes.toString(),
      run.output,
    );
    await assert.rejects(
      restarted.controlApp(
        f.outsider,
        installed[0].appId,
        { expectedVersion: 2, action: 'run' },
        randomUUID(),
      ),
      { code: 'NOT_FOUND' },
    );
    await restarted.revokeToolGrant(
      f.buyer,
      view.apps[0].grantId,
      { expectedVersion: 1 },
      randomUUID(),
    );
    await assert.rejects(
      restarted.controlApp(
        f.buyer,
        installed[0].appId,
        { expectedVersion: 2, action: 'run' },
        randomUUID(),
      ),
      { code: 'GRANT_REQUIRED' },
    );
  });
test('revised app installs the accepted version; corrupted package cannot install', async (t) => {
  const f = await fixture(t, false);
  await f.app.reconcileFileScans();
  await f.app.reviewDelivery(
    f.buyer,
    f.taskId,
    'request-revision',
    {
      expectedVersion: await f.version(),
      submissionId: f.submission.submissionId,
      notes: 'Please show only the highest overdue invoice.',
    },
    randomUUID(),
  );
  const revised = {
    ...manifest,
    steps: [...manifest.steps, { op: 'limit', count: 1 }],
  };
  const submission = await f.deliver(revised);
  await f.app.reconcileFileScans();
  await f.accept(submission.submissionId);
  const file = (await f.app.detail(f.buyer, f.taskId)).submissions.at(-1)
    .files[0];
  await f.repository.transaction(f.taskId, async (repo) => {
    const artifact = await repo.get('artifact', file.id);
    artifact.sha256 = 'bad';
    artifact.objectKey = f.options.objectStore.put(Buffer.from('{}'));
    await repo.save('artifact', artifact);
  });
  await assert.rejects(f.install(), { code: 'FILE_UNAVAILABLE' });
  assert.equal((await f.view()).apps.length, 0);
  // Restore exact accepted bytes; installation must pin the revised package.
  await f.repository.transaction(f.taskId, async (repo) => {
    const artifact = await repo.get('artifact', file.id);
    artifact.sha256 = file.sha256;
    artifact.objectKey = f.options.objectStore.put(
      Buffer.from(JSON.stringify(revised)),
    );
    await repo.save('artifact', artifact);
  });
  await f.install();
  assert.deepEqual((await f.view()).apps[0].appPackage, revised);
});
test('valid JSON containing unsupported code never falls back to a built-in recipe', async (t) => {
  const f = await fixture(t, false);
  await f.app.reconcileFileScans();
  await f.app.reviewDelivery(
    f.buyer,
    f.taskId,
    'request-revision',
    {
      expectedVersion: await f.version(),
      submissionId: f.submission.submissionId,
      notes: 'Change the requested report.',
    },
    randomUUID(),
  );
  const submission = await f.deliver({
    ...manifest,
    steps: [{ op: 'shell', command: 'whoami' }],
  });
  await f.app.reconcileFileScans();
  await f.accept(submission.submissionId);
  await assert.rejects(f.install(), { code: 'APP_UNSUPPORTED' });
  assert.equal((await f.view()).grants.length, 0);
});
