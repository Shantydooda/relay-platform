'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { createManagedStore } = require('../src/store.cjs');
const { createVault } = require('../src/token-vault.cjs');
const { loadConfig } = require('../src/config.cjs');
const { createProvider } = require('../src/provider.cjs');
const { digest } = require('../../poc-api/src/security.cjs');
const password = 'a long test-only passphrase';
function fixture(application) {
  let time = Date.now();
  const rows = new Map(),
    calls = [],
    key = randomBytes(32),
    userId = randomUUID(),
    tenantId = randomUUID();
  const identity = {
    id: userId,
    email: 'invited@example.test',
    email_confirmed_at: new Date(time).toISOString(),
    user_metadata: { name: 'Invited member', workspace: 'builder' },
  };
  const authResult = () => ({
    data: {
      session: {
        access_token: 'provider-access-token',
        refresh_token: 'MUST-NOT-BE-STORED',
        expires_at: Math.floor(time / 1000) + 3600,
      },
      user: identity,
    },
    error: null,
  });
  const provider = {
    async limit(keys) {
      calls.push(['limit', keys]);
    },
    async eligibleEmail(email) {
      return email === 'invited@example.test';
    },
    async signUp(...args) {
      calls.push(['signup', ...args]);
      return authResult();
    },
    async signIn(...args) {
      calls.push(['signin', ...args]);
      return authResult();
    },
    async verify(...args) {
      calls.push(['verify', ...args]);
      return authResult();
    },
    async identity(access) {
      calls.push(['identity', access]);
      return { data: { user: identity }, error: null };
    },
    async bootstrap(...args) {
      calls.push(['bootstrap', ...args]);
    },
    async profile() {
      return { name: 'Invited member', workspace: 'builder' };
    },
    async memberships() {
      return [{ id: tenantId, name: 'Personal workspace', role: 'owner' }];
    },
    async saveSession(row) {
      rows.set(row.token_hash, { ...row });
    },
    async session(hash) {
      return rows.get(hash) || null;
    },
    async touchSession(hash, last_seen_at) {
      rows.get(hash).last_seen_at = last_seen_at;
    },
    async deleteSession(hash) {
      calls.push(['delete-session', hash]);
      rows.delete(hash);
    },
    async deleteUserSessions(id) {
      calls.push(['delete-user-sessions', id]);
      for (const [hash, row] of rows) if (row.user_id === id) rows.delete(hash);
    },
    async resend(email) {
      calls.push(['resend', email]);
      return { error: null };
    },
    async recover(email) {
      calls.push(['recover', email]);
      return { error: null };
    },
    async updatePassword(...args) {
      calls.push(['update-password', ...args]);
    },
    async revoke(...args) {
      calls.push(['revoke', ...args]);
    },
    async command(...args) {
      calls.push(['command', ...args]);
      return { taskId: randomUUID(), version: 1 };
    },
  };
  const store = createManagedStore({
    provider,
    sessionKey: key,
    now: () => time,
    application,
  });
  return {
    store,
    provider,
    rows,
    calls,
    key,
    identity,
    tenantId,
    advance: (ms) => {
      time += ms;
    },
  };
}
test('config requires explicit HTTPS provider settings and valid encryption key', () => {
  const env = {
    RELAY_APP_ORIGIN: 'https://relay-staging.onrender.com',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'test-publishable',
    SUPABASE_SECRET_KEY: 'test-secret',
    RELAY_SESSION_KEY: randomBytes(32).toString('base64'),
  };
  assert.equal(loadConfig(env).sessionKey.length, 32);
  assert.equal(
    loadConfig({
      ...env,
      RELAY_APP_ORIGIN: '',
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://assigned-staging.onrender.com',
    }).origin,
    'https://assigned-staging.onrender.com',
  );
  assert.equal(
    loadConfig({
      ...env,
      RENDER: 'true',
      RENDER_EXTERNAL_URL: 'https://other.onrender.com',
    }).origin,
    env.RELAY_APP_ORIGIN,
  );
  assert.throws(
    () =>
      loadConfig({
        ...env,
        RELAY_APP_ORIGIN: '',
        RENDER_EXTERNAL_URL: 'https://untrusted.example',
      }),
    /Missing RELAY_APP_ORIGIN/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...env,
        RELAY_APP_ORIGIN: '',
        RENDER: 'true',
        RENDER_EXTERNAL_URL: 'http://assigned.onrender.com',
      }),
    /HTTPS/,
  );
  assert.throws(
    () => loadConfig({ ...env, RELAY_APP_ORIGIN: 'http://relay.example' }),
    /HTTPS/,
  );
  assert.throws(
    () =>
      loadConfig({
        ...env,
        SUPABASE_URL: 'https://example.supabase.co.evil.test',
      }),
    /hosted Supabase/,
  );
  assert.throws(
    () => loadConfig({ ...env, RELAY_SESSION_KEY: 'short' }),
    /32 random bytes/,
  );
  assert.throws(
    () => loadConfig({ ...env, SUPABASE_SECRET_KEY: '' }),
    /Missing SUPABASE_SECRET_KEY/,
  );
});
test('AES-GCM vault rejects altered ciphertext, wrong key and swapping session records', () => {
  const vault = createVault(randomBytes(32)),
    sealed = vault.seal('access-token', 'session-a');
  assert.equal(vault.open(sealed, 'session-a'), 'access-token');
  assert.throws(() => vault.open(sealed, 'session-b'));
  assert.throws(() => createVault(randomBytes(32)).open(sealed, 'session-a'));
  const parts = sealed.split('.');
  parts[2] = randomBytes(16).toString('base64url');
  assert.throws(() => vault.open(parts.join('.'), 'session-a'));
});
test('register and recovery give generic notices; registration never grants an unverified session', async () => {
  const { store, provider, rows, calls } = fixture();
  const a = await store.register(
    {
      name: 'Member',
      email: 'invited@example.test',
      password,
      workspace: 'buyer',
    },
    'ip',
  );
  const b = await store.register(
    {
      name: 'Other',
      email: 'unknown@example.test',
      password,
      workspace: 'buyer',
    },
    'ip',
  );
  assert.deepEqual(a, b);
  assert.equal(a.verificationRequired, true);
  assert.equal(rows.size, 0);
  assert.equal(calls.filter((call) => call[0] === 'signup').length, 1);
  assert.deepEqual(
    await store.emailAction('recover', { email: 'invited@example.test' }, 'ip'),
    await store.emailAction('recover', { email: 'unknown@example.test' }, 'ip'),
  );
  provider.signUp = async () => ({ error: { status: 503 } });
  await assert.rejects(
    store.register(
      {
        name: 'Member',
        email: 'invited@example.test',
        password,
        workspace: 'buyer',
      },
      'ip',
    ),
    { code: 'PROVIDER_UNAVAILABLE' },
  );
});
test('managed login verifies provider identity and stores only encrypted access token + opaque verifier', async () => {
  const { store, rows, calls, identity } = fixture();
  const raw = await store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    row = rows.get(digest(raw));
  assert.equal(row.user_id, identity.id);
  assert.equal(row.scope, 'app');
  assert.doesNotMatch(
    JSON.stringify([...rows.values()]),
    /provider-access-token|MUST-NOT-BE-STORED/,
  );
  assert.equal(JSON.stringify([...rows.values()]).includes(raw), false);
  const actor = await store.principal(raw);
  assert.equal(actor.user.emailVerified, true);
  assert.equal(actor.user.workspace, 'builder');
  assert.ok(calls.some((call) => call[0] === 'identity'));
  assert.throws(() => store.csrf(actor, 'wrong'), { code: 'CSRF_FAILED' });
  store.csrf(actor, actor.csrf);
});
test('unverified, revoked-invite and wrong-subject identities cannot acquire or use app sessions', async () => {
  const { store, provider, identity, rows } = fixture();
  identity.email_confirmed_at = null;
  await assert.rejects(
    store.login({ email: 'invited@example.test', password }, 'ip'),
    { code: 'VERIFICATION_REQUIRED' },
  );
  assert.equal(rows.size, 0);
  identity.email_confirmed_at = new Date().toISOString();
  const raw = await store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  provider.eligibleEmail = async () => false;
  await assert.rejects(store.principal(raw), { code: 'ACCESS_DENIED' });
  provider.eligibleEmail = async () => true;
  identity.id = randomUUID();
  await assert.rejects(store.principal(raw), { code: 'SIGN_IN_REQUIRED' });
});
test('server enforces managed idle/absolute expiry and rejects damaged encrypted records', async () => {
  const { store, rows, advance } = fixture();
  const raw = await store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  advance(30 * 60 * 1000);
  await assert.rejects(store.principal(raw), { code: 'SIGN_IN_REQUIRED' });
  const fresh = await store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  rows.get(digest(fresh)).encrypted_access_token = 'broken';
  await assert.rejects(store.principal(fresh), { code: 'SIGN_IN_REQUIRED' });
  const next = await store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  advance(25 * 60 * 1000);
  await store.principal(next);
  advance(25 * 60 * 1000);
  await store.principal(next);
  advance(11 * 60 * 1000);
  await assert.rejects(store.principal(next), { code: 'SIGN_IN_REQUIRED' });
});
test('recovery grants a restricted session, not tasks; reset revokes every app session', async () => {
  const { store, rows, calls } = fixture();
  const normal = await store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  const { raw } = await store.verify(
    { tokenHash: 'a'.repeat(64), type: 'recovery' },
    'ip',
  );
  await assert.rejects(store.principal(raw), { code: 'RECOVERY_ONLY' });
  const actor = await store.principal(raw, { allowRecovery: true });
  assert.deepEqual(actor.memberships, []);
  await assert.rejects(
    store.createTask(
      actor,
      { tenantId: randomUUID(), title: 'Task', brief: 'Brief' },
      randomUUID(),
    ),
    { code: 'RECOVERY_ONLY' },
  );
  await store.reset(actor, {
    password: 'a completely new test-only passphrase',
  });
  assert.equal(rows.size, 0);
  assert.ok(calls.some((call) => call[0] === 'revoke' && call[2] === 'global'));
  await assert.rejects(store.principal(normal), { code: 'SIGN_IN_REQUIRED' });
});
test('invalid verification type and ordinary sessions cannot change passwords through recovery endpoint', async () => {
  const { store } = fixture();
  await assert.rejects(
    store.verify({ tokenHash: 'a'.repeat(64), type: 'admin' }, 'ip'),
    { code: 'INVALID_LINK' },
  );
  const raw = await store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    actor = await store.principal(raw);
  await assert.rejects(store.reset(actor, { password }), {
    code: 'RECOVERY_REQUIRED',
  });
});
test('logout revokes the opaque session even when provider logout is unavailable', async () => {
  const { store, provider, rows } = fixture();
  const raw = await store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    actor = await store.principal(raw);
  provider.revoke = async () => {
    throw new Error('Provider unavailable');
  };
  await assert.rejects(store.logout(actor));
  assert.equal(rows.size, 0);
  await assert.rejects(store.principal(raw), { code: 'SIGN_IN_REQUIRED' });
});
test('provider data client uses user JWT for task/profile access, never the admin secret', async () => {
  const requests = [];
  const provider = createProvider(
    {
      supabaseURL: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
      secretKey: 'sb_secret_test',
      origin: 'https://relay.example',
    },
    {
      fetchImpl: async (url, options) => {
        requests.push({
          url: String(url),
          headers: new Headers(options.headers),
        });
        return new Response(
          JSON.stringify(
            String(url).includes('relay_profiles')
              ? { user_id: 'user-a', name: 'Member', workspace: 'buyer' }
              : { email: 'invited@example.test' },
          ),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  );
  await provider.profile('verified-user-access-token', 'user-a');
  await provider.eligibleEmail('invited@example.test');
  assert.equal(
    requests[0].headers.get('authorization'),
    'Bearer verified-user-access-token',
  );
  assert.equal(requests[0].headers.get('apikey'), 'sb_publishable_test');
  assert.equal(requests[1].headers.get('apikey'), 'sb_secret_test');
});

test('composed application refreshes roles and rejects stale, forged and logged-out actors', async () => {
  const received = [];
  const application = {
    createTask: async (actor) => {
      received.push(actor);
      return actor.memberships;
    },
    marketplace: { agents: async (actor) => actor.memberships },
  };
  const f = fixture(application),
    raw = await f.store.login(
      { email: 'invited@example.test', password },
      'ip',
    );
  const actor = await f.store.principal(raw);
  actor.memberships = [{ id: 'forged', role: 'owner' }];
  actor.user.id = 'forged';
  actor.scope = 'recovery';
  f.provider.memberships = async () => [{ id: f.tenantId, role: 'approver' }];
  assert.equal((await f.store.createTask(actor))[0].role, 'approver');
  assert.equal(received[0].user.id, f.identity.id);
  assert.equal(received[0].scope, 'app');
  assert.equal((await f.store.marketplace.agents(actor))[0].role, 'approver');
  await assert.rejects(f.store.createTask({ ...actor }), {
    code: 'SIGN_IN_REQUIRED',
  });
  f.rows.clear();
  await assert.rejects(f.store.createTask(actor), { code: 'SIGN_IN_REQUIRED' });
  assert.equal(received.length, 1);
});
test('managed composition rejects recovery, expired and revoked provider access before application work', async () => {
  const f = fixture({
    createTask: async () => assert.fail('unauthorized application work'),
  });
  const recovery = await f.store.verify(
    { tokenHash: 'a'.repeat(64), type: 'recovery' },
    'ip',
  );
  const actor = await f.store.principal(recovery.raw, { allowRecovery: true });
  await assert.rejects(f.store.createTask(actor), { code: 'RECOVERY_ONLY' });
  const raw = await f.store.login(
    { email: 'invited@example.test', password },
    'ip',
  );
  const normal = await f.store.principal(raw);
  f.provider.identity = async () => ({ error: { status: 401 } });
  await assert.rejects(f.store.createTask(normal), {
    code: 'SIGN_IN_REQUIRED',
  });
});
test('logout during identity refresh cannot enter the composed application', async () => {
  const f = fixture({
    createTask: async () => assert.fail('revoked session reached application'),
  });
  const raw = await f.store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    actor = await f.store.principal(raw);
  f.provider.memberships = async () => {
    f.rows.clear();
    return [{ id: f.tenantId, role: 'owner' }];
  };
  await assert.rejects(f.store.createTask(actor), { code: 'SIGN_IN_REQUIRED' });
});
for (const adapter of ['sqlite', 'postgres'])
  test(`managed ${adapter} sessions use shared task policies and block replay after workspace removal`, async (t) => {
    const { DatabaseSync } = require('node:sqlite');
    const {
      createSqliteRepository,
      createPostgresRepository,
    } = require('../../application/src/repository.cjs');
    const { createApplication } = require('../../application/src/service.cjs');
    const db =
      adapter === 'sqlite'
        ? new DatabaseSync(':memory:')
        : await require('@electric-sql/pglite').PGlite.create();
    t.after(() => db.close());
    const repository =
      adapter === 'sqlite'
        ? createSqliteRepository(db)
        : await createPostgresRepository(db, { initialize: true });
    const application = createApplication({ repository });
    const f = fixture(application),
      raw = await f.store.login(
        { email: 'invited@example.test', password },
        'ip',
      ),
      actor = await f.store.principal(raw);
    const body = {
        tenantId: f.tenantId,
        title: 'Managed buyer task',
        brief: 'Keep the same shared task and authorization rules.',
      },
      key = randomUUID();
    const task = await f.store.createTask(actor, body, key);
    assert.deepEqual(await f.store.createTask(actor, body, key), task);
    assert.equal(
      (await f.store.detail(actor, task.taskId)).task.title,
      body.title,
    );
    f.provider.memberships = async () => [{ id: f.tenantId, role: 'approver' }];
    await assert.rejects(
      f.store.mutateTask(
        actor,
        task.taskId,
        'post',
        { expectedVersion: 1 },
        randomUUID(),
      ),
      { code: 'FORBIDDEN' },
    );
    f.provider.memberships = async () => [];
    await assert.rejects(f.store.createTask(actor, body, key), {
      code: 'ACCESS_DENIED',
    });
    await assert.rejects(f.store.detail(actor, task.taskId), {
      code: 'ACCESS_DENIED',
    });
  });

test('managed composition keeps minted supplier commands distinct from browser sessions', async () => {
  const principal = {
    agentId: randomUUID(),
    actor: { user: { id: randomUUID() }, memberships: [] },
  };
  let quoted = 0,
    permission = 0;
  const f = fixture({
    runtimePrincipal: async () => principal,
    marketplace: {
      quote: async (actor, id, body, key, runtime) => {
        assert.equal(runtime, principal);
        assert.equal(actor, principal.actor);
        quoted++;
      },
    },
    requestToolPermission: async (runtime) => {
      assert.equal(runtime, principal);
      permission++;
    },
  });
  const runtime = await f.store.runtimePrincipal('fixture-only');
  await f.store.marketplace.quote(
    runtime.actor,
    'task',
    {},
    randomUUID(),
    runtime,
  );
  await f.store.requestToolPermission(runtime, 'task', {}, randomUUID());
  await assert.rejects(
    f.store.marketplace.quote(runtime.actor, 'task', {}, randomUUID(), {
      ...runtime,
    }),
    { code: 'SIGN_IN_REQUIRED' },
  );
  assert.equal(quoted, 1);
  assert.equal(permission, 1);
});
test('composed commands fail closed on provider outage, invitation revocation, session expiry and password reset', async () => {
  const f = fixture({
    createTask: async () => assert.fail('unauthorized command'),
  });
  let raw = await f.store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    actor = await f.store.principal(raw);
  const original = f.provider.identity;
  f.provider.identity = async () => ({ error: { status: 503 } });
  await assert.rejects(f.store.createTask(actor), {
    code: 'PROVIDER_UNAVAILABLE',
  });
  f.provider.identity = original;
  f.provider.eligibleEmail = async () => false;
  await assert.rejects(f.store.createTask(actor), { code: 'ACCESS_DENIED' });
  f.provider.eligibleEmail = async () => true;
  f.advance(30 * 60 * 1000);
  await assert.rejects(f.store.createTask(actor), { code: 'SIGN_IN_REQUIRED' });
  raw = await f.store.login({ email: 'invited@example.test', password }, 'ip');
  actor = await f.store.principal(raw);
  const recovery = await f.store.verify(
    { tokenHash: 'a'.repeat(64), type: 'recovery' },
    'ip',
  );
  await f.store.reset(
    await f.store.principal(recovery.raw, { allowRecovery: true }),
    { password: 'new isolated test-only password' },
  );
  await assert.rejects(f.store.createTask(actor), { code: 'SIGN_IN_REQUIRED' });
});

test('managed HTTP task creation rechecks role after route authentication', async (t) => {
  const http = require('node:http');
  const { DatabaseSync } = require('node:sqlite');
  const {
    createSqliteRepository,
  } = require('../../application/src/repository.cjs');
  const { createApplication } = require('../../application/src/service.cjs');
  const { createApp } = require('../../poc-api/src/app.cjs');
  const db = new DatabaseSync(':memory:');
  const application = createApplication({
    repository: createSqliteRepository(db),
  });
  const f = fixture(application),
    raw = await f.store.login(
      { email: 'invited@example.test', password },
      'ip',
    ),
    actor = await f.store.principal(raw);
  const server = createApp({
    origin: 'https://relay.example',
    mode: 'managed-staging',
    store: f.store,
    logger: { error: () => assert.fail('Unexpected server error') },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  let checks = 0;
  f.provider.memberships = async () => [
    { id: f.tenantId, role: ++checks === 1 ? 'owner' : 'approver' },
  ];
  const result = await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.address().port,
        path: '/api/tasks',
        method: 'POST',
        headers: {
          Host: 'relay.example',
          Origin: 'https://relay.example',
          'Content-Type': 'application/json',
          Cookie: `__Host-relay_poc_session=${raw}`,
          'X-CSRF-Token': actor.csrf,
          'Idempotency-Key': randomUUID(),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            body: JSON.parse(Buffer.concat(chunks)),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(
      JSON.stringify({
        tenantId: f.tenantId,
        title: 'Role changed',
        brief: 'Must not create this task after demotion.',
      }),
    );
  });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'FORBIDDEN');
  assert.ok(checks >= 2);
  f.provider.memberships = async () => [{ id: f.tenantId, role: 'owner' }];
  assert.equal((await f.store.list(actor, f.tenantId)).length, 0);
});
