'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createAccessBoundary } = require('../src/access-boundary.cjs');
test(
  'nested authorization reads share a transaction but detached work reacquires access',
  { timeout: 3000 },
  async (t) => {
    const db = new DatabaseSync(':memory:');
    t.after(() => db.close());
    const repository = createSqliteRepository(db);
    let entered = 0;
    const guard = repository.accessGuard;
    repository.accessGuard = (work) => {
      entered++;
      return guard(work);
    };
    const b = createAccessBoundary(repository);
    let release, late;
    const later = new Promise((r) => (release = r));
    await b.repository.transaction('write', async (repo) => {
      await repo.save('fixture', { id: 'one', ownerId: 'owner', value: 42 });
      assert.equal(
        (await b.repository.read((current) => current.get('fixture', 'one')))
          .value,
        42,
      );
      late = later.then(() =>
        b.repository.read((current) => current.get('fixture', 'one')),
      );
    });
    assert.equal(entered, 1);
    release();
    assert.equal((await late).value, 42);
    assert.equal(entered, 2);
    await b.repository.read(async () => {
      assert.equal(
        (await b.repository.read((repo) => repo.get('fixture', 'one'))).value,
        42,
      );
    });
    assert.equal(entered, 3);
  },
);
