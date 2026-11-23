'use strict';
// The Relay Connector (packages/relay-connector): reads only the exports its
// settings name, inside one folder, and answers Relay's granted reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, writeFileSync, symlinkSync, chmodSync, readFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { parseCsv, loadConfig, ConfigError, createFolderSource, createConnector } = require('../src/index.cjs');

const KEY = 'rcn_00000000-0000-4000-8000-000000000001.' + 'a'.repeat(43);
function folder(t) {
  const dir = mkdtempSync(join(tmpdir(), 'relay-connector-'));
  mkdirSync(join(dir, 'exports'));
  writeFileSync(join(dir, 'exports', 'vendors.csv'), '﻿id,name,taxId\r\nV-1,"Acme, Inc.",12-3\r\nV-2,"The ""Best"" Co",45-6\r\n');
  writeFileSync(join(dir, 'outside.csv'), 'id\nsecret\n');
  const settings = (extra = {}) => { writeFileSync(join(dir, 'relay-connector.json'), JSON.stringify({ relay: 'https://relay.example.com', root: 'exports', objects: { vendor: 'vendors.csv' }, ...extra })); return join(dir, 'relay-connector.json'); };
  return { dir, settings, env: { RELAY_CONNECTOR_KEY: KEY } };
}

test('CSV exports are read as text exactly as exported, quotes and all', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, ""y"""\n"line\nbreak",\n'), [{ a: '1', b: 'x, "y"' }, { a: 'line\nbreak', b: '' }]);
  assert.throws(() => parseCsv('a,a\n1,2\n'), /unique name/);
  assert.throws(() => parseCsv('a,b\n1\n'), /Row 2 has 1 values/);
  assert.throws(() => parseCsv('a\n"open\n'), /inside a quoted value/);
});

test('settings name Relay, the key and the exports; nothing outside the exports folder is read', t => {
  const f = folder(t);
  const config = loadConfig(f.settings(), f.env);
  assert.equal(config.relay, 'https://relay.example.com');
  assert.deepEqual(Object.keys(config.objects), ['vendor']);
  assert.throws(() => loadConfig(f.settings({ objects: { vendor: '../outside.csv' } }), f.env), /outside the exports folder/);
  symlinkSync(join(f.dir, 'outside.csv'), join(f.dir, 'exports', 'link.csv'));
  assert.throws(() => loadConfig(f.settings({ objects: { vendor: 'link.csv' } }), f.env), /outside the exports folder/, 'links can’t escape the folder');
  assert.throws(() => loadConfig(f.settings({ objects: { payroll: 'vendors.csv' } }), f.env), /isn’t an object Relay knows/);
  assert.throws(() => loadConfig(f.settings({ relay: 'http://relay.example.com' }), f.env), /must use https/);
  assert.equal(loadConfig(f.settings({ relay: 'http://127.0.0.1:4180' }), f.env).relay, 'http://127.0.0.1:4180');
  assert.throws(() => loadConfig(f.settings({ key: KEY }), f.env), /Don’t put the connector key in the settings file/);
  assert.throws(() => loadConfig(f.settings(), {}), ConfigError);
  writeFileSync(join(f.dir, 'key'), KEY); chmodSync(join(f.dir, 'key'), 0o644);
  assert.throws(() => loadConfig(f.settings({ keyFile: 'key' }), {}), /chmod 600/);
  chmodSync(join(f.dir, 'key'), 0o600);
  assert.equal(loadConfig(f.settings({ keyFile: 'key' }), {}).key, KEY);
});

test('the source pages rows and reports a missing export as a plain error', t => {
  const f = folder(t);
  const source = createFolderSource(loadConfig(f.settings(), f.env));
  assert.deepEqual(source.read('vendor', { cursor: '0', limit: 1 }), { rows: [{ id: 'V-1', name: 'Acme, Inc.', taxId: '12-3' }], nextCursor: '1' });
  assert.deepEqual(source.read('vendor', { cursor: '1', limit: 500 }).nextCursor, null);
  assert.throws(() => source.read('customer'), { code: 'OBJECT_UNAVAILABLE' });
});

test('the loop says hello, answers a read, logs it locally without the rows, and stops on a refused key', async t => {
  const f = folder(t);
  const config = loadConfig(f.settings({ auditLog: 'audit.log' }), f.env);
  const calls = [];
  const jobs = [{ readId: 'r1', grantId: 'g1', agent: 'Vendor cleaner', request: 'Dedupe vendors', object: 'vendor', cursor: '0', limit: 500, params: {} }];
  const fetchImpl = async (url, options) => {
    const path = url.replace(config.relay, '');
    calls.push([options.method, path, options.body ? JSON.parse(options.body) : null, options.headers.authorization]);
    const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
    if (path === '/api/connector/hello') return reply(200, { label: 'NetSuite', environment: 'sandbox', objects: ['vendor'] });
    if (path.startsWith('/api/connector/reads?')) return jobs.length ? reply(200, jobs.shift()) : reply(401, { error: { message: 'This connector key isn’t valid.' } });
    return reply(200, { status: 'answered' });
  };
  const result = await createConnector({ config, source: createFolderSource(config), fetchImpl, sleep: async () => {} }).run();
  assert.equal(result.stopped, 'This connector key isn’t valid.');
  assert.deepEqual(calls[0].slice(0, 3), ['POST', '/api/connector/hello', { version: '0.1.0', objects: ['vendor'] }]);
  assert.equal(calls[0][3], `Bearer ${KEY}`);
  assert.equal(calls[2][1], '/api/connector/reads/r1');
  assert.equal(calls[2][2].rows.length, 2);
  const log = readFileSync(join(f.dir, 'audit.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.equal(log.length, 1);
  assert.deepEqual({ ...log[0], time: undefined }, { time: undefined, readId: 'r1', grantId: 'g1', agent: 'Vendor cleaner', request: 'Dedupe vendors', object: 'vendor', cursor: '0', outcome: 'sent', rows: 2 });
  assert.doesNotMatch(JSON.stringify(log), /Acme/, 'the local log never holds the rows');
});
