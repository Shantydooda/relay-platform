'use strict';
const { createUnifiedManagedStore } = require('../../staging-api/src/unified-managed.cjs');
const { createMembershipProducer } = require('../../staging-api/src/membership-producer.cjs');
const { createMembershipProviderStream, postgresProviderReader } = require('../../staging-api/src/membership-provider-stream.cjs');
const { startWorker, workerHealth } = require('../../operations/src/worker.cjs');

function composePilot({ provider, repository, pool, sessionKey, membershipKey, logger = console, now = Date.now }) {
  const issuer = 'relay-pilot', keyId = 'pilot-v1';
  let producer, pendingSync;
  const sync = () => {
    if (!pendingSync) pendingSync = producer.tick().finally(() => { pendingSync = null; });
    return pendingSync;
  };
  const synchronizedProvider = { ...provider, async bootstrap(...args) {
    await provider.bootstrap(...args);
    // Wait for any earlier capture, then capture the committed bootstrap.
    if (pendingSync) await pendingSync;
    await sync();
  } };
  const managed = createUnifiedManagedStore({ provider: synchronizedProvider, repository, sessionKey, now,
    membershipFeed: { issuer, keys: { [keyId]: membershipKey } },
    applicationOptions: { localExecution: false },
  });
  let stream;
  producer = createMembershipProducer({ repository, issuer, keyId, key: membershipKey, now,
    send: event => managed.feed.receive(event), beforeRefresh: () => stream.sync(),
  });
  stream = createMembershipProviderStream({ repository, producer, issuer, now, readPage: postgresProviderReader(pool) });
  const workers = [];
  let closed = false;
  return {
    store: managed.store,
    async start() {
      if (closed || workers.length) throw new Error('PILOT_ALREADY_STARTED_OR_CLOSED');
      // Fail startup if trusted state cannot be read. No stale grant is refreshed.
      await sync();
      workers.push(startWorker({ name: 'membership-sync', run: sync, logger }));
      let cursor = '';
      workers.push(startWorker({ name: 'conversation-recovery', logger, run: async () => {
        cursor = (await managed.store.reconcileScoping(cursor)).next;
      } }));
    },
    health: () => workerHealth(workers),
    async close() {
      closed = true;
      workers.forEach(worker => worker.stop());
      await Promise.all(workers.map(worker => worker.done()));
    },
  };
}
module.exports = { composePilot };
