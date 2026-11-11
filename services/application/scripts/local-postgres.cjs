'use strict';

// Local operations only. No hosted URLs, provider credentials or demo data are
// accepted here. PostgreSQL utilities must already be installed on the machine.
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes, createHash } = require('node:crypto');
const { Pool } = require('pg');
const { localPool } = require('../src/postgres.cjs');
const { postgresPoolDatabase } = require('../src/repository.cjs');
const { migrate } = require('../src/migrations.cjs');

const ROOT = resolve(__dirname, '../../..');
function paths(home = process.env.RELAY_LOCAL_PG_HOME || join(ROOT, '.poc-data/postgres')) {
  const directory = resolve(home);
  const suffix = createHash('sha256').update(directory).digest('hex').slice(0, 12);
  return {
    home: directory, data: join(directory, 'data'), config: join(directory, 'admin.json'),
    runtime: join(directory, 'runtime.json'), enabled: join(directory, 'enabled.json'),
    socket: join(tmpdir(), `relay-pg-${suffix}`), log: join(directory, 'postgres.log')
  };
}
function savePrivate(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
}
function binary(name) {
  const bindir = execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim();
  return join(bindir, name);
}
function utility(name, args, options = {}) {
  return execFileSync(binary(name), args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
function adminPool(config, database = 'postgres') {
  const p = paths(config.home);
  return new Pool({ host: p.socket, port: config.port, user: 'relay_local_admin', database, max: 2, connectionTimeoutMillis: 3000 });
}
function readConfig(home) {
  const config = JSON.parse(readFileSync(paths(home).config, 'utf8'));
  if (config.host !== '127.0.0.1') throw new Error('Local operations cannot target a remote database.');
  return config;
}
function startCluster(home) {
  const config = readConfig(home), p = paths(config.home);
  mkdirSync(p.socket, { recursive: true, mode: 0o700 });
  chmodSync(p.socket, 0o700);
  try { utility('pg_ctl', ['-D', p.data, 'status']); return; } catch { /* Stopped cluster. */ }
  utility('pg_ctl', ['-D', p.data, '-l', p.log, '-w', '-t', '30', 'start']);
}
function stopCluster(home, mode = 'fast') {
  const p = paths(home);
  utility('pg_ctl', ['-D', p.data, '-m', mode, '-w', '-t', '30', 'stop']);
}
async function migrateLocal(config) {
  const pool = localPool(config.migrator);
  try {
    const result = await migrate(postgresPoolDatabase(pool));
    // Grants are explicit provisioning, separate from immutable SQL history.
    // Runtime can inspect history but cannot change it or own any objects.
    await pool.query('GRANT USAGE ON SCHEMA relay_private TO relay_app');
    await pool.query('GRANT SELECT ON relay_private.schema_migrations TO relay_app');
    await pool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON relay_private.relay_v1_documents, relay_private.relay_v1_receipts TO relay_app');
    return result;
  } finally { await pool.end(); }
}
async function setup({ home, port = 55432 } = {}) {
  const p = paths(home);
  if (existsSync(p.config)) {
    startCluster(p.home);
    const config = readConfig(p.home);
    // Do not report success for a partially provisioned previous attempt.
    // Existing credentials are retained; missing roles/databases fail closed.
    await migrateLocal(config);
    if (!existsSync(p.runtime)) savePrivate(p.runtime, config.runtime);
    return config;
  }
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local database port.');
  mkdirSync(p.home, { recursive: true, mode: 0o700 });
  chmodSync(p.home, 0o700);
  mkdirSync(p.socket, { recursive: true, mode: 0o700 });
  chmodSync(p.socket, 0o700);
  if (existsSync(p.data)) throw new Error('Unconfigured PostgreSQL data exists. Inspect it instead of overwriting it.');
  utility('initdb', ['-D', p.data, '-U', 'relay_local_admin', '--auth-local=trust', '--auth-host=scram-sha-256', '--no-locale', '-E', 'UTF8']);
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  writeFileSync(join(p.data, 'postgresql.auto.conf'), [
    "listen_addresses = '127.0.0.1'", `port = ${port}`,
    `unix_socket_directories = ${literal(p.socket)}`, "password_encryption = 'scram-sha-256'",
    "log_statement = 'none'", "log_min_error_statement = 'panic'", "log_parameter_max_length_on_error = 0"
  ].join('\n') + '\n', { mode: 0o600 });
  const connection = { host: '127.0.0.1', port, database: 'relay_local' };
  const config = {
    home: p.home, host: connection.host, port,
    migrator: { ...connection, user: 'relay_migrator', password: randomBytes(32).toString('base64url') },
    runtime: { ...connection, user: 'relay_app', password: randomBytes(32).toString('base64url') }
  };
  savePrivate(p.config, config);
  startCluster(p.home);
  const admin = adminPool(config);
  try {
    await admin.query(`CREATE ROLE relay_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(config.migrator.password)}`);
    await admin.query(`CREATE ROLE relay_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD ${literal(config.runtime.password)}`);
    await admin.query('CREATE DATABASE relay_local OWNER relay_migrator');
    await admin.query('REVOKE ALL ON DATABASE relay_local FROM PUBLIC');
    await admin.query('GRANT CONNECT ON DATABASE relay_local TO relay_app');
  } finally { await admin.end(); }
  const owner = localPool(config.migrator);
  try { await owner.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC'); }
  finally { await owner.end(); }
  await migrateLocal(config);
  savePrivate(p.runtime, config.runtime);
  return config;
}

async function main() {
  const action = process.argv[2];
  if (action === 'setup') {
    await setup();
    console.log('Local PostgreSQL initialized, restricted roles provisioned and migrations applied. Local app has not been switched yet.');
  } else if (action === 'start') { startCluster(); console.log('Local PostgreSQL is running on loopback.'); }
  else if (action === 'stop') { stopCluster(); console.log('Local PostgreSQL stopped.'); }
  else if (action === 'migrate') {
    const result = await migrateLocal(readConfig());
    console.log(`Local migrations current: ${result.current}; applied ${result.applied.length}.`);
  } else throw new Error('Use setup, start, stop or migrate.');
}
if (require.main === module) main().catch(() => { console.error('Local PostgreSQL operation failed. No hosted services were contacted. Inspect local configuration and PostgreSQL logs.'); process.exitCode = 1; });
module.exports = { ROOT, paths, savePrivate, utility, adminPool, readConfig, setup, startCluster, stopCluster, migrateLocal };
