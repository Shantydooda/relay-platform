'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
async function proposal(f, extra = {}, key = randomUUID()) {
  return f.app.proposeChange(
    f.builder,
    f.taskId,
    {
      expectedVersion: (await f.get()).version,
      title: 'Revised cleanup',
      brief: 'Clean data and include a summary',
      reason: 'Additional summary requested',
      amountMinor: 700,
      retainedMinor: 100,
      deliveryMinutes: 15,
      kind: 'scope-change',
      ...extra,
    },
    key,
  );
}
async function review(f, p, decision = 'accept', key = randomUUID()) {
  return f.app.reviewChange(
    f.buyer,
    f.taskId,
    {
      expectedVersion: (await f.get()).version,
      proposalId: p.proposalId,
      decision,
    },
    key,
  );
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: messages preserve terms; revised agreement is explicit and idempotent`, async (t) => {
    const f = await fixture(t, adapter),
      before = await f.get();
    await f.app.supplierMessage(
      f.builder,
      f.taskId,
      { expectedVersion: before.version, body: 'I can add that summary.' },
      randomUUID(),
    );
    assert.equal((await f.get()).selectedOfferId, before.selectedOfferId);
    await assert.rejects(
      f.app.supplierMessage(
        f.stranger,
        f.taskId,
        { expectedVersion: (await f.get()).version, body: 'No' },
        randomUUID(),
      ),
      { code: 'NOT_FOUND' },
    );
    await assert.rejects(proposal(f, { kind: 'correction' }), {
      code: 'INCLUDED_WORK',
    });
    await assert.rejects(proposal(f, { retainedMinor: 501 }), {
      code: 'INVALID_INPUT',
    });
    const p = await proposal(f),
      body = {
        expectedVersion: (await f.get()).version,
        proposalId: p.proposalId,
        decision: 'accept',
      },
      key = randomUUID();
    const first = await f.app.reviewChange(f.buyer, f.taskId, body, key);
    assert.deepEqual(
      await f.app.reviewChange(f.buyer, f.taskId, body, key),
      first,
    );
    const after = await f.get();
    assert.equal(after.scopeVersion, 2);
    assert.equal(after.assignment, null);
    assert.equal(
      after.offers.find((x) => x.id === after.selectedOfferId).amountMinor,
      700,
    );
    assert.equal(after.agreementHistory.length, 1);
    assert.equal(after.offers[0].amountMinor, 500);
  });
  test(`${adapter}: decline, expiry, supersession and concurrent reviews are safe`, async (t) => {
    const f = await fixture(t, adapter),
      p = await proposal(f);
    await review(f, p, 'decline');
    assert.equal((await f.get()).scopeVersion, 1);
    const old = await proposal(f);
    const current = await proposal(f, { amountMinor: 300 });
    await assert.rejects(review(f, old), { code: 'CHANGE_STALE' });
    const body = {
      expectedVersion: (await f.get()).version,
      proposalId: current.proposalId,
      decision: 'accept',
    };
    const results = await Promise.allSettled([
      f.app.reviewChange(f.buyer, f.taskId, body, randomUUID()),
      f.app.reviewChange(f.buyer, f.taskId, body, randomUUID()),
    ]);
    assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
    const expired = await proposal(f);
    f.advance(86400001);
    await assert.rejects(review(f, expired), { code: 'CHANGE_STALE' });
  });
}
test('accepted change cancels the old assignment and grant; submitted work is protected', async (t) => {
  const f = await fixture(t);
  await f.repository.transaction('fixture', async (r) => {
    await r.save('agent', { id: 'agent-fixture', ownerId: f.builder.user.id });
    const task = await r.get('task', f.taskId, true);
    task.assignment = {
      id: 'old-run',
      agentId: 'agent-fixture',
      operatorId: f.builder.user.id,
      mode: 'local-unpaid',
      status: 'running',
      leaseHash: 'old',
      leaseUntil: Date.now() + 60000,
    };
    await r.save('task', task);
  });
  const p = await proposal(f);
  await review(f, p);
  assert.equal((await f.get()).assignment, null);
  assert.equal(
    (await f.repository.read((r) => r.get('agent-grant', 'old-run'))).status,
    'cancelled',
  );
  await f.accept();
  await assert.rejects(proposal(f), { code: 'FUNDED_CHANGE_UNAVAILABLE' });
});
test('company change releases old reservation and requires fresh approval', async (t) => {
  const f = await fixture(t),
    tenant = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  const approver = {
    user: { id: randomUUID() },
    memberships: [{ id: tenant, role: 'approver', company: true }],
  };
  f.app = createApplication({
    ...f.options,
    resolveOperator: async (id) =>
      [f.buyer, f.builder, approver].find((a) => a.user.id === id),
  });
  await f.repository.transaction('fixture', async (r) => {
    const task = await r.get('task', f.taskId, true);
    task.companyApprovalRequired = true;
    await r.save('task', task);
  });
  await f.app.configureBudget(
    f.buyer,
    tenant,
    { limitMinor: 1000, expectedVersion: 0 },
    randomUUID(),
  );
  await f.app.requestApproval(
    f.buyer,
    f.taskId,
    { expectedVersion: (await f.get()).version, note: 'Research' },
    randomUUID(),
  );
  let task = await f.get();
  await f.app.decideApproval(
    approver,
    f.taskId,
    {
      approvalId: task.approval.id,
      expectedVersion: task.approval.version,
      decision: 'approved',
      note: 'Approved',
    },
    randomUUID(),
  );
  assert.equal(
    (await f.app.companyBudget(f.buyer, tenant)).budget.reservedMinor,
    500,
  );
  await review(f, await proposal(f));
  assert.equal(
    (await f.app.companyBudget(f.buyer, tenant)).budget.reservedMinor,
    0,
  );
  assert.equal(
    (await f.app.detail(f.buyer, f.taskId)).approval.status,
    'stale',
  );
  await assert.rejects(f.begin('fund'), { code: 'APPROVAL_REQUIRED' });
});
test('local identity adapter exposes all conversation commands', () => {
  const methods = {
    supplierMessage() {},
    proposeChange() {},
    reviewChange() {},
  };
  const store = require('../src/compose.cjs').composeIdentity({}, methods);
  for (const [name, fn] of Object.entries(methods))
    assert.equal(store[name], fn);
});
test('authenticated runtime replies and replacement fences a real execution lease', async (t) => {
  const base = await fixture(t);
  const f = await require('./helpers/recurring.cjs').recurringFixture(
    base.repository,
  );
  const { taskId } = await f.app.createTask(
    f.buyer,
    {
      tenantId: f.buyer.memberships[0].id,
      title: 'Clean CSV',
      brief: 'Normalize the supplied CSV.',
    },
    randomUUID(),
  );
  await f.app.addInput(
    f.buyer,
    taskId,
    {
      expectedVersion: 1,
      filename: 'source.csv',
      base64: Buffer.from('name\nAcme\n').toString('base64'),
      notes: 'Test',
    },
    randomUUID(),
  );
  await f.app.mutateTask(
    f.buyer,
    taskId,
    'post',
    { expectedVersion: 2 },
    randomUUID(),
  );
  const offer = await f.quote(taskId);
  await f.app.marketplace.accept(
    f.buyer,
    taskId,
    { expectedVersion: 3, offerId: offer.offerId },
    randomUUID(),
  );
  const award = await f.app.authorizeLocal(
    f.buyer,
    taskId,
    { expectedVersion: 4, mode: 'local-unpaid' },
    randomUUID(),
  );
  const claim = await f.app.claim(
    f.principal,
    taskId,
    { assignmentId: award.assignmentId },
    randomUUID(),
  );
  const get = () => base.repository.read((r) => r.get('task', taskId));
  await f.app.supplierMessage(
    f.principal.actor,
    taskId,
    {
      expectedVersion: (await get()).version,
      body: 'I can revise the output.',
    },
    randomUUID(),
    f.principal,
  );
  assert.equal((await get()).messages.at(-1).authorName, 'CSV worker');
  const proposal = await f.app.proposeChange(
    f.principal.actor,
    taskId,
    {
      expectedVersion: (await get()).version,
      kind: 'scope-change',
      title: 'Revised CSV',
      brief: 'Normalize CSV and include counts.',
      reason: 'Requested counts',
      amountMinor: 150,
      retainedMinor: 0,
      deliveryMinutes: 1,
    },
    randomUUID(),
    f.principal,
  );
  await f.app.reviewChange(
    f.buyer,
    taskId,
    {
      expectedVersion: (await get()).version,
      proposalId: proposal.proposalId,
      decision: 'accept',
    },
    randomUUID(),
  );
  await assert.rejects(
    f.app.progress(
      f.principal,
      taskId,
      { leaseToken: claim.leaseToken, message: 'Old worker update' },
      randomUUID(),
    ),
  );
  await assert.rejects(
    f.app.submit(
      f.principal,
      taskId,
      {
        leaseToken: claim.leaseToken,
        evidence: 'Old output',
        files: [
          {
            filename: 'result.csv',
            mime: 'text/csv',
            base64: Buffer.from('name\nAcme\n').toString('base64'),
          },
        ],
      },
      randomUUID(),
    ),
  );
  assert.equal((await get()).assignment, null);
  const fresh = await f.app.authorizeLocal(
    f.buyer,
    taskId,
    { expectedVersion: (await get()).version, mode: 'local-unpaid' },
    randomUUID(),
  );
  assert.notEqual(fresh.assignmentId, award.assignmentId);
  await f.finish(taskId);
  assert.equal((await get()).assignment.status, 'accepted');
});
