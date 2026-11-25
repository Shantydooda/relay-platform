'use strict';
// Regression tests for the Nov 2026 QA findings on the Relay Connector:
// cursor/limit validation, path-free error messages, and open-once reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, symlinkSync, unlinkSync, renameSync, mkdirSync, rmSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { loadConfig, createFolderSource, createConnector } = require('../src/index.cjs');

const KEY = 'rcn_00000000-0000-4000-8000-000000000001.' + 'b'.repeat(43);

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-connector-reg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'exports'));
  writeFileSync(join(dir, 'exports', 'vendors.csv'), 'id,name\nV-1,Acme\nV-2,Beta\nV-3,Gamma\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ relay: 'https://relay.example.com', root: 'exports', objects: { vendor: 'vendors.csv' } }));
  return { dir, config: () => ({ ...loadConfig(join(dir, 'settings.json'), { RELAY_CONNECTOR_KEY: KEY }), auditLog: join(dir, 'audit.log') }) };
}

function relayStub(job) {
  const state = { answer: null };
  state.fetchImpl = async (url, init) => {
    if (url.includes('wait=')) return new Response(JSON.stringify({ readId: 'r1', grantId: 'g', agent: 'A', request: 'R', object: 'vendor', cursor: '0', limit: 500, ...job }), { status: 200 });
    state.answer = JSON.parse(init.body);
    return new Response('{}', { status: 200 });
  };
  return state;
}

test('cursor: only canonical non-negative integers are accepted; limit must be a positive integer', t => {
  const source = createFolderSource(folder(t).config());
  for (const cursor of ['-1', 'abc', '1e3', '0x10', '', ' 1', '01', '1.5', '1234567890', 5, {}, ['1']]) {
    assert.throws(() => source.read('vendor', { cursor }), { code: 'INVALID_CURSOR' }, JSON.stringify(cursor));
  }
  for (const limit of [0, -5, NaN, 1.5, '10']) assert.throws(() => source.read('vendor', { limit }), { code: 'INVALID_LIMIT' }, String(limit));
  assert.equal(source.read('vendor', { cursor: '1', limit: 1 }).rows[0].id, 'V-2');
  assert.equal(source.read('vendor').rows.length, 3, 'an absent cursor still starts at the top');
  assert.deepEqual(source.read('vendor', { cursor: '99' }), { rows: [], nextCursor: null });
});

test('client: an invalid cursor or limit from Relay is answered with an error result, not rows', async t => {
  for (const job of [{ cursor: '-1' }, { cursor: 'abc' }, { limit: -1 }]) {
    const f = folder(t);
    const config = f.config();
    const stub = relayStub(job);
    await createConnector({ config, source: createFolderSource(config), fetchImpl: stub.fetchImpl }).once();
    assert.match(stub.answer.error.code, /^INVALID_(CURSOR|LIMIT)$/);
    assert.ok(!('rows' in stub.answer));
  }
});

test('errors sent to Relay carry no local paths; the detail stays in the local audit log', async t => {
  const f = folder(t);
  const config = f.config();
  const source = createFolderSource(config);
  unlinkSync(join(f.dir, 'exports', 'vendors.csv'));
  let err;
  try { source.read('vendor'); } catch (e) { err = e; }
  assert.equal(err.code, 'SOURCE_UNREADABLE');
  assert.equal(err.message, 'The export could not be read.');
  const stub = relayStub({});
  await createConnector({ config, source, fetchImpl: stub.fetchImpl }).once();
  assert.equal(stub.answer.error.code, 'SOURCE_UNREADABLE');
  const sent = JSON.stringify(stub.answer);
  assert.ok(!sent.includes(f.dir) && !sent.includes('vendors.csv') && !/ENOENT/.test(sent), sent);
  const audit = readFileSync(config.auditLog, 'utf8');
  assert.match(audit, /"error":"SOURCE_UNREADABLE"/);
});

test('the export is read from the handle that was checked: a final link or a directory is refused', t => {
  const f = folder(t);
  const source = createFolderSource(f.config());
  const file = join(f.dir, 'exports', 'vendors.csv');
  renameSync(file, join(f.dir, 'exports', 'real.csv'));
  symlinkSync(join(f.dir, 'exports', 'real.csv'), file); // even an in-folder link is not followed at open
  assert.throws(() => source.read('vendor'), { code: 'SOURCE_UNREADABLE', message: 'The export could not be read.' });
  unlinkSync(file);
  mkdirSync(file);
  assert.throws(() => source.read('vendor'), { code: 'SOURCE_UNREADABLE' });
});
