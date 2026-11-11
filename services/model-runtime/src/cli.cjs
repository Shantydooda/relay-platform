'use strict';
const { readPrivateConfig } = require('../../agent-runtime/src/cli.cjs');
const { createModelRuntime } = require('./worker.cjs');
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--config')
    throw new Error('CONFIG_REQUIRED');
  const runtime = createModelRuntime({
    ...readPrivateConfig(args[1]),
    onEvent: (event, reason) =>
      console.log(
        `Local AI supplier: ${event}${reason ? ' (' + reason + ')' : ''}`,
      ),
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => runtime.stop());
  await runtime.run();
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'AI supplier stopped. Check local model, private config and agent access. No private details logged.',
    );
    process.exitCode = 1;
  });
module.exports = { main };
