'use strict';
const { startWorker } = require('../../operations/src/worker.cjs');
// Durable retries and payment decisions remain in the application store.
function startPaymentWorker(store, options = {}) {
  return startWorker({
    name: 'payment-reconciliation',
    run: () => store.reconcilePayments(),
    intervalMs: 5000,
    staleAfterMs: 120000,
    ...options,
  });
}
module.exports = { startPaymentWorker };
