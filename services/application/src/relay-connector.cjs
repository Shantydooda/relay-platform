'use strict';

// The Relay Connector (docs/specs/Buyer-Connections.md → "Relay Connector").
//
// A buyer runs a small connector inside their own network, next to their ERP
// or its exports (packages/relay-connector). It keeps the ERP login there.
// Relay never sees or stores it: the connection holds only a hash of the
// connector's key.
//
// The connector only ever calls out to Relay (no inbound ports):
//   hello        -> says which objects it serves and checks in
//   next read    -> long-polls for a granted read waiting for it
//   answer       -> returns that read's rows (or an error)
// An agent's read still goes through connections.cjs#readAccess, with every
// check before and after. Only the middle step changes: instead of Relay
// calling the system with a stored credential, it queues the read for the
// buyer's connector and waits a short time for the answer. Rows are sealed
// while they wait and deleted once handed over.

const { randomUUID, randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');

// One fixed vocabulary of ERP objects, so a grant reads the same whichever ERP
// sits behind the connector. Payroll and employee records are left out on
// purpose: they hold personal data and need their own review.
const ERP_OBJECTS = Object.freeze(['vendor', 'customer', 'item', 'account', 'purchase-order', 'sales-order', 'invoice', 'bill', 'journal-entry']);
const SYSTEMS = Object.freeze([
  { kind: 'netsuite', label: 'Oracle NetSuite' },
  { kind: 'sap-s4hana', label: 'SAP S/4HANA' },
  { kind: 'dynamics-365', label: 'Microsoft Dynamics 365' },
  { kind: 'erp-exports', label: 'Other ERP or database exports' },
]);
const HELP = 'Runs the Relay Connector inside your network. It reads the exports you point it at; your ERP login never leaves your network.';
const MAX_ROWS = 500, MAX_BYTES = 2 * 1024 * 1024, MAX_KEYS = 100;
const DEFAULT_TIMINGS = Object.freeze({ readWaitMs: 20000, pollMs: 150, onlineMs: 60000, maxConnectorWaitMs: 25000 });
const KEY = /^rcn_([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;

// Provider descriptors for connections.cjs. They have no credential fields and
// no read(): reads for them go through the bridge below.
function connectorSystems() {
  return SYSTEMS.map(s => ({ ...s, connector: true, environments: ['sandbox', 'production'], objects: [...ERP_OBJECTS], credentialFields: [], help: HELP }));
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = value => createHash('sha256').update(value).digest('hex');

function createConnectorBridge(context) {
  const { repository, now, connectionVault } = context;
  const timings = { ...DEFAULT_TIMINGS, ...(context.connectorTimings || {}) };

  function issueKey(connectionId) {
    const secret = randomBytes(32).toString('base64url');
    return { key: `rcn_${connectionId}.${secret}`, hash: digest(secret) };
  }
  function online(c) { return !!c.connectorSeenAt && now() - c.connectorSeenAt < timings.onlineMs; }
  function view(c) {
    return { online: online(c), lastSeenAt: c.connectorSeenAt || null, version: c.connectorVersion || null };
  }

  // The key names its connection; the secret part is compared by hash in
  // constant time. A disconnected connection has no hash, so its key is void.
  async function authenticate(repo, key, lock = false) {
    const match = typeof key === 'string' ? KEY.exec(key) : null;
    const c = match ? await repo.get('connection', match[1], lock) : null;
    const expected = c?.mode === 'connector' && c.status === 'active' && c.connectorKeyHash ? Buffer.from(c.connectorKeyHash) : null;
    const given = Buffer.from(match ? digest(match[2]) : '');
    if (!expected || expected.length !== given.length || !timingSafeEqual(expected, given))
      fail(401, 'CONNECTOR_KEY_INVALID', 'This connector key isn’t valid. The connection may have been removed; create a new one in Settings → Integrations.');
    return c;
  }
  function seen(c, version) {
    c.connectorSeenAt = now();
    if (version) c.connectorVersion = version;
  }

  async function hello(key, body) {
    exactKeys(body, ['version', 'objects']);
    const version = text(body.version, 'Version', 1, 40);
    if (!Array.isArray(body.objects) || !body.objects.length || new Set(body.objects).size !== body.objects.length || body.objects.some(o => !ERP_OBJECTS.includes(o)))
      fail(400, 'INVALID_INPUT', `Objects must come from: ${ERP_OBJECTS.join(', ')}.`);
    return repository.transaction(`connector:${KEY.exec(key)?.[1] || 'none'}`, async repo => {
      const c = await authenticate(repo, key, true);
      seen(c, version);
      c.objects = ERP_OBJECTS.filter(o => body.objects.includes(o));
      await repo.save('connection', c);
      return { connectionId: c.id, label: c.label, environment: c.environment, objects: [...c.objects] };
    });
  }

  // Claim the oldest waiting read for this connection, if any.
  async function claimNext(key) {
    return repository.transaction(`connector:${KEY.exec(key)?.[1] || 'none'}`, async repo => {
      const c = await authenticate(repo, key, true);
      seen(c);
      await repo.save('connection', c);
      const waiting = (await repo.page('connector-read', 'owner_id', c.id, { limit: 100, statuses: ['pending'] })).sort((a, b) => a.createdAt - b.createdAt);
      const read = waiting[0];
      if (!read) return null;
      read.status = 'claimed'; read.claimedAt = now(); read.version++;
      await repo.save('connector-read', read);
      const { id: readId, grantId, object, cursor, limit, params, agent, request } = read;
      return { readId, grantId, object, cursor, limit, params, agent, request };
    });
  }
  async function nextRead(key, { waitMs = timings.maxConnectorWaitMs } = {}) {
    const deadline = Date.now() + Math.min(Math.max(Number(waitMs) || 0, 0), timings.maxConnectorWaitMs);
    for (;;) {
      const job = await claimNext(key);
      if (job || Date.now() >= deadline) return job;
      await sleep(Math.min(timings.pollMs * 2, Math.max(deadline - Date.now(), 0)));
    }
  }

  function cell(value) {
    return value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 20000);
  }
  function validRows(body, limit) {
    if (!Array.isArray(body.rows) || body.rows.length > Math.min(limit, MAX_ROWS)) return false;
    if (body.nextCursor !== null && (typeof body.nextCursor !== 'string' || !body.nextCursor || body.nextCursor.length > 100)) return false;
    if (Buffer.byteLength(JSON.stringify(body.rows)) > MAX_BYTES) return false;
    return body.rows.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length <= MAX_KEYS &&
      Object.entries(row).every(([k, v]) => k.length <= 100 && cell(v)));
  }

  async function answer(key, readId, body) {
    let invalid = false;
    const result = await repository.transaction(`connector:${KEY.exec(key)?.[1] || 'none'}`, async repo => {
      const c = await authenticate(repo, key, true);
      const read = await repo.get('connector-read', text(readId, 'Read', 36, 36), true);
      if (!read || read.ownerId !== c.id) fail(404, 'NOT_FOUND', 'Read not found.');
      if (read.status !== 'claimed') fail(409, 'READ_CLOSED', 'This read was withdrawn or already answered.');
      seen(c); await repo.save('connection', c);
      read.version++; read.answeredAt = now();
      if (body && typeof body === 'object' && 'error' in body) {
        exactKeys(body, ['error']);
        const message = text(body.error?.message, 'Message', 1, 300);
        read.status = 'failed'; read.error = { code: /^[A-Z_]{3,40}$/.test(body.error?.code || '') ? body.error.code : 'SOURCE_ERROR', message };
      } else if (body && typeof body === 'object' && Object.keys(body).every(k => ['rows', 'nextCursor'].includes(k)) && validRows({ nextCursor: null, ...body }, read.limit)) {
        read.status = 'answered';
        read.result = connectionVault.seal({ rows: body.rows, nextCursor: body.nextCursor ?? null }, `connector-read:${read.id}`);
      } else {
        invalid = true;
        read.status = 'failed'; read.error = { code: 'INVALID_ANSWER', message: 'The buyer’s connector sent data Relay couldn’t accept.' };
      }
      await repo.save('connector-read', read);
      return { readId: read.id, status: read.status };
    });
    if (invalid) fail(400, 'INVALID_INPUT', `Send up to ${MAX_ROWS} rows of flat values (text, numbers, true/false or empty), at most 2 MB.`);
    return result;
  }

  // Called by readAccess between its two checks, with no transaction open.
  async function read(connectionId, { grantId, object, cursor, limit, params, agent, request }) {
    const readId = randomUUID();
    await repository.transaction(`connector:${connectionId}`, async repo => {
      const c = await repo.get('connection', connectionId, true);
      if (!c || c.status !== 'active') fail(403, 'GRANT_REQUIRED', 'The buyer disconnected this system.');
      if (!online(c)) fail(503, 'CONNECTOR_OFFLINE', 'The buyer’s Relay Connector is offline. Ask the buyer to start it, then try again.');
      await repo.save('connector-read', { id: readId, tenantId: c.tenantId, ownerId: c.id, grantId, object, cursor: String(cursor ?? '0'), limit, params,
        agent, request, status: 'pending', result: null, version: 1, createdAt: now() });
    });
    const deadline = Date.now() + timings.readWaitMs;
    for (;;) {
      await sleep(timings.pollMs);
      const outcome = await repository.transaction(`connector:${connectionId}`, async repo => {
        const r = await repo.get('connector-read', readId, true);
        const c = await repo.get('connection', connectionId);
        const finish = async (status, extra = {}) => { Object.assign(r, { status, result: null, version: r.version + 1, closedAt: now(), ...extra }); await repo.save('connector-read', r); };
        if (!c || c.status !== 'active') { await finish('withdrawn'); return { error: [403, 'GRANT_REQUIRED', 'The buyer disconnected this system.'] }; }
        if (r.status === 'answered') { const rows = connectionVault.open(r.result, `connector-read:${r.id}`); await finish('delivered'); return { rows }; }
        if (r.status === 'failed') { await finish('failed'); return { error: [502, 'CONNECTOR_ERROR', `The buyer’s connector couldn’t answer: ${r.error.message}`] }; }
        if (Date.now() >= deadline) { await finish('withdrawn'); return { error: [504, 'CONNECTOR_TIMEOUT', 'The buyer’s connector didn’t answer in time. Try again shortly.'] }; }
        return null;
      });
      if (outcome?.rows) return outcome.rows;
      if (outcome?.error) fail(...outcome.error);
    }
  }

  // Disconnecting voids the key and withdraws reads still waiting.
  async function voidConnection(repo, c) {
    c.connectorKeyHash = null;
    for (const r of await repo.page('connector-read', 'owner_id', c.id, { limit: 100, statuses: ['pending', 'claimed', 'answered'] })) { r.status = 'withdrawn'; r.result = null; r.version++; await repo.save('connector-read', r); }
  }

  return { issueKey, view, online, hello, nextRead, answer, read, voidConnection };
}

module.exports = { createConnectorBridge, connectorSystems, ERP_OBJECTS };
