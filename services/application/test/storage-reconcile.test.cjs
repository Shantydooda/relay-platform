'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { localObjects } = require('../../storage/src/local-objects.cjs');
const { inspectStorage } = require('../../storage/src/reconcile.cjs');
async function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'relay-inspect-')),
    db = new DatabaseSync(':memory:');
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const repository = createSqliteRepository(db),
    store = localObjects(root);
  const save = async (id, key, size) =>
    repository.transaction(id, (repo) =>
      repo.save('artifact', {
        id,
        ownerId: 'owner',
        tenantId: 'team',
        objectKey: key,
        size,
      }),
    );
  return { root, repository, store, save };
}
test('inspection detects missing, corrupt and unreferenced objects without deleting files or exposing content', async (t) => {
  const f = await fixture(t);
  const good = f.store.put(Buffer.from('good')),
    bad = f.store.put(Buffer.from('bad')),
    orphan = f.store.put(Buffer.from('private orphan'));
  await f.save('a', good, 4);
  await f.save('b', bad, 3);
  await f.save('c', 'a'.repeat(64), 7);
  fs.writeFileSync(join(f.root, bad), 'xxx');
  const before = fs.readdirSync(f.root).sort();
  const report = await inspectStorage(f.repository, f.root);
  assert.equal(report.counts.verified, 1);
  assert.equal(report.counts.corrupt, 1);
  assert.equal(report.counts.missing, 1);
  assert.equal(report.counts.unreferencedCandidates, 1);
  assert.equal(report.snapshotAtomic, false);
  assert.ok(!JSON.stringify(report).includes('private orphan'));
  assert.deepEqual(fs.readdirSync(f.root).sort(), before);
  assert.equal(f.store.read(orphan).toString(), 'private orphan');
});
test('partial references suppress orphan inference and hashing respects its budget', async (t) => {
  const f = await fixture(t),
    one = f.store.put(Buffer.from('one')),
    two = f.store.put(Buffer.from('two'));
  await f.save('a', one, 3);
  await f.save('b', two, 3);
  const partial = await inspectStorage(f.repository, f.root, {
    limit: 1,
    verifyBytes: 0,
  });
  assert.equal(partial.referencesPartial, true);
  assert.equal(partial.counts.unreferencedCandidates, 0);
  assert.equal(partial.counts.unverified, 1);
  assert.equal(partial.verifiedBytes, 0);
});
test('inspection during uncommitted publication remains advisory; symlinks are never followed', async (t) => {
  const f = await fixture(t),
    key = f.store.put(Buffer.from('pending'));
  assert.equal(
    (await inspectStorage(f.repository, f.root)).counts.unreferencedCandidates,
    1,
  );
  await f.save('a', key, 7);
  assert.equal(
    (await inspectStorage(f.repository, f.root)).counts.unreferencedCandidates,
    0,
  );
  const link = 'b'.repeat(64);
  fs.symlinkSync(join(f.root, key), join(f.root, link));
  await f.save('b', link, 7);
  assert.equal(
    (await inspectStorage(f.repository, f.root)).counts.unavailable,
    1,
  );
});

test('inspection tolerates concurrent publication and delayed reference commits', async (t) => {
  const f = await fixture(t);
  const { execFile } = require('node:child_process');
  const run = require('node:util').promisify(execFile);
  const modulePath = require('node:path').resolve(
    __dirname,
    '../../storage/src/local-objects.cjs',
  );
  let active = true;
  const writers = Promise.all(
    Array.from({ length: 3 }, (_, writer) =>
      run(process.execPath, [
        '-e',
        `
    const {localObjects,putWithRetry}=require(process.argv[1]);
    const store=localObjects(process.argv[2]);
    (async()=>{ for(let i=0;i<8;i++) {
      const bytes=Buffer.from(process.argv[3]+':'+i);
      console.log(JSON.stringify({key:await putWithRetry(store,bytes),size:bytes.length}));
      await new Promise(resolve=>setTimeout(resolve,30));
    } })();
  `,
        modulePath,
        f.root,
        String(writer),
      ]).then(async (result) => {
        for (const line of result.stdout.trim().split('\n')) {
          const item = JSON.parse(line);
          await f.save(item.key, item.key, item.size);
        }
      }),
    ),
  );
  writers
    .finally(() => {
      active = false;
    })
    .catch(() => {});
  let snapshots = 0;
  while (active) {
    const report = await inspectStorage(f.repository, f.root);
    assert.equal(report.counts.corrupt, 0);
    assert.equal(report.counts.missing, 0);
    snapshots++;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await writers;
  const final = await inspectStorage(f.repository, f.root);
  assert.ok(snapshots > 1);
  assert.equal(final.counts.verified, 24);
  assert.equal(final.counts.unreferencedCandidates, 0);
});
