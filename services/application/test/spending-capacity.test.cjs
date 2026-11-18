'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const task = (id, ownerId = 'buyer', tenantId = 'team') => ({ id, ownerId, tenantId, title: 'Test', createdAt: 1 });

for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: spending caps fail closed and apply only to authorized records`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repo = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    await repo.transaction('seed', async tx => {
      for (let i = 0; i < 1000; i++) await tx.save('task', task(String(i), 'other'));
      await tx.save('task', task('own'));
      await tx.save('task', task('private', 'buyer', 'elsewhere'));
      await tx.save('sandbox-settlement-history', { id: 'archive', taskId: 'own', ownerId: 'buyer' });
      await tx.save('sandbox-settlement-history', { id: 'private-archive', taskId: 'private', ownerId: 'buyer' });
    });
    await assert.rejects(repo.read(tx => tx.spendingRecords('team', null)), { code: 'REPORT_CAPACITY_EXCEEDED' });
    const own = await repo.read(tx => tx.spendingRecords('team', 'buyer'));
    assert.deepEqual(own.tasks.map(x => x.id), ['own']);
    assert.deepEqual(own.history.map(x => x.id), ['archive']);
    assert.equal((await repo.read(tx => tx.spendingRecords('team', 'other'))).tasks.length, 1000);
    await repo.transaction('large', tx => tx.save('task', { ...task('large', 'large-owner'), data: 'x'.repeat(10 * 1024 * 1024) }));
    await assert.rejects(repo.read(tx => tx.spendingRecords('team', 'large-owner')), { code: 'REPORT_CAPACITY_EXCEEDED' });
    assert.deepEqual(await repo.read(tx => tx.spendingRecords('missing', null)), { tasks: [], history: [] });
  });
}

test('SQLite read snapshot survives a concurrent independent writer and releases after failure', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'relay-report-snapshot-'));
  const first = new DatabaseSync(join(dir, 'db.sqlite'));
  first.exec('PRAGMA journal_mode=WAL');
  const repo = createSqliteRepository(first);
  const second = new DatabaseSync(join(dir, 'db.sqlite'));
  const writer = createSqliteRepository(second);
  t.after(() => { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); });
  await writer.transaction('seed', tx => tx.save('task', task('one')));
  await repo.read(async tx => {
    assert.equal((await tx.spendingRecords('team', null)).tasks.length, 1);
    await writer.transaction('new', tx => tx.save('task', task('two')));
    assert.equal((await tx.spendingRecords('team', null)).tasks.length, 1);
  });
  assert.equal((await repo.read(tx => tx.spendingRecords('team', null))).tasks.length, 2);
  await assert.rejects(repo.read(() => { throw new Error('expected failure'); }), /expected failure/);
  assert.equal((await repo.read(tx => tx.spendingRecords('team', null))).tasks.length, 2);
});
