'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readConfig, adminPool, migrateLocal } = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createSpendingReports } = require('../../src/spending-snapshots.cjs');

test('native spending snapshot stays exact across a concurrent payment update and restart', async t => {
  const config = readConfig();
  const database = 'relay_reports_' + Date.now();
  const admin = adminPool(config);
  let first, second;
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  t.after(async () => { await first?.close(); await second?.close(); await admin.query(`DROP DATABASE ${database}`); await admin.end(); });
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = { ...config, runtime: { ...config.runtime, database }, migrator: { ...config.migrator, database } };
  await migrateLocal(qa);
  first = await openLocalPostgres(qa.runtime);
  second = await openLocalPostgres(qa.runtime);
  const record = (i, amountMinor = 100) => ({ id: String(i).padStart(6, '0'), ownerId: 'buyer', tenantId: 'team', title: 'Task', createdAt: 1,
    settlement: { id: 's' + i, status: 'funded', ledger: [{ reference: 'r' + i, debit: 'provider_cash', credit: 'buyer_funds', currency: 'USD', amountMinor, createdAt: 1 }] } });
  await first.repository.transaction('seed', async repo => { for (let i = 0; i < 61; i++) await repo.save('task', record(i)); });
  let changed = false;
  const wrapped = { ...first.repository, transaction: (key, work, options) => first.repository.transaction(key, repo => work({ ...repo,
    async spendingBatch(...args) {
      const batch = await repo.spendingBatch(...args);
      if (!changed) {
        changed = true;
        await second.repository.transaction('concurrent-payment', tx => tx.save('task', record(60, 900)));
      }
      return batch;
    },
  }), options) };
  const actor = { user: { id: 'buyer' }, memberships: [{ id: 'team', role: 'owner' }] };
  const options = { now: () => 100, taskView: () => ({ status: 'posted' }) };
  const original = await createSpendingReports({ ...options, repository: wrapped })(actor, 'team');
  assert.equal(original.totals.fundedMinor, 6100);
  await first.close();
  first = await openLocalPostgres(qa.runtime);
  const reports = createSpendingReports({ ...options, repository: first.repository });
  const last = await reports(actor, 'team', { snapshot: original.snapshotId, page: 2 });
  assert.equal(last.items.find(item => item.id === '000060').fundedMinor, 100);
  assert.equal(last.totals.fundedMinor, 6100);
  assert.equal((await reports(actor, 'team')).totals.fundedMinor, 6900);
  const otherReports = createSpendingReports({ ...options, repository: second.repository });
  for (let i = 0; i < 4; i++) {
    const pair = await Promise.all([reports(actor, 'team'), otherReports(actor, 'team')]);
    assert.ok(pair.every(report => report.totals.fundedMinor === 6900));
  }
  assert.equal((await first.repository.read(repo => repo.list('spending-report', 'owner_id', 'buyer', 100))).length, 5);
});
