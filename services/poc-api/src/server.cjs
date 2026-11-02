'use strict';

const { resolve, join } = require('node:path');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { openDatabase } = require('./database.cjs');
const { openApplicationDatabase } = require('../../application/src/sqlite.cjs');
const { openLocalPostgres } = require('../../application/src/postgres.cjs');
const { createApp } = require('./app.cjs');
const { createUnifiedLocalStore } = require('./unified-store.cjs');
const { startWorker, workerHealth } = require('../../operations/src/worker.cjs');
const { createLocalRuntimeManager } = require('../../agent-runtime/src/manager.cjs');

async function start() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use the separately reviewed deployment launcher for hosting.');
  const port = Number(process.env.RELAY_POC_PORT || 4180);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port');
  const origin = `http://127.0.0.1:${port}`;
  const databasePath = resolve(process.env.RELAY_DATABASE_PATH || resolve(__dirname, '../../../.poc-data/relay.sqlite'));
  const postgresHome = resolve(process.env.RELAY_LOCAL_PG_HOME || resolve(__dirname, '../../../.poc-data/postgres'));
  const enabledFile = join(postgresHome, 'enabled.json');
  let authDb, applicationDb, native;
  try {
    if (existsSync(enabledFile)) {
      const enabled = JSON.parse(readFileSync(enabledFile, 'utf8'));
      if (enabled.backend !== 'postgres' || enabled.identityPath !== databasePath) throw new Error('Local backend configuration does not match this identity store.');
      const config = JSON.parse(readFileSync(join(postgresHome, 'runtime.json'), 'utf8'));
      native = await openLocalPostgres(config);
    } else {
      applicationDb = openApplicationDatabase(`${databasePath}.application.sqlite`);
    }
    authDb = openDatabase(databasePath);
    const modelConfigPath = resolve(__dirname, '../../../.poc-data/scoping.json');
    const modelConfig = existsSync(modelConfigPath) ? JSON.parse(readFileSync(modelConfigPath, 'utf8')) : null;
    const scopingProvider = modelConfig ? require('../../scoping/src/ollama.cjs').createOllamaProvider(modelConfig) : null;
    const paymentProvider = process.env.RELAY_STRIPE_SANDBOX_KEY
      ? require('../../payments/src/stripe-sandbox.cjs').createStripeSandbox({ secretKey: process.env.RELAY_STRIPE_SANDBOX_KEY, origin }) : null;
    const objectStore = require('../../storage/src/local-objects.cjs').localObjects(`${databasePath}.objects`);
    const scanConfigPath = resolve(__dirname, '../../../.poc-data/scanner.json');
    const scanConfig = !process.env.RELAY_CLAMSCAN_PATH && existsSync(scanConfigPath) ? JSON.parse(readFileSync(scanConfigPath, 'utf8')) : {};
    const fileScanner = require('../../storage/src/scanner.cjs').clamScanner(process.env.RELAY_CLAMSCAN_PATH || scanConfig.executable, scanConfig);
    const driveConfigPath = resolve(__dirname, '../../../.poc-data/google-drive.json');
    if (existsSync(driveConfigPath) && (statSync(driveConfigPath).mode & 0o077)) throw new Error('Drive config must be readable only by its owner');
    const driveProvider = existsSync(driveConfigPath) ? require('../../connectors/src/google-drive.cjs').createGoogleDrive({ ...JSON.parse(readFileSync(driveConfigPath, 'utf8')), origin }) : null;
    const store = await createUnifiedLocalStore({ driveProvider, objectStore, fileScanner, authDb, applicationDb, repository: native?.repository, storage: native ? 'postgres' : 'sqlite', localExecution: true, scopingProvider, paymentProvider, paymentRecoveryUserIds: (process.env.RELAY_PAYMENT_RECOVERY_USER_IDS || '').split(',').filter(Boolean) });
    const runtimeManager = createLocalRuntimeManager(origin);
    const paymentWebhookVerifier = paymentProvider && process.env.RELAY_STRIPE_WEBHOOK_SECRET
      ? require('../../payments/src/webhook.cjs').createWebhookVerifier({ secret: process.env.RELAY_STRIPE_WEBHOOK_SECRET }) : null;
    const workers = [];
    const server = createApp({ store, origin, runtimeManager, paymentWebhookVerifier,
      getWorkerHealth: () => workerHealth(workers) });
    const signatureUpdater = require('../../storage/src/signatures.cjs').startSignatureUpdater(scanConfig);
    workers.push(require('../../storage/src/worker.cjs').startScanWorker(store));
    workers.push(require('../../payments/src/worker.cjs').startPaymentWorker(store));
    let executionCursors = {}, scheduleCursor = '', appCursor = '', scopingCursor = '';
    workers.push(startWorker({ name: 'conversation-recovery', run: async () => {
      scopingCursor = (await store.reconcileScoping(scopingCursor)).next;
    } }));
    workers.push(startWorker({ name: 'execution-recovery', run: async () => {
      executionCursors = (await store.reconcileExecutions(executionCursors)).cursors;
    } }));
    workers.push(startWorker({ name: 'scheduled-tasks', run: async () => {
      scheduleCursor = (await store.reconcileSchedules(scheduleCursor)).next;
    } }));
    workers.push(startWorker({ name: 'scheduled-apps', run: async () => {
      appCursor = (await store.reconcileApps(appCursor)).next;
    } }));
    let stopping = false;
    let stopPromise;
    function shutdown() {
      if (stopping) return stopPromise;
      stopping = true;
      console.info('Relay shutdown: stopping background workers.');
      workers.forEach(worker => worker.stop());
      signatureUpdater.stop();
      runtimeManager.close();
      stopPromise = new Promise((done, reject) => {
        server.close(async () => {
          try { console.info('Relay shutdown: draining workers.'); await signatureUpdater.done(); await Promise.all(workers.map(worker => worker.done())); console.info('Relay shutdown: closing storage.'); await store.waitForScoping(); await native?.close(); applicationDb?.close(); authDb.close(); console.info('Relay shutdown: complete.'); done(); }
          catch (error) { reject(error); }
        });
        server.closeIdleConnections();
      });
      return stopPromise;
    }
    server.on('error', error => {
      console.error(`Relay failed to start (${error.code || 'UNKNOWN'}).`);
      shutdown().catch(() => {}).finally(() => { process.exitCode = 1; });
    });
    server.listen(port, '127.0.0.1', () => console.log(`Relay v1 local development\nLocal: ${origin}\nShared application backend · ${native ? 'native PostgreSQL' : 'SQLite'} tasks · local identity\nOptional CSV runtime supports explicit local test execution. Real-money payments are disabled.\nDemo and hosted staging unchanged.`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => shutdown().catch(() => { process.exitCode = 1; }));
    return { server, shutdown };
  } catch (error) {
    await native?.close(); applicationDb?.close(); authDb?.close();
    throw error;
  }
}
if (require.main === module) start().catch(() => {
  console.error('Relay startup failed. Check local storage, migration status and optional local-model/connector configuration. No fallback database was selected.');
  process.exitCode = 1;
});
module.exports = { start };
