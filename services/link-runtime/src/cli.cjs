'use strict';
const { readPrivateConfig } = require('../../agent-runtime/src/cli.cjs');
const { createLinkRuntime } = require('./worker.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config') throw new Error('CONFIG_REQUIRED');
  const runtime = createLinkRuntime({ ...readPrivateConfig(args[1]), onEvent: event => console.log(`Offline link inventory: ${event}`) });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => runtime.stop());
  return runtime.run();
}
if (require.main === module) main().catch(() => {
  console.error('Link runtime stopped. Check the private config, local server and credential. No private details were logged.');
  process.exitCode = 1;
});
module.exports = { main };
