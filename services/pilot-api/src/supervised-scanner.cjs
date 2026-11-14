'use strict';
const { createApplication } = require('../../application/src/service.cjs');
const { startScanWorker } = require('../../storage/src/worker.cjs');

async function verifyScanner(scanner) {
  const clean = await scanner.scan(Buffer.from('company,city\nExample,Berlin\n'));
  if (clean.status !== 'clean') throw new Error('SCANNER_CLEAN_SELF_TEST_FAILED');
  // Standard harmless antivirus test string. Never written into buyer files.
  const test = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  if ((await scanner.scan(test)).status !== 'blocked') throw new Error('SCANNER_DETECTION_SELF_TEST_FAILED');
}
async function startSupervisedScanner({ repository, objectStore, fileScanner, workerOptions = {} }) {
  await objectStore.verifyBucket();
  await verifyScanner(fileScanner);
  const application = createApplication({ repository, objectStore, fileScanner });
  // No HTTP listener, signup, payment reconciliation or agent execution. This
  // process only advances durable file scan claims for the dedicated pilot DB.
  return startScanWorker(application, workerOptions);
}
module.exports = { verifyScanner, startSupervisedScanner };
