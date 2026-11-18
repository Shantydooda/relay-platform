'use strict';
const http = require('node:http');
const { MAX_BYTES } = require('./membership-feed.cjs');

// Separate loopback-only fixture listener. Not mounted on the buyer/builder app.
function createLocalMembershipFeedServer(feed) {
  let active = 0;
  const server = http.createServer(async (req, res) => {
    function send(status, value) {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    }
    if (
      !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        req.socket.remoteAddress,
      )
    )
      return send(403, { error: 'LOOPBACK_REQUIRED' });
    if (req.method !== 'POST' || req.url !== '/internal/access-updates')
      return send(404, { error: 'NOT_FOUND' });
    if (
      req.headers.origin ||
      req.headers['content-type'] !== 'application/json'
    )
      return send(415, { error: 'ACCESS_CONTENT_TYPE' });
    const declaredLength = req.headers['content-length'];
    if (
      declaredLength &&
      (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BYTES)
    ) {
      res.setHeader('Connection', 'close');
      req.resume();
      return send(413, { error: 'ACCESS_BODY_LIMIT' });
    }
    if (active >= 8) {
      res.setHeader('Retry-After', '1');
      return send(503, { error: 'ACCESS_FEED_BUSY' });
    }
    active++;
    let timer;
    try {
      timer = setTimeout(() => req.destroy(), 5000);
      let bytes = 0;
      const chunks = [];
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          send(413, { error: 'ACCESS_BODY_LIMIT' });
          req.resume();
          return;
        }
        chunks.push(chunk);
      }
      clearTimeout(timer);
      const result = await feed.receive({
        body: Buffer.concat(chunks),
        eventId: req.headers['x-relay-event-id'],
        timestamp: req.headers['x-relay-timestamp'],
        keyId: req.headers['x-relay-key-id'],
        signature: req.headers['x-relay-signature'],
      });
      send(200, result);
    } catch (error) {
      if (!res.destroyed && !res.writableEnded)
        send(
          Number.isInteger(error.status) &&
            error.status >= 400 &&
            error.status <= 599
            ? error.status
            : 503,
          {
            error: /^[A-Z_]{1,60}$/.test(error.code || '')
              ? error.code
              : 'ACCESS_FEED_UNAVAILABLE',
          },
        );
    } finally {
      clearTimeout(timer);
      active--;
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.maxHeadersCount = 20;
  return server;
}
module.exports = { createLocalMembershipFeedServer };
