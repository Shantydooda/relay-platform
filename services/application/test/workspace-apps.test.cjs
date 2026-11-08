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
async function fixture(t, postgres = false) {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = postgres
    ? await createPostgresRepository(db, { initialize: true })
    : createSqliteRepository(db);
  const f = await recurringFixture(repository);
  const tenantId = f.buyer.memberships[0].id;
  const source = await f.app.saveToolSource(
    f.buyer,
    { tenantId, name: 'CRM fixture', content: 'name\nZebra\nAcme\nAcme' },
    randomUUID(),
  );
  const installed = await f.app.installApp(
    f.buyer,
    f.taskId,
    {
      expectedVersion: f.config.expectedVersion,
      sourceId: source.sourceId,
      expiresDays: 30,
      consent: 'local-source-read',
    },
    randomUUID(),
  );
  return {
    ...f,
    repository,
    tenantId,
    ...source,
    ...installed,
    view: () => f.app.workspaceApps(f.buyer, tenantId),
  };
}
for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} app trial install, concurrent runs, review, restart and scheduled execution`, async (t) => {
    const f = await fixture(t, postgres),
      { app, buyer, appId } = f;
    let view = await f.view(),
      installed = view.apps[0];
    const body = { expectedVersion: installed.version, action: 'run' },
      key = randomUUID();
    const results = await Promise.all([
      app.controlApp(buyer, appId, body, key),
      app.controlApp(buyer, appId, body, key),
    ]);
    assert.deepEqual(results[0], results[1]);
    view = await f.view();
    assert.equal(view.runs.length, 1);
    assert.equal(view.runs[0].output, 'name\r\nAcme\r\nZebra\r\n');
    const run = view.runs[0];
    await assert.rejects(
      app.controlApp(
        buyer,
        appId,
        { expectedVersion: view.apps[0].version, action: 'run' },
        randomUUID(),
      ),
      { code: 'RUN_NEEDS_REVIEW' },
    );
    await assert.rejects(
      app.reviewAppRun(
        buyer,
        run.id,
        { expectedVersion: 1, action: 'save', outputHash: 'other' },
        randomUUID(),
      ),
      { code: 'REVIEW_STALE' },
    );
    await app.reviewAppRun(
      buyer,
      run.id,
      { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
      randomUUID(),
    );
    assert.equal(
      (await f.repository.read((repo) => repo.get('app-output', run.id)))
        .outputHash,
      run.outputHash,
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
    f.setTime('2026-10-29T09:00Z');
    await Promise.all([
      app.reconcileApps(),
      createApplication(f.options).reconcileApps(),
    ]);
    view = await f.view();
    assert.equal(view.runs.length, 2);
    f.setTime('2026-10-30T09:00Z');
    await app.reconcileApps();
    view = await f.view();
    assert.equal(view.apps[0].status, 'paused');
    assert.equal(view.runs.length, 2);
    assert.ok(view.audit.some((item) => item.action === 'app.blocked'));
  });
test('revocation, expired grants, cross-tenant access and membership epochs fail closed', async (t) => {
  const f = await fixture(t),
    { app, buyer, appId } = f;
  let view = await f.view();
  await assert.rejects(app.workspaceApps(f.outsider, f.tenantId), {
    code: 'NOT_FOUND',
  });
  await assert.rejects(
    app.controlApp(
      f.outsider,
      appId,
      { action: 'run', expectedVersion: 1 },
      randomUUID(),
    ),
    { code: 'NOT_FOUND' },
  );
  await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 1, action: 'run' },
    randomUUID(),
  );
  view = await f.view();
  await app.revokeToolGrant(
    buyer,
    view.grants[0].id,
    { expectedVersion: 1 },
    randomUUID(),
  );
  const run = view.runs[0];
  await assert.rejects(
    app.reviewAppRun(
      buyer,
      run.id,
      { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
      randomUUID(),
    ),
    { code: 'GRANT_REQUIRED' },
  );
  await app.reviewAppRun(
    buyer,
    run.id,
    { expectedVersion: 1, action: 'discard', outputHash: run.outputHash },
    randomUUID(),
  );
  await assert.rejects(
    app.controlApp(
      buyer,
      appId,
      { expectedVersion: 2, action: 'run' },
      randomUUID(),
    ),
    { code: 'GRANT_REQUIRED' },
  );
  await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 2, action: 'renew', consent: 'local-source-read' },
    randomUUID(),
  );
  buyer.memberships[0].accessEpoch++;
  await assert.rejects(
    app.controlApp(
      buyer,
      appId,
      { expectedVersion: 3, action: 'run' },
      randomUUID(),
    ),
    { code: 'GRANT_STALE' },
  );
  await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 3, action: 'renew', consent: 'local-source-read' },
    randomUUID(),
  );
  f.setTime('2026-12-01T09:00Z');
  await assert.rejects(
    app.controlApp(
      buyer,
      appId,
      { expectedVersion: 4, action: 'run' },
      randomUUID(),
    ),
    { code: 'GRANT_REQUIRED' },
  );
});
test('disconnect invalidates old consent; malformed data and duplicate installs cannot produce output', async (t) => {
  const f = await fixture(t),
    { app, buyer, appId } = f;
  const change = {
    tenantId: f.tenantId,
    id: f.sourceId,
    name: 'CRM fixture',
    content: 'name\nAcme',
    expectedVersion: 1,
    action: 'disconnect',
  };
  await app.saveToolSource(buyer, change, randomUUID());
  await app.saveToolSource(
    buyer,
    { ...change, expectedVersion: 2, action: 'save' },
    randomUUID(),
  );
  await assert.rejects(
    app.controlApp(
      buyer,
      appId,
      { expectedVersion: 1, action: 'run' },
      randomUUID(),
    ),
    { code: 'GRANT_STALE' },
  );
  await assert.rejects(
    app.installApp(
      buyer,
      f.taskId,
      {
        expectedVersion: f.config.expectedVersion,
        sourceId: f.sourceId,
        expiresDays: 30,
        consent: 'local-source-read',
      },
      randomUUID(),
    ),
    { code: 'ALREADY_INSTALLED' },
  );
  await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 1, action: 'renew', consent: 'local-source-read' },
    randomUUID(),
  );
  await app.saveToolSource(
    buyer,
    {
      ...change,
      expectedVersion: 3,
      action: 'save',
      content: 'name\n"unclosed',
    },
    randomUUID(),
  );
  await assert.rejects(
    app.controlApp(
      buyer,
      appId,
      { expectedVersion: 2, action: 'run' },
      randomUUID(),
    ),
    { code: 'SOURCE_INVALID' },
  );
  assert.equal((await f.view()).runs.length, 0);
});

test('agent tool calls require assigned agent, current lease and live task-specific consent even on replay', async (t) => {
  const f = await fixture(t),
    { app, buyer } = f;
  await f.create();
  f.setTime('2026-10-29T09:00Z');
  await app.reconcileSchedules();
  const taskId = (await app.listSchedules(buyer, f.tenantId)).schedules[0]
    .latestTaskId;
  await f.quote(taskId);
  await app.reconcileSchedules();
  let detail = await app.detail(buyer, taskId);
  const grant = await app.grantTaskTool(
    buyer,
    taskId,
    {
      expectedVersion: detail.task.version,
      sourceId: f.sourceId,
      expiresDays: 1,
      consent: 'local-source-read',
    },
    randomUUID(),
  );
  const claim = await app.claim(
    f.principal,
    taskId,
    { assignmentId: detail.execution.id },
    randomUUID(),
  );
  const body = { grantId: grant.grantId, leaseToken: claim.leaseToken },
    key = randomUUID();
  const result = await app.readAgentTool(f.principal, taskId, body, key);
  assert.match(result.content, /Zebra/);
  assert.equal(result.untrusted, true);
  assert.equal(
    (await app.supplierAssignment(f.principal, taskId)).toolGrants[0].id,
    grant.grantId,
  );
  await assert.rejects(
    app.readAgentTool(
      f.principal,
      taskId,
      { ...body, leaseToken: 'x'.repeat(43) },
      randomUUID(),
    ),
    { code: 'LEASE_EXPIRED' },
  );
  await assert.rejects(
    app.readAgentTool(
      f.principal,
      taskId,
      { ...body, grantId: (await f.view()).apps[0].grantId },
      randomUUID(),
    ),
    { code: 'GRANT_REQUIRED' },
  );
  await app.revokeToolGrant(
    buyer,
    grant.grantId,
    { expectedVersion: 1 },
    randomUUID(),
  );
  await assert.rejects(app.readAgentTool(f.principal, taskId, body, key), {
    code: 'GRANT_REQUIRED',
  });
  assert.equal(
    (await f.view()).audit.filter((event) => event.action === 'tool.read')
      .length,
    1,
  );
});

test('saved output downloads survive permission expiry but not loss of workspace authority', async (t) => {
  const f = await fixture(t),
    { app, buyer, appId } = f;
  const { runId } = await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 1, action: 'run' },
    randomUUID(),
  );
  await assert.rejects(app.downloadAppOutput(buyer, runId), {
    code: 'NOT_FOUND',
  });
  const run = (await f.view()).runs[0];
  await app.reviewAppRun(
    buyer,
    runId,
    { expectedVersion: 1, outputHash: run.outputHash, action: 'save' },
    randomUUID(),
  );
  f.setTime('2026-12-01T09:00Z');
  assert.equal(
    (await app.downloadAppOutput(buyer, runId)).bytes.toString(),
    run.output,
  );
  await assert.rejects(app.downloadAppOutput(f.outsider, runId), {
    code: 'NOT_FOUND',
  });
  buyer.memberships[0].role = 'employee';
  assert.equal((await f.view()).sources.length, 0);
  await assert.rejects(app.downloadAppOutput(buyer, runId), {
    code: 'ADMIN_REQUIRED',
  });
});

test('configured file scanner blocks unsafe generated downloads', async (t) => {
  const f = await fixture(t),
    { app, buyer, appId } = f;
  const { runId } = await app.controlApp(
    buyer,
    appId,
    { expectedVersion: 1, action: 'run' },
    randomUUID(),
  );
  const run = (await f.view()).runs[0];
  await app.reviewAppRun(
    buyer,
    runId,
    { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
    randomUUID(),
  );
  const blocked = createApplication({
    ...f.options,
    fileScanner: { scan: async () => ({ status: 'blocked' }) },
  });
  await assert.rejects(blocked.downloadAppOutput(buyer, runId), {
    code: 'FILE_QUARANTINED',
  });
  const missing = createApplication({ ...f.options, objectStore: {} });
  await assert.rejects(missing.downloadAppOutput(buyer, runId), {
    code: 'FILE_QUARANTINED',
  });
});

test('Relay hosting is a server-owned paid entitlement with bounded host controls', async (t) => {
  const f = await fixture(t),
    { app, buyer, appId, repository, tenantId } = f;
  let view = await f.view();
  assert.equal(view.hosting.entitlement.plan, 'free');
  assert.equal(view.hosting.entitlement.canHost, false);
  await assert.rejects(
    app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: view.apps[0].version, action: 'provision' },
      randomUUID(),
    ),
    { code: 'SUBSCRIPTION_REQUIRED' },
  );
  await repository.transaction('subscription:' + tenantId, (repo) =>
    repo.save('workspace-subscription', {
      id: tenantId,
      ownerId: buyer.user.id,
      tenantId,
      plan: 'pro',
      status: 'active',
      provider: 'sandbox-fixture',
      version: 1,
    }),
  );
  const provisioned = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: view.apps[0].version, action: 'provision' },
    randomUUID(),
  );
  assert.equal(provisioned.status, 'running');
  view = await f.view();
  assert.equal(view.hosting.entitlement.canHost, true);
  assert.equal(view.hosting.hosts[0].runtime, 'relay-bounded-v1');
  const stopped = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: view.hosting.hosts[0].version, action: 'stop' },
    randomUUID(),
  );
  assert.equal(stopped.status, 'stopped');
  await assert.rejects(
    app.controlAppHost(
      f.outsider,
      appId,
      { expectedVersion: stopped.version, action: 'start' },
      randomUUID(),
    ),
    { code: 'NOT_FOUND' },
  );
  await assert.rejects(
    app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: 1, action: 'start' },
      randomUUID(),
    ),
    { code: 'VERSION_CONFLICT' },
  );
  const restarted = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: stopped.version, action: 'start' },
    randomUUID(),
  );
  await repository.transaction('subscription:' + tenantId, async (repo) => {
    const subscription = await repo.get(
      'workspace-subscription',
      tenantId,
      true,
    );
    subscription.status = 'canceled';
    subscription.version++;
    await repo.save('workspace-subscription', subscription);
  });
  view = await f.view();
  assert.equal(view.hosting.entitlement.canHost, false);
  assert.equal(view.hosting.hosts[0].status, 'subscription_hold');
  const heldStop = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: restarted.version, action: 'stop' },
    randomUUID(),
  );
  await assert.rejects(
    app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: heldStop.version, action: 'start' },
      randomUUID(),
    ),
    { code: 'SUBSCRIPTION_REQUIRED' },
  );
  await repository.transaction('subscription:' + tenantId, async (repo) => {
    const subscription = await repo.get(
      'workspace-subscription',
      tenantId,
      true,
    );
    subscription.status = 'active';
    subscription.version++;
    await repo.save('workspace-subscription', subscription);
  });
  view = await f.view();
  await app.revokeToolGrant(
    buyer,
    view.grants[0].id,
    { expectedVersion: view.grants[0].version },
    randomUUID(),
  );
  await assert.rejects(
    app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: heldStop.version, action: 'start' },
      randomUUID(),
    ),
    { code: 'GRANT_REQUIRED' },
  );
  await app.controlApp(
    buyer,
    appId,
    {
      expectedVersion: view.apps[0].version,
      action: 'renew',
      consent: 'local-source-read',
    },
    randomUUID(),
  );
  const healthy = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: heldStop.version, action: 'start' },
    randomUUID(),
  );
  const removed = await app.controlAppHost(
    buyer,
    appId,
    { expectedVersion: healthy.version, action: 'deprovision' },
    randomUUID(),
  );
  assert.equal(removed.status, 'deleted');
  assert.equal((await f.view()).hosting.hosts.length, 0);
});

test('qualified agents are discoverable and a direct request is bound to the chosen agent', async (t) => {
  const f = await fixture(t),
    { app, buyer, builder, agentId, repository, tenantId } = f;
  const listingAgent = (await app.marketplace.agents(builder)).find(
    (item) => item.id === agentId,
  );
  await app.marketplace.updateListing(
    builder,
    agentId,
    { expectedVersion: listingAgent.version, status: 'published' },
    randomUUID(),
  );
  const buyerCatalog = await app.marketplace.catalog(buyer);
  assert.equal(
    buyerCatalog.find((item) => item.id === agentId).availability,
    'available',
  );
  assert.equal(
    (await app.marketplace.catalog(builder)).some(
      (item) => item.id === agentId,
    ),
    false,
  );
  const created = await app.createTask(
    buyer,
    {
      tenantId,
      title: 'Direct clean-up',
      brief: 'Clean this customer export.',
      preferredAgentId: agentId,
      preferenceMode: 'agent',
    },
    randomUUID(),
  );
  assert.equal(
    (await repository.read((repo) => repo.get('task', created.taskId)))
      .preferredAgentId,
    agentId,
  );
  const builderTask = await app.createTask(
    buyer,
    {
      tenantId,
      title: 'Builder request',
      brief: 'Let this builder choose the right agent.',
      preferredAgentId: agentId,
      preferenceMode: 'builder',
    },
    randomUUID(),
  );
  assert.equal(
    (await repository.read((repo) => repo.get('task', builderTask.taskId)))
      .preferredOperatorId,
    builder.user.id,
  );
  await app.mutateTask(
    buyer,
    builderTask.taskId,
    'post',
    { expectedVersion: builderTask.version },
    randomUUID(),
  );
  assert.equal(
    (await app.marketplace.opportunities(builder)).some(
      (task) => task.id === builderTask.taskId,
    ),
    true,
  );
  assert.equal(
    (await app.marketplace.opportunities(f.outsider)).some(
      (task) => task.id === builderTask.taskId,
    ),
    false,
  );
  await app.mutateTask(
    buyer,
    created.taskId,
    'post',
    { expectedVersion: created.version },
    randomUUID(),
  );
  assert.equal(
    (await app.marketplace.opportunities(builder)).some(
      (task) => task.id === created.taskId,
    ),
    true,
  );
  assert.equal(
    (await app.marketplace.opportunities(f.outsider)).some(
      (task) => task.id === created.taskId,
    ),
    false,
  );
  await assert.rejects(
    app.createTask(
      buyer,
      {
        tenantId,
        title: 'Unknown',
        brief: 'Try an unavailable agent.',
        preferredAgentId: randomUUID(),
        preferenceMode: 'agent',
      },
      randomUUID(),
    ),
    { code: 'NOT_FOUND' },
  );
});

for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} explicit context, permission decisions and snapshot reads`, async (t) => {
    const f = await fixture(t, postgres),
      { app, buyer } = f;
    const { taskId } = await app.createTask(
      buyer,
      {
        tenantId: f.tenantId,
        title: 'Use CRM context',
        brief: 'Normalize supplied CSV using the selected CRM context.',
      },
      randomUUID(),
    );
    const version = async () => (await app.detail(buyer, taskId)).task.version;
    await app.addInput(
      buyer,
      taskId,
      {
        expectedVersion: await version(),
        filename: 'input.csv',
        base64: Buffer.from('name\nAcme\n').toString('base64'),
        notes: 'Input',
      },
      randomUUID(),
    );
    await assert.rejects(
      app.attachTaskContext(
        f.outsider,
        taskId,
        {
          expectedVersion: await version(),
          sourceId: f.sourceId,
          mode: 'snapshot',
        },
        randomUUID(),
      ),
      { code: 'NOT_FOUND' },
    );
    await app.attachTaskContext(
      buyer,
      taskId,
      {
        expectedVersion: await version(),
        sourceId: f.sourceId,
        mode: 'snapshot',
      },
      randomUUID(),
    );
    assert.equal(
      (await app.detail(buyer, taskId)).task.contextReferences[0].content,
      undefined,
    );
    await app.mutateTask(
      buyer,
      taskId,
      'post',
      { expectedVersion: await version() },
      randomUUID(),
    );
    const offer = await f.quote(taskId);
    await app.marketplace.accept(
      buyer,
      taskId,
      { expectedVersion: await version(), offerId: offer.offerId },
      randomUUID(),
    );
    await app.authorizeLocal(
      buyer,
      taskId,
      { expectedVersion: await version(), mode: 'local-unpaid' },
      randomUUID(),
    );
    const ask = {
      sourceId: f.sourceId,
      operation: 'read',
      reason: 'Use the customer records to check the requested output.',
    };
    await assert.rejects(
      app.requestToolPermission(
        f.principal,
        taskId,
        { ...ask, operation: 'write' },
        randomUUID(),
      ),
      { code: 'OPERATION_UNSUPPORTED' },
    );
    await assert.rejects(
      app.requestToolPermission(
        f.principal,
        taskId,
        { ...ask, sourceId: randomUUID() },
        randomUUID(),
      ),
      { code: 'CONTEXT_REQUIRED' },
    );
    const requests = await Promise.all([
      app.requestToolPermission(f.principal, taskId, ask, randomUUID()),
      app.requestToolPermission(f.principal, taskId, ask, randomUUID()),
    ]);
    assert.equal(requests[0].requestId, requests[1].requestId);
    const beforeWait = (await app.detail(buyer, taskId)).execution.deadlineAt;
    f.setTime(beforeWait + 600000);
    await f.heartbeat();
    await createApplication(f.options).reconcileExecutions();
    assert.equal((await app.detail(buyer, taskId)).execution.status, 'queued');
    assert.equal(
      (await app.executionQueue(buyer)).items.find(
        (item) => item.taskId === taskId,
      ).overdue,
      false,
    );
    await app.declineToolPermission(
      buyer,
      taskId,
      { expectedVersion: await version(), requestId: requests[0].requestId },
      randomUUID(),
    );
    await app.reconcileExecutions();
    assert.equal((await app.detail(buyer, taskId)).execution.status, 'queued');
    const request = await app.requestToolPermission(
      f.principal,
      taskId,
      ask,
      randomUUID(),
    );
    const assignment = (await app.detail(buyer, taskId)).execution;
    await assert.rejects(
      app.claim(
        f.principal,
        taskId,
        { assignmentId: assignment.id },
        randomUUID(),
      ),
      { code: 'PERMISSION_PENDING' },
    );
    assert.equal(request.requestId, requests[0].requestId);
    assert.equal(request.status, 'declined');
    const grant = await app.grantTaskTool(
      buyer,
      taskId,
      {
        expectedVersion: await version(),
        requestId: request.requestId,
        sourceId: f.sourceId,
        expiresDays: 1,
        consent: 'local-source-read',
      },
      randomUUID(),
    );
    const claim = await app.claim(
      f.principal,
      taskId,
      { assignmentId: assignment.id },
      randomUUID(),
    );
    const src = (await f.view()).sources[0];
    await app.saveToolSource(
      buyer,
      {
        id: f.sourceId,
        tenantId: f.tenantId,
        expectedVersion: src.version,
        name: src.name,
        content: 'changed',
        action: 'save',
      },
      randomUUID(),
    );
    const output = await app.readAgentTool(
      f.principal,
      taskId,
      { grantId: grant.grantId, leaseToken: claim.leaseToken },
      randomUUID(),
    );
    assert.match(output.content, /Zebra/);
    assert.equal(
      (await app.supplierAssignment(f.principal, taskId)).permissionRequests.at(
        -1,
      ).status,
      'approved',
    );
    await app.revokeToolGrant(
      buyer,
      grant.grantId,
      { expectedVersion: 1 },
      randomUUID(),
    );
    await assert.rejects(
      app.readAgentTool(
        f.principal,
        taskId,
        { grantId: grant.grantId, leaseToken: claim.leaseToken },
        randomUUID(),
      ),
      { code: 'GRANT_REQUIRED' },
    );
    const renewal = await app.requestToolPermission(
      f.principal,
      taskId,
      ask,
      randomUUID(),
    );
    await assert.rejects(
      app.readAgentTool(
        f.principal,
        taskId,
        { grantId: grant.grantId, leaseToken: claim.leaseToken },
        randomUUID(),
      ),
      { code: 'LEASE_EXPIRED' },
    );
    await app.cancelExecution(
      buyer,
      taskId,
      { expectedVersion: await version(), reason: 'Cancel while waiting' },
      randomUUID(),
    );
    await assert.rejects(
      app.grantTaskTool(
        buyer,
        taskId,
        {
          expectedVersion: await version(),
          requestId: renewal.requestId,
          sourceId: f.sourceId,
          expiresDays: 1,
          consent: 'local-source-read',
        },
        randomUUID(),
      ),
      { code: 'ASSIGNMENT_REQUIRED' },
    );
    await assert.rejects(
      app.declineToolPermission(
        buyer,
        taskId,
        { expectedVersion: await version(), requestId: renewal.requestId },
        randomUUID(),
      ),
      { code: 'REQUEST_STALE' },
    );
  });

for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} hosted execution uses worker and blocks lapsed subscriptions and deleted hosts`, async (t) => {
    const f = await fixture(t, postgres),
      { app, buyer, appId, repository, tenantId } = f;
    const subscription = {
      id: tenantId,
      ownerId: buyer.user.id,
      tenantId,
      plan: 'pro',
      status: 'active',
      provider: 'sandbox-fixture',
      version: 1,
    };
    await repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', subscription),
    );
    await app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: 1, action: 'provision' },
      randomUUID(),
    );
    const key = randomUUID();
    const body = { expectedVersion: 1, action: 'run' };
    const runs = await Promise.all([
      app.controlApp(buyer, appId, body, key),
      app.controlApp(buyer, appId, body, key),
    ]);
    assert.deepEqual(runs[0], runs[1]);
    let view = await f.view();
    assert.equal(view.runs.length, 1);
    assert.equal(view.runs[0].execution, 'local-process');
    assert.equal(view.runs[0].output, 'name\r\nAcme\r\nZebra\r\n');
    const run = view.runs[0];
    await app.reviewAppRun(
      buyer,
      run.id,
      { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
      randomUUID(),
    );
    await repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', {
        ...subscription,
        status: 'canceled',
        version: 2,
      }),
    );
    await assert.rejects(
      app.controlApp(
        buyer,
        appId,
        { expectedVersion: 2, action: 'run' },
        randomUUID(),
      ),
      { code: 'SUBSCRIPTION_REQUIRED' },
    );
    await app.controlApp(
      buyer,
      appId,
      { expectedVersion: 2, action: 'schedule', calendar: f.config.calendar },
      randomUUID(),
    );
    f.setTime('2026-10-29T09:00Z');
    await app.reconcileApps();
    view = await f.view();
    assert.equal(view.runs.length, 1);
    assert.equal(view.apps[0].status, 'paused');
    assert.match(view.apps[0].reason, /subscription/);
    await repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', { ...subscription, version: 3 }),
    );
    await app.controlApp(
      buyer,
      appId,
      { expectedVersion: view.apps[0].version, action: 'resume' },
      randomUUID(),
    );
    await app.controlAppHost(
      buyer,
      appId,
      { expectedVersion: 1, action: 'deprovision' },
      randomUUID(),
    );
    view = await f.view();
    await assert.rejects(
      app.controlApp(
        buyer,
        appId,
        { expectedVersion: view.apps[0].version, action: 'run' },
        randomUUID(),
      ),
      { code: 'HOST_STOPPED' },
    );
  });

for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} hosted crash retry keeps saved outputs and rechecks subscription`, async (t) => {
    const f = await fixture(t, postgres);
    const { spawn } = require('node:child_process');
    const {
      createLocalAutomationWorker,
    } = require('../../app-runtime/src/local-worker.cjs');
    let crash = true;
    const worker = createLocalAutomationWorker({
      spawnImpl(executable, args, options) {
        const child = spawn(executable, args, options);
        if (crash) {
          crash = false;
          child.once('spawn', () => child.kill('SIGKILL'));
        }
        return child;
      },
    });
    const app = createApplication({
      ...f.options,
      runHostedAutomation: worker,
    });
    const subscription = {
      id: f.tenantId,
      ownerId: f.buyer.user.id,
      tenantId: f.tenantId,
      plan: 'pro',
      status: 'active',
    };
    await f.repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', subscription),
    );
    await app.controlAppHost(
      f.buyer,
      f.appId,
      { expectedVersion: 1, action: 'provision' },
      randomUUID(),
    );
    const body = { expectedVersion: 1, action: 'run' },
      key = randomUUID();
    await assert.rejects(app.controlApp(f.buyer, f.appId, body, key), {
      code: 'APP_WORKER_FAILED',
    });
    assert.equal((await f.view()).runs.length, 0);
    await f.repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', {
        ...subscription,
        status: 'canceled',
      }),
    );
    await assert.rejects(app.controlApp(f.buyer, f.appId, body, key), {
      code: 'SUBSCRIPTION_REQUIRED',
    });
    await f.repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', subscription),
    );
    await app.controlApp(f.buyer, f.appId, body, key);
    const view = await f.view(),
      run = view.runs[0];
    assert.equal(view.runs.length, 1);
    await app.reviewAppRun(
      f.buyer,
      run.id,
      { expectedVersion: 1, action: 'save', outputHash: run.outputHash },
      randomUUID(),
    );
    await f.repository.transaction('seed', (repo) =>
      repo.save('workspace-subscription', {
        ...subscription,
        status: 'canceled',
      }),
    );
    assert.equal(
      (await app.downloadAppOutput(f.buyer, run.id)).bytes.toString(),
      run.output,
    );
  });
