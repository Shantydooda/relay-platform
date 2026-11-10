'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');

// Independent behavioral oracle: exercise commands, not a duplicate implementation
// of their guards. Preconditions (current version, owned lease, valid files) are
// supplied by reach(). Rejected commands must leave task and supplier feed intact.
const transitions = {
  queued:       { claim: 'running', cancel: 'cancelled' },
  running:      { progress: 'running', submit: 'buyer_review', fail: 'failed', cancel: 'cancelled' },
  buyer_review: { accept: 'accepted', revise: 'queued', cancel: 'cancelled' },
  accepted:     {},
  failed:       { retry: 'queued' },
  cancelled:    {},
};
const rejection = {
  claim: 'STATE_CONFLICT', progress: 'LEASE_EXPIRED', submit: 'LEASE_EXPIRED',
  fail: 'LEASE_EXPIRED', accept: 'STALE_SUBMISSION', revise: 'STALE_SUBMISSION',
  cancel: 'STATE_CONFLICT', retry: 'RECOVERY_BLOCKED',
};
const delivery = leaseToken => ({
  leaseToken,
  evidence: 'Contains only the requested release notes.',
  files: [{ filename: 'notes.txt', mime: 'text/plain', base64: Buffer.from('Search your saved tasks.').toString('base64') }],
});

async function reach(repository, state) {
  const f = await fixture(repository);
  const job = await f.task();
  let leaseToken = 'x'.repeat(43);
  let submissionId = randomUUID();
  if (state !== 'queued') {
    ({ leaseToken } = await f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, randomUUID()));
  }
  if (['buyer_review', 'accepted'].includes(state)) {
    ({ submissionId } = await f.app.submit(f.principal, job.taskId, delivery(leaseToken), randomUUID()));
  }
  const version = async () => (await f.app.detail(f.buyer, job.taskId)).task.version;
  const actions = {
    claim: key => f.app.claim(f.principal, job.taskId, { assignmentId: job.assignmentId }, key),
    progress: key => f.app.progress(f.principal, job.taskId, { leaseToken, message: 'Working on the release notes.' }, key),
    submit: key => f.app.submit(f.principal, job.taskId, delivery(leaseToken), key),
    fail: key => f.app.failExecution(f.principal, job.taskId, { leaseToken, code: 'AGENT_ERROR' }, key),
    accept: async key => f.app.reviewDelivery(f.buyer, job.taskId, 'accept-delivery', { expectedVersion: await version(), submissionId }, key),
    revise: async key => f.app.reviewDelivery(f.buyer, job.taskId, 'request-revision', { expectedVersion: await version(), submissionId, notes: 'Use shorter sentences.' }, key),
    cancel: async key => f.app.cancelExecution(f.buyer, job.taskId, { expectedVersion: await version(), reason: 'No longer required.' }, key),
    retry: async key => f.app.retryExecution(f.buyer, job.taskId, { expectedVersion: await version(), reason: 'Retry after the runtime recovered.' }, key),
  };
  if (state === 'accepted') await actions.accept(randomUUID());
  if (state === 'failed') await actions.fail(randomUUID());
  if (state === 'cancelled') await actions.cancel(randomUUID());
  const snapshot = () => repository.read(repo => repo.get('task', job.taskId));
  assert.equal((await snapshot()).assignment.status, state);
  return { ...f, ...job, actions, snapshot, leaseToken, submissionId };
}

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: execution transition matrix preserves rejected state and public projections`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    for (const [state, allowed] of Object.entries(transitions)) {
      for (const action of Object.keys(rejection)) {
        await t.test(`${state} / ${action}`, async () => {
          const f = await reach(repository, state);
          const before = await f.snapshot();
          const events = await f.app.supplierEvents(f.principal);
          if (['accept', 'revise', 'cancel', 'retry'].includes(action)) {
            const eligibility = (await f.app.detail(f.buyer, f.taskId)).actions.execution[action];
            assert.equal(eligibility.allowed, !!allowed[action]);
            assert.equal(eligibility.code, allowed[action] ? null : rejection[action]);
            assert.deepEqual(await f.snapshot(), before, 'eligibility must not mutate execution');
          }
          if (allowed[action]) {
            await f.actions[action](randomUUID());
            const detail = await f.app.detail(f.buyer, f.taskId);
            assert.equal(detail.task.status, allowed[action]);
            assert.equal(detail.execution.status, allowed[action]);
            assert.equal((await f.app.supplierAssignment(f.principal, f.taskId)).status, allowed[action]);
            assert.ok((await f.snapshot()).version > before.version);
          } else {
            const code = state === 'running' && action === 'claim' ? 'LEASE_BUSY' : rejection[action];
            await assert.rejects(f.actions[action](randomUUID()), { code });
            assert.deepEqual(await f.snapshot(), before, 'rejection must roll back all task changes');
            assert.deepEqual(await f.app.supplierEvents(f.principal), events, 'rejection must not publish an event');
          }
        });
      }
    }
  });

  test(`${adapter}: competing claims, replay and revision fence obsolete workers`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    const f = await reach(repository, 'queued');
    const keys = [randomUUID(), randomUUID()];
    const results = await Promise.allSettled(keys.map(key => f.actions.claim(key)));
    const winner = results.findIndex(result => result.status === 'fulfilled');
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.find(result => result.status === 'rejected').reason.code, 'LEASE_BUSY');
    const claim = results[winner].value;
    const beforeReplay = await f.snapshot();
    assert.deepEqual(await f.actions.claim(keys[winner]), claim);
    assert.deepEqual(await f.snapshot(), beforeReplay);
    const sent = await f.app.submit(f.principal, f.taskId, delivery(claim.leaseToken), randomUUID());
    await f.app.reviewDelivery(f.buyer, f.taskId, 'request-revision', {
      expectedVersion: (await f.snapshot()).version, submissionId: sent.submissionId, notes: 'Use shorter sentences.',
    }, randomUUID());
    const beforeStale = await f.snapshot();
    await assert.rejects(f.actions.claim(keys[winner]), { code: 'LEASE_EXPIRED' });
    await assert.rejects(f.app.submit(f.principal, f.taskId, delivery(claim.leaseToken), randomUUID()), { code: 'LEASE_EXPIRED' });
    assert.deepEqual(await f.snapshot(), beforeStale);
    const fresh = await f.actions.claim(randomUUID());
    assert.notEqual(fresh.leaseToken, claim.leaseToken);
    assert.equal(fresh.revisionNotes, 'Use shorter sentences.');
    assert.equal((await f.snapshot()).submissions.length, 1);
  });

  test(`${adapter}: cancellation racing delivery commits one outcome and fences late writes`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    // Reverse launch order as well as running concurrently: either serialization
    // is valid, but both commands must not commit against the same task version.
    for (const cancelFirst of [false, true]) {
      const f = await reach(repository, 'running');
      const before = await f.snapshot();
      const cancel = () => f.app.cancelExecution(f.buyer, f.taskId, {
        expectedVersion: before.version, reason: 'Stop this task before delivery.',
      }, randomUUID());
      const submit = () => f.actions.submit(randomUUID());
      const commands = cancelFirst ? [cancel, submit] : [submit, cancel];
      const results = await Promise.allSettled(commands.map(run => run()));
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
      const after = await f.snapshot();
      const cancelled = after.assignment.status === 'cancelled';
      assert.ok(cancelled || after.assignment.status === 'buyer_review');
      assert.equal(results.find(result => result.status === 'rejected').reason.code,
        cancelled ? 'LEASE_EXPIRED' : 'VERSION_CONFLICT');
      assert.equal(after.submissions.length, cancelled ? 0 : 1);
      assert.equal(after.version, before.version + 1);
      assert.equal((await f.app.supplierAssignment(f.principal, f.taskId)).status, after.assignment.status);
      await assert.rejects(f.actions.progress(randomUUID()), { code: 'LEASE_EXPIRED' });
      assert.deepEqual(await f.snapshot(), after);
    }
  });
}
