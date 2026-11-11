'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { loadConfig } = require('../../pilot-api/src/config.cjs');
const { composePilot } = require('../../pilot-api/src/composition.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
const env = () => ({ RELAY_ENVIRONMENT:'private-pilot', RELAY_APP_ORIGIN:'https://relay-pilot-test.onrender.com',
  SUPABASE_URL:'https://nnxtpkksvurcrajyjqmn.supabase.co', SUPABASE_PUBLISHABLE_KEY:'fixture', SUPABASE_SECRET_KEY:'fixture',
  RELAY_SESSION_KEY:'a'.repeat(64), RELAY_MEMBERSHIP_KEY:'b'.repeat(64), RELAY_PILOT_DATABASE_PASSWORD:'fixture',
  RELAY_DATABASE_CA:'-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----' });
test('pilot config rejects other environments, missing encryption and all payment credentials', () => {
  assert.equal(loadConfig(env()).database.projectRef, 'nnxtpkksvurcrajyjqmn');
  for (const patch of [{RELAY_ENVIRONMENT:'staging'}, {SUPABASE_URL:'https://pjnhmlhaabjqqifjixio.supabase.co'},
    {RELAY_APP_ORIGIN:'https://relay-staging-j2iy.onrender.com'}, {RELAY_DATABASE_CA:''},
    {STRIPE_SECRET_KEY:'sk_live_fixture'}, {STRIPE_SECRET_KEY:'sk_test_fixture'}]) {
    assert.throws(() => loadConfig({...env(), ...patch}));
  }
});
test('managed pilot never permits loopback execution over HTTPS', () => {
  assert.throws(() => createApp({origin:env().RELAY_APP_ORIGIN, mode:'managed-pilot',store:{features:{localExecution:true}}}), /loopback/);
  assert.throws(() => createApp({origin:'http://127.0.0.1:4180',mode:'managed-pilot',store:{}}), /HTTPS/);
});
test('pilot startup consumes trusted changes and drains workers; provider outage blocks startup', async t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const user = randomUUID(), tenant = randomUUID();
  const pool = {query: async sql => sql.includes('from public.relay_membership_changes') ? {rows:[{
    sequence:1, event_id:randomUUID(), user_id:user, revision:1, memberships:[{id:tenant,role:'owner',company:false}]
  }]} : {rows:[{sequence:1,stream_id:'fixture',retained_through:0}]}};
  const query = pool.query;
  pool.query = (sql, args) => sql.includes('from public.relay_membership_changes') && args[0] === 1 ? Promise.resolve({rows:[]}) : query(sql,args);
  const pilot = composePilot({provider:{},repository,pool,sessionKey:randomBytes(32),membershipKey:randomBytes(32),logger:{error(){}}});
  t.after(() => pilot.close());
  await pilot.start();
  assert.equal(pilot.store.features.localExecution, false);
  assert.equal(pilot.health().workers.length, 2);
  await assert.rejects(pilot.start(), /ALREADY/);
  await pilot.close();
  assert.ok(pilot.health().workers.every(w => w.status === 'stopped'));
  const failed = composePilot({provider:{},repository,pool:{query:async()=>{throw new Error('offline');}},sessionKey:randomBytes(32),membershipKey:randomBytes(32)});
  await assert.rejects(failed.start(), /offline/);
  assert.equal(failed.health().workers.length,0);
  await failed.close();
});
