'use strict';
// QA (auth/session/access): HTTP-layer guards of services/poc-api/src/app.cjs
// against the local unified store. Passing tests document verified behaviour;
// `todo` tests reproduce confirmed bugs (BUG-AUTH-<n>).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { openDatabase } = require('../src/database.cjs');
const { createUnifiedLocalStore } = require('../src/unified-store.cjs');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { createApp } = require('../src/app.cjs');

// The app checks the Host header against its origin, so the server can listen on
// an ephemeral port while every request names this fixed origin.
const ORIGIN = 'http://127.0.0.1:4791';
const HOST = '127.0.0.1:4791';
const COOKIE = 'relay_local_session_4791';
const PASSWORD = 'qa auth local fixture password only';

function paymentDouble() {
  return {
    kind: 'fixture',
    async createOperator() { return { accountId: 'acct_fixture' }; },
    async onboarding() { return { url: 'https://connect.stripe.com/fixture' }; },
    async operator() { return { accountId: 'acct_fixture', ready: true, manualPayouts: true, requirements: [] }; },
    async checkout() { return { sessionId: 'cs_test_fixture', url: 'https://checkout.stripe.com/fixture' }; },
    async funding() { return { status: 'funded', intentId: 'pi_fixture', chargeId: 'ch_fixture' }; },
    async refund() { return { refundId: 're_fixture', status: 'pending' }; },
    async refundStatus() { return { status: 'succeeded' }; },
    async transfer() { return { transferId: 'tr_fixture' }; },
    async payout() { return { payoutId: 'po_fixture', status: 'pending' }; },
    async payoutStatus() { return { status: 'paid' }; },
  };
}

async function fixture(t, { paymentProvider } = {}) {
  const authDb = openDatabase(':memory:'), dataDb = openDatabase(':memory:');
  const repository = createSqliteRepository(dataDb);
  const store = await createUnifiedLocalStore({ authDb, repository, localExecution: true, paymentProvider });
  const server = createApp({ store, origin: ORIGIN });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); authDb.close(); dataDb.close(); });
  const sessions = {};
  for (const name of ['owner', 'member', 'approver', 'buyer', 'stranger']) {
    sessions[name] = await store.register({ name: `QA ${name}`, email: `${name}@qa.test`, password: PASSWORD, workspace: 'buyer' }, `ip-${name}`);
  }
  const actor = name => store.principal(sessions[name]);
  const { tenantId: companyId } = store.createTeam(actor('owner'), { name: 'QA Co' }, randomUUID());
  for (const [name, role] of [['member', 'employee'], ['approver', 'approver']]) {
    const invite = store.inviteTeamMember(actor('owner'), companyId, { email: `${name}@qa.test`, role });
    await store.acceptTeamInvite(actor(name), { token: invite.token });
  }
  const personal = name => actor(name).memberships.find(m => !m.company).id;

  function request(path, { method = 'GET', as, body, headers = {}, raw } = {}) {
    const session = as ? sessions[as] : null;
    const finalHeaders = { Host: HOST, ...headers };
    if (session) {
      finalHeaders.Cookie = `${COOKIE}=${session}`;
      if (!['GET', 'HEAD'].includes(method) && !('X-CSRF-Token' in headers)) finalHeaders['X-CSRF-Token'] = store.principal(session).csrf;
    }
    if (!['GET', 'HEAD'].includes(method) && !('Origin' in headers)) finalHeaders.Origin = ORIGIN;
    const payload = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
    if (payload !== undefined && !('Content-Type' in headers)) finalHeaders['Content-Type'] = 'application/json';
    for (const [k, v] of Object.entries(finalHeaders)) if (v === null) delete finalHeaders[k];
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers: finalHeaders }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(text); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, json, text });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }
  return { store, repository, sessions, actor, companyId, personal, request };
}

test('host, origin, CSRF and Sec-Fetch-Site guards reject forged browser requests', async t => {
  const f = await fixture(t);
  const create = { tenantId: f.personal('buyer'), title: 'QA request', brief: 'Research twenty companies with evidence.' };
  const key = () => ({ 'Idempotency-Key': randomUUID() });

  assert.equal((await f.request('/api/me', { as: 'buyer', headers: { Host: 'evil.test' } })).json.error.code, 'INVALID_HOST');
  assert.equal((await f.request('/api/me', { as: 'buyer', headers: { Host: '127.0.0.1:4792' } })).json.error.code, 'INVALID_HOST');
  assert.equal((await f.request('/api/me', { as: 'buyer', headers: { 'Sec-Fetch-Site': 'cross-site' } })).json.error.code, 'CROSS_SITE');
  // A cross-site top-level navigation may load only the public page.
  const nav = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' };
  assert.equal((await f.request('/', { headers: nav })).status, 200);
  assert.equal((await f.request('/api/me', { as: 'buyer', headers: nav })).json.error.code, 'CROSS_SITE');

  for (const origin of [null, 'null', 'http://127.0.0.1:4792', 'http://evil.test', `${ORIGIN}/`]) {
    const res = await f.request('/api/tasks', { method: 'POST', as: 'buyer', body: create, headers: { Origin: origin, ...key() } });
    assert.equal(res.status, 403, `origin ${origin}`);
    assert.equal(res.json.error.code, 'ORIGIN_REQUIRED');
  }
  for (const csrf of [null, '', 'x'.repeat(43), f.actor('stranger').csrf]) {
    const res = await f.request('/api/tasks', { method: 'POST', as: 'buyer', body: create, headers: { 'X-CSRF-Token': csrf, ...key() } });
    assert.equal(res.json.error.code, 'CSRF_FAILED', `csrf ${csrf}`);
  }
  const ok = await f.request('/api/tasks', { method: 'POST', as: 'buyer', body: create, headers: key() });
  assert.equal(ok.status, 201);
});

test('session cookie is HttpOnly/SameSite=Strict, logout and re-login revoke the old token', async t => {
  const f = await fixture(t);
  const login = await f.request('/api/auth/login', { method: 'POST', body: { email: 'buyer@qa.test', password: PASSWORD } });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'][0];
  assert.match(cookie, /^relay_local_session_4791=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=43200$/);
  const fresh = cookie.split(';')[0].split('=')[1];
  // Login is CSRF-free but still requires the exact Origin.
  assert.equal((await f.request('/api/auth/login', { method: 'POST', body: { email: 'buyer@qa.test', password: PASSWORD }, headers: { Origin: 'http://evil.test' } })).json.error.code, 'ORIGIN_REQUIRED');

  f.sessions.fresh = fresh;
  assert.equal((await f.request('/api/me', { as: 'fresh' })).json.user.email, 'buyer@qa.test');
  // Logging in while carrying an old cookie rotates it: the old one is gone.
  const old = f.sessions.buyer;
  const rotated = await f.request('/api/auth/login', { method: 'POST', body: { email: 'buyer@qa.test', password: PASSWORD }, headers: { Cookie: `${COOKIE}=${old}` } });
  assert.equal(rotated.status, 200);
  assert.equal((await f.request('/api/me', { as: 'buyer' })).json.error.code, 'SIGN_IN_REQUIRED');

  const logout = await f.request('/api/auth/logout', { method: 'POST', as: 'fresh', body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await f.request('/api/me', { as: 'fresh' })).json.error.code, 'SIGN_IN_REQUIRED');
  // Logout without the CSRF token is refused and the session survives.
  f.sessions.again = (await f.request('/api/auth/login', { method: 'POST', body: { email: 'buyer@qa.test', password: PASSWORD } })).headers['set-cookie'][0].split(';')[0].split('=')[1];
  assert.equal((await f.request('/api/auth/logout', { method: 'POST', as: 'again', body: {}, headers: { 'X-CSRF-Token': null } })).json.error.code, 'CSRF_FAILED');
  assert.equal((await f.request('/api/me', { as: 'again' })).status, 200);
  // Malformed cookies fail closed.
  for (const value of ['', 'short', `${'a'.repeat(43)}`, `${'a'.repeat(42)}!`]) {
    const res = await f.request('/api/me', { headers: { Cookie: `${COOKIE}=${value}` } });
    assert.equal(res.json.error.code, 'SIGN_IN_REQUIRED');
  }
});

test('body validation: content type, size, JSON shape, unknown and prototype keys', async t => {
  const f = await fixture(t);
  const path = '/api/tasks', base = { method: 'POST', as: 'buyer' };
  const k = () => ({ 'Idempotency-Key': randomUUID() });
  assert.equal((await f.request(path, { ...base, raw: '{}', headers: { 'Content-Type': 'text/plain', ...k() } })).status, 415);
  assert.equal((await f.request(path, { ...base, raw: '{', headers: k() })).json.error.code, 'INVALID_JSON');
  assert.equal((await f.request(path, { ...base, raw: 'x'.repeat(40000), headers: k() })).status, 413);
  for (const body of [null, [], 'text', { tenantId: f.personal('buyer'), title: 'a', brief: 'b', role: 'owner' }]) {
    const res = await f.request(path, { ...base, raw: JSON.stringify(body), headers: k() });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const proto = `{"tenantId":"${f.personal('buyer')}","title":"t","brief":"b","__proto__":{"admin":true}}`;
  assert.equal((await f.request(path, { ...base, raw: proto, headers: k() })).json.error.code, 'INVALID_FIELDS');
  assert.equal((await f.request(path, { ...base, body: { tenantId: f.personal('buyer'), title: 'a\u0000b', brief: 'b' }, headers: k() })).json.error.code, 'INVALID_INPUT');
  // Invalid idempotency keys are refused before any write.
  for (const key of [undefined, 'short', 'x'.repeat(129), 'has space in it 123']) {
    const res = await f.request(path, { ...base, body: { tenantId: f.personal('buyer'), title: 'ok', brief: 'ok brief' }, headers: key ? { 'Idempotency-Key': key } : {} });
    assert.equal(res.json.error.code, 'IDEMPOTENCY_REQUIRED', String(key));
  }
});

test('idempotency keys are per user and bound to the body', async t => {
  const f = await fixture(t);
  const key = randomUUID();
  const send = (as, tenantId, title = 'Same key') => f.request('/api/tasks', { method: 'POST', as, body: { tenantId, title, brief: 'Idempotency probe brief.' }, headers: { 'Idempotency-Key': key } });
  const first = await send('buyer', f.personal('buyer'));
  assert.equal(first.status, 201);
  assert.deepEqual((await send('buyer', f.personal('buyer'))).json, first.json, 'same user, same body replays');
  assert.equal((await send('buyer', f.personal('buyer'), 'Other title')).json.error.code, 'IDEMPOTENCY_CONFLICT');
  // Another user with the same key neither sees nor replays the first user's receipt.
  const other = await send('stranger', f.personal('stranger'));
  assert.equal(other.status, 201);
  assert.notEqual(other.json.taskId, first.json.taskId);
  // A replay is re-authorized: another user cannot reuse the key to write into the first user's workspace.
  const cross = await send('stranger', f.personal('buyer'), 'Cross tenant');
  assert.equal(cross.status, 404);
});

test('cross-tenant reads and writes are refused for non-members (IDOR)', async t => {
  const f = await fixture(t);
  const tenantId = f.personal('buyer');
  const { json: { taskId } } = await f.request('/api/tasks', { method: 'POST', as: 'buyer', body: { tenantId, title: 'Private', brief: 'Private brief for IDOR probe.' }, headers: { 'Idempotency-Key': randomUUID() } });
  const k = () => ({ 'Idempotency-Key': randomUUID() });
  assert.equal((await f.request(`/api/tasks/${taskId}`, { as: 'stranger' })).status, 404);
  assert.equal((await f.request(`/api/tasks?tenantId=${tenantId}`, { as: 'stranger' })).status, 404);
  assert.equal((await f.request(`/api/tasks/${taskId}/offers`, { as: 'stranger' })).status, 404);
  assert.equal((await f.request(`/api/tasks/${taskId}/messages`, { method: 'POST', as: 'stranger', body: { expectedVersion: 1, body: 'hi' }, headers: k() })).status, 404);
  assert.equal((await f.request(`/api/tasks/${taskId}/cancel`, { method: 'POST', as: 'stranger', body: { expectedVersion: 1 }, headers: k() })).status, 404);
  assert.equal((await f.request(`/api/tasks/${taskId}`, { method: 'PATCH', as: 'stranger', body: { expectedVersion: 1, title: 'x', brief: 'y' }, headers: k() })).status, 404);
  assert.equal((await f.request('/api/tasks', { method: 'POST', as: 'stranger', body: { tenantId, title: 'x', brief: 'y' }, headers: k() })).status, 404);
  assert.equal((await f.request(`/api/connections?tenantId=${tenantId}`, { as: 'stranger' })).status >= 403, true);
  assert.equal((await f.request(`/api/payments/history?tenantId=${tenantId}`, { as: 'stranger' })).status >= 403, true);
  // Company-scoped endpoints refuse a non-member.
  for (const path of [`/api/teams/${f.companyId}`, `/api/teams/${f.companyId}/budget`, `/api/teams/${f.companyId}/policy`, `/api/teams/${f.companyId}/audit`, `/api/teams/${f.companyId}/projects`]) {
    assert.equal((await f.request(path, { as: 'stranger' })).status, 403, path);
  }
  // Still readable by its owner.
  assert.equal((await f.request(`/api/tasks/${taskId}`, { as: 'buyer' })).status, 200);
});

test('role boundaries: employees and approvers cannot administer the company; approvers cannot write tasks', async t => {
  const f = await fixture(t);
  const k = () => ({ 'Idempotency-Key': randomUUID() });
  const c = f.companyId;
  for (const as of ['member', 'approver']) {
    assert.equal((await f.request(`/api/teams/${c}/budget`, { method: 'POST', as, body: { limitMinor: 1000, expectedVersion: 0 }, headers: k() })).status, 403, as);
    assert.equal((await f.request(`/api/teams/${c}/policy`, { method: 'POST', as, body: { membersCanPublish: false, expectedVersion: 0 }, headers: k() })).status, 403, as);
    assert.equal((await f.request(`/api/teams/${c}/audit`, { as })).status, 403, as);
    assert.equal((await f.request(`/api/teams/${c}/projects`, { method: 'POST', as, body: { name: 'Proj', leadId: f.actor(as).user.id, memberIds: [], capMinor: 100 }, headers: k() })).status, 403, as);
    assert.equal((await f.request(`/api/teams/${c}/invite`, { method: 'POST', as, body: { email: 'x@qa.test', role: 'employee' } })).status, 403, as);
    assert.equal((await f.request(`/api/teams/${c}/role`, { method: 'POST', as, body: { memberId: f.actor('member').user.id, expectedRole: 'employee', role: 'approver' } })).status, 403, as);
  }
  // Nobody can be invited or promoted to owner, even by the owner.
  assert.equal((await f.request(`/api/teams/${c}/invite`, { method: 'POST', as: 'owner', body: { email: 'x@qa.test', role: 'owner' } })).json.error.code, 'INVALID_ROLE');
  assert.equal((await f.request(`/api/teams/${c}/role`, { method: 'POST', as: 'owner', body: { memberId: f.actor('member').user.id, expectedRole: 'employee', role: 'owner' } })).json.error.code, 'INVALID_ROLE');
  // Approvers cannot create company tasks; employees can.
  assert.equal((await f.request('/api/tasks', { method: 'POST', as: 'approver', body: { tenantId: c, title: 'x', brief: 'Approver attempt.' }, headers: k() })).json.error.code, 'FORBIDDEN');
  const created = await f.request('/api/tasks', { method: 'POST', as: 'member', body: { tenantId: c, title: 'Employee task', brief: 'Employee brief.' }, headers: k() });
  assert.equal(created.status, 201);
  // Approvers cannot read or change the employee's task.
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}`, { as: 'approver' })).status, 404);
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}/cancel`, { method: 'POST', as: 'approver', body: { expectedVersion: 1 }, headers: k() })).json.error.code, 'FORBIDDEN');
  // The company owner can read it.
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}`, { as: 'owner' })).status, 200);
});

test('a removed member loses access on the very next request, with the same session', async t => {
  const f = await fixture(t);
  const k = () => ({ 'Idempotency-Key': randomUUID() });
  const created = await f.request('/api/tasks', { method: 'POST', as: 'member', body: { tenantId: f.companyId, title: 'Before removal', brief: 'Created before removal.' }, headers: k() });
  assert.equal(created.status, 201);
  const replayKey = randomUUID();
  const msg = { expectedVersion: 1, body: 'Context before removal' };
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}/messages`, { method: 'POST', as: 'member', body: msg, headers: { 'Idempotency-Key': replayKey } })).status, 200);
  const removed = await f.request(`/api/teams/${f.companyId}/remove`, { method: 'POST', as: 'owner', body: { memberId: f.actor('member').user.id } });
  assert.equal(removed.status, 200);
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}`, { as: 'member' })).status, 404);
  assert.equal((await f.request(`/api/tasks?tenantId=${f.companyId}`, { as: 'member' })).status, 404);
  // Even a replay of a receipt issued before removal is re-authorized and refused.
  assert.equal((await f.request(`/api/tasks/${created.json.taskId}/messages`, { method: 'POST', as: 'member', body: msg, headers: { 'Idempotency-Key': replayKey } })).status, 404);
  assert.equal((await f.request('/api/tasks', { method: 'POST', as: 'member', body: { tenantId: f.companyId, title: 'After', brief: 'After removal.' }, headers: k() })).status, 404);
  assert.equal((await f.request('/api/activity', { as: 'member' })).json.items.some(i => i.tenantId === f.companyId), false);
  assert.equal((await f.request(`/api/teams/${f.companyId}`, { as: 'member' })).status, 403);
  // Acting for the company is refused too.
  assert.equal((await f.request('/api/agents', { as: 'member', headers: { 'X-Relay-Act-As': f.companyId } })).status, 403);
});

test('act-as header: refused for outsiders, malformed ids and organization-to-buyer escalation', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/agents', { as: 'stranger', headers: { 'X-Relay-Act-As': f.companyId } })).status, 403);
  assert.equal((await f.request('/api/agents', { as: 'member', headers: { 'X-Relay-Act-As': 'not-a-uuid' } })).json.error.code, 'ACT_AS_UNAVAILABLE');
  assert.equal((await f.request('/api/agents', { as: 'member', headers: { 'X-Relay-Act-As': f.personal('member') } })).status, 403, 'a personal workspace is not an organization');
  assert.equal((await f.request('/api/agents', { as: 'member', headers: { 'X-Relay-Act-As': f.companyId } })).status, 200);
  // The organization identity has no buyer access to the company's requests or tasks.
  const k = () => ({ 'Idempotency-Key': randomUUID() });
  assert.equal((await f.request('/api/tasks', { method: 'POST', as: 'owner', body: { tenantId: f.companyId, title: 'x', brief: 'Org identity cannot buy.' }, headers: { 'X-Relay-Act-As': f.companyId, ...k() } })).status, 404);
  assert.equal((await f.request(`/api/tasks?tenantId=${f.companyId}`, { as: 'owner', headers: { 'X-Relay-Act-As': f.companyId } })).status, 404);
  // Payout management under /api/payments is owner-only for an organization.
  assert.equal((await f.request('/api/payments/operator/refresh', { method: 'POST', as: 'member', body: {}, headers: { 'X-Relay-Act-As': f.companyId } })).json.error.code, 'OWNER_REQUIRED');
});

test('employee acting for an organization can trigger a task transfer and payout of the organization\'s funds', { todo: 'BUG-AUTH-1: OWNER_REQUIRED guard only covers /api/payments*, not /api/tasks/:id/payments/(transfer|payout)' }, async t => {
  const f = await fixture(t, { paymentProvider: paymentDouble() });
  // The owner onboards the organization as a payout operator (owner-only, allowed).
  const asOrgOwner = await f.store.actAs(f.actor('owner'), f.companyId);
  await f.store.onboardOperator(asOrgOwner, { country: 'US' }, randomUUID());
  await f.store.refreshOperator(asOrgOwner);
  // The organization's agent offers on an outside buyer's request, which is funded and accepted.
  const asOrgMember = await f.store.actAs(f.actor('member'), f.companyId);
  const { agentId } = await f.store.marketplace.addAgent(asOrgMember, { name: 'Org agent', purpose: 'Clean CSV files', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Clean CSV' }] }, randomUUID());
  const [agent] = await f.store.marketplace.agents(asOrgMember);
  const buyer = f.actor('buyer');
  const { taskId } = await f.store.createTask(buyer, { tenantId: f.personal('buyer'), title: 'Clean CSV', brief: 'Clean this CSV export.' }, randomUUID());
  await f.store.addInput(buyer, taskId, { expectedVersion: 1, filename: 'a.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Clean.' }, randomUUID());
  await f.store.mutateTask(buyer, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  const { offerId } = await f.store.marketplace.quote(asOrgMember, taskId, { agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Clean it.' }, randomUUID());
  const version = async () => (await f.repository.read(repo => repo.get('task', taskId))).version;
  await f.store.marketplace.accept(buyer, taskId, { offerId, expectedVersion: await version() }, randomUUID());
  await f.store.sandboxPayment(buyer, taskId, 'fund', { expectedVersion: await version() }, randomUUID());
  await f.store.reconcilePayment(buyer, taskId);
  await f.repository.transaction('qa-fixture', async repo => {
    const task = await repo.get('task', taskId, true);
    assert.equal(task.settlement.status, 'funded');
    task.assignment = { id: 'qa-assignment', agentId, operatorId: f.companyId, mode: 'stripe-sandbox', status: 'accepted', offerId };
    task.submissions = [{ id: 'qa-submission', status: 'accepted', files: [] }];
    await repo.save('task', task);
  });
  // An employee (not an owner) acting for the organization moves its money.
  const transfer = await f.request(`/api/tasks/${taskId}/payments/transfer`, { method: 'POST', as: 'member', body: { expectedVersion: await version() },
    headers: { 'X-Relay-Act-As': f.companyId, 'Idempotency-Key': randomUUID() } });
  assert.equal(transfer.status, 403, `expected OWNER_REQUIRED, got ${transfer.status} ${transfer.text}`);
  assert.equal(transfer.json.error.code, 'OWNER_REQUIRED');
});

test('malformed percent-encoding in app-run ids is a client error, not a 500', { todo: 'BUG-AUTH-2: decodeURIComponent URIError in app.cjs app-run/workspace-app routes returns 500 INTERNAL_ERROR' }, async t => {
  const f = await fixture(t);
  const res = await f.request('/api/app-runs/%E0%A4%A/download', { as: 'buyer' });
  assert.equal(res.status, 400, `got ${res.status} ${res.text}`);
  const post = await f.request('/api/workspace-apps/%E0%A4%A', { method: 'POST', as: 'buyer', body: {}, headers: { 'Idempotency-Key': randomUUID() } });
  assert.equal(post.status, 400, `got ${post.status} ${post.text}`);
});

test('auth rate limit keys on the socket address and ignores X-Forwarded-For (risk behind a proxy)', async t => {
  const f = await fixture(t);
  // Twenty failures from one socket address exhaust the shared IP bucket for every account,
  // even when each request claims a different client in X-Forwarded-For.
  const results = [];
  for (let i = 0; i < 21; i++) {
    const email = `nobody${i}@qa.test`;
    results.push((await f.request('/api/auth/login', { method: 'POST', body: { email, password: 'wrong password value' }, headers: { 'X-Forwarded-For': `203.0.113.${i}` } })).json.error.code);
  }
  assert.equal(results.at(-1), 'AUTH_LIMIT');
  const legit = await f.request('/api/auth/login', { method: 'POST', body: { email: 'owner@qa.test', password: PASSWORD }, headers: { 'X-Forwarded-For': '198.51.100.7' } });
  assert.equal(legit.json.error.code, 'AUTH_LIMIT', 'a legitimate user behind the same proxy is locked out');
});

test('a member acting for an organization cannot offer on their own personal request', { todo: 'BUG-AUTH-3: self-dealing guard (task.ownerId === actor.user.id) checks the organization id, not onBehalfOf, so a member can quote on and win their own request' }, async t => {
  const f = await fixture(t);
  const mel = f.actor('member');
  const asOrg = await f.store.actAs(mel, f.companyId);
  const { agentId } = await f.store.marketplace.addAgent(asOrg, { name: 'Org agent', purpose: 'Clean CSV files', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Clean CSV' }] }, randomUUID());
  const [agent] = await f.store.marketplace.agents(asOrg);
  // Mel's own personal request.
  const { taskId } = await f.store.createTask(mel, { tenantId: f.personal('member'), title: 'Clean my CSV', brief: 'Clean this CSV export.' }, randomUUID());
  await f.store.addInput(mel, taskId, { expectedVersion: 1, filename: 'a.csv', base64: Buffer.from('id\n1\n').toString('base64'), notes: 'Clean.' }, randomUUID());
  await f.store.mutateTask(mel, taskId, 'post', { expectedVersion: 2 }, randomUUID());
  // As a person, Mel cannot offer on it (control).
  const { agentId: ownAgent } = await f.store.marketplace.addAgent(mel, { name: 'Personal agent', purpose: 'Clean CSV files', kind: 'general', domain: '', integration: 'api', capabilities: [{ category: 'Data', task: 'Clean CSV' }] }, randomUUID());
  const own = (await f.store.marketplace.agents(mel)).find(a => a.id === ownAgent);
  await assert.rejects(f.store.marketplace.quote(mel, taskId, { agentId: ownAgent, capabilityId: own.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Self.' }, randomUUID()), { code: 'NOT_FOUND' });
  // Through the organization the same person must be refused too.
  assert.equal((await f.store.marketplace.opportunities(asOrg)).some(o => o.id === taskId), false, 'own request listed as an opportunity');
  await assert.rejects(f.store.marketplace.quote(asOrg, taskId, { agentId, capabilityId: agent.capabilities[0].id, expectedVersion: 3, amountMinor: 5000, deliveryMinutes: 60, proposal: 'Self via org.' }, randomUUID()), { code: 'NOT_FOUND' });
});
