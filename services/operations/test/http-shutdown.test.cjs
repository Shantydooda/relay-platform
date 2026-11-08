'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { closeHttpServer, trackRequests } = require('../src/http-shutdown.cjs');

async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return server.address().port;
}

test('shutdown closes incomplete HTTP headers instead of waiting indefinitely', { timeout: 3000 }, async t => {
  const server = http.createServer();
  const port = await listen(server, t);
  const socket = net.connect(port, '127.0.0.1');
  socket.on('error', () => {});
  t.after(() => socket.destroy());
  await once(socket, 'connect');
  socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n');
  await delay(20);
  const closed = once(socket, 'close');
  await closeHttpServer(server, { graceMs: 30 });
  await closed;
  assert.equal(server.listening, false);
});

test('shutdown lets a request complete within its grace period', { timeout: 3000 }, async t => {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const requests = trackRequests(async (req, res) => { entered(); await delay(30); res.end('saved'); });
  const server = http.createServer(requests.handle);
  server.drainRequests = requests.drain;
  const port = await listen(server, t);
  const response = fetch(`http://127.0.0.1:${port}`).then(res => res.text());
  await started;
  await closeHttpServer(server, { graceMs: 500 });
  assert.equal(await response, 'saved');
});

test('storage drain waits for the command even after its socket is closed', { timeout: 3000 }, async t => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const work = new Promise(resolve => { finish = resolve; });
  const requests = trackRequests(async (req, res) => { entered(); await work; res.end('saved'); });
  const server = http.createServer(requests.handle);
  server.drainRequests = requests.drain;
  const port = await listen(server, t);
  const response = fetch(`http://127.0.0.1:${port}`).catch(() => null);
  await started;
  let drained = false;
  const closing = closeHttpServer(server, { graceMs: 20 }).then(() => { drained = true; });
  await response;
  assert.equal(drained, false);
  finish();
  await closing;
  assert.equal(drained, true);
});
