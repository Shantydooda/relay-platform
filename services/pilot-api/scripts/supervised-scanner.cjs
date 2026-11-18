'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { supervisedConfig, privateText, DIRECTORY } = require('../src/supervised-config.cjs');
const { startSupervisedScanner } = require('../src/supervised-scanner.cjs');
const { openHostedPostgres } = require('../../application/src/hosted-postgres.cjs');
const { pilotObjects } = require('../../storage/src/pilot-objects.cjs');
const { clamScanner } = require('../../storage/src/scanner.cjs');

async function start() {
  const config = supervisedConfig();
  const scannerConfig = JSON.parse(privateText(path.join(DIRECTORY, 'scanner.json')));
  const fileScanner = clamScanner(scannerConfig.executable, scannerConfig);
  const objectStore = pilotObjects({ projectRef: config.database.projectRef, secret: config.secretKey });
  const database = await openHostedPostgres(config.database);
  let worker, stopping = false;
  const healthFile = path.join(DIRECTORY, 'scanner-health.json');
  function record() {
    const temporary = `${healthFile}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ environment: 'private-pilot', checkedAt: Date.now(), ...worker.health() }), { mode: 0o600 });
    fs.renameSync(temporary, healthFile);
  }
  try {
    worker = await startSupervisedScanner({ repository: database.repository, objectStore, fileScanner });
    // Keep this explicitly supervised process alive, even while its DB pool is
    // idle. A dead process leaves an aging timestamp, never a fresh health claim.
    const timer = setInterval(record, 5000);
    record();
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(timer);
      worker.stop();
      await worker.done();
      record();
      await database.close();
    };
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
      stop().catch(() => { console.error('Pilot scanner shutdown failed.'); process.exitCode = 1; });
    });
    console.info('Supervised pilot scanner running. Files wait safely when this process is offline.');
  } catch {
    worker?.stop();
    await worker?.done();
    await database.close();
    throw new Error('PILOT_SCANNER_STARTUP_FAILED');
  }
}
if (require.main === module) start().catch(() => {
  console.error('Pilot scanner could not start. Check private configuration, signatures and pilot storage.');
  process.exitCode = 1;
});
module.exports = { start };
