'use strict';
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { existsSync } = require('node:fs');
const root = resolve(__dirname, '../../..');
const binary = resolve(root, '.poc-data/tools/ollama/ollama');
if (!existsSync(binary)) throw new Error('Install the verified standalone Ollama build described in docs/Conversational-Scoping.md first.');
const child = spawn(binary, ['serve'], { stdio: 'inherit', env: {
  ...process.env, OLLAMA_HOST: '127.0.0.1:11435', OLLAMA_NO_CLOUD: '1',
  OLLAMA_MODELS: resolve(root, '.poc-data/models'), OLLAMA_NUM_PARALLEL: '1', OLLAMA_MAX_LOADED_MODELS: '1',
  OLLAMA_DEBUG_LOG_REQUESTS: 'false'
} });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
child.on('error', () => { console.error('Local model service could not start.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code || 0; });
