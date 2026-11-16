'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertReadyToStart } = require('../src/start-preflight.cjs');

const NOW = 1_000_000;
function repoWith(records) {
  return { get: async (kind, id) => records[`${kind}:${id}`] ?? null };
}
const agent = { credentialExpiresAt: NOW + 3600000 };
const liveSource = { id: 'src', tenantId: 't1', ownerId: 'u1', status: 'active', name: 'Pipeline.csv',
  provenance: { mode: 'live-file', connectionVersion: 3 } };
const connection = { status: 'active', version: 3 };
const records = { 'tool-source:src': liveSource, 'drive-connection:drive:t1:u1': connection };
const task = { tenantId: 't1', contextReferences: [{ sourceId: 'src', mode: 'live' }] };

test('work with a connected runtime and connected sources may start', async () => {
  await assertReadyToStart(repoWith(records), task, agent, NOW);
  await assertReadyToStart(repoWith({}), { tenantId: 't1' }, agent, NOW);
});

test('an expired or expiring runtime credential blocks the start', async () => {
  for (const expiry of [undefined, NOW - 1, NOW + 60000]) {
    await assert.rejects(assertReadyToStart(repoWith(records), task, { credentialExpiresAt: expiry }, NOW), /RUNTIME_CREDENTIAL_EXPIRED|credential/);
  }
});

test('a disconnected, missing or foreign source blocks the start and names the source', async () => {
  await assert.rejects(assertReadyToStart(repoWith({ ...records, 'tool-source:src': { ...liveSource, status: 'disabled' } }), task, agent, NOW),
    /Pipeline\.csv is no longer connected/);
  await assert.rejects(assertReadyToStart(repoWith({}), task, agent, NOW), /no longer connected/);
  await assert.rejects(assertReadyToStart(repoWith({ ...records, 'tool-source:src': { ...liveSource, tenantId: 'other' } }), task, agent, NOW),
    /no longer connected/);
});

test('a changed or disconnected Drive connection blocks a live file', async () => {
  for (const changed of [{ ...connection, status: 'disconnected' }, { ...connection, version: 4 }, undefined]) {
    await assert.rejects(assertReadyToStart(repoWith({ ...records, 'drive-connection:drive:t1:u1': changed }), task, agent, NOW),
      /Drive access for Pipeline\.csv changed/);
  }
});

test('a snapshot reference carries its content and needs no live connection', async () => {
  await assertReadyToStart(repoWith({}), { tenantId: 't1', contextReferences: [{ sourceId: 'gone', mode: 'snapshot' }] }, agent, NOW);
});
