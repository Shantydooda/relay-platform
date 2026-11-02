'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { readConfig, ROOT, paths } = require('./local-postgres.cjs');
const { openLocalPostgres } = require('../src/postgres.cjs');
const { inspectStorage } = require('../../storage/src/reconcile.cjs');
async function main() {
  const identity = resolve(
    process.env.RELAY_DATABASE_PATH || resolve(ROOT, '.poc-data/relay.sqlite'),
  );
  const enabled = JSON.parse(readFileSync(paths().enabled, 'utf8'));
  if (enabled.backend !== 'postgres' || enabled.identityPath !== identity)
    throw new Error('Local backend mismatch');
  const connection = await openLocalPostgres(readConfig().runtime);
  try {
    console.log(
      JSON.stringify(
        await inspectStorage(connection.repository, `${identity}.objects`),
        null,
        2,
      ),
    );
  } finally {
    await connection.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Storage inspection failed. Check local database and storage configuration. No files were removed.',
    );
    process.exitCode = 1;
  });
