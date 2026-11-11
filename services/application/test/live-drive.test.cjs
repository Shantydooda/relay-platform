'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { recurringFixture } = require('./helpers/recurring.cjs');
const { createGoogleDrive } = require('../../connectors/src/google-drive.cjs');

async function fixture(t, postgres) {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = postgres
    ? await createPostgresRepository(db, { initialize: true })
    : createSqliteRepository(db);
  const f = await recurringFixture(repository);
  f.buyer.csrf = 'fixture-session';
  const remote = {
    content: 'name\nOriginal\n',
    version: '1',
    denied: false,
    afterRead: null,
  };
  const provider = createGoogleDrive({
    clientId: 'fixture',
    clientSecret: 'fixture',
    apiKey: 'fixture',
    projectNumber: '123',
    encryptionKey: 'ab'.repeat(32),
    origin: 'http://127.0.0.1:4180',
    fetchImpl: async (url) => {
      if (url.includes('/token'))
        return Response.json({
          access_token: 'fixture-access',
          refresh_token: 'fixture-refresh',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      if (url.includes('/revoke')) return new Response('');
      if (remote.denied) return new Response('', { status: 401 });
      if (url.includes('fields='))
        return Response.json({
          id: 'file1',
          name: 'Live customer data',
          mimeType: 'text/csv',
          version: remote.version,
          capabilities: { canDownload: true },
        });
      remote.afterRead?.();
      return new Response(remote.content);
    },
  });
  const app = createApplication({ ...f.options, driveProvider: provider });
  const tenantId = f.buyer.memberships[0].id;
  async function connect() {
    const begin = await app.beginDrive(f.buyer, { tenantId });
    await app.completeDrive(f.buyer, {
      tenantId,
      state: new URL(begin.url).searchParams.get('state'),
      code: 'fixture-code',
    });
  }
  await connect();
  const link = () =>
    app.importDriveFile(f.buyer, {
      tenantId,
      fileId: 'file1',
      mode: 'live',
      consent: 'read-latest-selected-file',
    });
  const { sourceId } = await link();
  return {
    ...f,
    options: { ...f.options, driveProvider: provider },
    app,
    remote,
    repository,
    tenantId,
    sourceId,
    connect,
    link,
    view: () => app.workspaceApps(f.buyer, tenantId),
  };
}

for (const postgres of [false, true]) {
  test(`${postgres ? 'postgres' : 'sqlite'} live automation reads fresh input, records exact versions and pauses on provider failure`, async (t) => {
    const f = await fixture(t, postgres),
      { app, buyer, remote } = f;
    await assert.rejects(
      app.importDriveFile(buyer, {
        tenantId: f.tenantId,
        fileId: 'file1',
        mode: 'live',
      }),
      { code: 'CONSENT_REQUIRED' },
    );
    const { appId } = await app.installApp(
      buyer,
      f.taskId,
      {
        expectedVersion: f.config.expectedVersion,
        sourceId: f.sourceId,
        expiresDays: 30,
        consent: 'local-source-read',
      },
      randomUUID(),
    );
    remote.content = 'name\nFresh\n';
    remote.version = '2';
    await app.controlApp(
      buyer,
      appId,
      { expectedVersion: 1, action: 'run' },
      randomUUID(),
    );
    let view = await f.view();
    assert.equal(view.sources[0].version, 2);
    assert.equal(view.runs[0].inputSnapshot, remote.content);
    assert.match(view.runs[0].output, /Fresh/);
    assert.equal(view.runs[0].sourceVersion, 2);
    const old = await f.repository.read((repo) =>
      repo.get('tool-source-version', `${f.sourceId}:1`),
    );
    assert.match(old.content, /Original/);
    const run = view.runs[0];
    await app.reviewAppRun(
      buyer,
      run.id,
      { expectedVersion: 1, action: 'discard', outputHash: run.outputHash },
      randomUUID(),
    );
    await app.controlApp(
      buyer,
      appId,
      {
        expectedVersion: view.apps[0].version,
        action: 'schedule',
        calendar: f.config.calendar,
      },
      randomUUID(),
    );
    remote.content = 'name\nScheduled fresh\n';
    remote.version = '3';
    f.setTime('2026-10-29T09:00:00Z');
    await Promise.all([
      app.reconcileApps(),
      createApplication(f.options).reconcileApps(),
    ]);
    view = await f.view();
    assert.equal(view.runs.length, 2);
    const scheduledRun = view.runs.find((item) => item.sourceVersion === 3);
    assert.equal(scheduledRun.inputSnapshot, remote.content);
    await app.reviewAppRun(
      buyer,
      scheduledRun.id,
      {
        expectedVersion: 1,
        action: 'discard',
        outputHash: scheduledRun.outputHash,
      },
      randomUUID(),
    );
    remote.denied = true;
    f.setTime('2026-10-30T09:00:00Z');
    await app.reconcileApps();
    view = await f.view();
    assert.equal(view.apps[0].status, 'paused');
    assert.equal(view.runs.length, 2);
    assert.equal(view.sources[0].content, 'name\nScheduled fresh\n');
  });

  test(`${postgres ? 'postgres' : 'sqlite'} latest task reads recheck access; snapshots remain pinned; relinking invalidates old grants`, async (t) => {
    const f = await fixture(t, postgres),
      { app, buyer, remote } = f;
    async function task(mode) {
      const { taskId } = await app.createTask(
        buyer,
        {
          tenantId: f.tenantId,
          title: 'CSV with context',
          brief: 'Normalize the supplied CSV.',
        },
        randomUUID(),
      );
      const version = async () =>
        (await app.detail(buyer, taskId)).task.version;
      await app.addInput(
        buyer,
        taskId,
        {
          expectedVersion: await version(),
          filename: 'in.csv',
          base64: Buffer.from('name\nTest').toString('base64'),
          notes: 'Fixture',
        },
        randomUUID(),
      );
      await app.attachTaskContext(
        buyer,
        taskId,
        { expectedVersion: await version(), sourceId: f.sourceId, mode },
        randomUUID(),
      );
      await app.mutateTask(
        buyer,
        taskId,
        'post',
        { expectedVersion: await version() },
        randomUUID(),
      );
      const quote = await f.quote(taskId);
      await app.marketplace.accept(
        buyer,
        taskId,
        { expectedVersion: await version(), offerId: quote.offerId },
        randomUUID(),
      );
      await app.authorizeLocal(
        buyer,
        taskId,
        { expectedVersion: await version(), mode: 'local-unpaid' },
        randomUUID(),
      );
      const grantBody = {
        expectedVersion: await version(),
        sourceId: f.sourceId,
        expiresDays: 1,
        consent: 'local-source-read',
      };
      const grantKey = randomUUID();
      const usage = async () =>
        (await f.repository.read((r) => r.get('drive-usage', f.tenantId)))
          .count;
      const beforeGrant = await usage();
      if (mode !== 'snapshot') {
        remote.denied = true;
        await assert.rejects(
          app.grantTaskTool(buyer, taskId, grantBody, grantKey),
        );
        remote.denied = false;
        assert.equal(await usage(), beforeGrant + 1);
      }
      const grant = await app.grantTaskTool(buyer, taskId, grantBody, grantKey);
      const afterGrant = await usage();
      assert.equal(afterGrant, beforeGrant + (mode === 'snapshot' ? 0 : 2));
      assert.deepEqual(
        await app.grantTaskTool(buyer, taskId, grantBody, grantKey),
        grant,
      );
      assert.equal(await usage(), afterGrant);
      const detail = await app.detail(buyer, taskId);
      const claim = await app.claim(
        f.principal,
        taskId,
        { assignmentId: detail.execution.id },
        randomUUID(),
      );
      return {
        taskId,
        version,
        grant,
        claim,
        read: () =>
          app.readAgentTool(
            f.principal,
            taskId,
            { grantId: grant.grantId, leaseToken: claim.leaseToken },
            randomUUID(),
          ),
      };
    }
    const pinned = await task('snapshot');
    remote.content = 'name\nUpdated\n';
    remote.version = '2';
    const usage = () =>
      f.repository.read((repo) => repo.get('drive-usage', f.tenantId));
    const initialUsage = (await usage()).count;
    assert.match((await pinned.read()).content, /Original/);
    assert.equal(
      (await usage()).count,
      initialUsage,
      'pinned reads use no provider allowance',
    );
    await app.cancelExecution(
      buyer,
      pinned.taskId,
      { expectedVersion: await pinned.version(), reason: 'End fixture' },
      randomUUID(),
    );
    const latest = await task('latest');
    remote.content = 'name\nNewest\n';
    remote.version = '3';
    const output = await latest.read();
    assert.match(output.content, /Newest/);
    const reads = (await app.detail(buyer, latest.taskId)).task.contextReads;
    assert.equal(reads.at(-1).version, output.version);
    assert.ok(reads.at(-1).contentHash);
    await f.repository.transaction(`task:${latest.taskId}`, async (repo) => {
      const task = await repo.get('task', latest.taskId);
      task.contextBudget.reservedBytes = 1024000;
      await repo.save('task', task);
    });
    let blockedReads = 0;
    remote.afterRead = () => blockedReads++;
    await assert.rejects(latest.read(), { code: 'CONTEXT_DATA_LIMIT' });
    assert.equal(blockedReads, 0);
    remote.afterRead = null;
    await f.repository.transaction(`task:${latest.taskId}`, async (repo) => {
      const task = await repo.get('task', latest.taskId);
      task.contextBudget.reservedBytes = 48000;
      await repo.save('task', task);
    });
    remote.denied = true;
    await assert.rejects(latest.read(), { code: 'DRIVE_RECONNECT' });
    remote.denied = false;
    assert.equal(
      (await usage()).count,
      initialUsage + 4,
      'success and provider failure both count',
    );
    await f.repository.transaction('quota-fixture', async (repo) => {
      const row = await repo.get('drive-usage', f.tenantId);
      row.count = 120;
      await repo.save('drive-usage', row);
    });
    const restarted = createApplication(f.options);
    await assert.rejects(
      restarted.readAgentTool(
        f.principal,
        latest.taskId,
        { grantId: latest.grant.grantId, leaseToken: latest.claim.leaseToken },
        randomUUID(),
      ),
      { code: 'DRIVE_WORKSPACE_LIMIT' },
    );
    await assert.rejects(
      restarted.readAgentTool(
        f.principal,
        latest.taskId,
        { grantId: latest.grant.grantId, leaseToken: 'x'.repeat(43) },
        randomUUID(),
      ),
      { code: 'LEASE_EXPIRED' },
    );
    assert.equal((await usage()).count, 120);
    await f.repository.transaction('quota-fixture', async (repo) => {
      const row = await repo.get('drive-usage', f.tenantId);
      row.count = initialUsage + 4;
      await repo.save('drive-usage', row);
    });
    const status = await app.driveStatus(buyer, f.tenantId);
    await app.disconnectDrive(buyer, {
      tenantId: f.tenantId,
      expectedVersion: status.version,
    });
    await assert.rejects(latest.read(), { code: 'DRIVE_RECONNECT' });
    await f.connect();
    await assert.rejects(latest.read(), { code: 'DRIVE_RECONNECT' });
    assert.equal((await f.link()).sourceId, f.sourceId);
    await assert.rejects(latest.read(), { code: 'GRANT_STALE' });
    const renewed = await app.grantTaskTool(
      buyer,
      latest.taskId,
      {
        expectedVersion: await latest.version(),
        sourceId: f.sourceId,
        expiresDays: 1,
        consent: 'local-source-read',
      },
      randomUUID(),
    );
    remote.afterRead = () => f.setTime(f.options.now() + 600000);
    await assert.rejects(
      app.readAgentTool(
        f.principal,
        latest.taskId,
        { grantId: renewed.grantId, leaseToken: latest.claim.leaseToken },
        randomUUID(),
      ),
      { code: 'LEASE_EXPIRED' },
    );
  });
}

for (const postgres of [false, true]) {
  test(`${postgres ? 'postgres' : 'sqlite'} scheduled Drive admission survives failed reads and restart; exhaustion pauses without provider access`, async (t) => {
    const f = await fixture(t, postgres);
    const { appId } = await f.app.installApp(
      f.buyer,
      f.taskId,
      {
        expectedVersion: f.config.expectedVersion,
        sourceId: f.sourceId,
        expiresDays: 30,
        consent: 'local-source-read',
      },
      randomUUID(),
    );
    await f.app.controlApp(
      f.buyer,
      appId,
      { expectedVersion: 1, action: 'schedule', calendar: f.config.calendar },
      randomUUID(),
    );
    f.setTime('2026-10-29T09:00Z');
    const resetAt = Date.parse('2026-10-29T11:00Z');
    await f.repository.transaction('quota-fixture', (r) =>
      r.save('drive-usage', {
        id: f.tenantId,
        ownerId: f.tenantId,
        tenantId: f.tenantId,
        count: 119,
        resetAt,
      }),
    );
    f.remote.denied = true;
    await f.app.reconcileApps();
    assert.equal(
      (await f.repository.read((r) => r.get('drive-usage', f.tenantId))).count,
      120,
    );
    let view = await f.view();
    assert.equal(view.apps[0].status, 'paused');
    assert.equal(view.runs.length, 0);
    const restarted = createApplication(f.options);
    // Put the existing schedule back due, without changing its permission/terms.
    await f.repository.transaction('due-fixture', async (r) => {
      const app = await r.get('workspace-app', appId, true);
      app.status = 'active';
      app.nextAt = Date.parse('2026-10-29T09:00Z');
      await r.save('workspace-app', app);
    });
    f.remote.denied = false;
    let reads = 0;
    f.remote.afterRead = () => reads++;
    await Promise.all([restarted.reconcileApps(), f.app.reconcileApps()]);
    view = await f.view();
    assert.equal(reads, 0);
    assert.equal(view.runs.length, 0);
    assert.equal(view.apps[0].status, 'paused');
    assert.match(view.apps[0].reason, /allowance/);
    assert.equal(
      (await f.repository.read((r) => r.get('drive-usage', f.tenantId))).count,
      120,
    );
    f.setTime('2026-10-29T11:00Z');
    await restarted.controlApp(
      f.buyer,
      appId,
      { expectedVersion: view.apps[0].version, action: 'resume' },
      randomUUID(),
    );
    f.setTime('2026-10-30T09:00Z');
    await Promise.all([restarted.reconcileApps(), f.app.reconcileApps()]);
    view = await f.view();
    assert.equal(view.runs.length, 1);
    assert.equal(reads, 1);
    const usage = await f.repository.read((r) =>
      r.get('drive-usage', f.tenantId),
    );
    assert.ok(usage.count >= 1 && usage.count <= 2);
    await restarted.reconcileApps();
    assert.equal(reads, 1);
  });
}

test('scheduled admission rechecks a changed source before provider access', async (t) => {
  const f = await fixture(t, false);
  const { appId } = await f.app.installApp(
    f.buyer,
    f.taskId,
    {
      expectedVersion: f.config.expectedVersion,
      sourceId: f.sourceId,
      expiresDays: 30,
      consent: 'local-source-read',
    },
    randomUUID(),
  );
  await f.app.controlApp(
    f.buyer,
    appId,
    { expectedVersion: 1, action: 'schedule', calendar: f.config.calendar },
    randomUUID(),
  );
  f.setTime('2026-10-29T09:00Z');
  let changed = false,
    reads = 0;
  f.remote.afterRead = () => reads++;
  const repository = {
    ...f.repository,
    transaction: async (key, work) => {
      const result = await f.repository.transaction(key, work);
      if (key === `app:${appId}` && !changed) {
        changed = true;
        await f.repository.transaction('source-change-fixture', async (r) => {
          const source = await r.get('tool-source', f.sourceId, true);
          source.version++;
          await r.save('tool-source', source);
        });
      }
      return result;
    },
  };
  await createApplication({ ...f.options, repository }).reconcileApps();
  const view = await f.view();
  assert.equal(reads, 0);
  assert.equal(view.runs.length, 0);
  assert.equal(view.apps[0].status, 'paused');
  assert.ok(
    view.audit.some(
      (item) =>
        item.action === 'app.blocked' &&
        item.details?.code === 'SOURCE_CHANGED',
    ) || view.apps[0].reason.includes('source'),
  );
  assert.equal(
    (await f.repository.read((r) => r.get('drive-usage', f.tenantId))).count,
    1,
  );
});

test('manual runs and context snapshots retain failed admission and replay success without another charge', async (t) => {
  const f = await fixture(t, false);
  const usage = async () =>
    (await f.repository.read((r) => r.get('drive-usage', f.tenantId))).count;
  const initial = await usage();
  const { appId } = await f.app.installApp(
    f.buyer,
    f.taskId,
    {
      expectedVersion: f.config.expectedVersion,
      sourceId: f.sourceId,
      expiresDays: 30,
      consent: 'local-source-read',
    },
    randomUUID(),
  );
  f.remote.denied = true;
  const body = { expectedVersion: 1, action: 'run' },
    key = randomUUID();
  await assert.rejects(f.app.controlApp(f.buyer, appId, body, key));
  assert.equal(await usage(), initial + 1);
  f.remote.denied = false;
  const result = await f.app.controlApp(f.buyer, appId, body, key);
  assert.equal(await usage(), initial + 2);
  assert.deepEqual(await f.app.controlApp(f.buyer, appId, body, key), result);
  assert.equal(await usage(), initial + 2);
  const { taskId } = await f.app.createTask(
    f.buyer,
    {
      tenantId: f.tenantId,
      title: 'Snapshot task',
      brief: 'Review supplied context',
    },
    randomUUID(),
  );
  const snapshot = {
      expectedVersion: 1,
      sourceId: f.sourceId,
      mode: 'snapshot',
    },
    snapshotKey = randomUUID();
  f.remote.denied = true;
  await assert.rejects(
    f.app.attachTaskContext(f.buyer, taskId, snapshot, snapshotKey),
  );
  assert.equal(await usage(), initial + 3);
  f.remote.denied = false;
  await f.app.attachTaskContext(f.buyer, taskId, snapshot, snapshotKey);
  assert.equal(await usage(), initial + 4);
  await f.app.attachTaskContext(f.buyer, taskId, snapshot, snapshotKey);
  assert.equal(await usage(), initial + 4);
  const detail = await f.app.detail(f.buyer, taskId);
  assert.equal(detail.task.contextReferences[0].mode, 'snapshot');
});

for (const postgres of [false, true]) {
  test(`${postgres ? 'postgres' : 'sqlite'} aggregate snapshot allowance survives failure and restart and blocks provider reads`, async (t) => {
    const f = await fixture(t, postgres);
    const { taskId } = await f.app.createTask(
      f.buyer,
      { tenantId: f.tenantId, title: 'Bounded sources', brief: 'Review data' },
      randomUUID(),
    );
    const body = { expectedVersion: 1, sourceId: f.sourceId, mode: 'snapshot' };
    f.remote.denied = true;
    for (let i = 0; i < 9; i++)
      await assert.rejects(
        f.app.attachTaskContext(f.buyer, taskId, body, randomUUID()),
      );
    const competing = await Promise.allSettled(
      [0, 1].map(() =>
        f.app.attachTaskContext(f.buyer, taskId, body, randomUUID()),
      ),
    );
    assert.deepEqual(
      competing.map((result) => result.reason.code).sort(),
      ['CONTEXT_DATA_LIMIT', 'DRIVE_RECONNECT'].sort(),
    );
    const task = await f.repository.read((r) => r.get('task', taskId));
    assert.equal(task.contextBudget.reservedBytes, 160000);
    f.remote.denied = false;
    let reads = 0;
    f.remote.afterRead = () => reads++;
    const restarted = createApplication(f.options);
    await assert.rejects(
      restarted.attachTaskContext(f.buyer, taskId, body, randomUUID()),
      { code: 'CONTEXT_DATA_LIMIT' },
    );
    assert.equal(reads, 0);
    assert.equal((await restarted.detail(f.buyer, taskId)).task.version, 1);
  });
}
