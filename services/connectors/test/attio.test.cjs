'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createAttio } = require('../src/attio.cjs');
const config = {
  token: 'fixture-only',
  tenantId: 'tenant',
  workspaceLabel: 'Test',
  origin: 'http://127.0.0.1:4180',
};
test('Attio asserts by unique domain with server-held credentials and bounded failures', async () => {
  const provider = createAttio({
    ...config,
    fetchImpl: async (url, options) => {
      assert.equal(
        url,
        'https://api.attio.com/v2/objects/companies/records?matching_attribute=domains',
      );
      assert.equal(options.redirect, 'error');
      assert.equal(options.method, 'PUT');
      assert.equal(options.headers.authorization, 'Bearer fixture-only');
      assert.deepEqual(JSON.parse(options.body), {
        data: { values: { domains: ['example.com'], name: 'Example' } },
      });
      return Response.json({ data: { id: { record_id: 'record' } } });
    },
  });
  assert.deepEqual(
    await provider.assertCompany({ domain: 'example.com', name: 'Example' }),
    { recordId: 'record' },
  );
  for (const response of [
    new Response('', { status: 429 }),
    Response.json({ data: {} }),
    new Response('x'.repeat(65537)),
  ]) {
    await assert.rejects(
      createAttio({ ...config, fetchImpl: async () => response }).assertCompany(
        { domain: 'example.com' },
      ),
    );
  }
  assert.throws(() =>
    createAttio({ ...config, origin: 'https://relay.example' }),
  );
});

test('Attio redacts rejected, interrupted and malformed provider responses', async () => {
  for (const status of [401, 403, 429, 500, 503]) {
    const provider = createAttio({
      ...config,
      fetchImpl: async () => new Response('private token detail', { status }),
    });
    await assert.rejects(
      provider.assertCompany({ domain: 'example.com' }),
      (error) =>
        error.code === 'ATTIO_REJECTED' && !error.message.includes('private'),
    );
  }
  for (const fetchImpl of [
    async () => {
      throw new Error('private network detail');
    },
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('private stream detail'));
          },
        }),
      ),
  ]) {
    await assert.rejects(
      createAttio({ ...config, fetchImpl }).assertCompany({
        domain: 'example.com',
      }),
      (error) =>
        error.code === 'ATTIO_UNAVAILABLE' &&
        !error.message.includes('private'),
    );
  }
  for (const body of ['not json', '{"data":{"id":{"record_id":""}}}']) {
    await assert.rejects(
      createAttio({
        ...config,
        fetchImpl: async () => new Response(body),
      }).assertCompany({ domain: 'example.com' }),
      { code: 'ATTIO_RESPONSE' },
    );
  }
});
