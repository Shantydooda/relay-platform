'use strict';
// An in-process hosted pilot: managed mode, pilot connections, the pilot's
// public address. Supplier runtimes reach it through `fetchImpl`, which sends
// the pilot's Host header to this local server, as a real request would arrive.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../../../application/src/repository.cjs');
const { createUnifiedManagedStore } = require('../../src/unified-managed.cjs');
const { createApp } = require('../../../poc-api/src/app.cjs');
const { createSupplierClient } = require('../../../../packages/supplier-sdk/src/index.cjs');
const http = require('node:http');

const ORIGIN = 'https://relay-pilot-test.onrender.com';

async function pilot(t, applicationOptions = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const users = {};
  for (const role of ['builder', 'buyer', 'staff']) users[role] = { id: randomUUID(), email: `${role}@pilot.test`, email_confirmed_at: new Date().toISOString() };
  const sessions = new Map();
  const provider = {
    limit: async () => {}, eligibleEmail: async () => true,
    signIn: async email => ({ data: { session: { access_token: email, expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
    identity: async access => ({ data: { user: Object.values(users).find(u => u.email === access) } }),
    bootstrap: async () => {}, profile: async () => ({ name: 'Pilot member', workspace: 'buyer' }),
    memberships: async () => assert.fail('must use authoritative ledger'),
    saveSession: async row => sessions.set(row.token_hash, { ...row }), session: async hash => sessions.get(hash),
    deleteSession: async hash => sessions.delete(hash), touchSession: async () => {},
  };
  const composition = createUnifiedManagedStore({ provider, sessionKey: randomBytes(32), repository,
    applicationOptions: { localExecution: false, pilotConnections: true, relayTestReviewerIds: [users.staff.id], ...applicationOptions } });
  const actors = {};
  for (const role of Object.keys(users)) {
    await composition.access.apply({ userId: users[role].id, revision: 1, expiresAt: Date.now() + 300000, memberships: [{ id: randomUUID(), role: 'owner', company: false, accessEpoch: 1 }] });
    actors[role] = await composition.store.principal(await composition.store.login({ email: users[role].email, password: 'fixture' }, 'local'));
  }
  const server = createApp({ origin: ORIGIN, mode: 'managed-pilot', store: composition.store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  // The runtime talks to the pilot's public address; the request reaches this test server.
  const port = server.address().port;
  const fetchImpl = (url, init) => new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({ host: '127.0.0.1', port, path: target.pathname + target.search, method: init.method,
      headers: { ...init.headers, Host: target.host } }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); if (init.body) req.write(init.body); req.end();
  });
  return { store: composition.store, actors, fetchImpl, origin: ORIGIN, client: token => createSupplierClient({ origin: ORIGIN, token, fetchImpl }) };
}


module.exports = { pilot, ORIGIN };
