'use strict';
const { setTimeout: delay } = require('node:timers/promises');
const { privateJson } = require('./membership-producer.cjs');
const { readConfig } = require('../../application/scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../application/src/postgres.cjs');
const { createMembershipWatchdog } = require('../src/membership-watchdog.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (
    args[0] !== '--config' ||
    ![2, 3].includes(args.length) ||
    (args.length === 3 && !['--once', '--prune'].includes(args[2]))
  )
    throw new Error('INVALID_ARGS');
  const config = privateJson(args[1]);
  if (
    Object.keys(config).sort().join(',') !== 'issuer,sourceDatabase' ||
    !/^relay_membership_source_[a-z0-9_]{1,32}$/.test(config.sourceDatabase)
  )
    throw new Error('LOCAL_CONFIG_REQUIRED');
  const local = readConfig();
  const native = await openLocalPostgres({
    ...local.runtime,
    database: config.sourceDatabase,
  });
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const watchdog = createMembershipWatchdog({
      repository: native.repository,
      issuer: config.issuer,
    });
    if (args[2] === '--prune') {
      console.log(JSON.stringify(await watchdog.prune()));
      return;
    }
    do {
      try {
        const result = await watchdog.check();
        console.log(JSON.stringify(result));
        if (args[2] === '--once' && result.active.length) process.exitCode = 2;
      } catch {
        console.error('WATCHDOG_CHECK_UNAVAILABLE');
        if (args[2] === '--once') process.exitCode = 1;
      }
      if (args[2] === '--once') break;
      try {
        await delay(15000, undefined, { signal: controller.signal });
      } catch {
        break;
      }
    } while (!controller.signal.aborted);
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await native.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Local watchdog failed. Check private configuration and database availability.',
    );
    process.exitCode = 1;
  });
module.exports = { main };
