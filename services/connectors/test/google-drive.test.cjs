'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createGoogleDrive, SCOPE } = require('../src/google-drive.cjs');
const config = {
  clientId: 'test-client',
  clientSecret: 'test-secret',
  apiKey: 'test-picker',
  projectNumber: '123',
  encryptionKey: 'ab'.repeat(32),
  origin: 'http://127.0.0.1:4180',
};
const json = (value) =>
  new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
  });

test('Drive vault binds ciphertext to its connection and OAuth uses PKCE with selected-file scope', () => {
  const drive = createGoogleDrive(config),
    encrypted = drive.seal({ refreshToken: 'private' }, 'connection-a');
  assert.ok(!encrypted.includes('private'));
  assert.deepEqual(drive.open(encrypted, 'connection-a'), {
    refreshToken: 'private',
  });
  assert.throws(() => drive.open(encrypted, 'connection-b'), {
    code: 'CONNECTOR_LOCKED',
  });
  const url = new URL(drive.authorization('state', 'verifier'));
  assert.equal(url.searchParams.get('scope'), SCOPE);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'http://127.0.0.1:4180/drive/callback',
  );
  assert.throws(() =>
    createGoogleDrive({ ...config, origin: 'https://relay.example' }),
  );
});

test('Drive reads only bounded supported files from fixed Google endpoints', async () => {
  const calls = [];
  const drive = createGoogleDrive({
    ...config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.includes('fields=')
        ? json({
            id: 'file_1',
            name: 'Brief',
            mimeType: 'application/vnd.google-apps.document',
            version: '4',
            capabilities: { canDownload: true },
          })
        : new Response('Example context');
    },
  });
  assert.equal(
    (await drive.readFile('private-access', 'file_1')).content,
    'Example context',
  );
  assert.ok(calls[1].url.includes('/export?mimeType=text%2Fplain'));
  assert.ok(
    calls.every(
      (call) =>
        call.options.redirect === 'error' &&
        call.options.headers.authorization === 'Bearer private-access',
    ),
  );
  assert.ok(calls.every((call) => !call.url.includes('private-access')));
  await assert.rejects(drive.readFile('token', 'https://evil.example'), {
    code: 'FILE_INVALID',
  });
  const denied = createGoogleDrive({
    ...config,
    fetchImpl: async () =>
      json({
        id: 'file_1',
        mimeType: 'application/pdf',
        capabilities: { canDownload: true },
      }),
  });
  await assert.rejects(denied.readFile('token', 'file_1'), {
    code: 'FILE_UNSUPPORTED',
  });
  const large = createGoogleDrive({
    ...config,
    fetchImpl: async (url) =>
      url.includes('fields=')
        ? json({
            id: 'file_1',
            version: '1',
            mimeType: 'text/plain',
            capabilities: { canDownload: true },
          })
        : new Response('x'.repeat(16001)),
  });
  await assert.rejects(large.readFile('token', 'file_1'), {
    code: 'SOURCE_TOO_LARGE',
  });
});

test('OAuth errors do not expose provider response or credentials', async () => {
  const drive = createGoogleDrive({
    ...config,
    fetchImpl: async () =>
      new Response('secret provider error', { status: 400 }),
  });
  await assert.rejects(
    drive.exchange('private-code', 'private-verifier'),
    (error) =>
      error.code === 'DRIVE_REJECTED' && !error.message.includes('secret'),
  );
  const broken = createGoogleDrive({
    ...config,
    fetchImpl: async () =>
      json({
        access_token: 'a',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'other',
      }),
  });
  await assert.rejects(broken.refresh('private-refresh'), {
    code: 'DRIVE_RESPONSE',
  });
});
module.exports = { config };

test('Drive caps concurrent requests through body completion and recovers after failure', async () => {
  let release,
    calls = 0;
  const drive = createGoogleDrive({
    ...config,
    maxConcurrent: 1,
    fetchImpl: async () => {
      calls++;
      return new Response(
        new ReadableStream({
          start(controller) {
            release = () => {
              controller.enqueue(new TextEncoder().encode('{}'));
              controller.close();
            };
          },
        }),
      );
    },
  });
  const first = drive.revoke('fixture');
  await assert.rejects(drive.revoke('fixture'), { code: 'DRIVE_BUSY' });
  assert.equal(calls, 1);
  release();
  await first;
  const next = drive.revoke('fixture');
  release();
  await next;
  assert.equal(calls, 2);
  const failing = createGoogleDrive({
    ...config,
    maxConcurrent: 1,
    fetchImpl: async () => {
      throw new Error('fixture');
    },
  });
  await assert.rejects(failing.revoke('fixture'), {
    code: 'DRIVE_UNAVAILABLE',
  });
  await assert.rejects(failing.revoke('fixture'), {
    code: 'DRIVE_UNAVAILABLE',
  });
});
