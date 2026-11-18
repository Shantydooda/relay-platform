'use strict';

// Socket completion and command completion are different: disconnecting a
// client must not close storage while its authorized command is still settling.
function trackRequests(handler) {
  const pending = new Set();
  return {
    handle(req, res) {
      const work = Promise.resolve().then(() => handler(req, res));
      pending.add(work);
      work.then(
        () => pending.delete(work),
        () => { pending.delete(work); res.destroy(); },
      );
    },
    async drain() {
      while (pending.size) await Promise.allSettled([...pending]);
    },
  };
}

async function closeHttpServer(server, { graceMs = 5000 } = {}) {
  if (!Number.isInteger(graceMs) || graceMs < 0) throw new Error('Invalid shutdown grace period');
  let timer;
  try {
    await new Promise((resolve, reject) => {
      // Start closing before reaping sockets, so reconnects cannot race cleanup.
      server.close(error => {
        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      });
      server.closeIdleConnections();
      timer = setTimeout(() => server.closeAllConnections(), graceMs);
    });
    await server.drainRequests?.();
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { trackRequests, closeHttpServer };
