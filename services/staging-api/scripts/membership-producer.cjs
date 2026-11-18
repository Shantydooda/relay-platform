'use strict';
const fs = require('node:fs');
const {
  createLocalProviderRetention,
} = require('../src/membership-retention.cjs');
const { createMembershipAlerts } = require('../src/membership-alerts.cjs');
const { Pool } = require('pg');
const {
  createMembershipProviderStream,
  localProviderReader,
} = require('../src/membership-provider-stream.cjs');
const { createMembershipMonitor } = require('../src/membership-monitor.cjs');
const { createMembershipProducer } = require('../src/membership-producer.cjs');
const {
  localMembershipTransport,
} = require('../src/membership-producer-http.cjs');
const { readConfig } = require('../../application/scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../application/src/postgres.cjs');
function privateJson(file) {
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.size > 65536
  )
    throw new Error('PRIVATE_FILE_REQUIRED');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function configFrom(file) {
  const c = privateJson(file);
  if (
    Object.keys(c)
      .filter((key) => !['providerDatabase', 'providerConsumer'].includes(key))
      .sort()
      .join(',') !== 'endpoint,issuer,keyBase64,keyId,sourceDatabase' ||
    (c.providerConsumer !== undefined &&
      (!c.providerDatabase ||
        !/^[a-z0-9_-]{1,64}$/.test(c.providerConsumer))) ||
    typeof c.sourceDatabase !== 'string' ||
    !/^relay_membership_source_[a-z0-9_]{1,32}$/.test(c.sourceDatabase) ||
    typeof c.keyBase64 !== 'string' ||
    (c.providerDatabase !== undefined &&
      !/^relay_provider_fixture_[a-z0-9_]{1,32}$/.test(c.providerDatabase))
  )
    throw new Error('INVALID_PRODUCER_CONFIG');
  const key = Buffer.from(c.keyBase64, 'base64');
  if (key.length !== 32 || key.toString('base64') !== c.keyBase64)
    throw new Error('INVALID_PRODUCER_KEY');
  const send = localMembershipTransport(c.endpoint);
  return { ...c, key, send };
}
async function main() {
  const args = process.argv.slice(2);
  if (
    ![2, 3, 4].includes(args.length) ||
    args[0] !== '--config' ||
    (args.length === 3 && !['--summary', '--alerts'].includes(args[2])) ||
    (args.length === 4 && !['--bootstrap', '--status'].includes(args[2]))
  )
    throw new Error('CONFIG_REQUIRED');
  const c = configFrom(args[1]),
    local = readConfig();
  if (c.sourceDatabase === local.runtime.database)
    throw new Error('SEPARATE_SOURCE_DATABASE_REQUIRED');
  const records = args[2] === '--bootstrap' ? privateJson(args[3]) : null;
  const native = await openLocalPostgres({
    ...local.runtime,
    database: c.sourceDatabase,
  });
  const providerPool = c.providerDatabase
    ? new Pool({
        ...local.runtime,
        database: c.providerDatabase,
        max: 2,
        connectionTimeoutMillis: 3000,
        statement_timeout: 5000,
        query_timeout: 8000,
      })
    : null;
  const controller = new AbortController(),
    stop = () => controller.abort();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    let stream;
    const retention = c.providerConsumer
      ? createLocalProviderRetention({
          pool: providerPool,
          repository: native.repository,
          issuer: c.issuer,
          consumerId: c.providerConsumer,
        })
      : null;
    const producer = createMembershipProducer({
      repository: native.repository,
      issuer: c.issuer,
      keyId: c.keyId,
      key: c.key,
      send: c.send,
      beforeRefresh: providerPool
        ? async () => {
            await stream.sync();
            if (retention) await retention.acknowledge();
          }
        : undefined,
    });
    if (providerPool)
      stream = createMembershipProviderStream({
        repository: native.repository,
        producer,
        issuer: c.issuer,
        readPage: localProviderReader(providerPool),
      });
    const monitor = createMembershipMonitor({
      repository: native.repository,
      issuer: c.issuer,
    });
    const alerts = createMembershipAlerts({
      repository: native.repository,
      issuer: c.issuer,
    });
    if (args[2] === '--alerts') {
      console.log(JSON.stringify(await alerts.read(), null, 2));
      return;
    }
    if (args[2] === '--summary') {
      console.log(
        JSON.stringify(
          await createMembershipMonitor({
            repository: native.repository,
            issuer: c.issuer,
          }).summary(),
          null,
          2,
        ),
      );
      return;
    }
    if (records && providerPool) throw new Error('PROVIDER_OWNS_BOOTSTRAP');
    if (args[2] === '--status') {
      console.log(JSON.stringify(await producer.inspect(args[3]), null, 2));
      return;
    }
    if (records) await producer.bootstrap(records);
    console.log(
      'Local membership producer running. No hosted provider or payment connection.',
    );
    await producer.run({
      signal: controller.signal,
      onError: (code) => console.error(code),
      afterTick: async () => {
        try {
          await alerts.evaluate(await monitor.summary());
        } catch {
          await alerts.unavailable();
        }
      },
    });
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    await providerPool?.end();
    await native.close();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Membership producer stopped. Check private local configuration, migrations and receiver availability.',
    );
    process.exitCode = 1;
  });
module.exports = { privateJson, configFrom };
