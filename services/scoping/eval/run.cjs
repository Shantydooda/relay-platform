'use strict';
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createOllamaProvider } = require('../src/ollama.cjs');
const cases = require('./cases.cjs');
async function main() {
  const config = JSON.parse(readFileSync(resolve(__dirname, '../../../.poc-data/scoping.json'), 'utf8'));
  const provider = createOllamaProvider(config);
  console.log(JSON.stringify({ configuration: provider.metadata }));
  let failed = 0;
  for (const item of cases) {
    const start = Date.now();
    try {
      const output = await provider.propose({ title: item.title || 'New task', brief: item.brief, input: item.input || null, messages: item.messages || [{ role: 'user', content: item.brief }, ...(item.message ? [{ role: 'user', content: item.message }] : [])] });
      const pass = !!item.check(output); if (!pass) failed++;
      console.log(JSON.stringify({ name: item.name, pass, ms: Date.now() - start, ...(!pass || process.env.RELAY_EVAL_DETAILS === '1' ? { output } : {}) }));
    } catch (error) { failed++; console.log(JSON.stringify({ name: item.name, pass: false, error: error.code || error.message, ms: Date.now() - start })); }
  }
  console.log(JSON.stringify({ cases: cases.length, passed: cases.length - failed, failed, model: config.model }));
  process.exitCode = failed ? 1 : 0;
}
main().catch(() => { console.error('Local model evaluation could not start.'); process.exitCode = 1; });
