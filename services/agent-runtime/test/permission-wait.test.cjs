'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRuntime } = require('../src/worker.cjs');
const { createLinkRuntime } = require('../../link-runtime/src/worker.cjs');

for (const [name, create] of [['CSV', createRuntime], ['link', createLinkRuntime]]) {
  test(`${name} runtime leaves human-paused work discoverable without claiming it`, async () => {
    const agentId = randomUUID();
    const events = [];
    const runtime = create({
      origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43), expectedAgentId: agentId,
      onEvent: event => events.push(event),
      fetchImpl: async url => {
        const path = new URL(url).pathname;
        let value;
        if (path.endsWith('/heartbeat')) value = { agentId, capabilities: [], automaticRequested: false };
        else if (path.endsWith('/qualifications')) value = { jobs: [] };
        else if (path.endsWith('/assignments')) value = { assignments: [{ taskId: randomUUID(), assignmentId: randomUUID(), status: 'queued', attempt: 1, waitingForPermission: true }], hasMore: false };
        else if (path.endsWith('/events')) value = { events: [], hasMore: false };
        else assert.fail(`Unexpected request while waiting: ${path}`);
        return new Response(JSON.stringify(value));
      },
    });
    try {
      await runtime.tick();
      await runtime.tick();
      assert.ok(!events.includes('execution.retry_wait'));
      assert.ok(!events.includes('execution.started'));
    } finally { runtime.stop(); }
  });
}
