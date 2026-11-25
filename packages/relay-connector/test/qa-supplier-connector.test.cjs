'use strict';
// Adversarial QA of the Relay Connector's folder source and CSV reader (Nov 2026).
// Passing tests document verified behaviour; `todo` tests reproduce confirmed
// bugs (BUG-SUP-<n>) without breaking the suite.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, symlinkSync, unlinkSync, renameSync, mkdirSync, rmSync, realpathSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { parseCsv, loadConfig, createFolderSource, createConnector } = require('../src/index.cjs');

const KEY = 'rcn_00000000-0000-4000-8000-000000000001.' + 'b'.repeat(43);

function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-connector-qa-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'exports'));
  mkdirSync(join(dir, 'exports-evil'));
  writeFileSync(join(dir, 'exports', 'vendors.csv'), 'id,name\nV-1,Acme\nV-2,Beta\nV-3,Gamma\n');
  writeFileSync(join(dir, 'exports-evil', 'secret.csv'), 'id,name\nS-1,Secret\n');
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ relay: 'https://relay.example.com', root: 'exports', objects: { vendor: 'vendors.csv' } }));
  return { dir, config: () => loadConfig(join(dir, 'settings.json'), { RELAY_CONNECTOR_KEY: KEY }) };
}

test('an export swapped for a link after start-up is refused, including a sibling folder sharing the root’s prefix', t => {
  const f = folder(t);
  const config = f.config();
  const source = createFolderSource(config);
  assert.equal(source.read('vendor').rows.length, 3);
  const file = join(f.dir, 'exports', 'vendors.csv');
  renameSync(file, join(f.dir, 'exports', 'old.csv'));
  // "exports-evil" starts with "exports": a plain prefix check would let it through.
  symlinkSync(join(f.dir, 'exports-evil', 'secret.csv'), file);
  assert.throws(() => source.read('vendor'), { code: 'SOURCE_UNREADABLE' });
  unlinkSync(file);
  assert.throws(() => source.read('vendor'), { code: 'SOURCE_UNREADABLE' });
  assert.throws(() => source.read('invoice'), { code: 'OBJECT_UNAVAILABLE' }, 'an object not in the settings is never read');
  assert.throws(() => loadConfig((writeFileSync(join(f.dir, 'settings.json'), JSON.stringify({ relay: 'https://relay.example.com', root: 'exports', objects: { vendor: '../exports-evil/secret.csv' } })), join(f.dir, 'settings.json')), { RELAY_CONNECTOR_KEY: KEY }), /outside the exports folder/);
  assert.equal(realpathSync(config.root), config.root);
});

test('paging: pages are capped at 500 rows, cursors are numeric offsets, and a bad cursor restarts at the top', t => {
  const f = folder(t);
  writeFileSync(join(f.dir, 'exports', 'vendors.csv'), 'id\n' + Array.from({ length: 1203 }, (_, i) => `V-${i}`).join('\n') + '\n');
  const source = createFolderSource(f.config());
  const first = source.read('vendor', { limit: 10000 });
  assert.equal(first.rows.length, 500);
  assert.equal(first.nextCursor, '500');
  const last = source.read('vendor', { cursor: '1000' });
  assert.equal(last.rows.length, 203);
  assert.equal(last.nextCursor, null);
  assert.deepEqual(source.read('vendor', { cursor: '5000' }), { rows: [], nextCursor: null });
  // Documented risk, not a leak: a non-numeric or negative cursor silently reads from row 0.
  for (const cursor of ['-1', 'abc', '1e3', '0x10']) assert.equal(source.read('vendor', { cursor, limit: 1 }).rows[0].id, 'V-0', cursor);
});

test('CSV reader: quoting, CRLF/CR, BOM, prototype-like headers and ragged rows', () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"1\r\n2","x"\r3,""\n'), [{ a: '1\r\n2', b: 'x' }, { a: '3', b: '' }]);
  const rows = parseCsv('__proto__,constructor\n1,2\n');
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype, 'a header named __proto__ never changes the row’s prototype');
  assert.equal(rows[0].constructor, '2');
  assert.throws(() => parseCsv('a,b\n1,2,3\n'), /Row 2 has 3 values/);
  assert.throws(() => parseCsv(' a ,a\n1,2\n'), /unique name/, 'headers are compared after trimming');
  assert.deepEqual(parseCsv(''), []);
  // Lenient by design: text after a closing quote is kept, not rejected (RFC 4180 would reject it).
  assert.deepEqual(parseCsv('a\n"x"y\n'), [{ a: 'xy' }]);
});

test('BUG-SUP-8 check: a single-column export keeps rows whose value is empty', () => {
    assert.deepEqual(parseCsv('email\na@x.com\n""\nb@x.com\n'), [{ email: 'a@x.com' }, { email: '' }, { email: 'b@x.com' }]);
  });

test('connector client: a 401 stops it, redirects are refused, and only Relay’s chosen object is read', async t => {
  const f = folder(t);
  const config = { ...f.config(), auditLog: join(f.dir, 'audit.log') };
  const source = createFolderSource(config);
  const calls = [];
  let answer;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/api/connector/reads?wait=25')) return new Response(JSON.stringify({ readId: '00000000-0000-4000-8000-0000000000aa', grantId: 'g', agent: 'A', request: 'R', object: 'invoice', cursor: '0', limit: 500 }), { status: 200 });
    if (url.includes('/api/connector/reads/')) { answer = JSON.parse(init.body); return new Response('{}', { status: 200 }); }
    return new Response(JSON.stringify({ error: { message: 'bad key' } }), { status: 401 });
  };
  const connector = createConnector({ config, source, fetchImpl });
  assert.equal(await connector.once(), true);
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(answer.error.code, 'OBJECT_UNAVAILABLE', 'an object outside the settings is answered with an error, not rows');
  assert.ok(!('rows' in answer));
  const stopped = await createConnector({ config, source, fetchImpl: async () => new Response('{"error":{"message":"gone"}}', { status: 401 }), sleep: async () => {} }).run();
  assert.equal(stopped.stopped, 'gone');
});
