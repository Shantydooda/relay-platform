'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runLocalAutomation } = require('../src/local-worker.cjs');
test('local worker runs bounded recipes and recovers after invalid input', async () => {
  const result = await runLocalAutomation({
    recipe: 'csv-normalize-v1',
    content: 'name\nÉlodie\nÉlodie',
  });
  assert.equal(result.output, 'name\r\nÉlodie\r\n');
  await assert.rejects(
    runLocalAutomation({
      recipe: 'execute-javascript',
      content: 'process.env',
    }),
    { code: 'APP_WORKER_INPUT' },
  );
  await assert.rejects(
    runLocalAutomation({
      recipe: 'csv-normalize-v1',
      content: 'x'.repeat(1024 * 1024),
    }),
    { code: 'APP_WORKER_INPUT' },
  );
  assert.ok(
    (
      await runLocalAutomation({
        recipe: 'csv-normalize-v1',
        content: 'name\nA',
      })
    ).output.includes('A'),
  );
});
test('local worker bounds process admission and releases slots', async () => {
  const payload = { recipe: 'csv-normalize-v1', content: 'name\nA' };
  const first = runLocalAutomation(payload),
    second = runLocalAutomation(payload);
  await assert.rejects(runLocalAutomation(payload), {
    code: 'APP_WORKER_BUSY',
  });
  await Promise.all([first, second]);
  await runLocalAutomation(payload);
});

test('killed and stalled real child processes release slots for a fresh retry', async () => {
  const { spawn } = require('node:child_process');
  const { createLocalAutomationWorker } = require('../src/local-worker.cjs');
  for (const mode of ['crash', 'timeout']) {
    let first = true,
      failedChild;
    const run = createLocalAutomationWorker({
      timeoutMs: 250,
      spawnImpl(executable, args, options) {
        if (!first) return spawn(executable, args, options);
        first = false;
        failedChild = spawn(
          executable,
          ['-e', 'process.stdin.resume();setInterval(()=>{},1000)'],
          options,
        );
        if (mode === 'crash')
          failedChild.once('spawn', () => failedChild.kill('SIGKILL'));
        return failedChild;
      },
    });
    const payload = { recipe: 'csv-normalize-v1', content: 'name\nA' };
    await assert.rejects(run(payload), {
      code: mode === 'crash' ? 'APP_WORKER_FAILED' : 'APP_WORKER_TIMEOUT',
    });
    assert.equal(failedChild.signalCode, 'SIGKILL');
    assert.equal((await run(payload)).output, 'name\r\nA\r\n');
  }
});
