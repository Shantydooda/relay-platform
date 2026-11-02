'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createLinkRuntime } = require('../src/worker.cjs');

test('link runtime uses only Relay, separates revision claim keys, and delivers actual transformed files', async () => {
  const agentId = randomUUID(), taskId = randomUUID(), assignmentId = randomUUID();
  let round = 0;
  const claims = [], submissions = [];
  const runtime = createLinkRuntime({ origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43), expectedAgentId: agentId, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'http://127.0.0.1:4180');
    const path = new URL(url).pathname, body = options.body && JSON.parse(options.body);
    let value = {};
    if (path.endsWith('/heartbeat')) value = { agentId, capabilities: [], automaticRequested: false };
    else if (path.endsWith('/qualifications')) value = { jobs: [] };
    else if (path.endsWith('/assignments')) value = { assignments: [{ taskId, assignmentId, status: 'queued', attempt: 0 }], hasMore: false };
    else if (path.endsWith(`/tasks/${taskId}`)) value = { assignmentId, status: 'queued', attempt: 0, submissions: Array.from({length:round},()=>({})) };
    else if (path.endsWith('/claim')) {
      claims.push(options.headers['Idempotency-Key']);
      value = { leaseToken: 'b'.repeat(43), input: null, brief: 'Extract web links from this text:\nhttps://z.test https://a.test', revisionNotes: round ? 'Sort links descending.' : null };
    } else if (path.endsWith('/submit')) submissions.push(body);
    else assert.ok(path.endsWith('/progress'));
    return new Response(JSON.stringify(value), { status: 200 });
  } });
  await runtime.tick();
  round = 1;
  await runtime.tick();
  assert.notEqual(claims[0], claims[1]);
  const files = submissions.map(s => JSON.parse(Buffer.from(s.files[0].base64, 'base64').toString()));
  assert.deepEqual(files[0].links, ['https://a.test/', 'https://z.test/']);
  assert.deepEqual(files[1].links, [...files[0].links].reverse());
});

test('link runtime does not bid on arbitrary briefs or another credential identity', async () => {
  const agentId = randomUUID();
  let mismatched = false;
  const runtime = createLinkRuntime({ origin: 'http://127.0.0.1:4180', token: 'a'.repeat(43), expectedAgentId: agentId, fetchImpl: async url => {
    const path = new URL(url).pathname;
    let value;
    if (path.endsWith('/heartbeat')) value = { agentId: mismatched ? randomUUID() : agentId, automaticRequested: true, capabilities: [{ id:randomUUID(),task:'Extract URLs' }] };
    else if (path.endsWith('/qualifications')) value = { jobs: [] };
    else if (path.endsWith('/opportunities')) value = { tasks: [{ brief: 'Research https://example.test and write a report', myOffers: [] }], hasMore: false };
    else if (path.endsWith('/assignments')) value = { assignments: [], hasMore: false };
    else assert.fail('Unexpected command');
    return new Response(JSON.stringify(value));
  } });
  await runtime.tick();
  mismatched = true;
  await assert.rejects(runtime.tick(), error => error.status === 403);
  runtime.stop();
});
