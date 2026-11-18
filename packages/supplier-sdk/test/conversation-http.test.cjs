'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createSupplierClient } = require('../src/index.cjs');
const { supplierApi } = require('../../../services/poc-api/src/supplier-api.cjs');

test('SDK conversation reaches the real HTTP router and retries a lost response with unchanged identity', async t => {
  const token = 'a'.repeat(43);
  const principal = { actor: { userId: 'builder' }, agentId: randomUUID() };
  const taskId = randomUUID();
  const calls = [];
  let disconnect = true;
  let reject = false;
  const store = {
    features: { localExecution: true },
    issueSupplierCredential() {},
    async runtimePrincipal(value) {
      assert.equal(value, token);
      return principal;
    },
  };
  for (const name of ['supplierMessage', 'proposeChange']) {
    store[name] = async (actor, id, body, key, runtime) => {
      assert.equal(actor, principal.actor);
      assert.equal(runtime, principal);
      assert.equal(id, taskId);
      calls.push({ name, body, key });
      if (reject) throw Object.assign(new Error('Private server detail'), { status: 409, code: 'STALE_VERSION' });
      return { commandKey: key };
    };
  }
  const server = createServer(async (req, res) => {
    try {
      await supplierApi({
        req, store, origin,
        url: new URL(req.url, origin),
        jsonBody: async request => {
          let raw = '';
          for await (const chunk of request) raw += chunk;
          return JSON.parse(raw);
        },
        send: (status, result) => {
          if (disconnect) {
            disconnect = false;
            res.destroy();
            return;
          }
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        },
      });
    } catch (error) {
      res.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: error.code, message: error.message } }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const client = createSupplierClient({ origin, token });
  const key = randomUUID();
  const message = { expectedVersion: 3, body: 'Could you clarify the requested output?' };
  assert.deepEqual(await client.message(taskId, message, key), { commandKey: key });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].name, 'supplierMessage');
  assert.deepEqual(calls[0].body, message);

  const proposalKey = randomUUID();
  const proposal = { expectedVersion: 3, kind: 'scope-change', title: 'Expanded output', amountMinor: 1500 };
  await client.proposeChange(taskId, proposal, proposalKey);
  assert.deepEqual(calls[2], { name: 'proposeChange', body: proposal, key: proposalKey });
  reject = true;
  await assert.rejects(client.proposeChange(taskId, proposal, randomUUID()), error =>
    error.code === 'STALE_VERSION' && error.status === 409 && !error.message.includes('Private'));
  assert.equal(calls.length, 4, 'stale proposals must not retry');
  await assert.rejects(client.message(taskId, message), /IDEMPOTENCY_KEY_REQUIRED/);
  assert.equal(calls.length, 4, 'missing command identity must not reach the server');
});
