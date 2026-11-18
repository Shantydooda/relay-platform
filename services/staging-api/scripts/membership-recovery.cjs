'use strict';
const { Pool } = require('pg');
const { privateJson } = require('./membership-producer.cjs');
const { readConfig } = require('../../application/scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../application/src/postgres.cjs');
const {
  createLocalMembershipRecovery,
} = require('../src/membership-recovery.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (
    args[0] !== '--config' ||
    !(
      (args.length === 3 && args[2] === '--review') ||
      (args.length === 4 && args[2] === '--retire')
    )
  )
    throw new Error('INVALID_ARGS');
  const config = privateJson(args[1]);
  if (
    Object.keys(config).sort().join(',') !==
      'consumerId,issuer,providerDatabase,sourceDatabase' ||
    !/^relay_membership_source_[a-z0-9_]{1,32}$/.test(config.sourceDatabase) ||
    !/^relay_provider_fixture_[a-z0-9_]{1,32}$/.test(config.providerDatabase)
  )
    throw new Error('LOCAL_CONFIG_REQUIRED');
  const local = readConfig();
  const source = await openLocalPostgres({
    ...local.runtime,
    database: config.sourceDatabase,
  });
  const pool = new Pool({
    ...local.migrator,
    database: config.providerDatabase,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    query_timeout: 8000,
  });
  try {
    const recovery = createLocalMembershipRecovery({
      pool,
      repository: source.repository,
      issuer: config.issuer,
      consumerId: config.consumerId,
    });
    const result =
      args[2] === '--review'
        ? await recovery.review()
        : await recovery.retire(privateJson(args[3]));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
    await source.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Recovery command refused. Check local operator permissions, private inputs and current review.',
    );
    process.exitCode = 1;
  });
module.exports = { main };
