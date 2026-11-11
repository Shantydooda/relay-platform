'use strict';

const fields = [
  'fundedMinor',
  'refundedMinor',
  'releasedMinor',
  'heldMinor',
  'netMinor',
  'pendingFundingMinor',
  'pendingRefundMinor',
];
const emptyTotals = () => Object.fromEntries(fields.map((field) => [field, 0]));

// Confirmed ledger movements, rather than checkout/transfer UI states, are the
// source of financial totals. A payout is not a second buyer expense.
function summarizeSpending(tasks, history, taskView, now, currency = 'USD') {
  if (!['USD', 'EUR'].includes(currency)) throw new Error('Unsupported report currency.');
  const archived = new Map();
  for (const settlement of history) {
    if (!archived.has(settlement.taskId)) archived.set(settlement.taskId, []);
    archived.get(settlement.taskId).push(settlement);
  }
  const items = tasks
    .map((task) => {
      const totals = emptyTotals();
      const settlements = new Map(
        (archived.get(task.id) || []).map((item) => [item.id, item]),
      );
      if (task.settlement) settlements.set(task.settlement.id, task.settlement);
      const transactions = [];
      for (const settlement of settlements.values()) {
        const settlementCurrency = settlement.currency || 'USD';
        if (!['USD', 'EUR'].includes(settlementCurrency) || (settlement.ledger || []).some(entry => entry.currency !== settlementCurrency)) throw new Error('Invalid spending ledger currency.');
        if (settlementCurrency !== currency) continue;
        const seen = new Set();
        for (const entry of settlement.ledger || []) {
          if (seen.has(entry.reference)) continue;
          seen.add(entry.reference);
          const kind =
            entry.debit === 'provider_cash' && entry.credit === 'buyer_funds'
              ? 'funding'
              : entry.debit === 'buyer_funds' &&
                  entry.credit === 'provider_cash'
                ? 'refund'
                : entry.debit === 'buyer_funds' &&
                    entry.credit === 'operator_balance'
                  ? 'release'
                  : null;
          if (!kind) continue;
          if (
            entry.currency !== currency ||
            !Number.isSafeInteger(entry.amountMinor) ||
            entry.amountMinor < 0
          ) {
            throw new Error(
              'Invalid spending ledger entry; totals cannot be reported safely.',
            );
          }
          totals[
            {
              funding: 'fundedMinor',
              refund: 'refundedMinor',
              release: 'releasedMinor',
            }[kind]
          ] += entry.amountMinor;
          transactions.push({
            kind,
            reference: entry.reference,
            settlementId: settlement.id,
            offerId: settlement.offerId,
            scopeVersion: settlement.scopeVersion,
            amountMinor: entry.amountMinor,
            currency: entry.currency,
            createdAt: entry.createdAt,
          });
        }
        if (
          ['creating_checkout', 'awaiting_payment'].includes(settlement.status)
        )
          totals.pendingFundingMinor += settlement.amountMinor;
        if (['creating_refund', 'refund_pending'].includes(settlement.status))
          totals.pendingRefundMinor += settlement.amountMinor;
      }
      totals.netMinor = totals.fundedMinor - totals.refundedMinor;
      totals.heldMinor = totals.netMinor - totals.releasedMinor;
      if (
        totals.heldMinor < 0 ||
        Object.values(totals).some((value) => !Number.isSafeInteger(value))
      ) {
        throw new Error('Spending ledger does not reconcile.');
      }
      const offer = (task.offers || []).find(
        (item) => item.id === task.selectedOfferId,
      );
      return {
        id: task.id,
        title: task.title,
        createdAt: task.createdAt,
        status: taskView(task, now).status,
        paymentStatus: task.settlement?.status || 'unfunded',
        agreedMinor: offer && (offer.currency || 'USD') === currency ? offer.amountMinor : null,
        offerId: offer?.id || null,
        ...totals,
        transactions: transactions.sort((a, b) => b.createdAt - a.createdAt),
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  const totals = emptyTotals();
  for (const item of items)
    for (const field of fields) {
      totals[field] += item[field];
      if (!Number.isSafeInteger(totals[field]))
        throw new Error('Spending total exceeds supported precision.');
    }
  return { items, totals, currency, sandbox: true, observedAt: now };
}
module.exports = { summarizeSpending };
