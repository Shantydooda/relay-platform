'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { providerMigrations, migrateProvider } = require('../../pilot-api/scripts/database.cjs');

test('pilot provider migrations apply, replay safely, and reject changed history', async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create role supabase_auth_admin; create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  assert.equal(await migrateProvider(db), 4);
  assert.equal(await migrateProvider(db), 0);
  const changed = providerMigrations();
  changed[0].checksum = 'changed';
  await assert.rejects(migrateProvider(db, changed), /history differs/);
  assert.equal((await db.query('select count(*)::int as n from relay_private.provider_schema_migrations')).rows[0].n, 4);
  const broken = [...providerMigrations(), {name:'999999999999_failure.sql', checksum:'fixture', sql:'CREATE TABLE relay_private.rollback_probe(id int); SELECT no_such_function();'}];
  await assert.rejects(migrateProvider(db, broken));
  assert.equal((await db.query("select to_regclass('relay_private.rollback_probe') as value")).rows[0].value, null);
  assert.equal(await migrateProvider(db), 0);
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query("select has_schema_privilege($1,'relay_private','USAGE') as allowed", [role])).rows[0].allowed, false);
  }
});
