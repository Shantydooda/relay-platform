'use strict';

const { randomBytes } = require('node:crypto');
const { fail, exactKeys, text } = require('../../../packages/contracts/src/input.cjs');
const SUPPLIER_SCOPES = Object.freeze(['opportunities:read', 'offers:write', 'assignments:read', 'execution:write']);

function createCredentials({ repository, command, agentFor, expected, now, hash, localExecution, resolveOperator }) {
  async function issue(actor, id, body, key, kind) {
    if (!localExecution) fail(403, 'LOCAL_EXECUTION_DISABLED', 'Supplier connections are only enabled for unpaid localhost development.');
    exactKeys(body, kind === 'supplier-api' ? ['expectedVersion', 'expiresInSeconds'] : ['expectedVersion']);
    const lifetime = body.expiresInSeconds ?? 604800;
    if (!Number.isInteger(lifetime) || lifetime < 3600 || lifetime > 2592000) fail(400, 'INVALID_INPUT', 'Choose a key lifetime between one hour and 30 days.');
    const secret = randomBytes(32).toString('base64url');
    let issued = false;
    const result = await command(actor.user.id, key, ['credential', kind, id, body], repo => agentFor(repo, actor, id), async repo => {
      const agent = await agentFor(repo, actor, id);
      expected(agent, body.expectedVersion);
      const allowedMethods = kind === 'supplier-api' ? ['api', 'sdk'] : ['api'];
      if (!allowedMethods.includes(agent.integration)) fail(409, 'API_REQUIRED', 'Save an available connection method first: HTTP API or JavaScript SDK for your own runtime.');
      agent.credentialHash = hash(secret);
      agent.credentialExpiresAt = now() + lifetime * 1000;
      agent.runtimeTransport = kind;
      agent.runtimeKind = null;
      agent.connectedAt = 0;
      agent.version++;
      await repo.save('agent', agent);
      await repo.save('credential', { id: agent.credentialHash, ownerId: actor.user.id, agentId: id,
        kind, scopes: SUPPLIER_SCOPES, expiresAt: agent.credentialExpiresAt });
      issued = true;
      return { agentId: id, version: agent.version, expiresAt: agent.credentialExpiresAt, scopes: SUPPLIER_SCOPES };
    });
    // Only this first response contains the key. Receipts retain metadata only.
    return { ...result, token: issued ? secret : null };
  }
  async function revokeCredential(actor, id, body, key) {
    exactKeys(body, ['expectedVersion']);
    return command(actor.user.id, key, ['revoke', id, body], repo => agentFor(repo, actor, id), async repo => {
      const agent = await agentFor(repo, actor, id);
      expected(agent, body.expectedVersion);
      agent.credentialHash = null;
      agent.connectedAt = 0;
      agent.credentialExpiresAt = null;
      agent.version++;
      await repo.save('agent', agent);
      return { agentId: id, version: agent.version };
    });
  }
  function validCredential(credential, agent) {
    return credential && agent?.credentialHash === credential.id && (!credential.expiresAt || credential.expiresAt > now());
  }
  async function runtimePrincipal(secret, { kind, scope } = {}) {
    if (!localExecution) fail(403, 'LOCAL_EXECUTION_DISABLED', 'Unpaid supplier connections are not enabled in this environment.');
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) fail(401, 'INVALID_AGENT_KEY', 'A valid runtime credential is required.');
    const digest = hash(secret);
    const record = await repository.read(async repo => {
      const credential = await repo.get('credential', digest);
      const agent = credential ? await repo.get('agent', credential.agentId) : null;
      return validCredential(credential, agent) ? { credential, agent } : null;
    });
    if (!record || typeof resolveOperator !== 'function') fail(401, 'INVALID_AGENT_KEY', 'Runtime credential is expired, revoked or unavailable.');
    const transport = record.credential.kind || 'local-csv';
    if (kind && transport !== kind) fail(403, 'CREDENTIAL_TRANSPORT', 'Use the connection endpoint for this credential.');
    if (scope && !(record.credential.scopes || SUPPLIER_SCOPES).includes(scope)) fail(403, 'SCOPE_REQUIRED', 'This credential does not permit that operation.');
    const actor = await resolveOperator(record.agent.ownerId);
    if (!actor?.user || !actor.memberships.length || actor.recoveryRequired) fail(403, 'OPERATOR_UNAVAILABLE', 'The operator is not active.');
    return { actor, agentId: record.agent.id, credentialHash: digest, transport };
  }
  async function runtimeAgent(repo, principal, scope) {
    const agent = await agentFor(repo, principal.actor, principal.agentId);
    const credential = await repo.get('credential', principal.credentialHash);
    if (!validCredential(credential, agent)) fail(401, 'INVALID_AGENT_KEY', 'Runtime credential is expired or revoked.');
    if (scope && !(credential.scopes || SUPPLIER_SCOPES).includes(scope)) fail(403, 'SCOPE_REQUIRED', 'This credential does not permit that operation.');
    return agent;
  }
  async function heartbeat(principal, body = {}) {
    exactKeys(body, principal.transport === 'supplier-api' ? ['runtimeName', 'runtimeVersion'] : []);
    const runtimeName = principal.transport === 'supplier-api' ? text(body.runtimeName, 'Runtime name', 1, 80) : 'Local CSV automation';
    const runtimeVersion = principal.transport === 'supplier-api' ? text(body.runtimeVersion, 'Runtime version', 1, 80) : '1';
    return repository.transaction(`agent:${principal.agentId}`, async repo => {
      const agent = await runtimeAgent(repo, principal);
      agent.connectedAt = now();
      agent.runtimeKind = principal.transport === 'supplier-api' ? 'supplier-hosted' : 'bounded-csv-automation';
      agent.runtimeName = runtimeName;
      agent.runtimeVersion = runtimeVersion;
      await repo.save('agent', agent);
      return { connected: true, agentId: agent.id, automaticRequested: agent.rules.automaticRequested,
        minimumPayout: agent.rules.minimumPayout, currency: agent.rules.currency || 'USD', capabilities: agent.capabilities, protocolVersion: '1', leaseSeconds: 30 };
    });
  }
  return {
    runtimePrincipal, runtimeAgent, heartbeat, revokeCredential,
    issueCredential: (actor, id, body, key) => issue(actor, id, body, key, 'local-csv'),
    issueSupplierCredential: (actor, id, body, key) => issue(actor, id, body, key, 'supplier-api')
  };
}
module.exports = { createCredentials, SUPPLIER_SCOPES };
