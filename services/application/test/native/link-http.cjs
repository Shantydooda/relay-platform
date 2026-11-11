'use strict';
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { stopChild } = require('./lifecycle.cjs');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

async function linkHttp({ origin, home, buyer, builder, json, request, eventually }) {
  const { agentId } = await json('/api/agents', builder, { name: 'Offline link specialist', kind: 'specialist', domain: 'Text extraction', purpose: 'Extract links without visiting them', integration: 'sdk', capabilities: [{ category: 'Data', task: 'Extract web links from supplied text' }, { category: 'Writing', task: 'General writing, declared only' }] });
  await json(`/api/agents/${agentId}`, builder, { expectedVersion: 1, integration: 'sdk', setupStage: 3, automaticRequested: true, minimumPayout: 100, concurrency: 1 }, 'PATCH');
  const issued = await json(`/api/agents/${agentId}/supplier-credentials`, builder, { expectedVersion: 2, expiresInSeconds: 3600 });
  const configPath = join(home, 'link-agent.json');
  writeFileSync(configPath, JSON.stringify({ origin, agentId, token: issued.token }), { mode: 0o600 });
  const worker = fork(join(__dirname, '../../../link-runtime/src/cli.cjs'), ['--config', configPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} });
  const getAgent = async () => (await json('/api/agents', builder)).agents.find(item => item.id === agentId);
  try {
    let agent = await eventually(getAgent, value => value.runtime.connected);
    await json(`/api/agents/${agentId}/qualifications`, builder, { expectedVersion: agent.version, capabilityId: agent.capabilities[0].id, rubric: 'link-inventory-v1' });
    agent = await eventually(getAgent, value => value.capabilities[0].qualification === 'qualified');
    assert.equal(agent.capabilities[0].assessment.submissions.length, 2);
    assert.equal(agent.capabilities[1].qualification, 'unverified');
    assert.equal(agent.readiness.canReceivePaidWork, false);
    const task = await json('/api/tasks', buyer, { tenantId: buyer.actor.memberships[0].id, title: 'Inventory supplied links', brief: 'Extract web links from this text:\nhttps://zeta.example/docs https://alpha.example/docs https://alpha.example/docs.' });
    await json(`/api/tasks/${task.taskId}/post`, buyer, { expectedVersion: 1 });
    const bids = await eventually(() => json(`/api/tasks/${task.taskId}/offers`, buyer), value => value.offers.some(item => item.agentId === agentId));
    const offer = bids.offers.find(item => item.agentId === agentId);
    assert.equal(offer.qualificationEvidence.rubric, 'link-inventory-v1');
    assert.equal(offer.qualificationCurrent, true);
    await json(`/api/tasks/${task.taskId}/select`, buyer, { expectedVersion: 2, offerId: offer.id });
    await json(`/api/tasks/${task.taskId}/authorize-local`, buyer, { expectedVersion: 3, mode: 'local-unpaid' });
    const detail = () => json(`/api/tasks/${task.taskId}`, buyer);
    let delivered = await eventually(detail, value => value.task.status === 'buyer_review' && value.submissions.at(-1).files.every(file => file.scan?.status === 'clean'));
    const first = delivered.submissions[0];
    const file = first.files.find(item => item.filename === 'links.json');
    const downloaded = await request(`/api/tasks/${task.taskId}/submissions/${first.id}/files/${file.id}`, buyer);
    assert.deepEqual((await downloaded.json()).links, ['https://alpha.example/docs', 'https://zeta.example/docs']);
    await json(`/api/tasks/${task.taskId}/request-revision`, buyer, { expectedVersion: delivered.task.version, submissionId: first.id, notes: 'Sort links descending.' });
    delivered = await eventually(detail, value => value.submissions.length === 2 && value.task.status === 'buyer_review' && value.submissions.at(-1).files.every(file => file.scan?.status === 'clean'));
    const final = delivered.submissions.at(-1), revisedFile = final.files.find(item => item.filename === 'links.json');
    const revised = await request(`/api/tasks/${task.taskId}/submissions/${final.id}/files/${revisedFile.id}`, buyer);
    assert.deepEqual((await revised.json()).links, ['https://zeta.example/docs', 'https://alpha.example/docs']);
    const stale = await request(`/api/tasks/${task.taskId}/accept-delivery`, buyer, { expectedVersion: delivered.task.version, submissionId: first.id });
    assert.equal(stale.status, 409);
    await json(`/api/tasks/${task.taskId}/accept-delivery`, buyer, { expectedVersion: delivered.task.version, submissionId: final.id });
    assert.equal((await detail()).task.status, 'accepted');
  } finally {
    await stopChild(worker, { name: 'Link supplier' });
  }
}
module.exports = { linkHttp };
