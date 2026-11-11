'use strict';
const { fork } = require('node:child_process');
const { resolve } = require('node:path');
const { fail } = require('../../../packages/contracts/src/input.cjs');

function createLocalRuntimeManager(origin) {
  const processes = new Map();
  return {
    assertCapacity(agentId) {
      if (!processes.has(agentId) && processes.size >= 8) fail(429, 'RUNTIME_CAPACITY', 'This local server supports at most eight connected runtimes.');
    },
    start(agentId, token) {
      this.assertCapacity(agentId);
      processes.get(agentId)?.kill('SIGTERM');
      const worker = fork(resolve(__dirname, 'worker.cjs'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {}, execArgv: ['--max-old-space-size=64'] });
      processes.set(agentId, worker);
      worker.once('exit', () => { if (processes.get(agentId) === worker) processes.delete(agentId); });
      worker.on('error', () => { processes.delete(agentId); });
      worker.send({ origin, token });
    },
    stop(agentId) { processes.get(agentId)?.kill('SIGTERM'); processes.delete(agentId); },
    close() { for (const worker of processes.values()) worker.kill('SIGTERM'); processes.clear(); }
  };
}
module.exports = { createLocalRuntimeManager };
