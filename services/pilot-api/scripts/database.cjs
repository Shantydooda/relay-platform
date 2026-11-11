'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { hostedPoolOptions } = require('../../application/src/hosted-postgres.cjs');
const { postgresPoolDatabase } = require('../../application/src/repository.cjs');
const { migrate, assertCurrentSchema, validateHistory } = require('../../application/src/migrations.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const PILOT_REF = 'nnxtpkksvurcrajyjqmn';

function privateFile(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('PRIVATE_CONFIG_REQUIRED');
  return fs.readFileSync(file, 'utf8');
}
function loadConfig() {
  const directory = path.join(ROOT, '.poc-data/pilot');
  const config = JSON.parse(privateFile(path.join(directory, 'database.json')));
  if (config.projectRef !== PILOT_REF) throw new Error('WRONG_PILOT_PROJECT');
  const password = privateFile(path.join(directory, 'database-password.txt')).replace(/\r?\n$/, '');
  if (!password || /[\r\n]/.test(password)) throw new Error('INVALID_PASSWORD_FILE');
  return { ...config, excludedProjectRefs: ['pjnhmlhaabjqqifjixio', 'mhtybwyjublmjtldmvys'], password,
    ca: fs.readFileSync(path.join(directory, 'database-ca.crt'), 'utf8') };
}
function providerMigrations() {
  const directory = path.join(ROOT, 'supabase/migrations');
  return fs.readdirSync(directory).filter(name => /^\d{12}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
    const original = fs.readFileSync(path.join(directory, name), 'utf8');
    const sql = original.replace(/^((?:--[^\n]*\n|\s)*)begin;\s*/i, '$1').replace(/commit;\s*$/i, '');
    if (!/^((?:--[^\n]*\n|\s)*)begin;\s*/i.test(original) || !/commit;\s*$/i.test(original)) throw new Error('INVALID_MIGRATION_WRAPPER');
    return { name, sql, checksum: createHash('sha256').update(original).digest('hex') };
  });
}
async function migrateProvider(database, migrations = providerMigrations()) {
  return database.transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay:pilot:provider-migrations:v1',0))");
    await client.query('CREATE SCHEMA IF NOT EXISTS relay_private');
    await client.query('REVOKE ALL ON SCHEMA relay_private FROM PUBLIC, anon, authenticated');
    await client.query('CREATE TABLE IF NOT EXISTS relay_private.provider_schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp())');
    const applied = (await client.query('SELECT name, checksum FROM relay_private.provider_schema_migrations ORDER BY name')).rows;
    validateHistory(applied, migrations, false);
    for (const migration of migrations.slice(applied.length)) {
      if (client.exec) await client.exec(migration.sql);
      else await client.query(migration.sql);
      await client.query('INSERT INTO relay_private.provider_schema_migrations (name,checksum) VALUES ($1,$2)', [migration.name, migration.checksum]);
    }
    return migrations.length - applied.length;
  });
}
async function main(action) {
  if (!['check', 'migrate'].includes(action)) throw new Error('USAGE_CHECK_OR_MIGRATE');
  const pool = new Pool(hostedPoolOptions(loadConfig()));
  pool.on('error', () => {});
  try {
    const result = await pool.query('SELECT current_database() AS db, ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()');
    if (result.rows[0]?.db !== 'postgres' || result.rows[0]?.ssl !== true) throw new Error('TLS_DATABASE_CHECK_FAILED');
    console.log('Pilot connection: verified TLS; correct configured project.');
    const database = postgresPoolDatabase(pool);
    if (action === 'migrate') {
      const providerCount = await migrateProvider(database);
      const application = await migrate(database);
      console.log(`Applied ${providerCount} provider and ${application.applied.length} application migrations.`);
    }
    await assertCurrentSchema(database);
    const history = await pool.query('SELECT name,checksum FROM relay_private.provider_schema_migrations ORDER BY name');
    validateHistory(history.rows, providerMigrations(), true);
    const privacy = await pool.query("SELECT has_schema_privilege('anon','relay_private','USAGE') AS anon, has_schema_privilege('authenticated','relay_private','USAGE') AS authenticated");
    if (privacy.rows[0]?.anon || privacy.rows[0]?.authenticated) throw new Error('PRIVATE_SCHEMA_EXPOSED');
    console.log('Migration checksums and private schema access: verified.');
  } finally { await pool.end(); }
}
if (require.main === module) main(process.argv[2]).catch(error => {
  const code = /^[A-Z0-9_]+$/.test(error.code || '') ? error.code : 'PILOT_DATABASE_OPERATION_FAILED';
  console.error(`Pilot database check failed: ${code}. No credentials or provider details logged.`);
  process.exitCode = 1;
});
module.exports = { providerMigrations, migrateProvider };
