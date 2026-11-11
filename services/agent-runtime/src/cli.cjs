'use strict';

const { readFileSync, existsSync, writeFileSync, renameSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRuntime } = require('./worker.cjs');

const { readPrivateConfig } = require('../../../packages/supplier-sdk/src/private-config.cjs');

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--config' || args[2] !== '--state') throw new Error('Use --config <private-json-file> --state <cursor-json-file>');
  const configPath = resolve(args[1]), statePath = resolve(args[3]);
  if (configPath === statePath) throw new Error('CONFIG_STATE_COLLISION');
  const config = readPrivateConfig(configPath);
  let cursor = '';
  if (existsSync(statePath)) {
    const saved = JSON.parse(readFileSync(statePath, 'utf8'));
    if (saved.origin !== config.origin || saved.agentId !== config.expectedAgentId || typeof saved.cursor !== 'string') throw new Error('CURSOR_CONFIG_MISMATCH');
    cursor = saved.cursor;
  }
  const runtime = createRuntime({ ...config, transport: 'supplier-api', cursor,
    onCursor(value) {
      const temporary = `${statePath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify({ origin: config.origin, agentId: config.expectedAgentId, cursor: value }), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, statePath);
    },
    onEvent(type) { console.log(`CSV reference: ${type}`); }
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.stop());
  console.log('CSV reference connected to explicit localhost Supplier API v1. Deterministic automation; unpaid only.');
  return runtime.run();
}
if (require.main === module) Promise.resolve().then(main).catch(() => {
  console.error('Reference runtime stopped. Check private config permissions, localhost availability, key expiry and cursor ownership. No credentials were logged.');
  process.exitCode = 1;
});
module.exports = { readPrivateConfig };
