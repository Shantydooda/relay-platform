'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { adminPool, paths, utility } = require('./local-postgres.cjs');
const roles = ['provider', 'source', 'receiver'];
const hash = (file) =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function env(config, database) {
  return {
    ...process.env,
    PGHOST: paths(config.home).socket,
    PGPORT: String(config.port),
    PGUSER: 'relay_local_admin',
    PGDATABASE: database,
    PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '',
  };
}
function validate(databases, restore = false) {
  if (
    Object.keys(databases).sort().join(',') !== 'provider,receiver,source' ||
    new Set(Object.values(databases)).size !== 3
  )
    throw new Error('THREE_DATABASES_REQUIRED');
  for (const role of roles)
    if (
      !(
        restore
          ? /^relay_restore_[a-z0-9_]{1,40}$/
          : /^relay_(provider_fixture|membership_source|membership_receiver)_[a-z0-9_]{1,32}$/
      ).test(databases[role])
    )
      throw new Error('ISOLATED_DATABASE_REQUIRED');
}
async function backupMembership(config, databases, directory) {
  validate(databases);
  fs.mkdirSync(directory, { mode: 0o700 });
  const pools = [],
    clients = [];
  try {
    // Freeze writes across all three stores before taking any dump. These locks
    // are local fixture/operator operations, never attached to the running app.
    for (const role of roles) {
      const pool = adminPool(config, databases[role]);
      pools.push(pool);
      const client = await pool.connect();
      clients.push(client);
      await client.query('begin');
      await client.query("set local lock_timeout='5s'");
      const tables =
        role === 'provider'
          ? 'public.relay_memberships,public.relay_tenants,public.relay_membership_clock,public.relay_membership_versions,public.relay_membership_changes,public.relay_membership_consumers,public.relay_membership_retirement_audit'
          : 'relay_private.relay_v1_documents,relay_private.relay_v1_receipts';
      await client.query(`lock table ${tables} in share mode`);
    }
    const manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      files: {},
    };
    for (const role of roles) {
      const file = path.join(directory, role + '.dump');
      utility(
        'pg_dump',
        ['--format=custom', '--no-owner', '--no-acl', '--file', file],
        { env: env(config, databases[role]) },
      );
      fs.chmodSync(file, 0o600);
      manifest.files[role] = hash(file);
    }
    fs.writeFileSync(
      path.join(directory, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      { mode: 0o600, flag: 'wx' },
    );
    return manifest;
  } finally {
    for (const client of clients) {
      try {
        await client.query('rollback');
      } finally {
        client.release();
      }
    }
    for (const pool of pools) await pool.end();
  }
}
async function restoreMembership(config, directory, databases) {
  validate(databases, true);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'),
  );
  if (
    manifest.version !== 1 ||
    Object.keys(manifest.files || {})
      .sort()
      .join(',') !== 'provider,receiver,source'
  )
    throw new Error('INVALID_MANIFEST');
  for (const role of roles) {
    const file = path.join(directory, role + '.dump');
    if (
      !fs.lstatSync(file).isFile() ||
      fs.lstatSync(file).isSymbolicLink() ||
      hash(file) !== manifest.files[role]
    )
      throw new Error('BACKUP_INTEGRITY_FAILED');
  }
  const admin = adminPool(config);
  try {
    for (const name of Object.values(databases)) {
      if (
        (
          await admin.query('select 1 from pg_database where datname=$1', [
            name,
          ])
        ).rows.length
      )
        throw new Error('RESTORE_TARGET_EXISTS');
    }
    for (const role of roles) {
      await admin.query(`create database ${databases[role]}`);
      await admin.query(
        `revoke all on database ${databases[role]} from public`,
      );
      utility(
        'pg_restore',
        [
          '--exit-on-error',
          '--single-transaction',
          '--no-owner',
          '--no-acl',
          '--dbname',
          databases[role],
          path.join(directory, role + '.dump'),
        ],
        { env: env(config, databases[role]) },
      );
    }
    return { status: 'restored-isolated', databases };
  } finally {
    await admin.end();
  }
}
module.exports = { backupMembership, restoreMembership };

async function main() {
  const [action, file, directory, ...extra] = process.argv.slice(2);
  if (
    !['backup', 'restore'].includes(action) ||
    !file ||
    !directory ||
    extra.length
  )
    throw new Error('INVALID_ARGS');
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.size > 65536
  )
    throw new Error('PRIVATE_CONFIG_REQUIRED');
  const databases = JSON.parse(fs.readFileSync(file, 'utf8'));
  const config = require('./local-postgres.cjs').readConfig();
  const result =
    action === 'backup'
      ? await backupMembership(config, databases, path.resolve(directory))
      : await restoreMembership(config, path.resolve(directory), databases);
  console.log(
    JSON.stringify({
      status: action === 'backup' ? 'backup-created' : result.status,
    }),
  );
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Membership backup/restore refused. Check isolated local targets, private config and backup integrity. Existing databases are never overwritten.',
    );
    process.exitCode = 1;
  });
