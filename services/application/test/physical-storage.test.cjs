'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { once } = require('node:events');
const { localObjects } = require('../../storage/src/local-objects.cjs');
const run = promisify(execFile);
const modulePath = resolve(__dirname, '../../storage/src/local-objects.cjs');
function directory(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-physical-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('separate writer processes cannot exceed physical quota; duplicate objects remain readable', async (t) => {
  const root = directory(t);
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      run(process.execPath, [
        '-e',
        `
    const store=require(process.argv[1]).localObjects(process.argv[2],{maxBytes:40});
    try { store.put(Buffer.alloc(10,Number(process.argv[3]))); console.log('ok'); }
    catch(error) { console.log(error.code); }
  `,
        modulePath,
        root,
        String(i),
      ]),
    ),
  );
  const outcomes = results.map((r) => r.stdout.trim());
  assert.ok(
    outcomes.every((value) =>
      ['ok', 'OBJECT_STORAGE_LIMIT', 'OBJECT_STORAGE_BUSY'].includes(value),
    ),
  );
  const objects = fs
    .readdirSync(root)
    .filter((name) => /^[a-f0-9]{64}$/.test(name));
  assert.ok(objects.length > 0 && objects.length <= 4);
  const store = localObjects(root, { maxBytes: 40 });
  const key = objects[0],
    bytes = store.read(key);
  assert.equal(store.put(bytes), key);
  assert.equal(
    fs.readdirSync(root).filter((name) => name.startsWith('upload-')).length,
    0,
  );
});
test('killed writer releases its lock and recovery removes only incomplete uploads', async (t) => {
  const root = directory(t),
    store = localObjects(root, { maxBytes: 20 });
  const key = store.put(Buffer.from('retained'));
  const child = spawn(
    process.execPath,
    [
      '-e',
      `
    const {DatabaseSync}=require('node:sqlite'),fs=require('node:fs'),path=require('node:path');
    const db=new DatabaseSync(path.join(process.argv[1],'.writer.sqlite'));
    db.exec('BEGIN IMMEDIATE');
    fs.writeFileSync(path.join(process.argv[1],'upload-11111111-1111-1111-1111-111111111111'),'partial');
    process.stdout.write('ready'); setInterval(()=>{},1000);
  `,
      root,
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  );
  t.after(() => child.kill('SIGKILL'));
  await once(child.stdout, 'data');
  assert.throws(() => store.put(Buffer.from('new')), {
    code: 'OBJECT_STORAGE_BUSY',
  });
  assert.equal(store.read(key).toString(), 'retained');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  assert.deepEqual(localObjects(root).recoverUploads(), { removed: 1 });
  assert.equal(store.read(key).toString(), 'retained');
  assert.equal(store.read(store.put(Buffer.from('new'))).toString(), 'new');
  assert.deepEqual(store.recoverUploads(), { removed: 0 });
});
test('full physical store rejects new bytes, but deduplication and recovery still work', (t) => {
  const root = directory(t),
    store = localObjects(root, { maxBytes: 3 });
  const key = store.put(Buffer.from('abc'));
  assert.throws(() => store.put(Buffer.from('d')), {
    code: 'OBJECT_STORAGE_LIMIT',
  });
  assert.equal(store.put(Buffer.from('abc')), key);
  assert.equal(localObjects(root).read(key).toString(), 'abc');
  fs.writeFileSync(
    join(root, 'upload-22222222-2222-2222-2222-222222222222'),
    'incomplete',
  );
  store.put(Buffer.from('abc'));
  assert.equal(
    fs.readdirSync(root).filter((n) => n.startsWith('upload-')).length,
    0,
  );
});
