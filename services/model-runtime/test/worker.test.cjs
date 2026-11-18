'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createModelRuntime } = require('../src/worker.cjs');
function fixture(modelFetch, rejectProgress = false) {
  const agentId = randomUUID(),
    taskId = randomUUID(),
    assignmentId = randomUUID();
  const commands = [];
  const runtime = createModelRuntime({
    origin: 'http://127.0.0.1:4180',
    token: 'a'.repeat(43),
    expectedAgentId: agentId,
    modelFetch,
    fetchImpl: async (url, options) => {
      const path = new URL(url).pathname,
        body = options.body && JSON.parse(options.body);
      commands.push({ path, body });
      if (rejectProgress && path.endsWith('/progress'))
        return Response.json(
          { error: { code: 'LEASE_EXPIRED', message: 'Lease expired' } },
          { status: 409 },
        );
      let value = {};
      if (path.endsWith('/heartbeat')) {
        assert.match(body.runtimeName, /local AI/);
        value = { agentId, capabilities: [], automaticRequested: false };
      } else if (path.endsWith('/qualifications')) value = { jobs: [] };
      else if (path.endsWith('/assignments'))
        value = {
          assignments: [{ taskId, assignmentId, status: 'queued' }],
          hasMore: false,
        };
      else if (path.endsWith(`/tasks/${taskId}`))
        value = { assignmentId, status: 'queued', submissions: [], attempt: 0 };
      else if (path.endsWith('/claim'))
        value = {
          leaseToken: 'b'.repeat(43),
          brief: 'Extract web links from this text:\nhttps://a.test',
          input: null,
        };
      else
        assert.ok(
          ['/progress', '/submit', '/fail'].some((suffix) =>
            path.endsWith(suffix),
          ),
        );
      return Response.json(value);
    },
  });
  return { runtime, commands };
}
test('SDK delivery uses model result and truthful evidence', async () => {
  let calls = 0;
  const { runtime, commands } = fixture(async () => {
    calls++;
    return Response.json({
      message: { content: '{"links":["https://a.test/"]}' },
      done: true,
    });
  });
  await runtime.tick();
  runtime.stop();
  assert.equal(calls, 1);
  const submission = commands.find((c) => c.path.endsWith('/submit')).body;
  assert.match(submission.evidence, /Local AI extraction/);
  assert.match(submission.evidence, /No URLs visited/);
  assert.deepEqual(
    JSON.parse(Buffer.from(submission.files[0].base64, 'base64')).links,
    ['https://a.test/'],
  );
});
test('model failure marks execution failed, never submits invented files', async () => {
  const { runtime, commands } = fixture(async () =>
    Response.json({
      message: { content: '{"links":["https://invented.test/"]}' },
    }),
  );
  await runtime.tick();
  runtime.stop();
  assert.equal(commands.filter((c) => c.path.endsWith('/submit')).length, 0);
  assert.equal(
    commands.find((c) => c.path.endsWith('/fail')).body.code,
    'AGENT_ERROR',
  );
});
test('stopping runtime aborts in-flight inference and cannot submit', async () => {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { runtime, commands } = fixture(async (url, { signal }) => {
    started();
    await new Promise((resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), {
        once: true,
      }),
    );
  });
  const tick = runtime.tick();
  await ready;
  runtime.stop();
  await tick;
  assert.equal(commands.filter((c) => c.path.endsWith('/submit')).length, 0);
});
test('lease loss during slow inference aborts model and prevents delivery', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let started,
    aborted = false;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const { runtime, commands } = fixture(async (url, { signal }) => {
    started();
    await new Promise((resolve, reject) =>
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          reject(signal.reason);
        },
        { once: true },
      ),
    );
  }, true);
  const tick = runtime.tick();
  await ready;
  t.mock.timers.tick(10000);
  await tick;
  runtime.stop();
  assert.equal(aborted, true);
  assert.equal(commands.filter((c) => c.path.endsWith('/submit')).length, 0);
  assert.equal(commands.filter((c) => c.path.endsWith('/progress')).length, 1);
});
