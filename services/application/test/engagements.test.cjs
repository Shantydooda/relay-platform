'use strict';
// Engagements and milestones: the fee split, validation, and money moving per
// milestone (docs/specs/Engagements-and-Milestones.md, acceptance criteria).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createPricing } = require('../src/pricing.cjs');
const { milestonesInput, priceMilestones } = require('../src/engagements.cjs');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { fixture } = require('./fixtures/payment-fixture.cjs');

const SCHEDULE = '100000:2000,1000000:1200,*:800';
const stage = (title, amountMinor, deliveryMinutes = 60) => ({ title, criteria: [`${title} is checked`], amountMinor, deliveryMinutes });

test('milestone fees are slices of the fee on the whole amount, so the stages add up to one offer’s price', () => {
  const pricing = createPricing(SCHEDULE);
  for (const amounts of [[60000, 60000, 500000], [1, 1, 1], [99999, 2, 1000000, 7], [250, 750]]) {
    const priced = priceMilestones(amounts.map((amount, i) => stage(`Stage ${i}`, amount)), pricing.price);
    const whole = pricing.price(amounts.reduce((a, b) => a + b, 0));
    assert.equal(priced.reduce((sum, item) => sum + item.feeMinor, 0), whole.feeMinor);
    assert.equal(priced.reduce((sum, item) => sum + item.totalMinor, 0), whole.totalMinor);
    for (const item of priced) {
      assert.equal(item.totalMinor, item.amountMinor + item.feeMinor);
      assert.ok(item.feeMinor >= 0);
    }
  }
  // With no fee schedule, a milestone costs exactly the builder's price.
  assert.deepEqual(priceMilestones([stage('Alpha', 500), stage('Beta', 700)], createPricing('').price).map(item => item.totalMinor), [500, 700]);
});

test('a plan has 2–6 distinct, checkable milestones whose totals match the offer', () => {
  const ok = { amountMinor: 3000, deliveryMinutes: 120, maxDeliveryMinutes: 43200 };
  assert.equal(milestonesInput([stage('Alpha', 1000), stage('Beta', 2000)], ok).length, 2);
  const code = (value, totals = ok) => { try { milestonesInput(value, totals); } catch (error) { return error.code; } return null; };
  assert.equal(code([stage('Alpha', 3000, 120)]), 'INVALID_INPUT', 'one milestone is just an offer');
  assert.equal(code(Array.from({ length: 7 }, (_, i) => stage(`Stage ${i}`, 1, 1)), { ...ok, amountMinor: 7, deliveryMinutes: 7 }), 'INVALID_INPUT');
  assert.equal(code([stage('Alpha', 1000), stage('alpha', 2000)]), 'INVALID_INPUT', 'titles must differ');
  assert.equal(code([{ ...stage('Alpha', 1000), criteria: [] }, stage('Beta', 2000)]), 'INVALID_INPUT', 'each milestone needs a check');
  assert.equal(code([stage('Alpha', 1000), stage('Beta', 1999)]), 'MILESTONE_TOTAL');
  assert.equal(code([stage('Alpha', 1000, 30), stage('Beta', 2000)]), 'MILESTONE_TOTAL');
  assert.equal(code([{ ...stage('Alpha', 1000), extra: true }, stage('Beta', 2000)]), 'INVALID_FIELDS');
});

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: each milestone is funded, paid and refunded on its own, in order`, async t => {
    const pricing = createPricing(SCHEDULE);
    const milestones = priceMilestones([stage('Mapping', 200), stage('Test load', 300), stage('Full load', 400)], pricing.price);
    const total = pricing.price(900);
    // A repository of our own, so the provider double gives each milestone's payment its own ids.
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    const f = await fixture(t, adapter, repository, { feeSchedule: SCHEDULE,
      offer: { amountMinor: 900, feeMinor: total.feeMinor, totalMinor: total.totalMinor, deliveryMinutes: 180, milestones, agentName: 'Agent', operatorName: 'Builder' } });
    const read = id => f.repository.read(repo => repo.get('task', id));
    const pay = async (id, action, who = f.buyer) => f.app.sandboxPayment(who, id, action, { expectedVersion: (await read(id)).version }, randomUUID());

    // Funding the plan itself is refused; choosing it creates the milestones.
    await assert.rejects(f.begin('fund'), { code: 'ENGAGEMENT_PARENT' });
    const parent = await f.get();
    const { milestoneIds: [m1, m2, m3] } = await f.app.marketplace.accept(f.buyer, f.taskId, { offerId: 'offer-fixture', expectedVersion: parent.version }, randomUUID());
    await assert.rejects(f.begin('fund'), { code: 'ENGAGEMENT_PARENT' });

    // Only milestone 1 can be funded at first, and it is charged its own price.
    await assert.rejects(pay(m2, 'fund'), { code: 'MILESTONE_ORDER' });
    await pay(m1, 'fund'); await f.app.reconcilePayment(f.buyer, m1);
    let first = await read(m1);
    assert.equal(first.settlement.status, 'funded');
    assert.deepEqual([first.settlement.amountMinor, first.settlement.payoutMinor, first.settlement.feeMinor], [milestones[0].totalMinor, 200, milestones[0].feeMinor]);
    assert.equal((await read(m2)).settlement, undefined, 'nothing is held for later milestones');

    // Accept milestone 1 and pay the builder exactly their milestone price.
    await f.repository.transaction('fixture', async repo => {
      const task = await repo.get('task', m1, true);
      task.assignment = { id: randomUUID(), agentId: 'agent-fixture', operatorId: f.builder.user.id, mode: 'stripe-sandbox', status: 'accepted', offerId: task.selectedOfferId };
      task.submissions = [{ id: randomUUID(), status: 'accepted', files: [] }];
      await repo.save('agent', { id: 'agent-fixture', ownerId: f.builder.user.id });
      await repo.save('task', task);
    });
    await pay(m1, 'transfer', f.builder);
    await pay(m1, 'payout', f.builder);
    await f.app.reconcilePayment(f.builder, m1);
    first = await read(m1);
    assert.equal(first.settlement.status, 'paid');

    // Milestone 2 can be funded now. Ending the plan with its money held is refused until it is refunded.
    await pay(m2, 'fund'); await f.app.reconcilePayment(f.buyer, m2);
    const end = async () => f.app.endEngagement(f.buyer, f.taskId, { expectedVersion: (await f.get()).version }, randomUUID());
    await assert.rejects(end(), { code: 'REFUND_REQUIRED' });
    await pay(m2, 'refund'); await f.app.reconcilePayment(f.buyer, m2);
    assert.equal((await read(m2)).settlement.status, 'refunded');
    await end();

    // Milestone 1 stays accepted and paid; 2 and 3 are cancelled; the refund touched only milestone 2.
    assert.equal((await read(m1)).settlement.status, 'paid');
    assert.deepEqual([(await read(m2)).status, (await read(m3)).status], ['cancelled', 'cancelled']);
    assert.equal((await read(m3)).settlement, undefined);
    assert.equal(f.calls.filter(call => call[0] === 'refund').length, 1);
    assert.equal(f.calls.filter(call => call[0] === 'transfer').length, 1);
    await assert.rejects(end(), { code: 'ENGAGEMENT_ENDED' });
  });
}

test('accepted plans and unstarted milestones refuse change proposals; milestone terms don’t lapse; an expired checkout doesn’t block ending', async t => {
  const pricing = createPricing('');
  const milestones = priceMilestones([stage('Mapping', 200), stage('Test load', 300)], pricing.price);
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const f = await fixture(t, 'sqlite', repository, { offer: { amountMinor: 500, totalMinor: 500, feeMinor: 0, deliveryMinutes: 120, milestones, agentName: 'Agent', operatorName: 'Builder' } });
  const read = id => f.repository.read(repo => repo.get('task', id));
  const parent = await f.get();
  const { milestoneIds: [m1, m2] } = await f.app.marketplace.accept(f.buyer, f.taskId, { offerId: 'offer-fixture', expectedVersion: parent.version }, randomUUID());
  const change = { title: 'Bigger', brief: 'Bigger scope', amountMinor: 5000, deliveryMinutes: 60, reason: 'More vendors than expected.', retainedMinor: 0, kind: 'scope-change' };
  await assert.rejects(f.app.proposeChange(f.builder, f.taskId, { ...change, expectedVersion: (await f.get()).version }, randomUUID()), { code: 'ENGAGEMENT_ACCEPTED' });
  await assert.rejects(f.app.proposeChange(f.builder, m2, { ...change, expectedVersion: (await read(m2)).version }, randomUUID()), { code: 'MILESTONE_FIXED' });

  // A milestone can wait as long as the work before it takes.
  f.advance(400 * 86400000);
  const offer = (await read(m1)).offers[0];
  assert.ok(offer.expiresAt > Date.now() + 400 * 86400000, 'agreed milestone terms don’t expire while the plan is open');

  // A checkout that expired holds no money, so the plan can still end.
  await f.repository.transaction('fixture', async repo => { const task = await repo.get('task', m1, true); task.settlement = { status: 'expired' }; await repo.save('task', task); });
  await f.app.endEngagement(f.buyer, f.taskId, { expectedVersion: (await f.get()).version }, randomUUID());
  assert.deepEqual([(await read(m1)).status, (await read(m2)).status], ['cancelled', 'cancelled']);
});
