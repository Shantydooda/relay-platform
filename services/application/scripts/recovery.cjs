'use strict';

const { DatabaseSync, backup } = require('node:sqlite');
const { mkdirSync, readFileSync, chmodSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const net = require('node:net');
const { paths, readConfig, utility, savePrivate, adminPool, ROOT } = require('./local-postgres.cjs');
const { openLocalPostgres, localPool } = require('../src/postgres.cjs');
const { importSnapshot, readSqliteSnapshot } = require('../src/cutover.cjs');
const { assertCurrentSchema, migrate, validateHistory, loadMigrations } = require('../src/migrations.cjs');
const { postgresPoolDatabase } = require('../src/repository.cjs');

function fileHash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
async function assertAppStopped(port = 4180) {
  const listening = await new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
  if (listening) throw new Error('Stop the local application before cutover or paired identity/application backup.');
}
async function sqliteCopy(source, destination) {
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed.');
    await backup(db, destination);
    chmodSync(destination, 0o600);
  } finally { db.close(); }
}
function pgEnvironment(connection) {
  return { ...process.env, PGHOST: connection.host, PGPORT: String(connection.port), PGUSER: connection.user,
    PGPASSWORD: connection.password, PGDATABASE: connection.database, PGCONNECT_TIMEOUT: '5', PGOPTIONS: '' };
}
async function backupPair(config, identityPath, directory) {
  mkdirSync(directory, { mode: 0o700 });
  const identity = join(directory, 'identity.sqlite'), dump = join(directory, 'application.dump');
  await sqliteCopy(identityPath, identity);
  utility('pg_dump', ['--format=custom', '--no-owner', '--no-acl', '--file', dump], { env: pgEnvironment(config.migrator) });
  chmodSync(dump, 0o600);
  const pool = localPool(config.migrator);
  let records;
  try { records = (await pool.query('SELECT kind, count(*)::integer AS count FROM relay_private.relay_v1_documents GROUP BY kind ORDER BY kind')).rows; }
  finally { await pool.end(); }
  const objects = require('../../storage/src/backup.cjs').snapshotObjects(`${identityPath}.objects`, join(directory, 'objects'));
  savePrivate(join(directory, 'manifest.json'), {
    version: 2, objects, createdAt: new Date().toISOString(), sourceDatabase: config.runtime.database,
    identitySha256: fileHash(identity), applicationSha256: fileHash(dump), records,
    note: 'Offline paired local backup. Credentials are deliberately excluded. Restore into a fresh database and identity directory.'
  });
  return directory;
}
async function restorePair(config, directory, database, identityDestination) {
  if (!/^relay_restore_[a-z0-9_]{1,48}$/.test(database)) throw new Error('Restore requires a new isolated relay_restore_ database.');
  if (existsSync(identityDestination)) throw new Error('Restore never overwrites an existing identity store.');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (![1, 2].includes(manifest.version) || fileHash(join(directory, 'identity.sqlite')) !== manifest.identitySha256 || fileHash(join(directory, 'application.dump')) !== manifest.applicationSha256) {
    throw new Error('Backup integrity check failed.');
  }
  const { verifyObjects, snapshotObjects } = require('../../storage/src/backup.cjs');
  if (manifest.version === 2) verifyObjects(join(directory, 'objects'), manifest.objects);
  if (existsSync(`${identityDestination}.objects`)) throw new Error('Restore never overwrites object storage.');
  const admin = adminPool(config);
  try {
    // The validated identifier is generated locally, never supplied by an API.
    await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  } finally { await admin.end(); }
  const connection = { ...config.migrator, database };
  utility('pg_restore', ['--exit-on-error', '--single-transaction', '--no-owner', '--no-acl', '--dbname', database, join(directory, 'application.dump')], { env: pgEnvironment(connection) });
  const pool = localPool(connection);
  try {
    await pool.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
    await pool.query('REVOKE ALL ON SCHEMA relay_private FROM PUBLIC');
    await pool.query('REVOKE ALL ON ALL TABLES IN SCHEMA relay_private FROM PUBLIC');
    await pool.query('GRANT USAGE ON SCHEMA relay_private TO relay_app');
    await pool.query('GRANT SELECT ON relay_private.schema_migrations TO relay_app');
    await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON relay_private.relay_v1_documents, relay_private.relay_v1_receipts TO relay_app');
    const history = (await pool.query('SELECT name, checksum FROM relay_private.schema_migrations ORDER BY name')).rows;
    validateHistory(history, loadMigrations(), false);
    const records = (await pool.query('SELECT kind, count(*)::integer AS count FROM relay_private.relay_v1_documents GROUP BY kind ORDER BY kind')).rows;
    if (JSON.stringify(records) !== JSON.stringify(manifest.records)) throw new Error('Restored record counts differ from backup.');
    // Validate the original snapshot before any reviewed forward data migration.
    await migrate(postgresPoolDatabase(pool));
    await assertCurrentSchema(postgresPoolDatabase(pool));
  } finally { await pool.end(); }
  if (manifest.version === 2 && existsSync(join(directory, 'objects'))) snapshotObjects(join(directory, 'objects'), `${identityDestination}.objects`);
  await sqliteCopy(join(directory, 'identity.sqlite'), identityDestination);
  return { ...config.runtime, database };
}
async function cutover(config, identityPath) {
  const p = paths(config.home);
  const source = `${identityPath}.application.sqlite`;
  if (!existsSync(source)) throw new Error('Canonical SQLite source is missing.');
  const before = join(p.home, `before-cutover-${Date.now()}`);
  mkdirSync(before, { mode: 0o700 });
  await sqliteCopy(identityPath, join(before, 'identity.sqlite'));
  await sqliteCopy(source, join(before, 'application.sqlite'));
  const db = new DatabaseSync(join(before, 'application.sqlite'), { readOnly: true });
  let snapshot;
  try { snapshot = readSqliteSnapshot(db); } finally { db.close(); }
  const native = await openLocalPostgres(config.runtime);
  try {
    const result = await importSnapshot(native.repository, snapshot);
    // Verify the entire imported payload and receipt, not only the record count.
    await native.repository.read(async repo => {
      for (const row of snapshot.documents) {
        if (JSON.stringify(await repo.get(row.kind, row.id)) !== JSON.stringify(JSON.parse(row.payload))) throw new Error('Imported document mismatch.');
      }
      for (const row of snapshot.receipts) {
        const receipt = await repo.receipt(row.actor_id, row.request_key);
        if (receipt?.fingerprint !== row.fingerprint || JSON.stringify(receipt.result) !== JSON.stringify(JSON.parse(row.response))) throw new Error('Imported receipt mismatch.');
      }
    });
    if (!existsSync(p.enabled)) savePrivate(p.enabled, { backend: 'postgres', identityPath: resolve(identityPath), sourceDigest: snapshot.digest });
    return result;
  } finally { await native.close(); }
}
async function main() {
  const action = process.argv[2], config = readConfig(), p = paths(config.home);
  const identityPath = resolve(process.env.RELAY_DATABASE_PATH || join(ROOT, '.poc-data/relay.sqlite'));
  if (action === 'cutover') {
    await assertAppStopped();
    const result = await cutover(config, identityPath);
    console.log(`Local PostgreSQL cutover verified: ${result.documents} records and ${result.receipts} retry receipts preserved. Existing identities unchanged.`);
  } else if (action === 'backup') {
    await assertAppStopped();
    const destination = join(p.home, `backup-${Date.now()}`);
    await backupPair(config, identityPath, destination);
    console.log(`Paired local backup saved: ${destination}`);
  } else if (action === 'restore') {
    const directory = process.argv[3];
    if (!directory) throw new Error('Provide the local backup directory.');
    const destination = join(p.home, `restored-${Date.now()}`);
    mkdirSync(destination, { mode: 0o700 });
    const connection = await restorePair(config, resolve(directory), `relay_restore_${randomUUID().replaceAll('-', '')}`, join(destination, 'identity.sqlite'));
    savePrivate(join(destination, 'runtime.json'), connection);
    console.log(`Verified isolated restore saved: ${destination}. Main local data was not replaced.`);
  } else throw new Error('Use cutover, backup or restore.');
}
if (require.main === module) main().catch(() => { console.error('Local recovery operation failed safely. Check app shutdown, backup integrity and local database configuration. Existing stores were not replaced.'); process.exitCode = 1; });
module.exports = { assertAppStopped, backupPair, restorePair, cutover, fileHash };
