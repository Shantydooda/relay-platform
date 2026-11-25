'use strict';

// Adversarial QA of the execution lifecycle: lease fencing, buyer holds,
// races between buyer and agent commands, idempotency and revision limits.
// Every state is reached through real application commands.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');

const text = value => Buffer.from(value).toString('base64');
const delivery = (leaseToken, body = 'Search your saved tasks.', filename = 'notes.txt') => ({
  leaseToken, evidence: 'Release notes for the search feature.',
  files: [{ filename, mime: 'text/plain', base64: text(body) }],
});

async function setup(t, options) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const f = await fixture(repository, options);
  const job = await f.task();
  const version = async () => (await f.app.detail(f.buyer, job.taskId)).task.version;
  const stored = () => repository.read(repo => repo.get('task', job.taskId));
  const claim = (key = randomUUID()) => f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, key);
  const submit = (leaseToken, key = randomUUID(), body) => f.app.submit(f.principal, job.taskId, delivery(leaseToken, body), key);
  const review = async (action, submissionId, extra = {}, key = randomUUID()) =>
    f.app.reviewDelivery(f.buyer, job.taskId, action, { expectedVersion: await version(), submissionId, ...extra }, key);
  const pause = async (key = randomUUID()) => f.app.pauseExecution(f.buyer, job.taskId, { expectedVersion: await version() }, key);
  const resume = async (key = randomUUID()) => f.app.resumeExecution(f.buyer, job.taskId, { expectedVersion: await version() }, key);
  const cancel = async (key = randomUUID()) => f.app.cancelExecution(f.buyer, job.taskId, { expectedVersion: await version(), reason: 'No longer needed.' }, key);
  return { ...f, repository, job, version, stored, claim, submit, review, pause, resume, cancel };
}

test('a buyer pause fences the running lease: progress, submit and fail with the old token are refused', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  await s.pause();
  for (const attempt of [
    () => s.app.progress(s.principal, s.job.taskId, { leaseToken, message: 'Still working.' }, randomUUID()),
    () => s.submit(leaseToken),
    () => s.app.failExecution(s.principal, s.job.taskId, { leaseToken, code: 'AGENT_ERROR' }, randomUUID()),
  ]) await assert.rejects(attempt(), { code: 'LEASE_EXPIRED' });
  await assert.rejects(s.claim(), { code: 'PAUSED_BY_BUYER' });
  const task = await s.stored();
  assert.equal(task.assignment.status, 'queued');
  assert.equal(task.submissions.length, 0);
});

test('repeated pause/resume cycles while running never exhaust the retry budget', async t => {
  const s = await setup(t);
  for (let round = 0; round < 5; round++) {
    const claimed = await s.claim();
    assert.equal(claimed.exhausted, undefined, `round ${round} must not exhaust attempts`);
    await s.pause();
    await s.resume();
  }
  const { leaseToken } = await s.claim();
  await s.submit(leaseToken);
  assert.equal((await s.stored()).assignment.status, 'buyer_review');
});

test('a paused queued assignment is not timed out by the reconciler, and resume restarts the queue window', async t => {
  const s = await setup(t);
  await s.pause();
  s.advance(10 * 60 * 1000);
  await s.app.reconcileExecutions();
  assert.equal((await s.stored()).assignment.status, 'queued');
  await s.resume();
  const resumed = await s.stored();
  assert.ok(resumed.assignment.queueDeadlineAt > Date.now() + 5 * 60 * 1000 - 1);
  const { leaseToken } = await s.claim();
  await s.submit(leaseToken);
});

test('two claims with different keys race: exactly one wins, the loser gets LEASE_BUSY', async t => {
  const s = await setup(t);
  const results = await Promise.allSettled([s.claim(), s.claim(), s.claim()]);
  const won = results.filter(item => item.status === 'fulfilled');
  assert.equal(won.length, 1);
  assert.ok(results.filter(item => item.status === 'rejected').every(item => item.reason.code === 'LEASE_BUSY'));
  assert.equal((await s.stored()).assignment.attempt, 1);
});

test('replaying a claim key after the lease was lost and reclaimed never restores the old lease', async t => {
  const s = await setup(t);
  const key = randomUUID();
  const first = await s.claim(key);
  s.advance(30001);
  await s.app.reconcileExecutions();
  const second = await s.claim();
  await assert.rejects(s.claim(key), { code: 'LEASE_EXPIRED' });
  await assert.rejects(s.submit(first.leaseToken), { code: 'LEASE_EXPIRED' });
  await s.submit(second.leaseToken);
});

test('an expired-but-unreconciled lease can be reclaimed directly; the stale token is fenced', async t => {
  const s = await setup(t);
  const first = await s.claim();
  s.advance(30001);
  const second = await s.claim();
  assert.equal(second.attempt, 2);
  await assert.rejects(s.app.progress(s.principal, s.job.taskId, { leaseToken: first.leaseToken, message: 'Late.' }, randomUUID()), { code: 'LEASE_EXPIRED' });
});

test('claims past the attempt limit fail the assignment durably with RETRY_EXHAUSTED', async t => {
  const s = await setup(t);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal((await s.claim()).attempt, attempt);
    s.advance(30001);
  }
  const exhausted = await s.claim();
  assert.equal(exhausted.exhausted, true);
  const task = await s.stored();
  assert.equal(task.assignment.status, 'failed');
  assert.equal(task.assignment.error, 'RETRY_EXHAUSTED');
});

test('progress renews the lease but never past the execution deadline', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const { deadlineAt, heartbeatAt } = (await s.stored()).assignment;
  let clock = heartbeatAt, renewals = 0, refused;
  for (;;) {
    s.advance(20000); clock += 20000;
    try { await s.app.progress(s.principal, s.job.taskId, { leaseToken, message: 'Working.' }, randomUUID()); renewals++; }
    catch (error) { refused = error; break; }
    assert.ok(renewals < 1000);
  }
  assert.equal(refused.code, 'EXECUTION_EXPIRED');
  assert.ok(clock >= deadlineAt);
  assert.ok(clock - 20000 < deadlineAt);
  await assert.rejects(s.submit(leaseToken), { code: 'EXECUTION_EXPIRED' });
});

test('accept and request-revision racing on the same version: exactly one applies', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const { submissionId } = await s.submit(leaseToken);
  const expectedVersion = await s.version();
  const results = await Promise.allSettled([
    s.app.reviewDelivery(s.buyer, s.job.taskId, 'accept-delivery', { expectedVersion, submissionId }, randomUUID()),
    s.app.reviewDelivery(s.buyer, s.job.taskId, 'request-revision', { expectedVersion, submissionId, notes: 'Shorter please.' }, randomUUID()),
    s.app.cancelExecution(s.buyer, s.job.taskId, { expectedVersion, reason: 'Changed my mind.' }, randomUUID()),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  for (const item of results.filter(item => item.status === 'rejected')) assert.equal(item.reason.code, 'VERSION_CONFLICT');
});

test('double accept with two keys: the second is refused and no extra event is written', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const { submissionId } = await s.submit(leaseToken);
  await s.review('accept-delivery', submissionId);
  const before = await s.stored();
  await assert.rejects(s.review('accept-delivery', submissionId), { code: 'STALE_SUBMISSION' });
  assert.deepEqual(await s.stored(), before);
});

test('an idempotency key replayed with a different body is refused; the same body replays the receipt', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const { submissionId } = await s.submit(leaseToken);
  const expectedVersion = await s.version(), key = randomUUID();
  const first = await s.app.reviewDelivery(s.buyer, s.job.taskId, 'request-revision', { expectedVersion, submissionId, notes: 'Shorter please.' }, key);
  const replay = await s.app.reviewDelivery(s.buyer, s.job.taskId, 'request-revision', { expectedVersion, submissionId, notes: 'Shorter please.' }, key);
  assert.deepEqual(replay, first);
  await assert.rejects(s.app.reviewDelivery(s.buyer, s.job.taskId, 'request-revision', { expectedVersion, submissionId, notes: 'Longer please.' }, key), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(s.app.reviewDelivery(s.buyer, s.job.taskId, 'accept-delivery', { expectedVersion, submissionId }, key), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('a submit replayed with the same key after acceptance returns the original receipt and adds no submission', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const key = randomUUID();
  const first = await s.submit(leaseToken, key);
  await s.review('accept-delivery', first.submissionId);
  assert.deepEqual(await s.submit(leaseToken, key), first);
  assert.equal((await s.stored()).submissions.length, 1);
});

test('submit racing cancel in both orders leaves one consistent outcome', async t => {
  for (const order of ['submit-first', 'cancel-first']) {
    const s = await setup(t);
    const { leaseToken } = await s.claim();
    const expectedVersion = await s.version();
    const calls = [
      () => s.submit(leaseToken),
      () => s.app.cancelExecution(s.buyer, s.job.taskId, { expectedVersion, reason: 'No longer needed.' }, randomUUID()),
    ];
    if (order === 'cancel-first') calls.reverse();
    const results = await Promise.allSettled(calls.map(call => call()));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1, order);
    const task = await s.stored();
    if (task.assignment.status === 'cancelled') assert.equal(task.submissions.length, 0, order);
    else {
      assert.equal(task.assignment.status, 'buyer_review', order);
      assert.equal(task.submissions.at(-1).status, 'ready', order);
    }
    for (const item of results.filter(item => item.status === 'rejected')) assert.ok(['LEASE_EXPIRED', 'VERSION_CONFLICT'].includes(item.reason.code), order);
  }
});

test('pause racing claim on the same starting version: one wins; a winning claim makes the pause stale', async t => {
  const s = await setup(t);
  const expectedVersion = await s.version();
  const [claimed, paused] = await Promise.allSettled([
    s.claim(),
    s.app.pauseExecution(s.buyer, s.job.taskId, { expectedVersion }, randomUUID()),
  ]);
  const task = await s.stored();
  if (claimed.status === 'fulfilled') {
    assert.equal(paused.reason.code, 'VERSION_CONFLICT');
    assert.equal(task.assignment.status, 'running');
    await s.pause();
    await assert.rejects(s.submit(claimed.value.leaseToken), { code: 'LEASE_EXPIRED' });
  } else {
    assert.equal(claimed.reason.code, 'PAUSED_BY_BUYER');
    assert.ok(task.assignment.buyerPause);
  }
});

test('supplier-hosted revision cap is 10 rounds, then REVISION_LIMIT', async t => {
  const s = await setup(t);
  let lastSubmission;
  for (let round = 0; round < 10; round++) {
    const { leaseToken } = await s.claim();
    lastSubmission = (await s.submit(leaseToken, randomUUID(), `Draft ${round}`)).submissionId;
    await s.review('request-revision', lastSubmission, { notes: `Round ${round + 1}: tighten the wording.` });
  }
  const { leaseToken } = await s.claim();
  lastSubmission = (await s.submit(leaseToken, randomUUID(), 'Draft final')).submissionId;
  await assert.rejects(s.review('request-revision', lastSubmission, { notes: 'One more.' }), { code: 'REVISION_LIMIT' });
  const actions = (await s.app.detail(s.buyer, s.job.taskId)).actions.execution;
  assert.equal(actions.revise.allowed, false);
  assert.equal(actions.accept.allowed, true);
});

test('end as unmet: refused before 2 rounds, then fences the lease of an in-flight revision', async t => {
  const s = await setup(t);
  const end = async () => s.app.endUnmet(s.buyer, s.job.taskId, { expectedVersion: await s.version(), reason: 'The checklist was not met.' }, randomUUID());
  let token = (await s.claim()).leaseToken;
  let sub = (await s.submit(token)).submissionId;
  await assert.rejects(end(), { code: 'END_NOT_YET' });
  await s.review('request-revision', sub, { notes: 'Round one.' });
  token = (await s.claim()).leaseToken;
  sub = (await s.submit(token, randomUUID(), 'v2')).submissionId;
  await s.review('request-revision', sub, { notes: 'Round two.' });
  token = (await s.claim()).leaseToken;
  await end();
  await assert.rejects(s.submit(token, randomUUID(), 'v3'), { code: 'LEASE_EXPIRED' });
  const task = await s.stored();
  assert.equal(task.assignment.status, 'failed');
  assert.equal(task.assignment.error, 'BUYER_ENDED_UNMET');
  await assert.rejects(s.app.retryExecution(s.buyer, s.job.taskId, { expectedVersion: await s.version(), reason: 'Try again with the same agent.' }, randomUUID()), { code: 'RECOVERY_BLOCKED' });
});

test('a stale expectedVersion is refused for every buyer lifecycle command', async t => {
  const s = await setup(t);
  const stale = await s.version();
  const { leaseToken } = await s.claim();
  const { submissionId } = await s.submit(leaseToken);
  for (const call of [
    () => s.app.reviewDelivery(s.buyer, s.job.taskId, 'accept-delivery', { expectedVersion: stale, submissionId }, randomUUID()),
    () => s.app.reviewDelivery(s.buyer, s.job.taskId, 'request-revision', { expectedVersion: stale, submissionId, notes: 'Again.' }, randomUUID()),
    () => s.app.cancelExecution(s.buyer, s.job.taskId, { expectedVersion: stale, reason: 'Stop.' }, randomUUID()),
    () => s.app.endUnmet(s.buyer, s.job.taskId, { expectedVersion: stale, reason: 'Stop.' }, randomUUID()),
  ]) await assert.rejects(call(), { code: 'VERSION_CONFLICT' });
  for (const bad of [0, -1, 1.5, '3', null]) {
    await assert.rejects(s.app.cancelExecution(s.buyer, s.job.taskId, { expectedVersion: bad, reason: 'Stop.' }, randomUUID()), { code: 'INVALID_INPUT' });
  }
});

test('delivery file boundaries: names, emptiness, duplicates, count and mime', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const files = list => s.app.submit(s.principal, s.job.taskId, { leaseToken, evidence: 'Boundary check.', files: list }, randomUUID());
  const file = (filename, base64 = text('ok'), mime = 'text/plain') => ({ filename, base64, mime });
  for (const name of ['../x.txt', '.hidden', 'a/b.txt', 'résumé.txt', '', 'a'.repeat(101), 'notes .txt', 'n\u0000.txt'])
    await assert.rejects(files([file(name)]), { code: 'INVALID_FILE' }, JSON.stringify(name));
  await assert.rejects(files([file('empty.txt', '')]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('bin.txt', Buffer.from([0x61, 0x00]).toString('base64'))]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('bad.txt', Buffer.from([0xff, 0xfe]).toString('base64'))]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('a.txt'), file('a.txt')]), { code: 'INVALID_FILE' });
  await assert.rejects(files([]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('a.txt'), file('b.txt'), file('c.txt'), file('d.txt')]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('a.html', text('<b>x</b>'), 'text/html')]), { code: 'INVALID_FILE' });
  await assert.rejects(files([file('big.txt', Buffer.alloc(256 * 1024 + 1, 'a').toString('base64'))]), { code: 'INVALID_FILE' });
  const ok = await files([file('a'.repeat(100)), file('max.txt', Buffer.alloc(256 * 1024, 'a').toString('base64'))]);
  assert.ok(ok.submissionId);
});

test('empty, whitespace-only and oversized text inputs are refused on lifecycle commands', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  for (const message of ['', 'x'.repeat(201)])
    await assert.rejects(s.app.progress(s.principal, s.job.taskId, { leaseToken, message }, randomUUID()), { code: 'INVALID_INPUT' }, JSON.stringify(message));
  await assert.rejects(s.app.submit(s.principal, s.job.taskId, { ...delivery(leaseToken), evidence: '' }, randomUUID()), { code: 'INVALID_INPUT' });
  await assert.rejects(s.app.cancelExecution(s.buyer, s.job.taskId, { expectedVersion: await s.version(), reason: '' }, randomUUID()), { code: 'INVALID_INPUT' });
});

test('whitespace-only progress and revision notes are refused', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  await assert.rejects(s.app.progress(s.principal, s.job.taskId, { leaseToken, message: '   ' }, randomUUID()), { code: 'INVALID_INPUT' });
  const { submissionId } = await s.submit(leaseToken);
  await assert.rejects(s.review('request-revision', submissionId, { notes: '  \n ' }), { code: 'INVALID_INPUT' });
});

test('double submit with the same lease and different keys: one submission, the other is fenced', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const results = await Promise.allSettled([s.submit(leaseToken, randomUUID(), 'one'), s.submit(leaseToken, randomUUID(), 'two')]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.find(item => item.status === 'rejected').reason.code, 'LEASE_EXPIRED');
  assert.equal((await s.stored()).submissions.length, 1);
});

test('submit and fail racing on one lease: exactly one terminal outcome', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const results = await Promise.allSettled([
    s.submit(leaseToken),
    s.app.failExecution(s.principal, s.job.taskId, { leaseToken, code: 'AGENT_ERROR' }, randomUUID()),
  ]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  const task = await s.stored();
  assert.ok(['buyer_review', 'failed'].includes(task.assignment.status));
  assert.equal(task.submissions.length, task.assignment.status === 'buyer_review' ? 1 : 0);
});

test('after a restart, a fresh application instance reconciles the expired lease and fences the old worker', async t => {
  const s = await setup(t);
  const first = await s.claim();
  const later = Date.now() + 10 * 60 * 1000;
  // Fresh process over the same database (no in-memory state carried over).
  const { createApplication } = require('../src/service.cjs');
  const restarted = createApplication({ repository: s.repository, now: () => later, localExecution: true });
  await restarted.reconcileExecutions();
  const task = await s.stored();
  assert.equal(task.assignment.status, 'failed');
  assert.equal(task.assignment.leaseHash, null);
  s.advance(10 * 60 * 1000);
  await assert.rejects(s.submit(first.leaseToken), { code: 'LEASE_EXPIRED' });
});

test('replaying a buyer cancel key after the task moved on returns the original receipt without re-applying', async t => {
  const s = await setup(t);
  const expectedVersion = await s.version(), key = randomUUID();
  const body = { expectedVersion, reason: 'No longer needed.' };
  const first = await s.app.cancelExecution(s.buyer, s.job.taskId, body, key);
  const before = await s.stored();
  assert.deepEqual(await s.app.cancelExecution(s.buyer, s.job.taskId, body, key), first);
  assert.deepEqual(await s.stored(), before);
  await assert.rejects(s.app.cancelExecution(s.buyer, s.job.taskId, { ...body, reason: 'Different.' }, key), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('another buyer cannot pause, resume, cancel or review someone else\'s work', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.claim();
  const { submissionId } = await s.submit(leaseToken);
  const expectedVersion = await s.version();
  for (const call of [
    () => s.app.pauseExecution(s.other, s.job.taskId, { expectedVersion }, randomUUID()),
    () => s.app.cancelExecution(s.other, s.job.taskId, { expectedVersion, reason: 'Not mine.' }, randomUUID()),
    () => s.app.reviewDelivery(s.other, s.job.taskId, 'accept-delivery', { expectedVersion, submissionId }, randomUUID()),
    () => s.app.endUnmet(s.other, s.job.taskId, { expectedVersion, reason: 'Not mine.' }, randomUUID()),
  ]) await assert.rejects(call(), { code: 'NOT_FOUND' });
});
