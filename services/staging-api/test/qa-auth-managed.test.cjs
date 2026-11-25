'use strict';
// QA (auth/session/access): the managed-pilot HTTP surface over the unified
// managed store (Supabase identity double, authoritative membership ledger).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { createUnifiedManagedStore } = require('../src/unified-managed.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');

const ORIGIN = 'https://relay-pilot-qa.onrender.com';
const HOST = 'relay-pilot-qa.onrender.com';
const COOKIE = '__Host-relay_poc_session';

async function managed(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  let time = Date.now();
  const now = () => time;
  const users = {};
  for (const role of ['alice', 'bob']) users[role] = { id: randomUUID(), email: `${role}@pilot.test`, email_confirmed_at: new Date().toISOString() };
  const sessions = new Map(), revoked = new Set(), calls = [];
  const provider = {
    limit: async () => {}, eligibleEmail: async () => true,
    signIn: async (email, password) => password === 'right password'
      ? { data: { session: { access_token: `app:${email}:${randomUUID()}`, expires_at: Math.floor(time / 1000) + 3600 } } }
      : { error: { status: 400 } },
    verify: async (hash, type) => ({ data: { session: { access_token: `${type}:${hash}:${randomUUID()}`, expires_at: Math.floor(time / 1000) + 3600 } } }),
    identity: async access => {
      if (revoked.has(access)) return { error: { status: 401 } };
      const email = access.split(':')[1];
      const user = Object.values(users).find(u => u.email === email || access.includes(u.id));
      return user ? { data: { user } } : { error: { status: 401 } };
    },
    bootstrap: async () => {}, profile: async () => ({ name: 'Pilot member', workspace: 'buyer' }),
    memberships: async () => assert.fail('must use authoritative ledger'),
    saveSession: async row => sessions.set(row.token_hash, { ...row }), session: async hash => sessions.get(hash),
    deleteSession: async hash => sessions.delete(hash), touchSession: async (hash, seen) => { const row = sessions.get(hash); if (row) row.last_seen_at = seen; },
    deleteUserSessions: async id => { for (const [hash, row] of sessions) if (row.user_id === id) sessions.delete(hash); },
    revoke: async (access, scope) => { calls.push(['revoke', scope]); revoked.add(access); },
    updatePassword: async () => { calls.push(['password']); },
  };
  const composition = createUnifiedManagedStore({ provider, sessionKey: randomBytes(32), repository, now,
    applicationOptions: { localExecution: false, pilotConnections: true } });
  const tenants = { alice: randomUUID(), bob: randomUUID(), company: randomUUID() };
  const revision = { alice: 0, bob: 0 };
  async function grant(who, memberships) {
    revision[who]++;
    return composition.access.apply({ userId: users[who].id, revision: revision[who], expiresAt: time + 300000, memberships });
  }
  await grant('alice', [{ id: tenants.alice, role: 'owner', company: false, accessEpoch: 1 }, { id: tenants.company, role: 'employee', company: true, accessEpoch: 1 }]);
  await grant('bob', [{ id: tenants.bob, role: 'owner', company: false, accessEpoch: 1 }]);
  const server = createApp({ origin: ORIGIN, mode: 'managed-pilot', store: composition.store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const jar = {};
  function request(path, { method = 'GET', as, body, headers = {} } = {}) {
    const h = { Host: HOST, ...headers };
    if (as) { h.Cookie = `${COOKIE}=${jar[as].raw}`; if (method !== 'GET' && !('X-CSRF-Token' in headers)) h['X-CSRF-Token'] = jar[as].csrf; }
    if (method !== 'GET' && !('Origin' in headers)) h.Origin = ORIGIN;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined) h['Content-Type'] = 'application/json';
    for (const [k, v] of Object.entries(h)) if (v === null) delete h[k];
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: h }, res => {
        const chunks = []; res.on('data', c => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(text); } catch {} resolve({ status: res.statusCode, headers: res.headers, json, text }); });
      });
      req.on('error', reject); req.end(payload);
    });
  }
  async function login(who) {
    const res = await request('/api/auth/login', { method: 'POST', body: { email: users[who].email, password: 'right password' } });
    assert.equal(res.status, 200, res.text);
    jar[who] = { raw: res.headers['set-cookie'][0].split(';')[0].slice(COOKIE.length + 1), csrf: res.json.csrf, cookie: res.headers['set-cookie'][0] };
    return res;
  }
  return { request, login, jar, grant, tenants, users, sessions, calls, advance: ms => { time += ms; } };
}

test('managed cookie is __Host-, Secure, Strict and bounded to one hour; CSRF and origin are enforced', async t => {
  const m = await managed(t);
  const res = await m.login('alice');
  assert.match(m.jar.alice.cookie, /^__Host-relay_poc_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure$/);
  assert.equal(res.headers['strict-transport-security'], 'max-age=31536000');
  assert.equal(res.json.memberships.length, 2);
  const create = { tenantId: m.tenants.alice, title: 'Pilot request', brief: 'Pilot brief for QA.' };
  assert.equal((await m.request('/api/tasks', { method: 'POST', as: 'alice', body: create, headers: { 'X-CSRF-Token': null, 'Idempotency-Key': randomUUID() } })).json.error.code, 'CSRF_FAILED');
  assert.equal((await m.request('/api/tasks', { method: 'POST', as: 'alice', body: create, headers: { Origin: 'http://relay-pilot-qa.onrender.com', 'Idempotency-Key': randomUUID() } })).json.error.code, 'ORIGIN_REQUIRED');
  assert.equal((await m.request('/api/tasks', { method: 'POST', as: 'alice', body: create, headers: { 'Idempotency-Key': randomUUID() } })).status, 201);
  // Wrong password: generic error, no cookie.
  const bad = await m.request('/api/auth/login', { method: 'POST', body: { email: m.users.alice.email, password: 'wrong' } });
  assert.equal(bad.json.error.code, 'INVALID_CREDENTIALS');
  assert.equal(bad.headers['set-cookie'], undefined);
});

test('managed pilot has no act-as: the header is refused instead of silently ignored', async t => {
  const m = await managed(t);
  await m.login('alice');
  const res = await m.request('/api/agents', { as: 'alice', headers: { 'X-Relay-Act-As': m.tenants.company } });
  assert.equal(res.json.error.code, 'ACT_AS_UNAVAILABLE');
});

test('cross-tenant access is refused in managed mode', async t => {
  const m = await managed(t);
  await m.login('alice'); await m.login('bob');
  const { json: { taskId } } = await m.request('/api/tasks', { method: 'POST', as: 'alice', body: { tenantId: m.tenants.alice, title: 'Alice only', brief: 'Private pilot brief.' }, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal((await m.request(`/api/tasks/${taskId}`, { as: 'bob' })).status, 404);
  assert.equal((await m.request(`/api/tasks?tenantId=${m.tenants.alice}`, { as: 'bob' })).status, 404);
  assert.equal((await m.request('/api/tasks', { method: 'POST', as: 'bob', body: { tenantId: m.tenants.alice, title: 'x', brief: 'Cross tenant write.' }, headers: { 'Idempotency-Key': randomUUID() } })).status, 404);
  assert.equal((await m.request(`/api/tasks/${taskId}`, { as: 'alice' })).status, 200);
});

test('a membership snapshot that drops a workspace ends access on the next request; epochs cannot go backwards', async t => {
  const m = await managed(t);
  await m.login('alice');
  const created = await m.request('/api/tasks', { method: 'POST', as: 'alice', body: { tenantId: m.tenants.company, title: 'Company work', brief: 'Company pilot brief.' }, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(created.status, 201);
  await m.grant('alice', [{ id: m.tenants.alice, role: 'owner', company: false, accessEpoch: 1 }]);
  assert.equal((await m.request(`/api/tasks/${created.json.taskId}`, { as: 'alice' })).status, 404);
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.memberships.length, 1);
  // Re-adding the company with the old epoch is refused by the authority.
  await assert.rejects(m.grant('alice', [{ id: m.tenants.alice, role: 'owner', company: false, accessEpoch: 1 }, { id: m.tenants.company, role: 'employee', company: true, accessEpoch: 1 }]), { code: 'ACCESS_EPOCH_REQUIRED' });
  // A role change without a new epoch is refused too.
  await assert.rejects(m.grant('alice', [{ id: m.tenants.alice, role: 'employee', company: false, accessEpoch: 1 }]), { code: 'ACCESS_EPOCH_REQUIRED' });
  // An expired snapshot fails closed for every request.
  m.advance(300001);
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.error.code, 'ACCESS_DENIED');
});

test('recovery sessions reach only /api/me, reset and logout; reset ends every session', async t => {
  const m = await managed(t);
  await m.login('alice');
  const verify = await m.request('/api/auth/verify', { method: 'POST', body: { tokenHash: `${m.users.alice.id}-recovery-link`, type: 'recovery' } });
  assert.equal(verify.status, 200, verify.text);
  assert.equal(verify.json.recoveryRequired, true);
  m.jar.recovery = { raw: verify.headers['set-cookie'][0].split(';')[0].slice(COOKIE.length + 1), csrf: verify.json.csrf };
  assert.equal((await m.request('/api/me', { as: 'recovery' })).json.recoveryRequired, true);
  for (const path of [`/api/tasks?tenantId=${m.tenants.alice}`, '/api/agents', '/api/notifications', '/api/activity']) {
    const res = await m.request(path, { as: 'recovery' });
    assert.equal(res.json.error.code, 'RECOVERY_ONLY', path);
  }
  assert.equal((await m.request('/api/tasks', { method: 'POST', as: 'recovery', body: { tenantId: m.tenants.alice, title: 'x', brief: 'Recovery write.' }, headers: { 'Idempotency-Key': randomUUID() } })).json.error.code, 'RECOVERY_ONLY');
  assert.equal((await m.request('/api/me/workspace', { method: 'PATCH', as: 'recovery', body: { workspace: 'builder' } })).json.error.code, 'RECOVERY_ONLY');
  // An ordinary app session cannot use the reset endpoint.
  assert.equal((await m.request('/api/auth/reset', { method: 'POST', as: 'alice', body: { password: 'a brand new long password' } })).json.error.code, 'RECOVERY_REQUIRED');
  const reset = await m.request('/api/auth/reset', { method: 'POST', as: 'recovery', body: { password: 'a brand new long password' } });
  assert.equal(reset.status, 200, reset.text);
  assert.match(reset.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.error.code, 'SIGN_IN_REQUIRED', 'the other app session ended too');
  assert.equal((await m.request('/api/me', { as: 'recovery' })).json.error.code, 'SIGN_IN_REQUIRED');
});

test('managed idle timeout and logout end the server session', async t => {
  const m = await managed(t);
  let epoch = 1;
  // Membership snapshots last five minutes; a lapsed one needs a fresh epoch.
  const refresh = () => m.grant('alice', [{ id: m.tenants.alice, role: 'owner', company: false, accessEpoch: ++epoch }]);
  await m.login('alice');
  m.advance(29 * 60 * 1000); await refresh();
  assert.equal((await m.request('/api/me', { as: 'alice' })).status, 200);
  m.advance(29 * 60 * 1000); await refresh();
  // Still alive: the request above refreshed last_seen_at.
  assert.equal((await m.request('/api/me', { as: 'alice' })).status, 200);
  // Hard one-hour cap regardless of activity.
  m.advance(3 * 60 * 1000); await refresh();
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.error.code, 'SIGN_IN_REQUIRED');
  // Idle for more than 30 minutes ends a fresh session.
  await m.login('alice');
  m.advance(31 * 60 * 1000); await refresh();
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.error.code, 'SIGN_IN_REQUIRED');
  await m.login('alice');
  const out = await m.request('/api/auth/logout', { method: 'POST', as: 'alice', body: {} });
  assert.equal(out.status, 200);
  assert.deepEqual(m.calls.filter(c => c[0] === 'revoke').at(-1), ['revoke', 'local']);
  assert.equal((await m.request('/api/me', { as: 'alice' })).json.error.code, 'SIGN_IN_REQUIRED');
});
