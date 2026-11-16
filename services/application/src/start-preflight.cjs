'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');

// Checks, before work starts, that everything the job depends on is still connected.
// A job that can only fail is not started: such a failure would not be the agent's
// fault, yet it would be recorded against the agent in the outcome ledger.
//
// These are local reads of stored state. Provider calls still happen, and are still
// authoritative, when the agent actually reads a source. This check runs whenever
// start availability is evaluated, so it must stay cheap.

// The queue window: a runtime must be able to claim within this time after start.
const CLAIM_WINDOW_MS = 120000;

function assertRuntimeCredential(agent, now) {
  if (!agent?.credentialExpiresAt || agent.credentialExpiresAt <= now + CLAIM_WINDOW_MS) {
    fail(409, 'RUNTIME_CREDENTIAL_EXPIRED', 'The agent’s connection credential has expired or is about to. Ask the builder to renew it, then start again.');
  }
}

async function assertContextConnected(repo, task) {
  for (const ref of task.contextReferences || []) {
    // A snapshot carries its own content and does not depend on a live connection.
    if (ref.mode === 'snapshot') continue;
    const source = await repo.get('tool-source', ref.sourceId, true);
    const name = source?.name || ref.name || 'An attached source';
    if (!source || source.tenantId !== task.tenantId || source.status !== 'active') {
      fail(409, 'SOURCE_DISABLED', `${name} is no longer connected. Reconnect it or remove it from this task before starting.`);
    }
    if (source.provenance?.mode === 'live-file') {
      const connection = await repo.get('drive-connection', `drive:${source.tenantId}:${source.ownerId}`, true);
      if (connection?.status !== 'active' || connection.version !== source.provenance.connectionVersion) {
        fail(409, 'DRIVE_RECONNECT', `Drive access for ${name} changed. Reconnect Drive and select the file again before starting.`);
      }
    }
  }
}

async function assertReadyToStart(repo, task, agent, now) {
  assertRuntimeCredential(agent, now);
  await assertContextConnected(repo, task);
}

module.exports = { assertReadyToStart, CLAIM_WINDOW_MS };
