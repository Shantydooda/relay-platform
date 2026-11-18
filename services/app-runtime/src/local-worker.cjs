'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const MAX_BYTES = 1024 * 1024;
function createLocalAutomationWorker({
  spawnImpl = spawn,
  timeoutMs = 5000,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000)
    throw new TypeError('Invalid worker deadline');
  let active = 0;

  // Trusted bounded interpreter in a disposable process, not an arbitrary-code sandbox.
  async function runLocalAutomation(payload) {
    const input = JSON.stringify(payload);
    if (Buffer.byteLength(input) > MAX_BYTES)
      fail(413, 'APP_WORKER_INPUT', 'The automation input is too large.');
    if (active >= 2)
      fail(
        503,
        'APP_WORKER_BUSY',
        'Automation workers are busy. Try again shortly.',
      );
    active++;
    try {
      return await new Promise((resolve, reject) => {
        const child = spawnImpl(
          process.execPath,
          ['--max-old-space-size=64', path.join(__dirname, 'worker-entry.cjs')],
          {
            env: {},
            stdio: ['pipe', 'pipe', 'ignore'],
            cwd: __dirname,
          },
        );
        const chunks = [];
        let size = 0,
          failure;
        const stop = (code, message) => {
          failure ||= { code, message };
          child.kill('SIGKILL');
        };
        const timer = setTimeout(
          () =>
            stop(
              'APP_WORKER_TIMEOUT',
              'The automation exceeded its execution time. Try again.',
            ),
          timeoutMs,
        );
        child.stdout.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES)
            stop('APP_WORKER_OUTPUT', 'The automation output is too large.');
          else chunks.push(chunk);
        });
        child.stdin.on('error', () =>
          stop(
            'APP_WORKER_FAILED',
            'The automation worker stopped. Try again.',
          ),
        );
        child.on('error', () => {
          failure = {
            code: 'APP_WORKER_FAILED',
            message: 'The automation worker could not start.',
          };
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          try {
            if (failure) fail(503, failure.code, failure.message);
            if (code !== 0)
              fail(
                503,
                'APP_WORKER_FAILED',
                'The automation worker stopped. Try again.',
              );
            const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (result.error)
              fail(
                400,
                'APP_WORKER_INPUT',
                'The input does not match this automation. Review the data and try again.',
              );
            if (typeof result.output !== 'string')
              throw new Error('Invalid result');
            resolve(result);
          } catch (error) {
            reject(
              error.code
                ? error
                : Object.assign(
                    new Error('The automation returned an invalid result.'),
                    { code: 'APP_WORKER_FAILED', status: 503 },
                  ),
            );
          }
        });
        child.stdin.end(input);
      });
    } finally {
      active--;
    }
  }
  return runLocalAutomation;
}
const runLocalAutomation = createLocalAutomationWorker();
module.exports = { runLocalAutomation, createLocalAutomationWorker };
