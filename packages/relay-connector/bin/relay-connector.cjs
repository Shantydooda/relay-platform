#!/usr/bin/env node
'use strict';

// relay-connector --config relay-connector.json [--check]
//   --check  read the settings and exports, print what would be served, then
//            exit without contacting Relay.
const { loadConfig, ConfigError, createFolderSource, createConnector } = require('../src/index.cjs');

const args = process.argv.slice(2);
const at = args.indexOf('--config');
const configPath = at >= 0 ? args[at + 1] : 'relay-connector.json';
const log = message => console.log(`${new Date().toISOString()}  ${message}`);

(async () => {
  let config;
  try { config = loadConfig(configPath); }
  catch (error) { if (error instanceof ConfigError) { console.error(error.message); process.exit(2); } throw error; }
  const source = createFolderSource(config);
  if (args.includes('--check')) {
    for (const object of source.objects()) {
      const { rows } = source.read(object, { limit: 500 });
      console.log(`${object}: ${rows.length}${rows.length === 500 ? '+' : ''} rows, columns ${Object.keys(rows[0] || {}).join(', ') || '(none)'}`);
    }
    console.log(`Settings are valid. Relay: ${config.relay}. Audit log: ${config.auditLog}.`);
    return;
  }
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { log('Stopping.'); controller.abort(); });
  const result = await createConnector({ config, source, log }).run({ signal: controller.signal });
  if (result.stopped !== 'signal') process.exit(1);
})().catch(error => { console.error(error.message); process.exit(1); });
