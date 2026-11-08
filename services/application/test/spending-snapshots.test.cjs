'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createSpendingReports } = require('../src/spending-snapshots.cjs');
const actor = { user: { id: 'buyer' }, memberships: [{ id: 'team', role: 'owner', version: 1 }] };
function task(index, amount = 101) {
  return { id: String(index).padStart(6, '0'), tenantId: 'team', ownerId: 'buyer', title: '=unsafe,title', createdAt: 1,
    settlement: { id: 'settlement-' + index, status: 'funded', ledger: [{ reference: 'charge-' + index, debit: 'provider_cash', credit: 'buyer_funds', currency: 'USD', amountMinor: amount, createdAt: 1 }] } };
}
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: large reports page and export an immutable exact snapshot with access and expiry checks`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    let time = 100;
    const report = createSpendingReports({ repository, now: () => time, taskView: () => ({ status: 'posted' }) });
    await repository.transaction('seed', async repo => {
      for (let i = 0; i < 1001; i++) await repo.save('task', task(i));
      await repo.save('task', { ...task(9999), tenantId: 'private' });
    });
    const first = await report(actor, 'team');
    assert.equal(first.itemCount, 1001);
    assert.equal(first.items.length, 25);
    assert.equal(first.pageCount, 41);
    assert.equal(first.totals.fundedMinor, 101101);
    await repository.transaction('change', repo => repo.save('task', task(1000, 909)));
    const csv = [];
    const ids = new Set();
    for (let page = 0; page < first.pageCount; page++) {
      const part = await report(actor, 'team', { snapshot: first.snapshotId, page });
      assert.deepEqual(part.totals, first.totals);
      assert.equal(part.observedAt, first.observedAt);
      part.items.forEach(item => { assert.ok(!ids.has(item.id)); ids.add(item.id); });
      csv.push(part.csv);
    }
    assert.equal(ids.size, 1001);
    const lines = csv.join('').trim().replace(/^\uFEFF/, '').split('\r\n');
    assert.equal(lines.length, 1003);
    assert.equal(lines.filter(line => line.startsWith('"TOTAL"')).length, 1);
    assert.equal(lines.filter(line => line.startsWith('"Row type"')).length, 1);
    // Parse quoted CSV, including escaped/untrusted titles, and reconcile all eight columns.
    const values = line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"'));
    const cents = value => Number(value.replace('.', ''));
    const total = values(lines.at(-1));
    for (let column = 8; column < 16; column++) {
      const sum = lines.slice(1, -1).reduce((amount, line) => amount + cents(values(line)[column]), 0);
      assert.equal(sum, cents(total[column]));
    }
    assert.ok(values(lines[1])[2].startsWith("'=unsafe"));
    const refreshed = await report(actor, 'team');
    assert.equal(refreshed.totals.fundedMinor, 101909);
    await assert.rejects(report({ ...actor, user: { id: 'other' } }, 'team', { snapshot: first.snapshotId }), { code: 'NOT_FOUND' });
    await assert.rejects(report({ ...actor, memberships: [{ id: 'team', role: 'employee' }] }, 'team', { snapshot: first.snapshotId }), { code: 'NOT_FOUND' });
    await assert.rejects(report(actor, 'team', { snapshot: first.snapshotId, page: 99 }), { code: 'INVALID_REPORT_PAGE' });
    time += 1800001;
    await assert.rejects(report(actor, 'team', { snapshot: first.snapshotId }), { code: 'REPORT_EXPIRED' });
    const empty = await report(actor, 'team', { from: '2026-01-01', to: '2026-01-01' });
    assert.equal(empty.totals.openingHeldMinor, 101909);
    assert.equal((await repository.read(repo => repo.list('spending-report', 'owner_id', 'buyer'))).length, 1);
  });
}
