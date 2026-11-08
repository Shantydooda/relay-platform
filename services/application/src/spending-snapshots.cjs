'use strict';
const { randomUUID, createHash } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const { summarizeSpending } = require('./spending.cjs');
const { reportingPeriod, applyPeriod, spendingCsv } = require('./spending-report.cjs');
const PAGE_SIZE = 25;
const TTL = 30 * 60 * 1000;
const MAX_ITEMS = 10000;
const MAX_BYTES = 32 * 1024 * 1024;
const authority = member => createHash('sha256').update(JSON.stringify(member)).digest('hex');

function createSpendingReports({ repository, taskView, now }) {
  return async function spendingHistory(actor, tenantId, filters = {}) {
    if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'An active account is required.');
    const member = actor.memberships.find(item => item.id === tenantId);
    if (!member) fail(404, 'NOT_FOUND', 'Workspace not found.');
    const currency = filters.currency || 'USD';
    if (!['USD','EUR'].includes(currency)) fail(400, 'CURRENCY_UNSUPPORTED', 'Choose USD or EUR for the report.');
    const ownerId = actor.user.id;
    const stamp = authority(member);
    const page = filters.page === undefined ? 0 : Number(filters.page);
    if (!Number.isInteger(page) || page < 0 || page >= MAX_ITEMS / PAGE_SIZE)
      fail(400, 'INVALID_REPORT_PAGE', 'Choose a valid report page.');
    const readPage = async (repo, meta) => {
      if (!meta || meta.ownerId !== ownerId || meta.tenantId !== tenantId || meta.authority !== stamp)
        fail(404, 'NOT_FOUND', 'Report not found. Refresh to prepare a report for your current access.');
      if (meta.expiresAt <= now()) fail(410, 'REPORT_EXPIRED', 'This report expired. Refresh totals to prepare a new snapshot.');
      if (page >= meta.pageCount) fail(400, 'INVALID_REPORT_PAGE', 'Report page is out of range.');
      const saved = await repo.get('spending-report-page', `${meta.id}:${page}`);
      if (!saved) fail(409, 'REPORT_INCOMPLETE', 'Refresh totals to prepare a complete report.');
      const report = { items: saved.items, totals: meta.totals, currency: meta.currency || 'USD', sandbox: true,
        observedAt: meta.observedAt, period: meta.period, scope: meta.scope,
        snapshotId: meta.id, tenantId, expiresAt: meta.expiresAt, page, pageCount: meta.pageCount,
        itemCount: meta.itemCount, nextPage: page + 1 < meta.pageCount ? page + 1 : null };
      return { ...report, csv: spendingCsv(report, { header: page === 0, total: page === meta.pageCount - 1 }) };
    };
    if (filters.snapshot) {
      if (!/^[a-f0-9-]{36}$/.test(filters.snapshot)) fail(400, 'INVALID_REPORT', 'Invalid report reference.');
      return repository.read(async repo => readPage(repo, await repo.get('spending-report', filters.snapshot)));
    }
    if (page !== 0) fail(400, 'INVALID_REPORT_PAGE', 'Prepare a report before selecting a page.');
    const period = reportingPeriod(filters.from, filters.to);
    const build = () => repository.transaction(`spending-report:${ownerId}`, async repo => {
      const existing = await repo.list('spending-report', 'owner_id', ownerId, 100);
      for (const report of existing) if (report.expiresAt <= now()) await repo.deleteSpendingSnapshot(report.id, ownerId);
      // Bound retained snapshots. A fresh report invalidates the oldest beyond
      // five; callers get an explicit error rather than mixing report versions.
      const live = existing.filter(report => report.expiresAt > now()).sort((a, b) => a.observedAt - b.observedAt);
      while (live.length >= 5) await repo.deleteSpendingSnapshot(live.shift().id, ownerId);
      const observedAt = now();
      const id = randomUUID();
      const empty = applyPeriod(summarizeSpending([], [], taskView, observedAt, currency), period);
      const totals = { ...empty.totals };
      let after = '', scanned = 0, bytes = 0, itemCount = 0, pageCount = 0, pending = [];
      const savePage = async items => {
        bytes += Buffer.byteLength(JSON.stringify(items));
        if (bytes > MAX_BYTES) fail(422, 'REPORT_CAPACITY_EXCEEDED', 'Report exceeds the snapshot size limit. No partial report was saved.');
        await repo.save('spending-report-page', { id: `${id}:${pageCount++}`, ownerId, tenantId, items });
      };
      for (;;) {
        const batch = await repo.spendingBatch(tenantId, member.role === 'owner' ? null : ownerId, after);
        if (!batch.tasks.length) break;
        scanned += batch.tasks.length;
        if (scanned > MAX_ITEMS) fail(422, 'REPORT_CAPACITY_EXCEEDED', 'Report exceeds 10,000 source tasks. No partial report was saved.');
        after = batch.tasks.at(-1).id;
        const part = applyPeriod(summarizeSpending(batch.tasks, batch.history, taskView, observedAt, currency), period);
        for (const key of Object.keys(totals)) {
          totals[key] += part.totals[key];
          if (!Number.isSafeInteger(totals[key])) throw new Error('Spending total exceeds supported precision.');
        }
        // Stable task-reference ordering across page boundaries.
        pending.push(...part.items.sort((a, b) => a.id.localeCompare(b.id)));
        itemCount += part.items.length;
        while (pending.length >= PAGE_SIZE) await savePage(pending.splice(0, PAGE_SIZE));
      }
      if (pending.length || pageCount === 0) await savePage(pending);
      const meta = { id, ownerId, tenantId, currency, authority: stamp, observedAt, expiresAt: observedAt + TTL,
        period: empty.period, scope: member.role === 'owner' ? 'workspace' : 'your work', totals, itemCount, pageCount };
      await repo.save('spending-report', meta);
      return readPage(repo, meta);
    }, { snapshot: true });
    // Snapshot creation has no external effects. Retry serialization conflicts
    // from competing refreshes so retained-report limits also stay consistent.
    for (let attempt = 0; ; attempt++) {
      try { return await build(); }
      catch (error) {
        if (error.code !== '40001' || attempt >= 2) throw error;
      }
    }
  };
}
module.exports = { createSpendingReports };
