'use strict';
const RelayApprovals = {
  money(minor) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(minor / 100);
  },
  task(task, approval) {
    if (!approval) return '';
    const requestAction = state.detail?.actions?.approvals?.request;
    const currentOffer = state.offers?.find(
      (offer) => offer.id === task.selectedOfferId,
    );
    const endedUnpaid =
      state.detail.execution?.paymentStatus === 'not_applicable_local_unpaid' &&
      ['accepted', 'cancelled', 'failed'].includes(
        state.detail.execution.status,
      );
    const labels = {
      required: 'Company approval needed',
      pending: 'Waiting for budget approval',
      approved: 'Budget approved',
      declined: 'Changes requested',
      stale: 'A fresh approval is needed',
    };
    return `<section class="panel scope-recap" aria-label="Company approval"><span class="eyebrow">Company budget</span><h2>${endedUnpaid ? 'Approval recorded · allowance released' : approval.status === 'stale' && state.detail.execution ? 'Company access changed' : labels[approval.status] || escape(approval.status)}</h2>
      ${approval.status === 'stale' && currentOffer ? `<p><strong>Now selected:</strong> ${escape(currentOffer.agentName)} · ${this.money(currentOffer.amountMinor)} · scope v${task.scopeVersion}</p>` : ''}
      ${approval.invalidatedReason ? `<p role="status">${escape(approval.invalidatedReason)}</p>` : ''}
      ${approval.agreement ? `<p>${approval.status === 'stale' ? 'Previous request: ' : ''}${escape(approval.agreement.agentName)} · ${this.money(approval.agreement.amountMinor)} · scope v${approval.agreement.scopeVersion}</p>` : ''}
      ${approval.decisionNote ? `<p><strong>${approval.status === 'stale' ? 'Previous reviewer’s note' : 'Reviewer’s note'}</strong><br>${escape(approval.decisionNote)}</p>` : ''}
      ${approval.status === 'approved' && state.detail.execution ? '<p>Approval is recorded against this agreement. Unpaid local work releases its allowance when accepted, cancelled or failed. Funded commitments remain until refunded.</p>' : approval.status === 'approved' ? '<p>Reserved for this exact offer. Changing the offer or scope requires a new approval. Starting local work remains unpaid.</p>' : approval.status === 'pending' ? '<p>Your reviewer can approve or decline in the business workspace. No budget is reserved until approval.</p>' : '<p>Choose an offer, explain why you need it, and send it to your company reviewer. Keep any revisions on this task.</p>'}
      ${['required', 'declined', 'stale'].includes(approval.status) && task.selectedOfferId && !state.detail.execution ? `<form id="approval-request" class="market-form"><label>Why is this work needed?<textarea name="note" maxlength="2000" required></textarea></label><div class="form-error" role="alert"></div><button class="primary" type="submit" ${requestAction?.allowed ? '' : 'disabled'}>${approval.status === 'required' ? 'Request approval' : 'Resubmit for approval'}</button>${!requestAction?.allowed ? `<p class="hint">${escape(requestAction?.reason || 'Refresh to check whether approval can be requested.')}</p>` : ''}</form>` : ''}
      <button class="quiet" data-action="refresh">Refresh approval status</button></section>`;
  },
  workspace() {
    const data = state.companyBudget;
    if (!data) return '';
    const budget = data.budget,
      role = state.team.role;
    return `<section class="business-card business-budget"><header class="business-section-heading"><div><h2>Budget & approvals</h2><p>Review requests. Keep every decision tied to an offer.</p></div><span class="tag">Local allowance · no charges</span></header>
      ${budget ? `<div class="business-budget-stats"><div><span>Available</span><strong>${this.money(budget.availableMinor)}</strong><small>Ready to allocate</small></div><div><span>Reserved</span><strong>${this.money(budget.reservedMinor)}</strong><small>Approved offers</small></div><div><span>Committed</span><strong>${this.money(budget.committedMinor)}</strong><small>Funded commitments</small></div></div>` : '<p>An administrator needs to set an allowance before requests can be approved.</p>'}
      ${role === 'owner' ? `<details class="business-budget-settings"><summary>${budget ? 'Manage allowance' : 'Set a company allowance'}</summary><p class="hint">Fixed USD allowance, with no monthly reset. Reservations are spending permissions, not charges.</p><form id="company-budget" class="market-form"><label>Total allowance (USD)<input name="limit" type="number" min="0" max="1000000" step="0.01" value="${budget ? budget.limitMinor / 100 : ''}" required></label><div class="form-error" role="alert"></div><button type="submit">Save allowance</button></form></details>` : ''}
      <h3>${role === 'employee' ? 'Your approval requests' : 'Requests to review'}</h3>
      ${
        data.requests.length
          ? data.requests
              .map(
                (
                  r,
                ) => `<article class="business-approval"><span class="tag">${r.superseded ? 'Previous request · ' : ''}${escape(r.status)}${r.reservation === 'released' ? ' · allowance released' : ''}</span><h3>${escape(r.agreement.title)}</h3><p>${escape(r.agreement.agentName)} · ${this.money(r.agreement.amountMinor)} · scope v${r.agreement.scopeVersion}</p><p class="hint">Offer ${escape(r.agreement.offerId.slice(0, 8))} · expires ${escape(new Date(r.agreement.expiresAt).toLocaleString())}</p><details><summary>Scope & request reason</summary><p>${escape(r.agreement.brief)}</p><p><strong>Reason</strong><br>${escape(r.note)}</p></details>${r.invalidatedReason ? `<p>${escape(r.invalidatedReason)}</p>` : ''}${r.decisionNote ? `<p><strong>Decision</strong><br>${escape(r.decisionNote)}</p>` : ''}
      ${role !== 'approver' ? `<button class="quiet" data-action="task" data-id="${escape(r.taskId)}">Open task conversation</button>` : ''}
      ${r.status === 'pending' && !r.superseded && role !== 'employee' ? `<form data-approval-task="${escape(r.taskId)}" data-approval-id="${escape(r.id)}" data-version="${r.version}" class="market-form"><label>Decision<select name="decision"><option value="approved" ${r.actions?.approve?.allowed ? '' : 'disabled'}>Approve & reserve budget</option><option value="declined" ${!r.actions?.approve?.allowed && r.actions?.decline?.allowed ? 'selected' : ''} ${r.actions?.decline?.allowed ? '' : 'disabled'}>Decline with feedback</option></select></label><label>Note to requester<textarea name="note" maxlength="2000" required></textarea></label><div class="form-error" role="alert"></div><button type="submit" ${r.actions?.approve?.allowed || r.actions?.decline?.allowed ? '' : 'disabled'}>Send decision</button>${!r.actions?.approve?.allowed ? `<p class="hint">${escape(r.actions?.approve?.reason || 'Refresh to check decision availability.')}</p>` : ''}</form>` : ''}</article>`,
              )
              .join('')
          : '<div class="business-empty"><strong>All clear for now.</strong><p>Requests appear here when a teammate selects an offer and asks for approval.</p></div>'
      }<div class="inline-actions">${state.budgetAfter ? '<button data-action="approval-first">First page</button>' : ''}${data.hasMore ? '<button data-action="approval-next">Next requests</button>' : ''}</div></section>`;
  },
};
