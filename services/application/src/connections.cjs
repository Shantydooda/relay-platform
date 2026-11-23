'use strict';

// Buyer connections and access grants (docs/specs/Buyer-Connections.md).
//
// How access works:
// 1. A workspace owner connects a system once (an ERP sandbox, a drive, a CRM).
//    Relay verifies the credentials with the provider, then seals them
//    (AES-256-GCM, bound to the connection id). They are never shown again and
//    never leave Relay.
// 2. While working, an agent asks for read access by kind of system,
//    environment and objects ("sample-erp · sandbox · vendor"), with a purpose.
//    Execution time pauses and the buyer is notified (a task event feeds
//    notifications).
// 3. A workspace owner grants it by choosing one of their matching connections
//    and a duration (1–30 days). A grant is a record, not a token: nothing
//    secret is handed to the agent.
// 4. The agent reads through Relay with its own runtime credential and its
//    current work lease. On every read Relay re-checks the lease, the grant
//    (active, unexpired, same assignment, object in scope), the connection
//    (active, same epoch) and the granter's current authority, then opens the
//    sealed credential server-side, calls the provider and logs the read.
// 5. Revoking a grant, disconnecting the system, removing the granter, or the
//    grant expiring stops the next read. Every operation is a read: changes go
//    back as files the buyer reviews and loads with their own import tool.

const { randomUUID, createHash } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { pauseForPermission, resumeAfterPermission } = require('./permission-wait.cjs');
const { createConnectorBridge } = require('./relay-connector.cjs');

const MAX_DAYS = 30;
const MAX_OBJECTS = 10;
const MAX_REQUESTS = 20;
const READ_LIMIT = 500;
// An unanswered request blocks the work; after this long the agent may end it
// as blocked by the buyer instead of waiting indefinitely.
const ACCESS_WAIT_LIMIT_MS = 72 * 3600000;
// Systems Relay will connect once each connector has a test account and an
// independent security review. Listed so buyers see what's coming, never as built.
const PLANNED = Object.freeze([
  { kind: 'netsuite', label: 'Oracle NetSuite', note: 'Token-based login on a dedicated, read-only integration role.' },
  { kind: 'sap-s4hana', label: 'SAP S/4HANA', note: 'A communication arrangement with a read-only business role.' },
  { kind: 'dynamics-365', label: 'Microsoft Dynamics 365', note: 'An app registration with export-only duties.' },
  { kind: 'sftp', label: 'SFTP drop folder', note: 'Read-only access to one folder of exports.' },
  { kind: 'salesforce', label: 'Salesforce', note: 'A connected app with read-only object permissions.' },
  { kind: 'jira', label: 'Jira', note: 'An API token for a read-only account on chosen projects.' },
]);

function createConnections(context) {
  const { repository, command, now, resolveActor, taskFor, expected, event, connectionVault, connectionProviders = [] } = context;
  const providers = new Map(connectionProviders.map(p => [p.kind, p]));
  const bridge = createConnectorBridge(context);

  function enabled() {
    if (!connectionVault) fail(503, 'CONNECTIONS_UNAVAILABLE', 'Connections aren’t set up on this server.');
  }
  async function current(actor) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'Sign in to continue.');
    return resolveActor ? (await resolveActor(actor.user.id)) || { ...actor, memberships: [] } : actor;
  }
  // Workspace owners manage connections: the owner of a personal workspace, or
  // a company administrator.
  async function manager(actor, tenantId) {
    const m = ((await current(actor)).memberships || []).find(item => item.id === tenantId);
    if (!m || m.role !== 'owner') fail(403, 'FORBIDDEN', 'Only a workspace owner can manage connected systems.');
    return m;
  }
  async function member(actor, tenantId) {
    const m = ((await current(actor)).memberships || []).find(item => item.id === tenantId);
    if (!m) fail(403, 'FORBIDDEN', 'You’re not a member of this workspace.');
    return m;
  }
  function provider(kind) {
    const p = providers.get(kind);
    if (!p) fail(400, 'PROVIDER_UNAVAILABLE', 'Relay can’t connect to that system yet.');
    return p;
  }
  function connectionView(c) {
    const { id, tenantId, provider: kind, environment, label, account, objects, status, version, createdAt, verifiedAt } = c;
    return { id, tenantId, provider: kind, providerLabel: providers.get(kind)?.label || kind, environment, label, account, objects: [...objects], status, version, createdAt, verifiedAt,
      ...(c.mode === 'connector' ? { mode: 'connector', connector: bridge.view(c) } : {}) };
  }
  function objectsInput(value, allowed) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_OBJECTS || new Set(value).size !== value.length || value.some(o => !allowed.includes(o)))
      fail(400, 'INVALID_INPUT', `Choose 1–${MAX_OBJECTS} objects this system provides.`);
    return [...value];
  }
  function days(value) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_DAYS) fail(400, 'INVALID_INPUT', `Choose 1–${MAX_DAYS} days.`);
    return value;
  }

  function connectionCatalog() {
    return [
      ...[...providers.values()].map(p => ({ kind: p.kind, label: p.label, available: true, environments: [...p.environments], objects: [...p.objects],
        objectParams: Object.fromEntries(Object.entries(p.objectParams || {}).map(([k, v]) => [k, [...v]])), help: p.help || null, ...(p.connector ? { connector: true } : {}),
        credentialFields: p.credentialFields.map(({ name, label, secret }) => ({ name, label, secret: !!secret })) })),
      ...PLANNED.filter(p => !providers.has(p.kind)).map(p => ({ ...p, available: false })),
    ];
  }

  async function connections(actor, tenantId) {
    enabled();
    const m = await member(actor, tenantId);
    return repository.read(async repo => {
      const list = (await repo.list('connection', 'tenant_id', tenantId, 100)).filter(c => c.status === 'active');
      const grants = (await repo.list('access-grant', 'tenant_id', tenantId, 500)).filter(g => g.status === 'active' && g.expiresAt > now());
      return { canManage: m.role === 'owner', catalog: connectionCatalog(),
        connections: list.map(c => ({ ...connectionView(c), activeGrants: grants.filter(g => g.connectionId === c.id).length })) };
    });
  }

  async function connect(actor, body, key) {
    enabled();
    exactKeys(body, ['tenantId', 'provider', 'environment', 'label', 'credentials']);
    const p = provider(body.provider);
    if (!p.environments.includes(body.environment)) fail(400, 'INVALID_INPUT', 'Choose sandbox or production.');
    const label = text(body.label, 'Name', 2, 80);
    if (p.connector) return connectThroughConnector(actor, body, key, p, label);
    if (!body.credentials || typeof body.credentials !== 'object' || Array.isArray(body.credentials)) fail(400, 'INVALID_INPUT', 'Enter the connection details.');
    const fields = p.credentialFields.map(f => f.name);
    exactKeys(body.credentials, fields);
    const credentials = Object.fromEntries(fields.map(name => [name, text(body.credentials[name], name, 1, 4000)]));
    // The idempotency fingerprint carries a hash of the credentials, never the values.
    const fingerprint = { ...body, credentials: createHash('sha256').update(JSON.stringify(credentials)).digest('hex') };
    return command(actor.user.id, key, ['connect', fingerprint], () => manager(actor, body.tenantId), async repo => {
      if ((await repo.list('connection', 'tenant_id', body.tenantId, 101)).filter(c => c.status === 'active').length >= 100)
        fail(409, 'CONNECTION_LIMIT', 'A workspace can connect up to 100 systems.');
      let verified;
      try { verified = await p.verify(credentials); }
      catch (error) { if (error?.rejected) fail(400, 'CONNECTION_REJECTED', 'The system rejected these details. Check them and try again.'); throw error; }
      const id = randomUUID(), time = now();
      const connection = { id, tenantId: body.tenantId, ownerId: actor.user.id, provider: p.kind, environment: body.environment, label,
        account: String(verified.account || '').slice(0, 120), objects: verified.objects.filter(o => p.objects.includes(o)),
        secret: connectionVault.seal(credentials, `connection:${id}`), status: 'active', accessEpoch: 1, version: 1, createdAt: time, verifiedAt: time };
      await repo.save('connection', connection);
      await repo.save('connection-audit', { id: randomUUID(), tenantId: body.tenantId, ownerId: actor.user.id, connectionId: id, action: 'connected', createdAt: time });
      return { connectionId: id, version: 1 };
    }, `connections:${body.tenantId}`);
  }

  // The buyer's connector keeps the ERP login inside their network, so there
  // is nothing to verify or seal here: Relay issues a connector key, shown once
  // and stored as a hash. The connection serves nothing until the connector
  // checks in and says which objects it serves.
  async function connectThroughConnector(actor, body, key, p, label) {
    if (body.credentials !== undefined && (typeof body.credentials !== 'object' || body.credentials === null || Object.keys(body.credentials).length))
      fail(400, 'INVALID_INPUT', 'The Relay Connector keeps your login inside your network. Don’t enter it here.');
    const id = randomUUID(), issued = bridge.issueKey(id);
    const result = await command(actor.user.id, key, ['connect', { ...body, credentials: {} }], () => manager(actor, body.tenantId), async repo => {
      if ((await repo.list('connection', 'tenant_id', body.tenantId, 101)).filter(c => c.status === 'active').length >= 100)
        fail(409, 'CONNECTION_LIMIT', 'A workspace can connect up to 100 systems.');
      const time = now();
      await repo.save('connection', { id, tenantId: body.tenantId, ownerId: actor.user.id, provider: p.kind, environment: body.environment, label, account: '',
        objects: [], mode: 'connector', secret: null, connectorKeyHash: issued.hash, connectorSeenAt: null, connectorVersion: null,
        status: 'active', accessEpoch: 1, version: 1, createdAt: time, verifiedAt: null });
      await repo.save('connection-audit', { id: randomUUID(), tenantId: body.tenantId, ownerId: actor.user.id, connectionId: id, action: 'connected', createdAt: time });
      return { connectionId: id, version: 1 };
    }, `connections:${body.tenantId}`);
    // A replayed request returns the first connection without its key: the key
    // is shown once, to the request that created it.
    return result.connectionId === id ? { ...result, connectorKey: issued.key } : result;
  }

  async function disconnect(actor, id, body, key) {
    enabled();
    exactKeys(body, ['expectedVersion']);
    const access = async repo => {
      const c = await repo.get('connection', text(id, 'Connection', 36, 36), true);
      if (!c || c.status !== 'active') fail(404, 'NOT_FOUND', 'Connection not found.');
      await manager(actor, c.tenantId);
      return c;
    };
    return command(actor.user.id, key, ['disconnect', id, body], access, async repo => {
      const c = await access(repo); expected(c, body.expectedVersion);
      // Deleting the sealed credential and bumping the epoch voids every grant on it.
      c.status = 'disconnected'; c.secret = null; c.accessEpoch++; c.version++; c.updatedAt = now();
      if (c.mode === 'connector') await bridge.voidConnection(repo, c);
      await repo.save('connection', c);
      for (const g of await repo.list('access-grant', 'tenant_id', c.tenantId, 500))
        if (g.connectionId === c.id && g.status === 'active') { g.status = 'revoked'; g.revokedReason = 'disconnected'; g.version++; await repo.save('access-grant', g); }
      await repo.save('connection-audit', { id: randomUUID(), tenantId: c.tenantId, ownerId: actor.user.id, connectionId: c.id, action: 'disconnected', createdAt: now() });
      return { connectionId: c.id, status: c.status };
    });
  }

  // ---- Agent side ----------------------------------------------------------
  async function runtimeTask(repo, principal, taskId) {
    await context.credentials.runtimeAgent(repo, principal, 'execution:write');
    const task = await repo.get('task', text(taskId, 'Task', 36, 36), true);
    if (!task?.assignment || task.assignment.agentId !== principal.agentId || task.assignment.operatorId !== principal.actor.user.id)
      fail(404, 'NOT_FOUND', 'Assignment not found.');
    return task;
  }

  async function requestAccess(principal, taskId, body, key) {
    enabled();
    exactKeys(body, ['provider', 'environment', 'objects', 'purpose', 'days']);
    const p = provider(body.provider);
    if (!p.environments.includes(body.environment)) fail(400, 'INVALID_INPUT', 'Choose sandbox or production.');
    const objects = objectsInput(body.objects, p.objects), purpose = text(body.purpose, 'Purpose', 10, 1000), wanted = days(body.days);
    const authorize = async repo => {
      const task = await runtimeTask(repo, principal, taskId);
      if (!['queued', 'running'].includes(task.assignment.status)) fail(409, 'TASK_CLOSED', 'This assignment is no longer active.');
      return task;
    };
    return command(principal.actor.user.id, key, ['access-request', taskId, body], authorize, async repo => {
      const task = await authorize(repo);
      task.accessRequests ||= [];
      const same = task.accessRequests.find(r => r.assignmentId === task.assignment.id && r.status === 'pending' && r.provider === p.kind && r.environment === body.environment);
      if (same) return { requestId: same.id, status: same.status };
      if (task.accessRequests.length >= MAX_REQUESTS) fail(409, 'REQUEST_LIMIT', 'Access request limit reached.');
      const request = { id: randomUUID(), provider: p.kind, environment: body.environment, objects, purpose, days: wanted, operation: 'read',
        agentId: principal.agentId, assignmentId: task.assignment.id, scopeVersion: task.scopeVersion, status: 'pending', createdAt: now() };
      task.accessRequests.push(request);
      pauseForPermission(task, now());
      task.version++; task.updatedAt = now();
      event(task, principal.actor.user.id, 'access.requested', now());
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { requestId: request.id, status: 'pending' };
    }, `task:${taskId}`);
  }

  // ---- Buyer decisions -----------------------------------------------------
  function pendingRequest(task, requestId) {
    const r = (task.accessRequests || []).find(item => item.id === requestId);
    if (!r || r.status !== 'pending' || r.assignmentId !== task.assignment?.id || !['queued', 'running'].includes(task.assignment.status))
      fail(409, 'REQUEST_STALE', 'This request is no longer pending.');
    return r;
  }

  async function approveAccess(actor, taskId, body, key) {
    enabled();
    exactKeys(body, ['expectedVersion', 'requestId', 'connectionId', 'days']);
    const granted = days(body.days);
    const access = async repo => {
      const task = await taskFor(repo, actor, taskId, true);
      await manager(actor, task.tenantId);
      return task;
    };
    return command(actor.user.id, key, ['access-approve', taskId, body], access, async repo => {
      const task = await access(repo); expected(task, body.expectedVersion);
      const m = await manager(actor, task.tenantId);
      const request = pendingRequest(task, body.requestId);
      const c = await repo.get('connection', text(body.connectionId, 'Connection', 36, 36));
      if (!c || c.status !== 'active' || c.tenantId !== task.tenantId) fail(404, 'NOT_FOUND', 'Connection not found.');
      if (c.provider !== request.provider || c.environment !== request.environment)
        fail(409, 'CONNECTION_MISMATCH', `The agent asked for ${request.provider} · ${request.environment}. Choose a matching system.`);
      if (request.objects.some(o => !c.objects.includes(o))) fail(409, 'CONNECTION_MISMATCH', 'This system doesn’t provide everything the agent asked for.');
      const time = now();
      const grant = { id: randomUUID(), tenantId: task.tenantId, ownerId: actor.user.id, taskId: task.id, assignmentId: task.assignment.id, agentId: request.agentId,
        requestId: request.id, connectionId: c.id, connectionEpoch: c.accessEpoch, provider: c.provider, environment: c.environment, objects: [...request.objects],
        operation: 'read', granterEpoch: m.accessEpoch ?? null, expiresAt: time + Math.min(granted, request.days) * 86400000,
        status: 'active', reads: 0, rowsRead: 0, version: 1, createdAt: time };
      await repo.save('access-grant', grant);
      request.status = 'approved'; request.grantId = grant.id; request.decidedAt = time; request.decidedBy = actor.user.id;
      resumeAfterPermission(task, time);
      task.version++; task.updatedAt = time;
      event(task, actor.user.id, 'access.granted', time);
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { grantId: grant.id, expiresAt: grant.expiresAt };
    }, `task:${taskId}`);
  }

  async function declineAccess(actor, taskId, body, key) {
    enabled();
    exactKeys(body, ['expectedVersion', 'requestId']);
    const access = async repo => {
      const task = await taskFor(repo, actor, taskId, true);
      await member(actor, task.tenantId);
      return task;
    };
    return command(actor.user.id, key, ['access-decline', taskId, body], access, async repo => {
      const task = await access(repo); expected(task, body.expectedVersion);
      const request = pendingRequest(task, body.requestId);
      // Declining keeps the work paused: the agent can't continue without it, and
      // may end the work as blocked by the buyer (not a failure on its record).
      request.status = 'declined'; request.decidedAt = now(); request.decidedBy = actor.user.id;
      task.version++; task.updatedAt = now();
      event(task, actor.user.id, 'access.declined', now());
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { requestId: request.id, status: request.status };
    }, `task:${taskId}`);
  }

  async function revokeAccess(actor, grantId, body, key) {
    enabled();
    exactKeys(body, ['expectedVersion']);
    const access = async repo => {
      const g = await repo.get('access-grant', text(grantId, 'Grant', 36, 36), true);
      if (!g) fail(404, 'NOT_FOUND', 'Grant not found.');
      const m = await member(actor, g.tenantId);
      if (m.role !== 'owner' && g.ownerId !== actor.user.id) fail(403, 'FORBIDDEN', 'Only a workspace owner can revoke access.');
      return g;
    };
    return command(actor.user.id, key, ['access-revoke', grantId, body], access, async repo => {
      const g = await access(repo); expected(g, body.expectedVersion);
      if (g.status !== 'active') return { grantId: g.id, status: g.status };
      g.status = 'revoked'; g.revokedReason = 'buyer'; g.version++; g.revokedAt = now();
      await repo.save('access-grant', g);
      const task = await repo.get('task', g.taskId, true);
      if (task) { task.version++; task.updatedAt = now(); event(task, actor.user.id, 'access.revoked', now()); await require('./supplier-feed.cjs').saveTask(repo, task); }
      return { grantId: g.id, status: g.status };
    });
  }

  // ---- Brokered read -------------------------------------------------------
  async function liveGrant(repo, task, grantId) {
    const g = await repo.get('access-grant', text(grantId, 'Grant', 36, 36));
    if (!g || g.status !== 'active' || g.expiresAt <= now() || g.taskId !== task.id || g.assignmentId !== task.assignment.id || g.agentId !== task.assignment.agentId)
      fail(403, 'GRANT_REQUIRED', 'Access is missing, revoked or expired. Ask the buyer again.');
    const c = await repo.get('connection', g.connectionId);
    if (!c || c.status !== 'active' || c.accessEpoch !== g.connectionEpoch || (!c.secret && c.mode !== 'connector'))
      fail(403, 'GRANT_REQUIRED', 'The buyer disconnected this system.');
    const granter = resolveActor ? await resolveActor(g.ownerId) : null;
    const m = granter?.memberships?.find(item => item.id === g.tenantId);
    if (!m || m.role !== 'owner' || (m.accessEpoch ?? null) !== g.granterEpoch)
      fail(403, 'GRANT_STALE', 'The person who granted access no longer has the same authority.');
    return { g, c };
  }

  async function readAccess(principal, taskId, body) {
    enabled();
    exactKeys(body, ['leaseToken', 'grantId', 'object', 'cursor', 'params']);
    // Object parameters (a repository, a file path) are plain short strings; each
    // connector validates them against its own fixed patterns.
    const params = body.params ?? {};
    if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length > 5 ||
      Object.entries(params).some(([k, v]) => !/^[a-z]{1,20}$/.test(k) || typeof v !== 'string' || v.length > 300))
      fail(400, 'INVALID_INPUT', 'Read parameters must be a few short text values.');
    // Three steps, so a slow system never holds the work's lock while it answers:
    // 1. check the lease, grant and connection, and open the credential;
    // 2. call the provider with no transaction open;
    // 3. check everything again and record the read. If access ended meanwhile
    //    (revoked, expired, disconnected, lease lost), the rows are dropped.
    const check = async repo => {
      const task = await runtimeTask(repo, principal, taskId);
      context.checkLease(task, principal, body.leaseToken);
      const { g, c } = await liveGrant(repo, task, body.grantId);
      if (!g.objects.includes(body.object)) fail(403, 'GRANT_SCOPE', `This grant covers ${g.objects.join(', ')} only.`);
      return { task, g, c };
    };
    const before = await repository.read(async repo => {
      const { task, g, c } = await check(repo);
      return { assignmentId: task.assignment.id, connectionId: c.id, epoch: c.accessEpoch, kind: c.provider, grantId: g.id,
        agent: c.mode === 'connector' ? (await repo.get('agent', task.assignment.agentId))?.name || 'Agent' : null, request: task.title,
        credentials: c.mode === 'connector' ? null : connectionVault.open(c.secret, `connection:${c.id}`) };
    });
    const ask = { object: body.object, cursor: body.cursor ?? 0, limit: READ_LIMIT, params };
    const result = before.credentials === null
      ? await bridge.read(before.connectionId, { ...ask, grantId: before.grantId, agent: before.agent, request: before.request })
      : await provider(before.kind).read(before.credentials, ask);
    return repository.transaction(`task:${taskId}`, async repo => {
      const { task, g, c } = await check(repo);
      if (task.assignment.id !== before.assignmentId || c.id !== before.connectionId || c.accessEpoch !== before.epoch)
        fail(403, 'GRANT_REQUIRED', 'Access changed while reading. Ask the buyer again.');
      g.reads++; g.rowsRead += result.rows.length; g.lastReadAt = now();
      await repo.save('access-grant', g);
      await repo.save('access-log', { id: randomUUID(), tenantId: g.tenantId, ownerId: g.ownerId, taskId: task.id, grantId: g.id, object: body.object, params, rows: result.rows.length, createdAt: now() });
      return { object: body.object, rows: result.rows, nextCursor: result.nextCursor ?? null };
    });
  }

  // ---- Ending as blocked by the buyer --------------------------------------
  async function endBlocked(principal, taskId, body, key) {
    exactKeys(body, ['note']);
    const note = text(body.note, 'Reason', 10, 1000);
    const authorize = async repo => {
      const task = await runtimeTask(repo, principal, taskId);
      const job = task.assignment;
      if (!['queued', 'running'].includes(job.status)) fail(409, 'TASK_CLOSED', 'This assignment is no longer active.');
      const blocking = (task.accessRequests || []).find(r => r.assignmentId === job.id &&
        (r.status === 'declined' || (r.status === 'pending' && r.createdAt + ACCESS_WAIT_LIMIT_MS <= now())));
      if (!blocking) fail(409, 'BLOCK_NOT_ALLOWED', 'Work can end as blocked only after the buyer declines an access request, or leaves it unanswered for 72 hours.');
      if (task.settlement && !['expired', 'refunded'].includes(task.settlement.status))
        fail(409, 'PAYMENT_HELD', 'A payment is held on this work. The buyer resolves it through a refund first.');
      return { task, blocking };
    };
    return command(principal.actor.user.id, key, ['access-blocked', taskId, body], authorize, async repo => {
      const { task, blocking } = await authorize(repo);
      const job = task.assignment, time = now();
      // Recorded as cancelled with a reason: the outcome ledger doesn't count it
      // as a decided run, so a buyer-side blocker never lands on the agent's record.
      job.status = 'cancelled'; job.endReason = 'buyer_prerequisite'; job.endNote = note; job.blockingRequestId = blocking.id;
      job.endedAt = time; job.cancelledAt = time; job.permissionWait = null; job.leaseHash = null; job.leaseUntil = 0;
      if (blocking.status === 'pending') { blocking.status = 'expired'; blocking.decidedAt = time; }
      for (const g of await repo.list('access-grant', 'tenant_id', task.tenantId, 500))
        if (g.taskId === task.id && g.status === 'active') { g.status = 'revoked'; g.revokedReason = 'work_ended'; g.version++; await repo.save('access-grant', g); }
      task.version++; task.updatedAt = time;
      event(task, principal.actor.user.id, 'execution.blocked_by_buyer', time);
      await require('./supplier-feed.cjs').saveTask(repo, task);
      return { taskId: task.id, status: job.status, endReason: job.endReason };
    }, `task:${taskId}`);
  }

  // ---- Views used by task detail and the agent's claim ----------------------
  async function forTask(repo, task) {
    const grants = (await repo.list('access-grant', 'tenant_id', task.tenantId, 500)).filter(g => g.taskId === task.id);
    const labels = {};
    for (const g of grants) if (!(g.connectionId in labels)) labels[g.connectionId] = (await repo.get('connection', g.connectionId))?.label || 'Disconnected system';
    return {
      requests: (task.accessRequests || []).map(({ id, provider: kind, environment, objects, purpose, days: d, status, createdAt, decidedAt, grantId }) =>
        ({ id, provider: kind, providerLabel: providers.get(kind)?.label || kind, environment, objects: [...objects], purpose, days: d, status, createdAt, decidedAt: decidedAt || null, grantId: grantId || null })),
      grants: grants.map(g => ({ id: g.id, connectionId: g.connectionId, connectionLabel: labels[g.connectionId], provider: g.provider, environment: g.environment, objects: [...g.objects],
        status: g.status === 'active' && g.expiresAt <= now() ? 'expired' : g.status, expiresAt: g.expiresAt, reads: g.reads, rowsRead: g.rowsRead, lastReadAt: g.lastReadAt || null, version: g.version })),
    };
  }
  async function grantsForAgent(repo, task) {
    return (await repo.list('access-grant', 'tenant_id', task.tenantId, 500))
      .filter(g => g.taskId === task.id && g.assignmentId === task.assignment?.id && g.status === 'active' && g.expiresAt > now())
      .map(g => ({ id: g.id, provider: g.provider, environment: g.environment, objects: [...g.objects], expiresAt: g.expiresAt }));
  }

  return { connectionCatalog, connections, connect, disconnect, requestAccess, approveAccess, declineAccess, revokeAccess, readAccess, endBlocked, forTask, grantsForAgent,
    connectorHello: (key, body) => { enabled(); return bridge.hello(key, body); },
    connectorNextRead: (key, options) => { enabled(); return bridge.nextRead(key, options); },
    connectorAnswer: (key, readId, body) => { enabled(); return bridge.answer(key, readId, body); } };
}

module.exports = { createConnections, ACCESS_WAIT_LIMIT_MS, MAX_DAYS };
