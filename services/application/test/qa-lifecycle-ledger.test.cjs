'use strict';

// Adversarial QA: can a lifecycle path make a real failure disappear from the
// verified outcome ledger? Product rule: "Failures always count."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { taskOutcome } = require('../src/outcome-ledger.cjs');
const { fixture } = require('./helpers/supplier-workflow.cjs');

async function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const f = await fixture(repository);
  const job = await f.task();
  const stored = () => repository.read(repo => repo.get('task', job.taskId));
  const version = async () => (await stored()).version;
  return { ...f, job, stored, version };
}

test('baseline: an agent-reported failure is a failed outcome in the ledger', async t => {
  const s = await setup(t);
  const { leaseToken } = await s.app.claim(s.principal, s.job.taskId, { assignmentId: s.job.assignmentId }, randomUUID());
  await s.app.failExecution(s.principal, s.job.taskId, { leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  assert.equal(taskOutcome(await s.stored()).outcome, 'failed');
});

test('a failed run stays countable after the builder gets a change proposal accepted', { todo: 'BUG-LIFE-1: accepting a change proposal on a failed assignment relabels it cancelled and drops it from the ledger (failure laundering)' }, async t => {
  const s = await setup(t);
  const { leaseToken } = await s.app.claim(s.principal, s.job.taskId, { assignmentId: s.job.assignmentId }, randomUUID());
  await s.app.failExecution(s.principal, s.job.taskId, { leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  const failedAssignmentId = (await s.stored()).assignment.id;
  // The builder proposes a same-price "correction" on the failed work; the buyer accepts it.
  const proposal = await s.app.proposeChange(s.builder, s.job.taskId, {
    expectedVersion: await s.version(), title: 'Release notes', brief: 'Write clear release notes for the new search feature.',
    reason: 'Let us try that again.', amountMinor: 100, retainedMinor: 0, deliveryMinutes: 1, kind: 'correction',
  }, randomUUID());
  await s.app.reviewChange(s.buyer, s.job.taskId, { expectedVersion: await s.version(), proposalId: proposal.proposalId, decision: 'accept' }, randomUUID());
  const task = await s.stored();
  // The failed assignment must still be visible to the ledger as a failure.
  const events = await s.app.supplierEvents(s.principal, '', 100);
  const last = events.events.filter(item => item.assignmentId === failedAssignmentId).at(-1);
  assert.equal(last.status, 'failed', 'the failed assignment must not be rewritten as cancelled');
  assert.equal(taskOutcome(task)?.outcome, 'failed', 'the failed run must still count');
});

test('risk (current behaviour): a buyer retry after a failure lets the final acceptance count as first-time', async t => {
  const s = await setup(t);
  let { leaseToken } = await s.app.claim(s.principal, s.job.taskId, { assignmentId: s.job.assignmentId }, randomUUID());
  await s.app.failExecution(s.principal, s.job.taskId, { leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  await s.app.heartbeat(s.principal, { runtimeName: 'Fixture writer', runtimeVersion: '1.0' });
  await s.app.retryExecution(s.buyer, s.job.taskId, { expectedVersion: await s.version(), reason: 'The runtime recovered, retry it.' }, randomUUID());
  ({ leaseToken } = await s.app.claim(s.principal, s.job.taskId, { assignmentId: s.job.assignmentId }, randomUUID()));
  const { submissionId } = await s.app.submit(s.principal, s.job.taskId, { leaseToken, evidence: 'Second try.', files: [{ filename: 'notes.txt', mime: 'text/plain', base64: Buffer.from('ok').toString('base64') }] }, randomUUID());
  await s.app.reviewDelivery(s.buyer, s.job.taskId, 'accept-delivery', { expectedVersion: await s.version(), submissionId }, randomUUID());
  const task = await s.stored();
  assert.equal(task.assignment.recoveryHistory.length, 1);
  assert.equal(task.assignment.recoveryHistory[0].error, 'AGENT_ERROR');
  // The earlier failure is kept only in recoveryHistory; the ledger sees a first-time acceptance.
  assert.equal(taskOutcome(task).outcome, 'accepted_first_time');
});
