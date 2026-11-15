'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { recommendationFlow } = require('./helpers/recommendation-flow.cjs');

test('qualified supplier HTTP bids connect recommendations, buyer selection and builder work', async t => {
  const f = await recommendationFlow();
  t.after(() => f.close());
  const taskId = await f.postTask();
  const bids = await f.bid(taskId);
  const path = `/api/tasks/${taskId}`;
  let response = await f.request(`${path}/offers`, f.buyer);
  assert.equal(response.status, 200);
  const offers = response.body.offers;
  assert.equal(offers.length, 2, 'retries must not duplicate offers');
  const recommended = offers.find(offer => offer.recommendation.recommended);
  assert.equal(recommended.id, bids[0].offerId);
  assert.equal(recommended.qualificationCurrent, true);
  assert.deepEqual(recommended.capabilityMetadata.outputs, ['CSV']);
  assert.equal(recommended.qualificationEvidence.submissions.length, 2);
  assert.equal(recommended.trackRecord.capabilityAccepted, 0);
  assert.ok(recommended.recommendation.reasons.length);
  assert.deepEqual((await f.request(`${path}/offers`, f.buyer)).body.offers, offers);
  assert.equal((await f.request(`${path}/offers`, f.builders[0].operator)).status, 404);
  for (let retry = 0; retry < 2; retry++) {
    assert.equal((await f.request(`${path}/offer-exposure`, f.buyer, {
      offerIds: [recommended.id], stage: 'reviewed'
    })).status, 200);
  }

  const selection = { expectedVersion: 2, offerId: recommended.id }, key = randomUUID();
  response = await f.request(`${path}/select`, f.buyer, selection, 'POST', key);
  assert.equal(response.status, 200);
  assert.equal(response.body.executionAuthorized, false);
  assert.deepEqual(await f.request(`${path}/select`, f.buyer, selection, 'POST', key), response);
  const detail = (await f.request(path, f.buyer)).body;
  assert.equal(detail.task.status, 'selected');
  assert.equal(detail.execution, null);
  assert.equal((await f.request('/api/work', f.builders[0].operator)).body.tasks[0].id, taskId);
  assert.equal((await f.request('/api/work', f.builders[1].operator)).body.tasks.length, 0);
  const funnel = (await f.request(`/api/agents/${f.builders[0].agentId}/acquisition`, f.builders[0].operator)).body.funnel;
  assert.equal(funnel.quoted, 1);
  assert.equal(funnel.reviewed, 1);
  assert.equal(funnel.selected, 1);
  assert.equal((await f.request(`${path}/select`, f.buyer, {
    expectedVersion: 2, offerId: bids[1].offerId
  })).status, 409, 'stale tab cannot replace selection');

  const changed = await f.request(`${path}/scope`, f.buyer, {
    expectedVersion: detail.task.version, title: 'Updated CSV scope', brief: 'Normalize CSV data and sort all rows alphabetically.'
  });
  assert.equal(changed.status, 200);
  response = await f.request(`${path}/offers`, f.buyer);
  assert.ok(response.body.offers.every(offer => !offer.recommendation.recommended));
  const updated = (await f.request(path, f.buyer)).body.task;
  assert.equal((await f.request(`${path}/select`, f.buyer, {
    expectedVersion: updated.version, offerId: recommended.id
  })).status, 409, 'old scope cannot be selected with a fresh task version');
  await f.bid(taskId, updated.version);
  assert.equal((await f.request(`${path}/offers`, f.buyer)).body.offers.filter(offer => offer.recommendation.recommended).length, 1);

  await f.builders[0].client.heartbeat({ runtimeName: 'Local deterministic CSV QA', runtimeVersion: '2' });
  const refreshed = (await f.request(`${path}/offers`, f.buyer)).body.offers;
  assert.ok(refreshed.filter(offer => offer.agentId === f.builders[0].agentId).every(offer => !offer.recommendation.recommended));
  assert.equal(refreshed.find(offer => offer.recommendation.recommended).agentId, f.builders[1].agentId);

  const raceTask = await f.postTask();
  const raceOffers = await f.bid(raceTask);
  const choices = await Promise.all(raceOffers.map(offer => f.request(`/api/tasks/${raceTask}/select`, f.buyer, {
    expectedVersion: 2, offerId: offer.offerId
  })));
  assert.deepEqual(choices.map(result => result.status).sort(), [200, 409]);
  assert.equal((await f.request(`/api/tasks/${raceTask}/offers`, f.buyer)).body.offers.filter(offer => offer.selected).length, 1);
});

test('buyer conversation preferences refresh recommendations without changing scope or granting work', async t => {
  const f = await recommendationFlow(4197);
  t.after(() => f.close());
  const id = await f.postTask();
  await f.bid(id);
  const path = `/api/tasks/${id}`;
  let task = (await f.request(path, f.buyer)).body.task;
  assert.equal((await f.request(`${path}/messages`, f.buyer, {expectedVersion:task.version,body:'Keep it under $4'})).status,200);
  let offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
  assert.equal(offers.filter(o=>o.recommendation.recommended).length,0);
  assert.equal(offers.length,2);
  task = (await f.request(path, f.buyer)).body.task;
  assert.equal((await f.request(`${path}/messages`, f.buyer, {expectedVersion:task.version,body:'Clear matching preferences'})).status,200);
  offers = (await f.request(`${path}/offers`, f.buyer)).body.offers;
  assert.equal(offers.filter(o=>o.recommendation.recommended).length,1);
  const detail = (await f.request(path,f.buyer)).body;
  assert.equal(detail.task.scopeVersion,task.scopeVersion);
  assert.equal(detail.task.status,'posted');
  assert.equal(detail.execution,null);
});
