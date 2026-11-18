'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const { createOllamaProvider } = require('../../scoping/src/ollama.cjs');
const {
  validateProposal,
} = require('../../../packages/contracts/src/scope-proposal.cjs');
const proposal = () => ({
  reply: 'I have the output and schedule. Which timezone should I use?',
  title: 'Weekly company research',
  brief:
    'Every Monday find 50 German ecommerce companies with source links and deliver a CSV.',
  questions: [
    'Which timezone and time on Monday?',
    'What is the monthly budget cap?',
  ],
  assumptions: [],
  intent: 'request',
  cadence: 'weekly',
  schedule: 'Every Monday',
  timezone: null,
  perRunBudget: null,
  monthlyCap: null,
});
async function fixture(t, adapter, provider) {
  const db =
    adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
  t.after(() => db.close());
  const repository =
    adapter === 'sqlite'
      ? createSqliteRepository(db)
      : await createPostgresRepository(db, { initialize: true });
  let time = Date.now();
  const actor = {
    user: { id: randomUUID(), name: 'Buyer' },
    memberships: [{ id: randomUUID(), role: 'owner' }],
  };
  const app = createApplication({
    repository,
    now: () => time,
    scopingProvider: provider,
  });
  const { taskId } = await app.createTask(
    actor,
    {
      tenantId: actor.memberships[0].id,
      title: 'Research',
      brief:
        'Every Monday find 50 German ecommerce companies with source links. CSV.',
    },
    randomUUID(),
  );
  return {
    app,
    actor,
    taskId,
    repository,
    advance: (delta) => (time += delta),
  };
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: local scoping persists, replays and confirms recurring draft without activating work`, async (t) => {
    let calls = 0;
    const f = await fixture(t, adapter, {
      async propose() {
        calls++;
        return proposal();
      },
    });
    const key = randomUUID(),
      input = { expectedVersion: 1, message: 'Keep it to 50 companies.' };
    const job = await f.app.assist(f.actor, f.taskId, input, key);
    await f.app.waitForScoping();
    assert.deepEqual(await f.app.assist(f.actor, f.taskId, input, key), job);
    await f.app.waitForScoping();
    assert.equal(calls, 1);
    let detail = await f.app.detail(f.actor, f.taskId);
    assert.equal(detail.task.scopeVersion, 1);
    assert.equal(detail.messages.length, 3);
    assert.equal(detail.messages.at(-1).role, 'assistant');
    assert.equal(detail.messages.at(-1).body, proposal().questions.join('\n'));
    assert.equal(detail.task.scoping.proposal.timezone, null);
    const changed = await f.app.confirmScope(
      f.actor,
      f.taskId,
      { expectedVersion: detail.task.version, proposalId: job.jobId },
      randomUUID(),
    );
    detail = await f.app.detail(f.actor, f.taskId);
    assert.equal(detail.task.scopeVersion, 2);
    assert.equal(detail.task.workPlan.status, 'proposed_not_active');
    assert.equal(detail.scopes.at(-1).workPlan.cadence, 'weekly');
    await assert.rejects(
      f.app.mutateTask(
        f.actor,
        f.taskId,
        'post',
        { expectedVersion: changed.version },
        randomUUID(),
      ),
      { code: 'RECURRING_NOT_ENABLED' },
    );
    const saved = await f.repository.read((repo) =>
      repo.get('scoping-job', job.jobId),
    );
    assert.equal(saved.snapshot, undefined);
  });
  test(`${adapter}: late inference cannot overwrite edits; unauthorized callers cannot start or replay`, async (t) => {
    let resolve;
    const f = await fixture(t, adapter, {
      propose: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    const key = randomUUID(),
      input = { expectedVersion: 1 };
    await f.app.assist(f.actor, f.taskId, input, key);
    while (!resolve) await new Promise((done) => setImmediate(done));
    await f.app.mutateTask(
      f.actor,
      f.taskId,
      'scope',
      { expectedVersion: 2, title: 'New scope', brief: 'Do one run only.' },
      randomUUID(),
    );
    resolve(proposal());
    await f.app.waitForScoping();
    const detail = await f.app.detail(f.actor, f.taskId);
    assert.equal(detail.task.brief, 'Do one run only.');
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.task.scoping, null);
    await assert.rejects(
      f.app.assist({ ...f.actor, memberships: [] }, f.taskId, input, key),
      { code: 'NOT_FOUND' },
    );
  });
}
test('failure, interrupted jobs, stale confirmation and question-only replies stay non-authoritative', async (t) => {
  const f = await fixture(t, 'sqlite', {
    async propose() {
      throw new Error('sensitive provider failure');
    },
  });
  await f.app.assist(f.actor, f.taskId, { expectedVersion: 1 }, randomUUID());
  await f.app.waitForScoping();
  let detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.task.scoping.status, 'failed');
  assert.ok(!JSON.stringify(detail).includes('sensitive'));
  assert.equal(detail.task.scopeVersion, 1);
  const q = await fixture(t, 'sqlite', {
    async propose(snapshot) {
      return {
        ...proposal(),
        intent: 'question',
        title: 'Wrong title',
        brief: 'A changed scope must not be adopted.',
        timezone: 'Europe/Berlin',
      };
    },
  });
  const job = await q.app.assist(
    q.actor,
    q.taskId,
    { expectedVersion: 1, message: 'How much would this cost?' },
    randomUUID(),
  );
  await q.app.waitForScoping();
  detail = await q.app.detail(q.actor, q.taskId);
  assert.equal(
    detail.task.scoping.proposal.brief,
    'Every Monday find 50 German ecommerce companies with source links. CSV.',
  );
  assert.equal(detail.task.scoping.proposal.timezone, null);
  await assert.rejects(
    q.app.confirmScope(
      q.actor,
      q.taskId,
      { expectedVersion: detail.task.version, proposalId: job.jobId },
      randomUUID(),
    ),
    { code: 'NOT_A_SCOPE_CHANGE' },
  );
  await assert.rejects(
    q.app.confirmScope(
      q.actor,
      q.taskId,
      { expectedVersion: 1, proposalId: job.jobId },
      randomUUID(),
    ),
    { code: 'VERSION_CONFLICT' },
  );
});
test('local provider refuses remote destinations, redirects, malformed schemas and invalid timezones', async () => {
  assert.throws(() => createOllamaProvider({ origin: 'https://example.com' }));
  assert.throws(() => createOllamaProvider({ model: 'qwen-cloud' }));
  assert.throws(
    () => validateProposal({ ...proposal(), timezone: 'Mars/City' }),
    { code: 'INVALID_MODEL_OUTPUT' },
  );
  assert.throws(() => validateProposal({ ...proposal(), tools: ['charge'] }), {
    code: 'INVALID_MODEL_OUTPUT',
  });
  let sent;
  const provider = createOllamaProvider({
    fetch: async (url, options) => {
      sent = { url: String(url), options };
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(proposal()) } }),
      );
    },
  });
  assert.equal(
    (await provider.propose({ brief: 'Research', messages: [] })).cadence,
    'weekly',
  );
  assert.equal(sent.url, 'http://127.0.0.1:11435/api/chat');
  assert.equal(sent.options.redirect, 'error');
  assert.equal(JSON.parse(sent.options.body).stream, false);
});

test('interrupted job expires without discarding the saved message or allowing an old reply', async (t) => {
  let resolve;
  const f = await fixture(t, 'sqlite', {
    propose: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const body = { expectedVersion: 1, message: 'Add source links.' },
    key = randomUUID();
  await f.app.assist(f.actor, f.taskId, body, key);
  while (!resolve) await new Promise((done) => setImmediate(done));
  await assert.rejects(
    f.app.assist(
      f.actor,
      f.taskId,
      { expectedVersion: 2, message: 'Another message' },
      randomUUID(),
    ),
    { code: 'SCOPING_BUSY' },
  );
  await assert.rejects(
    f.app.assist(
      f.actor,
      f.taskId,
      { ...body, message: 'Changed retry payload' },
      key,
    ),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  f.advance(180001);
  const detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.task.scoping.status, 'failed');
  assert.equal(detail.messages.at(-1).body, body.message);
  resolve(proposal());
  await f.app.waitForScoping();
  assert.equal((await f.app.detail(f.actor, f.taskId)).messages.length, 2);
});

test('unanswered one-off questions require answers or explicit manual brief review', async (t) => {
  const f = await fixture(t, 'sqlite', {
    async propose() {
      return { ...proposal(), cadence: 'once', schedule: null };
    },
  });
  const job = await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: 1 },
    randomUUID(),
  );
  await f.app.waitForScoping();
  const detail = await f.app.detail(f.actor, f.taskId);
  await assert.rejects(
    f.app.confirmScope(
      f.actor,
      f.taskId,
      { expectedVersion: detail.task.version, proposalId: job.jobId },
      randomUUID(),
    ),
    { code: 'SCOPING_INCOMPLETE' },
  );
  await assert.rejects(
    f.app.mutateTask(
      f.actor,
      f.taskId,
      'post',
      { expectedVersion: detail.task.version },
      randomUUID(),
    ),
    { code: 'SCOPING_INCOMPLETE' },
  );
  assert.equal((await f.app.detail(f.actor, f.taskId)).task.scopeVersion, 1);
  const changed = await f.app.mutateTask(
    f.actor,
    f.taskId,
    'scope',
    {
      expectedVersion: detail.task.version,
      title: 'One CSV run',
      brief:
        'One run only: remove exact duplicate rows from the supplied CSV and return CSV.',
    },
    randomUUID(),
  );
  await f.app.mutateTask(
    f.actor,
    f.taskId,
    'post',
    { expectedVersion: changed.version },
    randomUUID(),
  );
  assert.equal((await f.app.detail(f.actor, f.taskId)).task.status, 'posted');
});

test('two application instances share one durable model claim; a restarted instance can recover an expired conversation', async (t) => {
  let resolve,
    calls = 0;
  const provider = {
    propose: () => {
      calls++;
      return new Promise((done) => {
        resolve = done;
      });
    },
  };
  const f = await fixture(t, 'sqlite', provider);
  const second = createApplication({
    repository: f.repository,
    scopingProvider: provider,
  });
  const key = randomUUID(),
    body = { expectedVersion: 1, message: 'Keep the source links.' };
  const [firstJob, secondJob] = await Promise.all([
    f.app.assist(f.actor, f.taskId, body, key),
    second.assist(f.actor, f.taskId, body, key),
  ]);
  assert.deepEqual(firstJob, secondJob);
  while (!resolve) await new Promise((done) => setImmediate(done));
  assert.equal(calls, 1);
  f.advance(180001);
  const restarted = createApplication({
    repository: f.repository,
    now: () => Date.now() + 180001,
    scopingProvider: {
      async propose() {
        return proposal();
      },
    },
  });
  const before = await restarted.detail(f.actor, f.taskId);
  assert.equal(before.task.scoping.status, 'failed');
  await restarted.assist(
    f.actor,
    f.taskId,
    { expectedVersion: before.task.version },
    randomUUID(),
  );
  await restarted.waitForScoping();
  resolve(proposal());
  await f.app.waitForScoping();
  await second.waitForScoping();
  const after = await restarted.detail(f.actor, f.taskId);
  assert.equal(after.messages.length, 3);
  assert.equal(
    after.messages.filter((message) => message.body === body.message).length,
    1,
  );
  assert.equal(after.task.scoping.status, 'completed');
  const old = await f.repository.read((repo) =>
    repo.get('scoping-job', firstJob.jobId),
  );
  assert.equal(old.status, 'stale');
  assert.equal(old.snapshot, undefined);
});

test('reviewing identical scope preserves the selected offer instead of forcing another bid', async (t) => {
  const f = await fixture(t, 'sqlite', null);
  const same = {
    ...proposal(),
    title: 'CSV cleanup',
    brief: 'Clean the supplied CSV.',
    cadence: 'once',
    schedule: null,
    questions: [],
    assumptions: [],
  };
  const app = createApplication({
    repository: f.repository,
    localExecution: true,
    scopingProvider: {
      async propose() {
        return same;
      },
    },
  });
  const builder = {
    user: { id: randomUUID(), name: 'Builder' },
    memberships: [{ id: randomUUID(), role: 'owner' }],
  };
  const { taskId } = await app.createTask(
    f.actor,
    {
      tenantId: f.actor.memberships[0].id,
      title: same.title,
      brief: same.brief,
    },
    randomUUID(),
  );
  await app.mutateTask(
    f.actor,
    taskId,
    'post',
    { expectedVersion: 1 },
    randomUUID(),
  );
  const { agentId } = await app.marketplace.addAgent(
    builder,
    {
      name: 'CSV worker',
      kind: 'general',
      purpose: 'Clean supplied CSV',
      integration: 'api',
      capabilities: [{ category: 'Data', task: 'CSV cleanup' }],
    },
    randomUUID(),
  );
  const agent = (await app.marketplace.agents(builder))[0];
  const offer = await app.marketplace.quote(
    builder,
    taskId,
    {
      agentId,
      capabilityId: agent.capabilities[0].id,
      expectedVersion: 2,
      amountMinor: 200,
      deliveryMinutes: 1,
      proposal: 'Clean the CSV and return it.',
    },
    randomUUID(),
  );
  await app.marketplace.accept(
    f.actor,
    taskId,
    { expectedVersion: 2, offerId: offer.offerId },
    randomUUID(),
  );
  const job = await app.assist(
    f.actor,
    taskId,
    { expectedVersion: 3 },
    randomUUID(),
  );
  await app.waitForScoping();
  const detail = await app.detail(f.actor, taskId);
  const confirmed = await app.confirmScope(
    f.actor,
    taskId,
    { expectedVersion: detail.task.version, proposalId: job.jobId },
    randomUUID(),
  );
  assert.equal(confirmed.unchanged, true);
  const after = await app.detail(f.actor, taskId);
  assert.equal(after.task.status, 'selected');
  assert.equal(after.task.selectedOfferId, offer.offerId);
  assert.equal(after.task.scopeVersion, 1);
  assert.equal(after.events.at(-1).type, 'scope.reviewed');
});

test('a model cannot report its proposed change as an already-applied agreement', async (t) => {
  const f = await fixture(t, 'sqlite', {
    async propose() {
      return {
        ...proposal(),
        intent: 'change',
        cadence: 'once',
        questions: [],
        reply: 'Your scope has been updated and payment completed.',
      };
    },
  });
  await f.app.assist(f.actor, f.taskId, { expectedVersion: 1 }, randomUUID());
  await f.app.waitForScoping();
  const detail = await f.app.detail(f.actor, f.taskId);
  assert.match(detail.messages.at(-1).body, /agreed scope has not changed/);
  assert.doesNotMatch(detail.messages.at(-1).body, /payment completed/);
  assert.equal(detail.task.scopeVersion, 1);
});

test('recurring calendar review stays explicit even when the model wrongly claims no details are missing', async (t) => {
  const f = await fixture(t, 'sqlite', {
    async propose() {
      return {
        ...proposal(),
        cadence: 'monthly',
        schedule: 'On the 31st every month',
        questions: [],
        reply: 'No additional details are needed. The schedule is ready.',
      };
    },
  });
  const job = await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: 1 },
    randomUUID(),
  );
  await f.app.waitForScoping();
  const detail = await f.app.detail(f.actor, f.taskId);
  assert.match(detail.messages.at(-1).body, /not scheduled.*shorter months/);
  assert.doesNotMatch(detail.messages.at(-1).body, /No additional details/);
  const saved = await f.app.confirmScope(
    f.actor,
    f.taskId,
    { expectedVersion: detail.task.version, proposalId: job.jobId },
    randomUUID(),
  );
  await f.app.mutateTask(
    f.actor,
    f.taskId,
    'post',
    { expectedVersion: saved.version },
    randomUUID(),
  );
  assert.equal(
    (await f.app.detail(f.actor, f.taskId)).task.recurringScheduleId,
    null,
  );
});

test('selected saved source content requires explicit consent and is recorded with its version', async (t) => {
  let seen;
  const f = await fixture(t, 'sqlite', {
    async propose(snapshot) {
      seen = snapshot;
      return proposal();
    },
  });
  const sourceId = randomUUID();
  await f.repository.transaction('seed', async (repo) => {
    await repo.save('tool-source', {
      id: sourceId,
      tenantId: f.actor.memberships[0].id,
      ownerId: f.actor.user.id,
      status: 'active',
      version: 3,
      content: 'Source facts',
      name: 'Brand notes',
    });
    const task = await repo.get('task', f.taskId, true);
    task.contextReferences = [
      { sourceId, name: 'Brand notes', mode: 'latest', version: 3 },
    ];
    await repo.save('task', task);
  });
  await f.app.assist(f.actor, f.taskId, { expectedVersion: 1 }, randomUUID());
  await f.app.waitForScoping();
  assert.deepEqual(seen.documents, []);
  let detail = await f.app.detail(f.actor, f.taskId);
  await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: detail.task.version, useContext: true },
    randomUUID(),
  );
  await f.app.waitForScoping();
  assert.equal(seen.documents[0].content, 'Source facts');
  assert.equal(seen.documents[0].untrusted, true);
  detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.task.scoping.contextReads[0].version, 3);
  await f.repository.transaction('disconnect', async (repo) => {
    const source = await repo.get('tool-source', sourceId, true);
    source.status = 'disconnected';
    await repo.save('tool-source', source);
  });
  await assert.rejects(
    f.app.assist(
      f.actor,
      f.taskId,
      { expectedVersion: detail.task.version, useContext: true },
      randomUUID(),
    ),
    { code: 'SOURCE_DISABLED' },
  );
});

test('source revocation during inference prevents saving a context-derived reply', async (t) => {
  let finish;
  const f = await fixture(t, 'sqlite', {
    propose: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const sourceId = randomUUID();
  await f.repository.transaction('seed', async (repo) => {
    await repo.save('tool-source', {
      id: sourceId,
      tenantId: f.actor.memberships[0].id,
      ownerId: f.actor.user.id,
      status: 'active',
      version: 1,
      content: 'Private source',
      name: 'Notes',
    });
    const task = await repo.get('task', f.taskId, true);
    task.contextReferences = [{ sourceId, mode: 'latest', name: 'Notes' }];
    await repo.save('task', task);
  });
  await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: 1, useContext: true },
    randomUUID(),
  );
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await f.repository.transaction('disconnect', async (repo) => {
    const source = await repo.get('tool-source', sourceId, true);
    source.status = 'disconnected';
    await repo.save('tool-source', source);
  });
  finish(proposal());
  await f.app.waitForScoping();
  const detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.messages.length, 1);
  assert.equal(detail.task.scoping.status, 'failed');
  assert.deepEqual(detail.task.scoping.contextReads, []);
});

test('workspace model attempts persist, replay without charging and reject before saving a message', async (t) => {
  const f = await fixture(t, 'sqlite', {
    async propose() {
      throw new Error('failure fixture');
    },
  });
  let time = Date.now();
  const options = {
    repository: f.repository,
    now: () => time,
    modelAttemptsPerHour: 1,
    scopingProvider: {
      async propose() {
        throw new Error('failure fixture');
      },
    },
  };
  let app = createApplication(options);
  const key = randomUUID(),
    body = { expectedVersion: 1, message: 'First attempt' };
  const first = await app.assist(f.actor, f.taskId, body, key);
  await app.waitForScoping();
  app = createApplication(options);
  assert.deepEqual(await app.assist(f.actor, f.taskId, body, key), first);
  const before = await app.detail(f.actor, f.taskId);
  await assert.rejects(
    app.assist(
      f.actor,
      f.taskId,
      { expectedVersion: before.task.version, message: 'Keep this unsent' },
      randomUUID(),
    ),
    { code: 'MODEL_WORKSPACE_LIMIT' },
  );
  assert.deepEqual(
    (await app.detail(f.actor, f.taskId)).messages,
    before.messages,
  );
  time += 3600000;
  await app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: before.task.version, message: 'New window' },
    randomUUID(),
  );
  await app.waitForScoping();
});

test('model scheduling receives the workspace and validates access before inference', async (t) => {
  let scheduling;
  const f = await fixture(t, 'sqlite', {
    async propose(snapshot, options) {
      scheduling = options;
      await options.beforeStart();
      return proposal();
    },
  });
  await f.app.assist(f.actor, f.taskId, { expectedVersion: 1 }, randomUUID());
  await f.app.waitForScoping();
  assert.equal(scheduling.tenantId, f.actor.memberships[0].id);
  assert.equal(
    (await f.app.detail(f.actor, f.taskId)).task.scoping.status,
    'completed',
  );
});
test('local model does not fetch when queued authorization fails', async () => {
  let calls = 0;
  const provider = createOllamaProvider({
    fetch: async () => {
      calls++;
      throw Error('must not fetch');
    },
  });
  await assert.rejects(
    provider.propose(
      { brief: 'Research', messages: [] },
      {
        tenantId: 'workspace',
        beforeStart: async () => {
          throw Error('Access revoked');
        },
      },
    ),
    /Access revoked/,
  );
  assert.equal(calls, 0);
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: recovery workers resume a saved pending conversation once and expire interrupted work`, async (t) => {
    let calls = 0;
    const provider = {
      async propose() {
        calls++;
        return proposal();
      },
    };
    const f = await fixture(t, adapter, provider);
    const transaction = f.repository.transaction;
    f.repository.transaction = async (key, work) => {
      if (key.startsWith('scope-job:'))
        throw new Error('simulated process stopped before claim');
      return transaction(key, work);
    };
    const job = await f.app.assist(
      f.actor,
      f.taskId,
      { expectedVersion: 1, message: 'Please help scope this request.' },
      randomUUID(),
    );
    await f.app.waitForScoping();
    f.repository.transaction = transaction;
    assert.equal(calls, 0);
    const options = {
      repository: f.repository,
      scopingProvider: provider,
      resolveActor: async () => f.actor,
    };
    const a = createApplication(options),
      b = createApplication(options);
    await Promise.all([a.reconcileScoping(), b.reconcileScoping()]);
    await Promise.all([a.waitForScoping(), b.waitForScoping()]);
    assert.equal(calls, 1);
    assert.equal(
      (await a.detail(f.actor, f.taskId)).task.scoping.status,
      'completed',
    );
    await f.repository.transaction('expire-fixture', async (repo) => {
      const row = await repo.get('scoping-job', job.jobId);
      row.status = 'running';
      row.snapshot = { sensitive: 'discard me' };
      row.expiresAt = 1;
      await repo.save('scoping-job', row);
      const task = await repo.get('task', f.taskId);
      task.scoping.status = 'pending';
      task.scoping.expiresAt = 1;
      await repo.save('task', task);
    });
    await b.reconcileScoping();
    const expired = await f.repository.read((repo) =>
      repo.get('scoping-job', job.jobId),
    );
    assert.equal(expired.status, 'stale');
    assert.equal(expired.snapshot, undefined);
    assert.equal(
      (await b.detail(f.actor, f.taskId)).task.scoping.status,
      'failed',
    );
    assert.equal(calls, 1);
    await f.repository.transaction('revoked-fixture', async (repo) => {
      const job = await repo.get('scoping-job', expired.id);
      job.status = 'pending';
      job.expiresAt = Date.now() + 180000;
      job.snapshot = { private: 'must not reach the provider' };
      await repo.save('scoping-job', job);
    });
    const revoked = createApplication({
      ...options,
      resolveActor: async () => null,
    });
    await revoked.reconcileScoping();
    await revoked.waitForScoping();
    assert.equal(calls, 1);
    assert.equal(
      (await f.repository.read((repo) => repo.get('scoping-job', expired.id)))
        .snapshot,
      undefined,
    );
  });
}

test('different conversation jobs share capacity and pending work resumes after release', async (t) => {
  let release, started;
  const gate = new Promise((resolve) => (release = resolve));
  const entered = new Promise((resolve) => (started = resolve));
  let calls = 0;
  const provider = {
    async propose() {
      calls++;
      if (calls === 1) {
        started();
        await gate;
      }
      return proposal();
    },
  };
  const f = await fixture(t, 'sqlite', provider);
  const second = createApplication({
    repository: f.repository,
    scopingProvider: provider,
    resolveActor: async () => f.actor,
  });
  await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: 1, message: 'Help me plan this work.' },
    randomUUID(),
  );
  await entered;
  const { taskId } = await second.createTask(
    f.actor,
    {
      tenantId: f.actor.memberships[0].id,
      title: 'Another task',
      brief: 'Research companies',
    },
    randomUUID(),
  );
  await second.assist(
    f.actor,
    taskId,
    { expectedVersion: 1, message: 'Scope this request too.' },
    randomUUID(),
  );
  await second.waitForScoping();
  assert.equal(calls, 1);
  assert.equal(
    (await second.detail(f.actor, taskId)).task.scoping.status,
    'pending',
  );
  release();
  await f.app.waitForScoping();
  await second.reconcileScoping();
  await second.waitForScoping();
  assert.equal(calls, 2);
  assert.equal(
    (await second.detail(f.actor, taskId)).task.scoping.status,
    'completed',
  );
});

test('stopping a working reply is authorized, idempotent and fences late output; retry keeps one user message', async (t) => {
  let finish;
  const f = await fixture(t, 'sqlite', {
    propose: () => new Promise((resolve) => (finish = resolve)),
  });
  await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: 1, message: 'Please help with this brief.' },
    randomUUID(),
  );
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  let detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.task.scoping.phase, 'working');
  const body = {
      expectedVersion: detail.task.version,
      jobId: detail.task.scoping.id,
    },
    key = randomUUID();
  await assert.rejects(
    f.app.cancelScoping(
      { user: { id: 'stranger' }, memberships: [] },
      f.taskId,
      body,
      key,
    ),
  );
  const cancelled = await f.app.cancelScoping(f.actor, f.taskId, body, key);
  assert.deepEqual(
    await f.app.cancelScoping(f.actor, f.taskId, body, key),
    cancelled,
  );
  finish(proposal());
  await f.app.waitForScoping();
  detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.task.scoping.status, 'cancelled');
  const messages = detail.messages.length;
  finish = null;
  await f.app.assist(
    f.actor,
    f.taskId,
    { expectedVersion: detail.task.version },
    randomUUID(),
  );
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  finish(proposal());
  await f.app.waitForScoping();
  detail = await f.app.detail(f.actor, f.taskId);
  assert.equal(detail.messages.length, messages + 1);
  assert.equal(
    detail.messages.filter((m) => m.body === 'Please help with this brief.')
      .length,
    1,
  );
});
