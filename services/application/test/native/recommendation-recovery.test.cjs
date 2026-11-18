'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readConfig, adminPool, migrateLocal } = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createApplication } = require('../../src/service.cjs');
const { recommendationFlow } = require('../../../poc-api/test/helpers/recommendation-flow.cjs');

test('native PostgreSQL: qualified bids and selection survive reconnect and competing connections', { timeout: 60000 }, async t => {
  const config = readConfig();
  const database = `relay_recommend_qa_${randomUUID().replaceAll('-', '')}`;
  const admin = adminPool(config);
  let first, second, flow, databaseCreated = false;
  t.after(async () => {
    await flow?.close();
    await first?.close();
    await second?.close();
    if (databaseCreated) await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  });
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  databaseCreated = true;
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const isolated = {
    ...config,
    runtime: { ...config.runtime, database },
    migrator: { ...config.migrator, database }
  };
  await migrateLocal(isolated);
  first = await openLocalPostgres(isolated.runtime);
  second = await openLocalPostgres(isolated.runtime);
  flow = await recommendationFlow(4198, { repository: first.repository });
  const taskId = await flow.postTask();
  const bids = await flow.bid(taskId);
  const path = `/api/tasks/${taskId}`;
  const readOffers = async () => {
    const result = await flow.request(`${path}/offers`, flow.buyer);
    assert.equal(result.status, 200);
    return result.body.offers;
  };
  const before = await readOffers();
  assert.equal(before.find(offer => offer.recommendation.recommended).id, bids[0].offerId);
  assert.equal(before[0].qualificationEvidence.submissions.length, 2);

  // Reconstruct the HTTP/application layer against a fresh database pool.
  await flow.restart(second.repository);
  await first.close();
  first = await openLocalPostgres(isolated.runtime);
  assert.deepEqual(await readOffers(), before, 'reconnect must not rerank or discard evidence');
  const actors = [flow.buyer.actor, ...flow.builders.map(builder => builder.operator.actor)];
  const other = createApplication({
    repository: first.repository, localExecution: true,
    resolveOperator: async id => actors.find(actor => actor.user.id === id)
  });
  const key = randomUUID();
  const competingKey = randomUUID();
  const chosen = { expectedVersion: 2, offerId: bids[0].offerId };
  const competing = { expectedVersion: 2, offerId: bids[1].offerId };
  const [httpResult, independentResult] = await Promise.all([
    flow.request(`${path}/select`, flow.buyer, chosen, 'POST', key),
    other.marketplace.accept(flow.buyer.actor, taskId, competing, competingKey)
      .then(body => ({ status: 200, body }), error => ({ status: error.status, code: error.code }))
  ]);
  assert.deepEqual([httpResult.status, independentResult.status].sort(), [200, 409]);
  const winner = httpResult.status === 200 ? bids[0].offerId : bids[1].offerId;
  const selectedBefore = await readOffers();
  assert.equal(selectedBefore.filter(offer => offer.selected).length, 1);
  assert.equal(selectedBefore.find(offer => offer.selected).id, winner);
  assert.ok(selectedBefore.every(offer => !offer.recommendation.recommended));

  await flow.restart(first.repository);
  await second.close();
  second = await openLocalPostgres(isolated.runtime);
  assert.deepEqual(await readOffers(), selectedBefore);
  const detail = (await flow.request(path, flow.buyer)).body;
  assert.equal(detail.task.status, 'selected');
  assert.equal(detail.execution, null);
  assert.equal(detail.payment, null);
  for (let index = 0; index < flow.builders.length; index++) {
    const work = await flow.request('/api/work', flow.builders[index].operator);
    assert.equal(work.status, 200);
    assert.equal(work.body.tasks.length, bids[index].offerId === winner ? 1 : 0);
  }
  const winningRequest = httpResult.status === 200 ? chosen : competing;
  const winningKey = httpResult.status === 200 ? key : competingKey;
  const winningResult = httpResult.status === 200 ? httpResult : independentResult;
  assert.deepEqual(await flow.request(`${path}/select`, flow.buyer, winningRequest, 'POST', winningKey), winningResult,
    'the accepted selection receipt survives reconstruction regardless of which connection won');
  const stale = await flow.request(`${path}/select`, flow.buyer, competing);
  assert.equal(stale.status, 409);
});
