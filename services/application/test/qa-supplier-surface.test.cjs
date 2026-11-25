'use strict';
// Adversarial QA of the supplier/builder surface (Nov 2026): supplier keys,
// the opportunity/assignment/event feeds, offers, automatic-offer limits,
// Relay tests and match alerts. Passing tests document verified behaviour;
// `todo` tests reproduce confirmed bugs (BUG-SUP-<n>) without breaking the suite.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository } = require('../src/repository.cjs');
const { categoryOf } = require('../../../packages/domain/src/categories.cjs');

const person = name => ({ user: { id: randomUUID(), name }, memberships: [{ id: randomUUID(), role: 'owner' }] });

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const buyer = person('Bea Buyer'), builder = person('Bo Builder'), rival = person('Ria Rival');
  const actors = [buyer, builder, rival];
  let time = Date.parse('2026-11-20T10:00:00Z');
  const app = createApplication({ repository, now: () => time, localExecution: true, resolveOperator: async id => actors.find(a => a.user.id === id) });
  const agentOf = async (actor, agentId) => (await app.marketplace.agents(actor)).find(a => a.id === agentId);

  // An agent with a connected supplier runtime and automatic offers on.
  async function connect(actor, { name = `${actor.user.name} agent`, category = 'Writing', task = 'Write release notes from a supplied brief', rules = {} } = {}) {
    const { agentId } = await app.marketplace.addAgent(actor, { name, purpose: task, kind: 'general', integration: 'api', capabilities: [{ category, task }] }, randomUUID());
    await app.marketplace.configure(actor, agentId, { expectedVersion: 1, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1, ...rules }, randomUUID());
    const issued = await app.issueSupplierCredential(actor, agentId, { expectedVersion: 2, expiresInSeconds: 3600 }, randomUUID());
    const principal = await app.runtimePrincipal(issued.token, { kind: 'supplier-api' });
    await app.heartbeat(principal, { runtimeName: 'QA runtime', runtimeVersion: '1' });
    const agent = await agentOf(actor, agentId);
    return { agentId, token: issued.token, principal, capabilityId: agent.capabilities[0].id, agent: () => agentOf(actor, agentId) };
  }
  async function post(title = 'Release notes', brief = 'Write clear release notes for the new search feature.', patch = null) {
    const { taskId } = await app.createTask(buyer, { tenantId: buyer.memberships[0].id, title, brief }, randomUUID());
    if (patch) await repository.transaction('qa-fixture', async repo => { const task = await repo.get('task', taskId); Object.assign(task, patch); await repo.save('task', task); });
    await app.mutateTask(buyer, taskId, 'post', { expectedVersion: 1 }, randomUUID());
    return taskId;
  }
  const version = async taskId => (await app.detail(buyer, taskId)).task.version;
  const offerBody = (s, extra = {}) => ({ agentId: s.agentId, capabilityId: s.capabilityId, expectedVersion: 2, amountMinor: 100, deliveryMinutes: 10, proposal: 'Release notes as a text file. Unpaid integration run.', ...extra });
  // Posted, offered by `s`, chosen and authorized: an assignment for `s`.
  async function assigned(s) {
    const taskId = await post();
    const { offerId } = await app.marketplace.quote(builder, taskId, offerBody(s), randomUUID(), s.principal);
    await app.marketplace.accept(buyer, taskId, { expectedVersion: await version(taskId), offerId }, randomUUID());
    const { assignmentId } = await app.authorizeLocal(buyer, taskId, { expectedVersion: await version(taskId), mode: 'local-unpaid' }, randomUUID());
    return { taskId, assignmentId };
  }
  return { app, repository, buyer, builder, rival, connect, post, version, offerBody, assigned, advance: ms => { time += ms; }, now: () => time };
}

// The fixed CSV rubric's answers, derived from the job alone the way a runtime would.
function csvAnswer(job) {
  const nonce = /Orbit-([0-9a-f]{8})/.exec(job.input)[1];
  const rows = ["'=2+2,Formula", 'Ada,"Acme, Inc"', `Zoe,Orbit-${nonce}`];
  const ordered = job.round === 1 ? rows : [...rows].reverse();
  return { round: job.round, csv: `name,company\r\n${ordered.join('\r\n')}\r\n`, report: { inputRows: 4, outputRows: 3, duplicatesRemoved: 1, sort: job.round === 1 ? 'ascending' : 'descending' } };
}

// ---- Keys and ownership ----------------------------------------------------

test('a supplier key never acts on another builder’s or another agent’s assignment', async t => {
  const f = await fixture(t);
  const mine = await f.connect(f.builder);
  const sibling = await f.connect(f.builder, { name: 'Second agent' });
  const rival = await f.connect(f.rival);
  const job = await f.assigned(mine);

  for (const other of [rival, sibling]) {
    await assert.rejects(f.app.supplierAssignment(other.principal, job.taskId), { code: 'NOT_FOUND' });
    await assert.rejects(f.app.claim(other.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID()), { code: 'NOT_FOUND' });
    assert.equal((await f.app.supplierAssignments(other.principal)).assignments.length, 0);
  }
  // The rival can't quote as the builder's agent, even naming it.
  const open = await f.post();
  await assert.rejects(f.app.marketplace.quote(f.rival, open, f.offerBody(mine), randomUUID(), rival.principal), { code: 'NOT_FOUND' });
  // The same builder's second key can't quote for the first agent.
  await assert.rejects(f.app.marketplace.quote(f.builder, open, f.offerBody(mine), randomUUID(), sibling.principal), { code: 'BIDDING_DISABLED' });
  // Another agent's event cursor is refused.
  await assert.rejects(f.app.supplierEvents(rival.principal, `${mine.agentId}:0000000000000001`), { code: 'INVALID_CURSOR' });
});

test('revoked, rotated and expired keys are refused even when a principal was resolved before the change', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder);
  const open = await f.post();
  // Rotation: the old principal object no longer works on any operation.
  const agent = await s.agent();
  const rotated = await f.app.issueSupplierCredential(f.builder, s.agentId, { expectedVersion: agent.version, expiresInSeconds: 3600 }, randomUUID());
  await assert.rejects(f.app.runtimePrincipal(s.token), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(f.app.supplierOpportunities(s.principal), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(f.app.marketplace.quote(f.builder, open, f.offerBody(s), randomUUID(), s.principal), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(f.app.qualificationJobs(s.principal), { code: 'INVALID_AGENT_KEY' });
  // Revocation voids the new key too.
  const fresh = await f.app.runtimePrincipal(rotated.token, { kind: 'supplier-api' });
  await f.app.revokeCredential(f.builder, s.agentId, { expectedVersion: (await s.agent()).version }, randomUUID());
  await assert.rejects(f.app.runtimePrincipal(rotated.token), { code: 'INVALID_AGENT_KEY' });
  await assert.rejects(f.app.heartbeat(fresh, { runtimeName: 'QA', runtimeVersion: '1' }), { code: 'INVALID_AGENT_KEY' });
  // Expiry: a key one millisecond past its lifetime is refused.
  const later = await f.app.issueSupplierCredential(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, expiresInSeconds: 3600 }, randomUUID());
  const live = await f.app.runtimePrincipal(later.token, { kind: 'supplier-api' });
  f.advance(3600 * 1000);
  await assert.rejects(f.app.supplierEvents(live), { code: 'INVALID_AGENT_KEY' });
  // Lifetimes outside one hour to 30 days, and malformed tokens, are refused.
  for (const expiresInSeconds of [3599, 2592001, 3600.5, '3600'])
    await assert.rejects(f.app.issueSupplierCredential(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, expiresInSeconds }, randomUUID()), { code: 'INVALID_INPUT' });
  for (const token of [undefined, '', 'x'.repeat(42), 'x'.repeat(44), `${'x'.repeat(42)}!`])
    await assert.rejects(f.app.runtimePrincipal(token), { code: 'INVALID_AGENT_KEY' });
});

// ---- Offers ------------------------------------------------------------------

test('runtime offers: amounts, currency, version, minimum, freshness, duplicates and milestones are checked', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder);
  const taskId = await f.post();
  const quote = extra => f.app.marketplace.quote(f.builder, taskId, f.offerBody(s, extra), randomUUID(), s.principal);
  for (const amountMinor of [0, -1, 1.5, '100', NaN, 10_000_001, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(quote({ amountMinor }), { code: 'INVALID_INPUT' }, `amount ${amountMinor}`);
  for (const deliveryMinutes of [0, -5, 525_601, 2.5])
    await assert.rejects(quote({ deliveryMinutes }), { code: 'INVALID_INPUT' }, `minutes ${deliveryMinutes}`);
  await assert.rejects(quote({ currency: 'GBP' }), { code: 'CURRENCY_UNSUPPORTED' });
  await assert.rejects(quote({ currency: 'EUR' }), { code: 'CURRENCY_UNSUPPORTED' }, 'runtime currency must match the agent rules');
  await assert.rejects(quote({ amountMinor: 99 }), { code: 'PRICE_LIMIT' });
  await assert.rejects(quote({ expectedVersion: 1 }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(quote({ capabilityId: randomUUID() }), { code: 'NOT_FOUND' });
  await assert.rejects(quote({ milestones: [] }), { code: 'MILESTONES_UNSUPPORTED' });
  await assert.rejects(quote({ extra: true }), { code: 'INVALID_FIELDS' });
  f.advance(120001);
  await assert.rejects(quote({}), { code: 'RUNTIME_REQUIRED' }, 'a stale heartbeat stops automatic offers');
  await f.app.heartbeat(s.principal, { runtimeName: 'QA runtime', runtimeVersion: '1' });
  await quote({});
  await assert.rejects(quote({}), { code: 'OFFER_EXISTS' });
  // An agent never offers on its own builder's request.
  const own = await f.app.createTask(f.builder, { tenantId: f.builder.memberships[0].id, title: 'Own', brief: 'My own request.' }, randomUUID());
  await f.app.mutateTask(f.builder, own.taskId, 'post', { expectedVersion: 1 }, randomUUID());
  await assert.rejects(f.app.marketplace.quote(f.builder, own.taskId, f.offerBody(s), randomUUID(), s.principal), { code: 'NOT_FOUND' });
});

test('“small requests only” refuses runtime offers above the limit and on ERP data requests; hand-made offers are not limited', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder, { rules: { automaticScope: 'limited', automaticLimitMinor: 500 } });
  const small = await f.post(), erp = await f.post('ERP data', 'Map our vendor master.');
  // Marked as an ERP data request after posting (the intake checklist itself is out of scope here).
  await f.repository.transaction('qa-fixture', async repo => { const task = await repo.get('task', erp); task.intake = { kind: 'erp-data' }; await repo.save('task', task); });
  await assert.rejects(f.app.marketplace.quote(f.builder, small, f.offerBody(s, { amountMinor: 501 }), randomUUID(), s.principal), { code: 'AUTOMATIC_LIMIT' });
  await assert.rejects(f.app.marketplace.quote(f.builder, erp, f.offerBody(s, { amountMinor: 100 }), randomUUID(), s.principal), { code: 'AUTOMATIC_LIMIT' });
  await f.app.marketplace.quote(f.builder, small, f.offerBody(s, { amountMinor: 500 }), randomUUID(), s.principal);
  const hand = await f.post();
  await f.app.marketplace.quote(f.builder, hand, f.offerBody(s, { amountMinor: 900 }), randomUUID());
  for (const automaticLimitMinor of [0, -1, 1.5, 10_000_001, undefined])
    await assert.rejects(f.app.marketplace.configure(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, integration: 'api', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1, automaticScope: 'limited', automaticLimitMinor }, randomUUID()), { code: 'INVALID_INPUT' });
});

// ---- Feeds ---------------------------------------------------------------------

test('the opportunity feed shows public brief metadata only, and hides reserved, own and excluded requests', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder), rival = await f.connect(f.rival);
  const secret = 'SECRET-BYTES-9f1c';
  const { taskId } = await f.app.createTask(f.buyer, { tenantId: f.buyer.memberships[0].id, title: 'CSV clean', brief: 'Clean this list.' }, randomUUID());
  await f.app.addInput(f.buyer, taskId, { expectedVersion: 1, filename: 'list.csv', notes: 'Our list.', base64: Buffer.from(`name\n${secret}\n`).toString('base64') }, randomUUID());
  await f.app.mutateTask(f.buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const direct = await f.post('Direct', 'For the rival only.', { preferredAgentId: rival.agentId });
  const excluded = await f.post('Retry', 'Another agent please.', { retryOf: { taskId: randomUUID(), version: 1, excludedAgentId: s.agentId } });
  const feed = await f.app.supplierOpportunities(s.principal);
  const ids = feed.tasks.map(item => item.id);
  assert.ok(ids.includes(taskId));
  assert.ok(!ids.includes(direct), 'a direct request for another agent stays hidden');
  assert.ok(!ids.includes(excluded), 'the excluded agent of a retry never sees it');
  assert.ok((await f.app.supplierOpportunities(rival.principal)).tasks.some(item => item.id === direct));
  const text = JSON.stringify(feed);
  assert.ok(!text.includes(secret), 'input bytes stay private before authorization');
  assert.ok(!text.includes(f.buyer.memberships[0].id) && !text.includes(f.buyer.user.id), 'the buyer’s workspace and identity stay private');
  for (const [after, limit] of [['bad cursor!', 50], ['', 0], ['', 101], ['', 1.5], ['x'.repeat(151), 10]])
    await assert.rejects(f.app.supplierOpportunities(s.principal, after, limit), { code: /INVALID_(CURSOR|INPUT)/ });
});

test('BUG-SUP-3 check: Supplier API opportunities carry `fits` as Supplier-API.md and the sample agent promise', async t => {
    const f = await fixture(t);
    const s = await f.connect(f.builder, { task: 'Write release notes from a supplied brief' });
    await f.post('Release notes', 'Write release notes from a supplied brief for our search feature.');
    const [item] = (await f.app.supplierOpportunities(s.principal)).tasks;
    assert.ok(item, 'the request is in the feed');
    assert.ok(Array.isArray(item.fits), `expected a fits array, got ${JSON.stringify(Object.keys(item))}`);
  });

test('BUG-SUP-2 check: resuming the opportunity feed from its nextCursor finds requests posted later', async t => {
    const f = await fixture(t);
    const s = await f.connect(f.builder);
    for (let i = 0; i < 3; i++) await f.post(`Request ${i}`);
    let page = await f.app.supplierOpportunities(s.principal, '', 100);
    assert.equal(page.hasMore, false);
    const cursor = page.nextCursor;
    const lastId = page.tasks.at(-1).id;
    // Post later (the clock moves) until one new request's id sorts before the last
    // one seen: id-ordered paging would skip it (each try is a coin flip).
    let missed = null;
    for (let i = 0; i < 40 && !missed; i++) {
      f.advance(1000);
      const id = await f.post(`Later ${i}`);
      if (id < lastId) missed = id;
    }
    assert.ok(missed, 'fixture produced an id before the cursor');
    page = await f.app.supplierOpportunities(s.principal, cursor, 100);
    assert.ok(page.tasks.some(item => item.id === missed), 'a request posted after the last poll is returned when resuming from nextCursor');
  });

test('event and assignment feeds: ordered, gap-free, stable on re-read and scoped to the agent', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder);
  const a = await f.assigned(s), b = await f.assigned(s);
  const active = await f.app.supplierAssignments(s.principal, '', 1);
  assert.equal(active.assignments.length, 1);
  assert.equal(active.hasMore, true);
  const rest = await f.app.supplierAssignments(s.principal, active.nextCursor, 1);
  assert.deepEqual(new Set([...active.assignments, ...rest.assignments].map(x => x.taskId)), new Set([a.taskId, b.taskId]));
  const all = [];
  let after = '';
  for (let i = 0; i < 20; i++) {
    const page = await f.app.supplierEvents(s.principal, after, 1);
    all.push(...page.events);
    if (!page.hasMore) break;
    after = page.nextCursor;
  }
  assert.ok(all.length >= 2);
  assert.deepEqual(all.map(e => e.sequence), all.map((_, i) => i + 1));
  const end = await f.app.supplierEvents(s.principal, all.at(-1).id, 10);
  assert.deepEqual(end.events, []);
  assert.equal(end.nextCursor, all.at(-1).id, 'an empty page keeps the cursor, never regresses it');
});

// ---- Relay tests (qualification) ------------------------------------------------

test('Relay test rounds can’t be skipped or replayed, and a pass stops counting after the key rotates', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder, { category: 'Data', task: 'Normalize CSV data' });
  const start = async rubric => f.app.startQualification(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, capabilityId: s.capabilityId, rubric }, randomUUID());
  await assert.rejects(start('no-such-rubric'), { code: 'RUBRIC_UNAVAILABLE' });
  const { assessmentId } = await start('csv-normalize-v1');
  await assert.rejects(start('csv-normalize-v1'), { code: 'ASSESSMENT_PENDING' });
  let [job] = await f.app.qualificationJobs(s.principal);
  assert.equal(job.round, 1);
  await assert.rejects(f.app.submitQualification(s.principal, assessmentId, csvAnswer({ ...job, round: 2 }), randomUUID()), { code: 'ASSESSMENT_STATE' }, 'round 2 before round 1');
  assert.equal((await f.app.submitQualification(s.principal, assessmentId, csvAnswer(job), randomUUID())).status, 'revision_pending');
  await assert.rejects(f.app.submitQualification(s.principal, assessmentId, csvAnswer(job), randomUUID()), { code: 'ASSESSMENT_STATE' }, 'round 1 replayed');
  [job] = await f.app.qualificationJobs(s.principal);
  assert.equal(job.round, 2);
  assert.equal((await f.app.submitQualification(s.principal, assessmentId, csvAnswer(job), randomUUID())).status, 'passed');
  assert.equal((await s.agent()).capabilities[0].qualification, 'qualified');
  // A foreign key can't submit to this assessment.
  const rival = await f.connect(f.rival);
  await assert.rejects(f.app.submitQualification(rival.principal, assessmentId, csvAnswer(job), randomUUID()), { code: 'NOT_FOUND' });
  // Rotating the key ends the pass: the runtime that passed is no longer the one connected.
  await f.app.issueSupplierCredential(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, expiresInSeconds: 3600 }, randomUUID());
  assert.notEqual((await s.agent()).capabilities[0].qualification, 'qualified');
  await assert.rejects(f.app.marketplace.updateListing(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, status: 'published' }, randomUUID()), { code: 'RELAY_TEST_REQUIRED' });
});

test('a data-driven Relay test refuses a capability outside its category', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder, { category: 'Software', task: 'Review pull requests for security issues' });
  await assert.rejects(f.app.startQualification(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, capabilityId: s.capabilityId, rubric: 'relay-test:5eed0000-0000-4000-8000-000000000001' }, randomUUID()), { code: 'CATEGORY_MISMATCH' });
});

test('BUG-SUP-1 check: the built-in CSV Relay test only qualifies capabilities in its own category', async t => {
    const f = await fixture(t);
    const s = await f.connect(f.builder, { category: 'Software', task: 'Review pull requests for security issues' });
    assert.notEqual(categoryOf((await s.agent()).capabilities[0]), 'data-cleanup');
    let refused = false;
    try {
      const { assessmentId } = await f.app.startQualification(f.builder, s.agentId, { expectedVersion: (await s.agent()).version, capabilityId: s.capabilityId, rubric: 'csv-normalize-v1' }, randomUUID());
      for (let round = 1; round <= 2; round++) {
        const [job] = await f.app.qualificationJobs(s.principal);
        await f.app.submitQualification(s.principal, assessmentId, csvAnswer(job), randomUUID());
      }
    } catch (error) { if (error.code === 'CATEGORY_MISMATCH') refused = true; else throw error; }
    const capability = (await s.agent()).capabilities[0];
    assert.ok(refused || capability.qualification !== 'qualified',
      `a code-review capability became "${capability.qualification}" by passing the CSV clean-up test`);
  });

// ---- Notifications ---------------------------------------------------------------

test('BUG-SUP-4 check: no match alert for a “try another agent” request the builder’s agent is excluded from', async t => {
    const f = await fixture(t);
    const s = await f.connect(f.builder, { task: 'Write release notes from a supplied brief' });
    const retry = await f.post('Release notes', 'Write release notes from a supplied brief for search.', { retryOf: { taskId: randomUUID(), version: 1, excludedAgentId: s.agentId } });
    assert.ok(!(await f.app.supplierOpportunities(s.principal)).tasks.some(item => item.id === retry), 'the feed hides it (verified)');
    assert.ok(!(await f.app.marketplace.opportunities(f.builder)).some(item => item.id === retry), 'the browser list hides it (verified)');
    const alerts = (await f.app.notifications(f.builder)).items.filter(item => item.destination === 'opportunity');
    assert.ok(!alerts.some(item => item.taskId === retry), 'no alert for a request this builder is excluded from');
  });

test('a paused agent doesn’t offer automatically, but its builder can still offer by hand', async t => {
  const f = await fixture(t);
  const s = await f.connect(f.builder);
  const taskId = await f.post('Release notes');
  await f.repository.transaction('pause-fixture', async repo => { const a = await repo.get('agent', s.agentId); a.listingStatus = 'paused'; await repo.save('agent', a); });
  await assert.rejects(f.app.marketplace.quote(f.builder, taskId, f.offerBody(s), randomUUID(), s.principal), { code: 'AGENT_PAUSED' });
  assert.ok((await f.app.marketplace.quote(f.builder, taskId, f.offerBody(s), randomUUID())).offerId);
});
