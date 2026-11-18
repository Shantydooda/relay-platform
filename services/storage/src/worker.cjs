'use strict';
const { startWorker } = require('../../operations/src/worker.cjs');
function startScanWorker(store, options = {}) {
  return startWorker({
    name: 'file-scanning',
    run: () => store.reconcileFileScans(),
    intervalMs: 2000,
    staleAfterMs: 300000,
    ...options,
  });
}
module.exports = { startScanWorker };
