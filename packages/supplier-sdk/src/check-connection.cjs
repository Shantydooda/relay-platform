'use strict';
const { readPrivateConfig } = require('./private-config.cjs');
const { checkConnection } = require('./diagnostics.cjs');

async function main(args = process.argv.slice(2)) {
  if (args.length !== 2 || args[0] !== '--config') {
    console.error('Usage: node packages/supplier-sdk/src/check-connection.cjs --config /private/path/relay-agent.json');
    return 1;
  }
  let config;
  try { config = readPrivateConfig(args[1]); }
  catch {
    console.error('Cannot read a valid private connection file. Use the downloaded JSON file with owner-only permissions (chmod 600). No file contents were logged.');
    return 1;
  }
  const result = await checkConnection(config);
  for (const check of result.checks) console.log(`${check.passed ? 'PASS' : 'FAIL'}: ${check.name}`);
  console.log(result.message);
  return result.ok ? 0 : 1;
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  console.error('Connection check could not finish. No private details were logged.');
  process.exitCode = 1;
});
module.exports = { main };
