'use strict';

const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');

const MIGRATION_DIRECTORY = join(__dirname, '../migrations');
const MIGRATION_LOCK = 'relay:application:migrations:v1';

function loadMigrations(directory = MIGRATION_DIRECTORY) {
  return readdirSync(directory).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}

function validateHistory(applied, migrations, requireCurrent) {
  if (applied.length > migrations.length) throw new Error('Database schema is newer than this application.');
  for (let index = 0; index < applied.length; index++) {
    if (applied[index].name !== migrations[index]?.name || applied[index].checksum !== migrations[index].checksum) {
      throw new Error('Migration history differs from source. Restore reviewed migration files; never rewrite applied history.');
    }
  }
  if (requireCurrent && applied.length !== migrations.length) throw new Error('Database migrations are pending. Run the migration command before starting Relay.');
}

// One transaction and a database-wide advisory lock: concurrent runners cannot
// apply the same migration twice, and any failed SQL rolls back the whole batch.
async function migrate(database, migrations = loadMigrations()) {
  return database.transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [MIGRATION_LOCK]);
    await client.query('CREATE SCHEMA IF NOT EXISTS relay_private');
    await client.query('REVOKE ALL ON SCHEMA relay_private FROM PUBLIC');
    await client.query(`CREATE TABLE IF NOT EXISTS relay_private.schema_migrations (
      name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
    )`);
    const applied = (await client.query('SELECT name, checksum FROM relay_private.schema_migrations ORDER BY name')).rows;
    validateHistory(applied, migrations, false);
    for (const migration of migrations.slice(applied.length)) {
      // Native pg supports a simple multi-statement query; embedded Postgres
      // exposes that same operation as exec rather than its prepared query API.
      if (typeof client.exec === 'function') await client.exec(migration.sql);
      else await client.query(migration.sql);
      await client.query('INSERT INTO relay_private.schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
    }
    return { applied: migrations.slice(applied.length).map(item => item.name), current: migrations.at(-1)?.name || null };
  });
}

async function assertCurrentSchema(database) {
  const applied = await database.transaction(async client => (await client.query('SELECT name, checksum FROM relay_private.schema_migrations ORDER BY name')).rows);
  validateHistory(applied, loadMigrations(), true);
}

module.exports = { migrate, assertCurrentSchema, loadMigrations, validateHistory };
