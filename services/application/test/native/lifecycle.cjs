'use strict';

const { setTimeout: delay } = require('node:timers/promises');

// Test fixtures must fail visibly and release their processes, even when the
// behavior under test is a broken shutdown or an unavailable dependency.
async function stopChild(child, { timeoutMs = 10000, name = 'Fixture process' } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  let timer;
  let expired = false;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', exited);
      child.removeListener('error', failed);
    };
    const exited = () => { cleanup(); resolve(); };
    const failed = error => { cleanup(); reject(error); };
    child.once('exit', exited);
    child.once('error', failed);
    timer = setTimeout(() => {
      expired = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.kill('SIGTERM');
  });
  if (expired) throw new Error(`${name} did not stop within ${timeoutMs}ms; fixture was killed.`);
}

async function eventually(read, condition, { timeoutMs = 20000, intervalMs = 100, name = 'Expected HTTP state' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    let timer;
    try {
      const value = await Promise.race([
        Promise.resolve().then(read),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Poll deadline reached')), Math.max(1, deadline - Date.now()));
        })
      ]);
      if (condition(value)) return value;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await delay(Math.max(0, Math.min(intervalMs, deadline - Date.now())));
  }
  throw new Error(`${name} was not reached within ${timeoutMs}ms.`, { cause: lastError });
}

module.exports = { stopChild, eventually };
