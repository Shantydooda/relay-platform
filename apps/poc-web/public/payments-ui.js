'use strict';
const RelayPayments = {
  backlog() {
    const data = state.operationsBacklog;
    if (!data) return '';
    return `<details class="panel"><summary>Work health & alerts</summary><p>Saved-state snapshot · ${escape(date(data.observedAt))}. Counts cover up to 1,000 records per category, not a live provider check. Use Refresh to update.</p>${data.partial ? '<p role="status">Partial scan: some categories have more records than this view can inspect.</p>' : ''}<div class="tool-library-grid">${data.groups.map(group => `<section class="panel"><h3>${escape(group.label)}</h3><p>${Object.entries(group.counts).map(([status,count]) => `${escape(status.replaceAll('_',' '))}: ${count}`).join(' · ') || 'No pending work'}${group.truncated ? ' · Partial counts' : ''}</p><small>Oldest observed state: ${group.oldestAgeMs === null ? 'Unknown / not applicable' : `${Math.floor(group.oldestAgeMs / 60000)} min`}</small>${group.alerts.length ? `<details><summary>Review ${group.alerts.length} ${group.alerts.length === 1 ? 'alert' : 'alerts'}</summary>${group.alerts.map(alert => `<p><strong>${escape(alert.state.replaceAll('_',' '))}</strong><br>${escape(alert.action)}<br><small>Record ${escape(alert.id)}</small></p>`).join('')}<small>Up to 20 alerts shown per category.</small></details>` : ''}</section>`).join('')}</div></details>`;
  },
  recovery() {
    const data = state.recoveryData || { items: [] };
    const labels = {needs_review:'Needs review',retrying:'Retrying',checking:'Checking now',overdue:'Check overdue',scheduled:'Scheduled'};
    const stamp = value => value ? new Date(value).toLocaleString() : 'Not checked yet';
    return `<section class="market-workspace"><header class="builder-page-title"><div><span class="eyebrow">Operations · sandbox only</span><h1>Payment recovery</h1><p>Review a delayed payment. Check its status safely.</p></div><button data-action="recovery-refresh">Refresh</button></header>
      ${this.backlog()}<section class="panel"><strong>${data.configured?'Sandbox checks available':'Stripe is disconnected'}</strong><p>A retry checks the existing operation using its original reference. It never creates a replacement charge, refund or payout. Discrepancies stay paused for investigation.</p></section>
      ${data.items.map(item=>`<article class="panel"><div class="readiness-row"><h2>${escape(item.title)}</h2><span class="tag">${escape(labels[item.status]||item.status)}</span></div>
        <p>${item.amountMinor===null?(item.type==='operator'?'Operator readiness':'No settlement amount available'):money(item.amountMinor, item.currency)+' '+escape(item.currency || 'USD')+' · '+escape((item.paymentStatus||'').replaceAll('_',' '))}</p>
        <p>Last checked: ${escape(stamp(item.lastCheckedAt))} · Failed checks: ${item.failures}</p>
        <p>${escape(item.blockedReason||'The provider check can be retried. Review the details before continuing.')}</p>
        <details><summary>Review details & history</summary><p>Check reference: ${escape(item.id)}</p><p>Next scheduled check: ${escape(stamp(item.nextAt))}</p><p>Reason: ${escape(item.errorCode||'No provider error recorded')}</p>${(item.references||[]).map(ref=>`<p>${escape(ref.type)}: ${escape(ref.id)}</p>`).join('')}${item.history.map(entry=>`<p>${escape(stamp(entry.createdAt))} · ${escape(entry.reason)}</p>`).join('')||'<p>No manual retries recorded.</p>'}</details>
        ${item.canRetry?`<form class="market-form" data-recovery="${escape(item.id)}" data-snapshot="${escape(item.snapshot)}"><label>Why are you retrying?<textarea name="reason" minlength="10" maxlength="500" required placeholder="What did you review or resolve?"></textarea></label><p class="hint">This queues a check. Confirmation still comes from the provider.</p><div class="form-error" role="alert"></div><button type="submit">Queue safe retry</button></form>`:''}</article>`).join('')||'<div class="empty-box"><h2>No payment checks yet</h2><p>Sandbox payment checks will appear here. No fixture data is added to your account.</p></div>'}
      <div class="action-row">${state.recoveryAfter?'<button data-action="recovery-first">First page</button>':''}${data.next?`<button data-action="recovery-next" data-after="${escape(data.next)}">Next checks</button>`:''}<button data-action="recovery-close">Back to workspace</button></div></section>`;
  },
  settings() {
    const status = state.payments;
    const connected = !!status?.configured;
    return `<section class="panel"><span class="eyebrow">Sandbox only · no real money</span><h2>Operator verification & payouts</h2>
      <p>One operator account covers all your agents. Capability qualification remains separate.</p>
      <div class="readiness-row"><strong>Stripe sandbox</strong><span class="tag">${connected?'Connected':'Not connected'}</span></div>
      <div class="readiness-row"><strong>Operator readiness</strong><span class="tag">${escape((status?.operator?.status||'not_started').replaceAll('_',' '))}</span></div>
      <p>Complete identity and payout setup on Stripe. Relay does not collect identity documents or bank details.</p>
      ${connected?`<form id="sandbox-operator" class="market-form"><label>Operator country (two-letter code)<input name="country" pattern="[A-Z]{2}" maxlength="2" placeholder="US" value="${escape(status?.operator?.country||'')}" required></label><div class="form-error" role="alert"></div><button type="submit">Continue sandbox onboarding</button></form><button data-action="sandbox-operator-refresh">Check onboarding status</button>`:'<p class="blocked-note">Integration prepared. Connect a Stripe sandbox before testing onboarding. Your account is not marked verified and paid work stays disabled.</p>'}
      <p class="hint">A completed redirect does not confirm verification. Sandbox readiness is not production identity verification.</p></section>`;
  },
  async exportCsv() {
    const report = state.spendingHistory;
    if (!report?.csv) throw new Error('Refresh the report before exporting.');
    const chunks = [];
    if (report.snapshotId) {
      for (let page = 0; page < report.pageCount; page++) {
        const part = await api('/api/payments/history?tenantId='+encodeURIComponent(report.tenantId)+'&snapshot='+encodeURIComponent(report.snapshotId)+'&page='+page);
        if (part.snapshotId !== report.snapshotId || part.page !== page || part.currency !== report.currency || JSON.stringify(part.totals) !== JSON.stringify(report.totals)) throw new Error('Report changed. Refresh totals before exporting.');
        chunks.push(part.csv);
      }
    } else chunks.push(report.csv);
    const url = URL.createObjectURL(new Blob(chunks, {type:'text/csv;charset=utf-8'}));
    const link = document.createElement('a');
    link.href=url; link.download=`relay-spending-${report.currency || 'USD'}-${report.period.from || 'all'}-${report.period.to || 'now'}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  },
  billing() {
    const data = state.spendingHistory;
    if (!data) return '<section class="market-workspace"><h1>History & spend</h1><p>History is unavailable. Reopen this section to try again.</p></section>';
    const stamp = value => new Date(value).toLocaleString(undefined, {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    const amount = value => money(value, data.currency);
    const totals = data.totals;
    const range = data.period.from || data.period.to ? `${data.period.from || 'Beginning'} to ${data.period.to || 'Now'} (UTC)` : 'All time';
    const metrics = [
      ['Released for work', totals.releasedMinor, 'Confirmed transfers to builders for accepted work.'],
      ['Closing held balance', totals.heldMinor, 'Money still held at the end of this period, or the report snapshot if earlier.'],
      ['Refunded', totals.refundedMinor, 'Refunds confirmed by the payment provider.']
    ];
    const labels = {funding:'Funding confirmed',refund:'Refund confirmed',release:'Released to builder'};
    return `<section class="market-workspace spending-history">
      <header class="builder-page-title"><div><span class="eyebrow">${escape(data.scope)} · ${escape(range)}</span><h1>History & spend</h1><p>A complete breakdown of your work and confirmed money movements.</p></div><button data-action="buyer-nav" data-tab="billing">Refresh totals</button></header>
      <form id="spending-filter" class="spending-filters"><label>Currency<select name="currency">${['USD','EUR'].map(currency=>`<option value="${currency}" ${data.currency===currency?'selected':''}>${currency}</option>`).join('')}</select></label><label>From (UTC)<input type="date" name="from" value="${escape(data.period.from)}"></label><label>Through (UTC)<input type="date" name="to" value="${escape(data.period.to)}"></label><button type="submit">Apply dates</button><button type="button" data-action="spending-all">All time</button><button type="button" data-action="spending-export">Export CSV</button><div class="form-error" role="alert"></div></form>
      <p class="hint">Confirmed movements are filtered by transaction date, including the entire end date in UTC. CSV exports the displayed snapshot, including the TOTAL row. Current quotes, statuses and pending amounts are not historical balances.</p>
      <p class="hint">Sandbox only · no real money moved · ${escape(data.currency)} · Updated ${escape(stamp(data.observedAt))}. Dates use your device’s time zone.</p>
      <div class="spending-summary">${metrics.map(([label,value,help])=>`<section class="panel"><span>${label}</span><strong>${amount(value)}</strong><p class="hint">${help}</p></section>`).join('')}</div>
      <section class="panel"><h2>Funding breakdown</h2><dl class="spending-breakdown">
        <div><dt>Opening held balance</dt><dd>${amount(totals.openingHeldMinor)}</dd></div>
        <div><dt>Confirmed funding in period</dt><dd>${amount(totals.fundedMinor)}</dd></div>
        <div><dt>Refunds in period</dt><dd>− ${amount(totals.refundedMinor)}</dd></div>
        <div><dt>Net funding in period</dt><dd>${amount(totals.netMinor)}</dd></div>
        <div><dt>Opening held + funding − refunds − released = closing held</dt><dd>${amount(totals.openingHeldMinor)} + ${amount(totals.fundedMinor)} − ${amount(totals.refundedMinor)} − ${amount(totals.releasedMinor)} = ${amount(totals.heldMinor)}</dd></div>
      </dl><p class="hint">Builder bank payouts do not charge you again. The current sandbox has no platform fee; this is not a tax invoice.</p>
      <details><summary>Pending now · not filtered by dates</summary><p>Awaiting funding confirmation: <strong>${amount(totals.pendingFundingMinor)}</strong></p><p>Awaiting refund confirmation: <strong>${amount(totals.pendingRefundMinor)}</strong> — included in current held funds until confirmed, not necessarily the historical closing balance.</p></details></section>
      <section class="panel"><h2>Work history <span class="tag">${data.itemCount ?? data.items.length}</span></h2><p class="hint">Page ${(data.page ?? 0)+1} of ${data.pageCount ?? 1} · Ordered by task reference. Totals cover every page. Export includes the complete saved report.</p>
      ${data.items.map(item=>`<article class="spending-row"><div class="spending-row-heading"><div><button class="quiet" data-action="task" data-id="${escape(item.id)}">${escape(item.title)}</button><p class="hint">${escape(stamp(item.createdAt))} · ${escape(item.status.replaceAll('_',' '))}</p></div><div><strong>${amount(item.releasedMinor)}</strong><small>Released for work</small></div></div>
      <details><summary>Cost breakdown & transaction history</summary><dl class="spending-breakdown">
      ${[['Opening held balance',amount(item.openingHeldMinor)],['Selected offer now',item.agreedMinor===null?'No offer selected':amount(item.agreedMinor)],['Confirmed funding',amount(item.fundedMinor)],['Released for work',amount(item.releasedMinor)],['Closing held balance',amount(item.heldMinor)],['Confirmed refunds',amount(item.refundedMinor)],['Pending funding now',amount(item.pendingFundingMinor)],['Pending refund now',amount(item.pendingRefundMinor)]].map(([label,value])=>`<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}
      </dl><p>Current payment status: ${escape(item.paymentStatus.replaceAll('_',' '))}</p><p class="hint">A selected offer is a quote, not proof of payment. A pending refund is not yet returned.</p>
      ${item.transactions.map(entry=>`<section class="spending-transaction"><div class="readiness-row"><strong>${labels[entry.kind]}</strong><strong>${amount(entry.amountMinor)}</strong></div><p>${escape(stamp(entry.createdAt))}</p><dl><dt>Transaction reference</dt><dd>${escape(entry.reference)}</dd><dt>Agreement</dt><dd>${escape(entry.offerId || 'Not recorded')} · scope version ${escape(String(entry.scopeVersion ?? 'Not recorded'))}</dd><dt>Settlement</dt><dd>${escape(entry.settlementId)}</dd></dl></section>`).join('')||'<p>No confirmed money movements in this period.</p>'}
      <p class="hint">Task reference: ${escape(item.id)}</p></details></article>`).join('')||'<div class="empty-box"><h3>No work in this period</h3><p>Try a different date range or view your full history.</p><button data-action="spending-all">Show all history</button></div>'}
      <nav class="action-row" aria-label="History pages">${data.page > 0 ? `<button data-action="spending-page" data-page="${data.page-1}">Previous</button>` : ''}${data.nextPage != null ? `<button data-action="spending-page" data-page="${data.nextPage}">Next</button>` : ''}</nav>
      </section></section>`;
  },
  task(task, payment, builder = false, execution = null) {
    if (!payment && (!state.payments?.configured || builder || !task.selectedOfferId)) return '';
    const labels = {creating_checkout:'Preparing checkout',awaiting_payment:'Awaiting test payment',funded:'Test funding confirmed',expired:'Checkout expired',creating_refund:'Requesting refund',refund_pending:'Refund pending',refunded:'Refund confirmed',refund_failed:'Refund needs review',creating_transfer:'Transferring test funds',transferred:'In operator balance',creating_payout:'Requesting payout',payout_pending:'Payout pending',paid:'Sandbox payout confirmed',payout_failed:'Payout needs review'};
    const button = (action,label) => `<button data-action="sandbox-payment" data-operation="${action}" data-id="${escape(task.id)}" data-version="${task.version}">${label}</button>`;
    const needsReview = payment?.reconciliation?.status === 'needs_review';
    const approvalNeeded = !builder && task.companyApprovalRequired && task.approvalStatus !== 'approved';
    let actions = '';
    if (!approvalNeeded && !builder && (!payment || ['expired','refunded'].includes(payment.status)) && !execution) actions += button('fund','Fund with test payment');
    if (payment?.status === 'awaiting_payment' && !builder) actions += button('checkout','Open sandbox checkout');
    if (payment && !['paid','refunded','expired','refund_failed','payout_failed'].includes(payment.status)) actions += button('reconcile','Check payment status');
    if (!builder && payment?.status === 'funded' && (!execution || ['cancelled','failed'].includes(execution.status))) actions += button('refund','Request full test refund');
    if (!approvalNeeded && !builder && payment?.status === 'funded' && !execution) actions += `<button data-action="authorize-sandbox">Start funded sandbox task</button>`;
    if (builder && payment?.status === 'funded' && execution?.status === 'accepted') actions += button('transfer','Transfer accepted earnings');
    if (builder && payment?.status === 'transferred') actions += button('payout','Request sandbox payout');
    if (needsReview) actions = '';
    if (approvalNeeded && !execution) actions += `<p class="hint">${task.approvalStatus === 'pending' ? 'Waiting for your reviewer. Funding and starting stay unavailable until this offer is approved.' : 'Request fresh company approval in the budget card above before funding or starting this offer.'}</p>`;
    return `<section class="panel"><span class="eyebrow">Test money only</span><h3>${needsReview?(payment?.status==='refund_failed'?'Refund needs review':payment?.status==='payout_failed'?'Payout needs review':'Payment needs review'):payment?escape(labels[payment.status]||'Needs review'):'Test funding'}</h3>
      <p>${payment?money(payment.amountMinor, payment.currency)+' '+escape(payment.currency || 'USD')+' · ':''}No real money moves. A transfer to the operator balance is separate from a payout.</p>
      <p role="status">${needsReview?'Automatic checks paused for operations review. Your task and payment history are saved; no replacement operation will be created.':payment?.reconciliation?.status==='retrying'?'Provider check delayed. Relay will retry automatically; your saved agreement is unchanged.':state.payments?.configured?'Payment status updates automatically. You can leave this page.':'Automatic checks are paused until Stripe sandbox is connected.'}</p>
      <div class="action-row">${actions}</div>${payment?.status?.endsWith('_failed')?'<p>Provider reconciliation is required. Do not create a replacement payment.</p>':''}
      <p class="hint">Sandbox policy: full refunds before transfer; zero platform fee. Production fees are undecided.</p></section>`;
  },
  earnings() {
    const tasks = state.work.filter(task => task.payment);
    return `<section class="panel"><h2>Sandbox earnings</h2><p>Accepted delivery makes funded work eligible for transfer. Payout confirmation comes separately.</p><p>No real payouts are enabled.</p></section>${tasks.map(task=>`<article class="panel" data-payment-task="${escape(task.id)}"><h3>${escape(task.title)}</h3>${this.task(task,task.payment,true,task.execution)}</article>`).join('')||'<div class="empty-box">No sandbox-funded tasks yet. Unpaid local tasks do not create earnings.</div>'}`;
  }
};
