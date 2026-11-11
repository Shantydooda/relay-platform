'use strict';
const { loadConfig } = require('./config.cjs');
const { composePilot } = require('./composition.cjs');
const { createProvider } = require('../../staging-api/src/provider.cjs');
const { openHostedPostgres } = require('../../application/src/hosted-postgres.cjs');
const { closeHttpServer } = require('../../operations/src/http-shutdown.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
async function start() {
  const config = loadConfig();
  const database = await openHostedPostgres(config.database);
  let pilot;
  try {
    const provider = createProvider(config);
    await provider.ready();
    pilot = composePilot({ ...config, provider, repository: database.repository, pool: database.pool });
    await pilot.start();
    const server = createApp({ origin: config.origin, store: pilot.store, mode: 'managed-pilot' });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, '0.0.0.0', resolve);
    });
    console.info('Relay private pilot listening. Payments and supplier execution disabled.');
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await closeHttpServer(server);
      await pilot.close();
      await database.close();
    };
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
      shutdown().catch(() => { console.error('Pilot shutdown failed.'); process.exitCode = 1; });
    });
  } catch (error) {
    await pilot?.close();
    await database.close();
    throw error;
  }
}
if (require.main === module) start().catch(() => {
  console.error('Pilot startup failed. Check dedicated configuration and migrations.');
  process.exitCode = 1;
});
module.exports = { start };
