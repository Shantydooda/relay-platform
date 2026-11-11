'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  startWorker,
  workerHealth,
} = require('../../operations/src/worker.cjs');
const { createApp } = require('../src/app.cjs');
function fixture(run) {
  let time = 100,
    callback,
    cleared = false;
  const logs = [];
  const worker = startWorker({
    name: 'test-worker',
    run,
    now: () => time,
    intervalMs: 10,
    staleAfterMs: 100,
    schedule: (fn) => {
      callback = fn;
      return {};
    },
    unschedule: () => {
      cleared = true;
    },
    logger: {
      error: (text) => logs.push(text),
      info: (text) => logs.push(text),
    },
  });
  return {
    worker,
    logs,
    advance: (amount) => {
      time += amount;
    },
    tick: () => callback(),
    cleared: () => cleared,
  };
}
test('worker detects failure, retries, recovers, and never logs raw errors', async () => {
  let fail = true;
  const f = fixture(() => {
    if (fail) throw new Error('secret credential and task content');
  });
  await f.worker.done();
  assert.equal(f.worker.health().status, 'degraded');
  await f.tick();
  assert.equal(f.worker.health().consecutiveFailures, 2);
  assert.equal(f.logs.length, 1);
  fail = false;
  await f.tick();
  assert.equal(f.worker.health().status, 'healthy');
  assert.equal(f.worker.health().consecutiveFailures, 0);
  assert.equal(f.worker.health().runs, 3);
  assert.equal(f.logs.length, 2);
  assert.ok(!JSON.stringify(f.logs).includes('secret'));
  f.worker.stop();
});
test('stalled work remains single-flight and shutdown drains it without dispatching more', async () => {
  let finish,
    calls = 0;
  const f = fixture(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await Promise.resolve();
  f.advance(101);
  assert.equal(f.worker.health().status, 'stalled');
  const running = f.tick();
  assert.equal(calls, 1);
  assert.equal(f.worker.done(), running);
  f.worker.stop();
  assert.equal(f.cleared(), true);
  finish();
  await running;
  await f.tick();
  assert.equal(calls, 1);
  assert.equal(f.worker.health().status, 'stopped');
});
test('missing ticks become stale and independent workers continue after another fails', async () => {
  const bad = fixture(() => {
    throw new Error('offline');
  });
  const good = fixture(() => {});
  await Promise.all([bad.worker.done(), good.worker.done()]);
  assert.equal(good.worker.health().status, 'healthy');
  assert.equal(workerHealth([bad.worker, good.worker]).status, 'degraded');
  good.advance(101);
  assert.equal(good.worker.health().status, 'stalled');
  await good.tick();
  assert.equal(good.worker.health().status, 'healthy');
  bad.worker.stop();
  good.worker.stop();
});
test('loopback health endpoint distinguishes worker degradation from process liveness', async (t) => {
  let status = 'healthy';
  const server = createApp({
    origin: 'http://127.0.0.1:4180',
    store: {},
    getWorkerHealth: () => ({
      status,
      workers: [{ name: 'scheduled-tasks', status }],
    }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  const get = (path) =>
    new Promise((resolve, reject) => {
      require('node:http')
        .get(
          `http://127.0.0.1:${server.address().port}${path}`,
          {
            headers: { Host: '127.0.0.1:4180' },
          },
          (response) => {
            let body = '';
            response.on('data', (chunk) => {
              body += chunk;
            });
            response.on('end', () =>
              resolve({
                status: response.statusCode,
                json: () => JSON.parse(body),
              }),
            );
          },
        )
        .on('error', reject);
    });
  assert.equal((await get('/health/workers')).status, 200);
  status = 'degraded';
  const result = await get('/health/workers');
  assert.equal(result.status, 503);
  assert.equal((await result.json()).status, 'degraded');
  assert.equal((await get('/health/live')).status, 200);
});
