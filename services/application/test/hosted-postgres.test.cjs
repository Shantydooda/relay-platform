'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hostedPoolOptions, openHostedPostgres } = require('../src/hosted-postgres.cjs');
const projectRef = 'abcdefghijklmnopqrst';
const config = { projectRef, excludedProjectRefs: ['pjnhmlhaabjqqifjixio', 'mhtybwyjublmjtldmvys'], host: `db.${projectRef}.supabase.co`, port: 5432, user: 'postgres', password: 'private-fixture-password' };

test('hosted database options enforce verified TLS, bounded pools and session pooling', () => {
  const direct = hostedPoolOptions(config);
  assert.equal(direct.ssl.rejectUnauthorized, true);
  assert.equal(direct.max, 4);
  assert.equal(direct.database, 'postgres');
  const session = hostedPoolOptions({ ...config, host: 'aws-0-us-east-1.pooler.supabase.com', user: `postgres.${projectRef}` });
  assert.equal(session.ssl.rejectUnauthorized, true);
  assert.equal(session.port, 5432);
});

test('wrong projects, insecure hosts, transaction pooling and identity mismatch fail before connecting', () => {
  for (const change of [
    { projectRef: 'pjnhmlhaabjqqifjixio' }, { projectRef: 'mhtybwyjublmjtldmvys' },
    { excludedProjectRefs: [] }, { host: '127.0.0.1' }, { host: 'attacker.example' },
    { port: 6543 }, { port: '5432' }, { password: '' }, { user: 'postgres.other' },
    { host: 'db.other.supabase.co' }, { ca: false },
  ]) assert.throws(() => hostedPoolOptions({ ...config, ...change }), /INVALID_PILOT_DATABASE_CONFIG/);
});

test('startup never migrates implicitly and closes failed pools without leaking provider errors', async () => {
  let options, ended = 0;
  class FixturePool {
    constructor(value) { options = value; }
    on() {}
    async end() { ended++; }
  }
  await assert.rejects(openHostedPostgres(config, { PoolClass: FixturePool, openRepository: async (_db, opts) => {
    assert.deepEqual(opts, { initialize: false });
    throw new Error(config.password);
  } }), error => error.message === 'PILOT_DATABASE_STARTUP_FAILED');
  assert.equal(options.ssl.rejectUnauthorized, true);
  assert.equal(ended, 1);
  const connection = await openHostedPostgres(config, { PoolClass: FixturePool, openRepository: async () => ({ marker: 'repository' }) });
  assert.equal(connection.repository.marker, 'repository');
  await connection.close();
  assert.equal(ended, 2);
});
