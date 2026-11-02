'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { DatabaseSync } = require('node:sqlite');
const { setup, stopCluster, startCluster, adminPool, utility } = require('../../scripts/local-postgres.cjs');
const { backupPair, restorePair, assertAppStopped } = require('../../scripts/recovery.cjs');
const { openLocalPostgres, localPool } = require('../../src/postgres.cjs');
const { postgresPoolDatabase } = require('../../src/repository.cjs');
const { migrate, loadMigrations } = require('../../src/migrations.cjs');
const { createApplication } = require('../../src/service.cjs');
const { openDatabase } = require('../../../poc-api/src/database.cjs');
const { createStore } = require('../../../poc-api/src/store.cjs');
const { readSqliteSnapshot, importSnapshot } = require('../../src/cutover.cjs');
const { createSqliteRepository } = require('../../src/repository.cjs');
const { normalizeCsv } = require('../../../agent-runtime/src/csv.cjs');

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function actor(name) {
  return { user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] };
}
function application(repository, actors, now = Date.now) {
  return createApplication({ repository, localExecution: true, now, resolveOperator: async id => actors.find(item => item.user.id === id) });
}
async function csvFixture(app, buyer, builder) {
  const agent = await app.marketplace.addAgent(builder, { name: 'Native CSV agent', purpose: 'Normalize supplied CSV', kind: 'general', integration: 'api', capabilities: [{ category: 'Data', task: 'Normalize CSV files' }] }, randomUUID());
  await app.marketplace.configure(builder, agent.agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, randomUUID());
  const credential = await app.issueCredential(builder, agent.agentId, { expectedVersion: 2 }, randomUUID());
  const principal = await app.runtimePrincipal(credential.token);
  await app.heartbeat(principal);
  const capabilityId = (await app.marketplace.agents(builder)).find(item => item.id === agent.agentId).capabilities[0].id;
  async function task() {
    const created = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'Normalize CSV', brief: 'Clean supplied CSV and return actual files.' }, randomUUID());
    await app.addInput(buyer, created.taskId, { expectedVersion: 1, filename: 'source.csv', notes: 'Only supplied rows.', base64: Buffer.from('name,city\nZeta,London\nAcme,Paris\nAcme,Paris\n').toString('base64') }, randomUUID());
    await app.mutateTask(buyer, created.taskId, 'post', { expectedVersion: 2 }, randomUUID());
    const offer = await app.marketplace.quote(builder, created.taskId, { agentId: agent.agentId, capabilityId, expectedVersion: 3, amountMinor: 100, deliveryMinutes: 1, proposal: 'Clean CSV and provide evidence.' }, randomUUID(), principal);
    return { taskId: created.taskId, offerId: offer.offerId };
  }
  async function authorize(task) {
    await app.marketplace.accept(buyer, task.taskId, { expectedVersion: 3, offerId: task.offerId }, randomUUID());
    const result = await app.authorizeLocal(buyer, task.taskId, { expectedVersion: 4, mode: 'local-unpaid' }, randomUUID());
    return { ...task, assignmentId: result.assignmentId };
  }
  return { agentId: agent.agentId, principal, token: credential.token, task, authorize };
}

test('native PostgreSQL: migration safety, separate connections, restart and paired backup recovery', { timeout: 120000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'relay-native-test-'));
  const config = await setup({ home, port: await freePort() });
  let first = await openLocalPostgres(config.runtime), second = await openLocalPostgres(config.runtime);
  const migrator = localPool(config.migrator), db = postgresPoolDatabase(migrator);
  t.after(async () => {
    await first?.close(); await second?.close(); await migrator.end();
    stopCluster(home);
    rmSync(home, { recursive: true, force: true });
  });
  const buyer = actor('Buyer'), builder = actor('Builder'), other = actor('Other');
  const actors = [buyer, builder, other];
  let app = application(first.repository, actors), app2 = application(second.repository, actors);

  await t.test('access cutoff serializes independent pools without starving command connections', async () => {
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const hold = new Promise(resolve => { release = resolve; });
    const order = [];
    const active = first.repository.accessGuard(async () => {
      entered(); await hold;
      await first.repository.transaction('guard-proof', async repo => { await repo.save('access-proof', { id: 'guard', ownerId: buyer.user.id }); });
      order.push('active-committed');
    });
    await started;
    const revoke = second.repository.accessGuard(async () => { order.push('revoked'); });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(order, []);
    release(); await active; await revoke;
    assert.deepEqual(order, ['active-committed', 'revoked']);
    await assert.rejects(first.repository.accessGuard(async () => { throw new Error('forced failure'); }), /forced failure/);
    await second.repository.accessGuard(async () => { order.push('lock-released'); });
    assert.equal(order.at(-1), 'lock-released');
  });

  await t.test('company reservations serialize across independent connections and gate employee execution', async () => {
    const admin = actor('Company administrator'), employee = actor('Company employee'), reviewer = actor('Company reviewer');
    admin.memberships[0].company = true;
    const tenantId = admin.memberships[0].id;
    employee.memberships = [{ id: tenantId, role: 'employee', company: true }];
    reviewer.memberships = [{ id: tenantId, role: 'approver', company: true }];
    actors.push(admin, employee, reviewer);
    const fixture = await csvFixture(app, employee, builder);
    const tasks = [await fixture.task(), await fixture.task()];
    await app.configureBudget(admin, tenantId, { limitMinor: 150, expectedVersion: 0 }, randomUUID());
    for (const task of tasks) {
      await app.marketplace.accept(employee, task.taskId, { expectedVersion: 3, offerId: task.offerId }, randomUUID());
      await assert.rejects(app.authorizeLocal(employee, task.taskId, { expectedVersion: 4, mode: 'local-unpaid' }, randomUUID()), { code: 'APPROVAL_REQUIRED' });
      await app.requestApproval(employee, task.taskId, { expectedVersion: 4, note: 'Clean the team data' }, randomUUID());
    }
    const decisions = await Promise.all(tasks.map(task => app.detail(employee, task.taskId)));
    const results = await Promise.allSettled(tasks.map((task, i) => [app, app2][i].decideApproval(reviewer, task.taskId, {
      approvalId: decisions[i].approval.id, expectedVersion: 1, decision: 'approved', note: 'Within our data allowance'
    }, randomUUID())));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'BUDGET_EXCEEDED');
    const accepted = tasks[results.findIndex(result => result.status === 'fulfilled')];
    const detail = await app2.detail(employee, accepted.taskId);
    await app2.authorizeLocal(employee, accepted.taskId, { expectedVersion: detail.task.version, mode: 'local-unpaid' }, randomUUID());
    assert.equal((await app.companyBudget(admin, tenantId)).budget.committedMinor, 100);
    const running = await app.detail(employee, accepted.taskId);
    await app.cancelExecution(employee, accepted.taskId, { expectedVersion: running.task.version, reason: 'Stop the local test' }, randomUUID());
    assert.equal((await app2.companyBudget(admin, tenantId)).budget.availableMinor, 150);
  });

  let qualificationAgentId;
  const qualifier = actor('Qualification operator');
  actors.push(qualifier);
  await t.test('qualification rounds serialize across connections and persist their evidence', async () => {
    const fixture = await csvFixture(app, buyer, qualifier);
    qualificationAgentId = fixture.agentId;
    const agent = (await app.marketplace.agents(qualifier))[0];
    const test = await app.startQualification(qualifier, agent.id, { expectedVersion: agent.version, capabilityId: agent.capabilities[0].id, rubric: 'csv-normalize-v1' }, randomUUID());
    for (const round of [1, 2]) {
      const job = (await app2.qualificationJobs(fixture.principal))[0];
      const output = normalizeCsv(Buffer.from(job.input), job.revision);
      const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
      const body = { round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } };
      const results = await Promise.allSettled([app, app2].map(instance => instance.submitQualification(fixture.principal, test.assessmentId, body, randomUUID())));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    }
    const capability = (await app2.marketplace.agents(qualifier))[0].capabilities[0];
    assert.equal(capability.qualification, 'qualified');
    assert.equal(capability.assessment.submissions.length, 2);
  });
  await t.test('scoping persists across connections and requires current-version confirmation', async () => {
    const provider = { async propose() { return { reply: 'Ready to review.', title: 'One CSV run', brief: 'Normalize the supplied CSV, removing exact duplicate rows.', questions: [], assumptions: [], intent: 'request', cadence: 'once', schedule: null, timezone: null, perRunBudget: null, monthlyCap: null }; } };
    const scoped = createApplication({ repository: first.repository, scopingProvider: provider });
    const created = await scoped.createTask(buyer, { tenantId: buyer.memberships[0].id, title: 'CSV request', brief: 'Clean this CSV.' }, randomUUID());
    const job = await scoped.assist(buyer, created.taskId, { expectedVersion: 1 }, randomUUID());
    await scoped.waitForScoping();
    const detail = await app2.detail(buyer, created.taskId);
    assert.equal(detail.messages.at(-1).role, 'assistant');
    assert.equal(detail.task.scopeVersion, 1);
    const input = { expectedVersion: detail.task.version, proposalId: job.jobId };
    const results = await Promise.allSettled([
      scoped.confirmScope(buyer, created.taskId, input, randomUUID()),
      createApplication({ repository: second.repository }).confirmScope(buyer, created.taskId, input, randomUUID())
    ]);
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal((await app2.detail(buyer, created.taskId)).task.scopeVersion, 2);
  });
  await t.test('migration runners serialize, detect drift, and roll back failed DDL', async () => {
    const repeated = await setup({ home });
    assert.equal(repeated.runtime.database, config.runtime.database);
    assert.equal(repeated.runtime.user, config.runtime.user);
    const results = await Promise.all(Array.from({ length: 6 }, () => migrate(db)));
    assert.ok(results.every(item => item.applied.length === 0));
    const altered = loadMigrations().map((item, index) => index ? item : { ...item, checksum: 'changed' });
    await assert.rejects(migrate(db, altered), /differs/);
    const sql = 'CREATE TABLE relay_private.rollback_probe (id INTEGER); SELECT nonexistent_column FROM nonexistent_table;';
    const bad = { name: '003_failure_probe.sql', sql, checksum: createHash('sha256').update(sql).digest('hex') };
    await assert.rejects(migrate(db, [...loadMigrations(), bad]));
    assert.equal((await migrator.query("SELECT to_regclass('relay_private.rollback_probe') AS value")).rows[0].value, null);
    assert.equal((await migrator.query('SELECT count(*)::integer AS count FROM relay_private.schema_migrations')).rows[0].count, loadMigrations().length);
  });
  await t.test('runtime startup refuses missing, pending or changed migration history', async () => {
    const admin = adminPool(config);
    try { await admin.query('CREATE DATABASE relay_unmigrated OWNER relay_migrator'); }
    finally { await admin.end(); }
    const empty = localPool({ ...config.migrator, database: 'relay_unmigrated' });
    try {
      const { createPostgresRepository } = require('../../src/repository.cjs');
      await assert.rejects(createPostgresRepository(postgresPoolDatabase(empty)), { code: '42P01' });
      const competing = await Promise.all(Array.from({ length: 6 }, () => migrate(postgresPoolDatabase(empty), loadMigrations().slice(0, 1))));
      assert.equal(competing.reduce((count, result) => count + result.applied.length, 0), 1);
      await assert.rejects(createPostgresRepository(postgresPoolDatabase(empty)), /pending/);
      await migrate(postgresPoolDatabase(empty));
      await empty.query("UPDATE relay_private.schema_migrations SET checksum = 'tampered' WHERE name = '002_discovery_indexes.sql'");
      await assert.rejects(createPostgresRepository(postgresPoolDatabase(empty)), /differs/);
    } finally { await empty.end(); }
  });
  await t.test('runtime role can use data but cannot own, migrate, truncate or create objects', async () => {
    for (const sql of [
      'CREATE TABLE public.forbidden (id INTEGER)',
      'CREATE TABLE relay_private.forbidden (id INTEGER)',
      'ALTER TABLE relay_private.relay_v1_documents ADD COLUMN forbidden TEXT',
      'TRUNCATE relay_private.relay_v1_documents',
      "UPDATE relay_private.schema_migrations SET checksum = 'forbidden'",
      'CREATE DATABASE relay_forbidden'
    ]) await assert.rejects(first.pool.query(sql), { code: '42501' });
    const role = (await first.pool.query('SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user')).rows[0];
    assert.deepEqual(role, { rolsuper: false, rolcreatedb: false, rolcreaterole: false });
  });
  await t.test('32 competing retries create one task and preserve immutable retry content', async () => {
    const key = randomUUID(), body = { tenantId: buyer.memberships[0].id, title: 'Exactly once', brief: 'One task across two pools.' };
    const results = await Promise.all(Array.from({ length: 32 }, (_, index) => (index % 2 ? app : app2).createTask(buyer, body, key)));
    assert.equal(new Set(results.map(item => item.taskId)).size, 1);
    await assert.rejects(app2.createTask(buyer, { ...body, title: 'Different' }, key), { code: 'IDEMPOTENCY_CONFLICT' });
  });
  let f, job, claimed, submission, file, expectedBytes;
  await t.test('simultaneous bids, selection and authorization do not lose updates or start twice', async () => {
    f = await csvFixture(app, buyer, builder);
    job = await f.task();
    const source = await first.repository.read(repo => repo.get('task', job.taskId));
    const agent = await first.repository.read(repo => repo.get('agent', f.agentId));
    const quote = { agentId: f.agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 100, deliveryMinutes: 1, proposal: 'Duplicate agent bid must fail.' };
    const duplicates = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => (index % 2 ? app : app2).marketplace.quote(builder, job.taskId, quote, randomUUID(), f.principal)));
    assert.ok(duplicates.every(item => item.status === 'rejected' && item.reason.code === 'OFFER_EXISTS'));
    // Different agents bid on the same scope concurrently; all offers survive.
    const bidders = await Promise.all(Array.from({ length: 4 }, (_, index) => app.marketplace.addAgent(other, { name: `Other ${index}`, purpose: 'CSV work', kind: 'general', integration: 'api', capabilities: [{ category: 'Data', task: 'CSV normalization' }] }, randomUUID())));
    const profiles = await app.marketplace.agents(other);
    await Promise.all(bidders.map((bidder, index) => (index % 2 ? app : app2).marketplace.quote(other, job.taskId, { ...quote, agentId: bidder.agentId, capabilityId: profiles.find(item => item.id === bidder.agentId).capabilities[0].id }, randomUUID())));
    assert.equal((await app.marketplace.offers(buyer, job.taskId)).length, 5);
    assert.equal((await app.detail(buyer, job.taskId)).task.version, source.version);
    const selections = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? app : app2).marketplace.accept(buyer, job.taskId, { expectedVersion: 3, offerId: job.offerId }, randomUUID())));
    assert.equal(selections.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok(selections.filter(item => item.status === 'rejected').every(item => item.reason.code === 'VERSION_CONFLICT'));
    const key = randomUUID();
    const authorized = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? app : app2).authorizeLocal(buyer, job.taskId, { expectedVersion: 4, mode: 'local-unpaid' }, key)));
    assert.equal(new Set(authorized.map(item => item.assignmentId)).size, 1);
    job.assignmentId = authorized[0].assignmentId;
  });
  await t.test('competing workers receive one lease; other tasks cannot exceed agent capacity', async () => {
    const claims = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => (index % 2 ? app : app2).claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID())));
    assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1);
    assert.ok(claims.filter(item => item.status === 'rejected').every(item => item.reason.code === 'LEASE_BUSY'));
    claimed = claims.find(item => item.status === 'fulfilled').value;
    const another = await f.authorize(await f.task());
    await assert.rejects(app2.claim(f.principal, another.taskId, { assignmentId: another.assignmentId }, randomUUID()), { code: 'CAPACITY_LIMIT' });
  });
  await t.test('concurrent delivery retries store one immutable submission and real file bytes', async () => {
    expectedBytes = normalizeCsv(Buffer.from(claimed.input.base64, 'base64')).csv;
    const body = { leaseToken: claimed.leaseToken, evidence: 'CSV row counts checked.', files: [{ filename: 'normalized.csv', mime: 'text/csv', base64: expectedBytes.toString('base64') }] };
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 10 }, (_, index) => (index % 2 ? app : app2).submit(f.principal, job.taskId, body, key)));
    assert.equal(new Set(results.map(item => item.submissionId)).size, 1);
    submission = (await app.detail(buyer, job.taskId)).submissions[0]; file = submission.files[0];
    assert.deepEqual((await app.download(buyer, job.taskId, submission.id, file.id)).bytes, expectedBytes);
    await assert.rejects(app.download(other, job.taskId, submission.id, file.id), { code: 'NOT_FOUND' });
  });
  const identityPath = join(home, 'identity.sqlite');
  let identityToken, identityActor;
  await t.test('simultaneous claims on different tasks respect capacity across pools', async () => {
    const separate = await csvFixture(app, buyer, builder);
    const tasks = [await separate.authorize(await separate.task()), await separate.authorize(await separate.task())];
    const claims = await Promise.allSettled(tasks.map((task, index) => (index ? app : app2).claim(separate.principal, task.taskId, { assignmentId: task.assignmentId }, randomUUID())));
    assert.equal(claims.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(claims.find(item => item.status === 'rejected').reason.code, 'CAPACITY_LIMIT');
    await app.revokeCredential(builder, separate.agentId, { expectedVersion: 3 }, randomUUID());
    await assert.rejects(app2.heartbeat(separate.principal), { code: 'INVALID_AGENT_KEY' });
  });
  let paymentTaskId, recoveryTeamId;
  await t.test('sandbox funding serializes across pools and authorizes only the funded agreement', async () => {
    let fundingChecks = 0;
    const provider = {
      createOperator: async () => ({ accountId: 'acct_fixture' }),
      onboarding: async () => ({ url: 'https://connect.stripe.com/fixture' }),
      operator: async () => ({ accountId: 'acct_fixture', ready: true, manualPayouts: true }),
      checkout: async () => ({ sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/fixture' }),
      funding: async () => { fundingChecks++; return { status: 'funded', intentId: 'pi_fixture', chargeId: 'ch_fixture' }; }
    };
    const make = repository => createApplication({ repository, localExecution: true, paymentProvider: provider, paymentRecoveryUserIds: [buyer.user.id], resolveOperator: async id => actors.find(a => a.user.id === id) });
    const a = make(first.repository), b = make(second.repository);
    await a.onboardOperator(builder, { country: 'US' }, randomUUID()); await a.refreshOperator(builder);
    const fixture = await csvFixture(a, buyer, builder), job = await fixture.task(); paymentTaskId = job.taskId;
    await a.marketplace.accept(buyer, job.taskId, { expectedVersion: 3, offerId: job.offerId }, randomUUID());
    const body = { expectedVersion: 4 };
    const attempts = await Promise.allSettled([a.sandboxPayment(buyer, job.taskId, 'fund', body, randomUUID()), b.sandboxPayment(buyer, job.taskId, 'fund', body, randomUUID())]);
    assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1);
    const recoveryId = `task:${job.taskId}`;
    await first.repository.transaction('fixture', async repo => {
      const check = await repo.get('payment-job', recoveryId, true);
      Object.assign(check, { status: 'review', failures: 12, errorCode: 'PROVIDER_CHECK_FAILED' });
      await repo.save('payment-job', check);
    });
    const row = (await a.paymentRecovery(buyer)).items.find(item => item.id === recoveryId);
    const recoveryBody = { snapshot: row.snapshot, reason: 'Provider connectivity restored in fixture.' };
    const retries = await Promise.allSettled([a.retryPaymentRecovery(buyer, recoveryId, recoveryBody, randomUUID()), b.retryPaymentRecovery(buyer, recoveryId, recoveryBody, randomUUID())]);
    assert.equal(retries.filter(result => result.status === 'fulfilled').length, 1);
    await Promise.all([a.reconcilePayments(), b.reconcilePayments()]);
    assert.equal(fundingChecks, 1);
    const detail = await a.detail(buyer, job.taskId);
    await assert.rejects(a.authorizeLocal(buyer, job.taskId, { expectedVersion: detail.task.version, mode: 'local-unpaid' }, randomUUID()), { code: 'FUNDING_LOCKED' });
    await a.authorizeLocal(buyer, job.taskId, { expectedVersion: detail.task.version, mode: 'stripe-sandbox' }, randomUUID());
    assert.equal((await b.detail(buyer, job.taskId)).execution.paymentStatus, 'funded');
    assert.equal((await b.taskPayment(buyer, job.taskId)).ledger.length, 1);
  });

  await t.test('offline backup refuses an active app and preserves identity plus application data', async () => {
    const listening = net.createServer(); listening.listen(0, '127.0.0.1'); await once(listening, 'listening');
    await assert.rejects(assertAppStopped(listening.address().port), /Stop/);
    await new Promise(resolve => listening.close(resolve));
    const identityDb = openDatabase(identityPath), identity = createStore(identityDb, Date.now, { identityOnly: true });
    identityToken = await identity.register({ name: 'Recovery identity', email: 'recovery@example.test', password: 'disposable recovery test passphrase', workspace: 'buyer' }, 'recovery');
    identityActor = identity.principal(identityToken);
    recoveryTeamId = identity.createTeam(identityActor, { name: 'Recovery company' }, randomUUID()).tenantId;
    identity.inviteTeamMember(identityActor, recoveryTeamId, { email: 'teammate@example.test', role: 'employee' });
    identityDb.close();
    require('../../../storage/src/local-objects.cjs').localObjects(`${identityPath}.objects`).put(Buffer.from('backup object fixture'));
    await backupPair(config, identityPath, join(home, 'backup'));
  });
  await t.test('database crash/restart and new application pools retain delivery, keys and receipts', async () => {
    await first.close(); await second.close(); first = null; second = null;
    // Immediate shutdown exercises WAL crash recovery, not just graceful close.
    stopCluster(home, 'immediate'); startCluster(home);
    first = await openLocalPostgres(config.runtime); second = await openLocalPostgres(config.runtime);
    app = application(first.repository, actors); app2 = application(second.repository, actors);
    assert.equal((await app.detail(buyer, job.taskId)).task.status, 'buyer_review');
    assert.deepEqual((await app.download(buyer, job.taskId, submission.id, file.id)).bytes, expectedBytes);
    assert.equal((await app.runtimePrincipal(f.token)).agentId, f.agentId);
    assert.equal((await app.taskPayment(buyer, paymentTaskId)).status, 'funded');
    const detail = await app.detail(buyer, job.taskId);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) => (index % 2 ? app : app2).reviewDelivery(buyer, job.taskId, 'accept-delivery', { expectedVersion: detail.task.version, submissionId: submission.id }, key)));
    assert.ok(results.every(item => item.status === 'accepted'));
    assert.equal((await app.marketplace.work(builder)).find(item => item.id === job.taskId).status, 'accepted');
  });
  await t.test('isolated restore recovers exact bytes and sessions without replacing current data', async () => {
    const destination = join(home, 'restored-identity.sqlite');
    const restoredConfig = await restorePair(config, join(home, 'backup'), 'relay_restore_verified', destination);
    const objectKey = require('../../../storage/src/local-objects.cjs').digest(Buffer.from('backup object fixture'));
    assert.equal(require('../../../storage/src/local-objects.cjs').localObjects(`${destination}.objects`).read(objectKey).toString(), 'backup object fixture');
    const restored = await openLocalPostgres(restoredConfig);
    try {
      const recovered = application(restored.repository, actors);
      assert.equal((await recovered.taskPayment(buyer, paymentTaskId)).ledger.length, 1);
      assert.equal((await recovered.taskPayment(buyer, paymentTaskId)).reconciliation.status, 'automatic');
      assert.ok((await recovered.taskPayment(buyer, paymentTaskId)).reconciliation.lastCheckedAt);
      const recoveryAudit = await restored.repository.read(repo => repo.list('payment-recovery', 'tenant_id', `task:${paymentTaskId}`));
      assert.equal(recoveryAudit.length, 1);
      assert.equal(recoveryAudit[0].previousFailures, 12);
      const qualification = (await recovered.marketplace.agents(qualifier)).find(item => item.id === qualificationAgentId);
      assert.equal(qualification.capabilities[0].qualification, 'qualified');
      assert.equal(qualification.capabilities[0].assessment.submissions.length, 2);
      assert.equal((await recovered.detail(buyer, job.taskId)).task.status, 'buyer_review'); // Snapshot precedes acceptance.
      assert.equal((await app.detail(buyer, job.taskId)).task.status, 'accepted');
      assert.deepEqual((await recovered.download(buyer, job.taskId, submission.id, file.id)).bytes, expectedBytes);
      assert.equal((await recovered.runtimePrincipal(f.token)).agentId, f.agentId);
      const identityDb = openDatabase(destination);
      try { const identity = createStore(identityDb, Date.now, { identityOnly: true }); const actor = identity.principal(identityToken); assert.equal(actor.user.id, identityActor.user.id); assert.equal(identity.team(actor, recoveryTeamId).invites.length, 1); }
      finally { identityDb.close(); }
    } finally { await restored.close(); }
    await assert.rejects(restorePair(config, join(home, 'backup'), 'relay_restore_verified', join(home, 'other-identity.sqlite')));
    const dump = join(home, 'backup/application.dump');
    const original = readFileSync(dump); writeFileSync(dump, Buffer.from('corrupt'));
    await assert.rejects(restorePair(config, join(home, 'backup'), 'relay_restore_corrupt', join(home, 'corrupt-identity.sqlite')), /integrity/);
    assert.equal(existsSync(join(home, 'corrupt-identity.sqlite')), false);
    writeFileSync(dump, original);
  });
  await t.test('native HTTP buyer/worker delivery survives app and database outages', async () => {
    const { httpWorkflow } = require('./http-workflow.cjs');
    await httpWorkflow(config, identityPath, await freePort());
  });
  await t.test('external supplier permissions and lifecycle run on native PostgreSQL', async () => {
    const { exercise } = require('../helpers/supplier-workflow.cjs');
    await exercise(first.repository);
  });
  await t.test('a prior-version backup restores before applying reviewed forward migrations', async () => {
    const admin = adminPool(config);
    try { await admin.query('CREATE DATABASE relay_prior_version OWNER relay_migrator'); }
    finally { await admin.end(); }
    const priorConfig = { ...config, migrator: { ...config.migrator, database: 'relay_prior_version' }, runtime: { ...config.runtime, database: 'relay_prior_version' } };
    const prior = localPool(priorConfig.migrator);
    try {
      await migrate(postgresPoolDatabase(prior), loadMigrations().slice(0, 2));
      const task = { id: randomUUID(), ownerId: buyer.user.id, tenantId: buyer.memberships[0].id, status: 'posted', version: 1, assignment: { id: randomUUID(), agentId: f.agentId, operatorId: builder.user.id, status: 'queued' } };
      await prior.query('INSERT INTO relay_private.relay_v1_documents VALUES ($1,$2,$3,$4,$5,$6,$7)', ['task', task.id, task.ownerId, task.tenantId, task.status, 1, JSON.stringify(task)]);
      await backupPair(priorConfig, identityPath, join(home, 'prior-backup'));
      const recoveredConfig = await restorePair(config, join(home, 'prior-backup'), 'relay_restore_prior_version', join(home, 'prior-identity.sqlite'));
      const recovered = await openLocalPostgres(recoveredConfig);
      try {
        assert.equal((await recovered.repository.read(repo => repo.get('execution-index', task.id))).status, 'queued');
        assert.equal((await recovered.repository.read(repo => repo.get('agent-grant', task.assignment.id))).agentId, f.agentId);
      } finally { await recovered.close(); }
    } finally { await prior.end(); }
  });
  await t.test('SQLite cutover is atomic, exact and refuses a changed source or a nonempty target', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const repository = createSqliteRepository(sqlite);
    await repository.transaction('fixture', async repo => {
      await repo.save('agent', { id: 'existing', ownerId: buyer.user.id, status: 'saved', version: 4, purpose: 'Original data' });
      await repo.saveReceipt(buyer.user.id, 'existing-retry-key', 'original-fingerprint', { agentId: 'existing' });
    });
    const snapshot = readSqliteSnapshot(sqlite);
    await assert.rejects(importSnapshot(first.repository, snapshot), /empty/);
    const admin = adminPool(config);
    try { await admin.query('CREATE DATABASE relay_import_test OWNER relay_migrator'); }
    finally { await admin.end(); }
    const importPool = localPool({ ...config.migrator, database: 'relay_import_test' });
    try {
      const { createPostgresRepository } = require('../../src/repository.cjs');
      const target = await createPostgresRepository(postgresPoolDatabase(importPool), { initialize: true });
      await assert.rejects(importSnapshot(target, { ...snapshot, documents: [...snapshot.documents, { kind: 'agent', payload: 'null' }] }));
      assert.equal(await target.read(repo => repo.hasRecords()), false);
      assert.equal((await importSnapshot(target, snapshot)).imported, true);
      assert.equal((await importSnapshot(target, snapshot)).imported, false);
      assert.deepEqual(await target.read(repo => repo.get('agent', 'existing')), JSON.parse(snapshot.documents[0].payload));
      assert.deepEqual(await target.read(repo => repo.receipt(buyer.user.id, 'existing-retry-key')), { fingerprint: 'original-fingerprint', result: { agentId: 'existing' } });
      await assert.rejects(importSnapshot(target, { ...snapshot, digest: 'changed' }), /changed/);
    } finally { await importPool.end(); sqlite.close(); }
  });
});
