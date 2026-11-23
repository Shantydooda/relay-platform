'use strict';

// Acceptance checklist and the "end as unmet" exit (docs/Decisions-Needed.md §2).
// The server decides what is allowed; this file only shows it and sends commands.
const RelayAcceptance = {
  MAX: 12,
  criteria() {
    return state.detail?.acceptance?.criteria || state.detail?.task?.acceptanceCriteria || [];
  },
  // The checklist can change only before work is authorized or funded.
  editable(task) {
    const payment = state.detail?.task?.id === task.id ? state.detail.payment : null;
    return !task.orchestrationPlan && !task.orchestrationStep && !task.scheduleId && !task.recurringScheduleId &&
      !(state.detail?.task?.id === task.id && state.detail.execution) &&
      ['draft', 'posted', 'selected'].includes(task.status) &&
      !(payment && !['expired', 'refunded'].includes(payment.status));
  },
  list(criteria, unmet = []) {
    if (!criteria?.length) return '';
    return `<ul class="acceptance-list">${criteria.map(item => {
      const missed = unmet.includes(item.id);
      return `<li class="${missed ? 'unmet' : ''}">${escape(item.text)}${missed ? ' <span class="tag">Not met</span>' : ''}</li>`;
    }).join('')}</ul>`;
  },
  // Read-only "done when" block for offers, the agreement and builder views.
  summary(criteria, unmet = [], heading = 'Done when') {
    if (!criteria?.length) return '';
    return `<div class="acceptance-summary"><h3>${escape(heading)}</h3>${this.list(criteria, unmet)}<p class="hint">Fixes needed to meet this checklist are included in the agreed price.</p></div>`;
  },
  // Editor shown with the brief, before work starts.
  scope(task) {
    const criteria = task.acceptanceCriteria || [];
    if (!this.editable(task)) return this.summary(criteria);
    const count = criteria.length;
    const label = count ? `Acceptance checklist · ${count} item${count === 1 ? '' : 's'}` : 'Add an acceptance checklist · optional';
    const posted = task.status !== 'draft';
    const form = `<form id="acceptance-criteria" class="market-form" data-id="${escape(task.id)}">
        <label for="acceptance-criteria-text">What must be true for you to accept the work? One check per line, up to ${this.MAX}.</label>
        <textarea id="acceptance-criteria-text" name="criteria" rows="4" maxlength="3900" placeholder="Every duplicate row is removed&#10;Rows are sorted by email">${escape(criteria.map(item => item.text).join('\n'))}</textarea>
        <p class="hint">The agent fixes anything on this list at no extra cost until it’s met. After two rounds of changes you can end the work if it still isn’t.${posted ? ' Saving changes the scope, so current offers will need updating.' : ''}</p>
        <div class="form-error" role="alert"></div><button type="submit">Save checklist</button>
      </form>`;
    // Once saved, show the list and keep the editor one click away instead of repeating it.
    return `<details class="acceptance-scope" data-disclosure-key="acceptance-${escape(task.id)}"><summary>${label}</summary>
      ${count ? `${this.list(criteria)}<details class="acceptance-edit"><summary>Edit checklist</summary>${form}</details>` : form}</details>`;
  },
  parse(value) {
    return String(value || '').split('\n').map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  },
  async save(form, value) {
    const task = state.detail.task;
    const criteria = this.parse(value);
    if (criteria.length > this.MAX) throw new Error(`Keep the checklist to ${this.MAX} items.`);
    await command(`/api/tasks/${task.id}/acceptance-criteria`, 'PUT', { expectedVersion: task.version, criteria });
    const posted = task.status !== 'draft';
    await refresh();
    render();
    notice.textContent = criteria.length
      ? `Checklist saved.${posted ? ' Agents need to update their offers for the new scope.' : ''}`
      : 'Checklist cleared.';
  },
  checks(name, criteria, selected = []) {
    if (!criteria.length) return '';
    return `<fieldset class="acceptance-checks"><legend>Which checks aren’t met yet?</legend>${criteria.map(item =>
      `<label class="check-label"><input type="checkbox" name="${escape(name)}" value="${escape(item.id)}" ${selected.includes(item.id) ? 'checked' : ''}>${escape(item.text)}</label>`).join('')}</fieldset>`;
  },
  // Added to the revision form: name the unmet checks and see how close the exit is.
  revisionFields() {
    const acceptance = state.detail?.acceptance;
    const criteria = this.criteria();
    if (!acceptance) return this.checks('unmet', criteria);
    const left = Math.max(0, acceptance.endAfterRounds - acceptance.revisionRounds);
    const exit = left === 0 ? '' : `<p class="hint">${left === acceptance.endAfterRounds ? `After ${left} rounds of changes` : 'After this round'} you can end the work if the checklist still isn’t met.</p>`;
    return `${this.checks('unmet', criteria)}${exit}`;
  },
  // "End as unmet" appears only when the server allows it.
  end(task) {
    const eligibility = state.detail?.actions?.execution?.end;
    if (!eligibility?.allowed) return '';
    const latest = (state.detail.submissions || []).findLast(item => item.status === 'revision_requested');
    return `<details class="acceptance-end"><summary>End as unmet</summary><form id="end-unmet" class="market-form">
      <p>The agent had ${state.detail.acceptance.revisionRounds} rounds of changes and the checklist still isn’t met. Ending stops the work and records it as a failed run on the agent’s track record. You can then try another agent.</p>
      ${this.checks('unmet', this.criteria(), latest?.unmetCriteria || [])}
      <label>Reason<textarea name="reason" maxlength="1000" required></textarea></label>
      <p class="hint">${this.refundNote()}</p>
      <div class="form-error" role="alert"></div>${RelayExecution.control(task, 'end', 'End as unmet', 'type="submit" class="danger"')}
    </form></details>`;
  },
  // The server only offers "End as unmet" on held money when it will refund it (payments.cjs `refunds`).
  refundNote() {
    const payment = state.detail.payment;
    if (payment?.status !== 'funded') return 'No money moves.';
    const amount = typeof money === 'function' ? money(payment.amountMinor, payment.currency) : `${payment.currency} ${(payment.amountMinor / 100).toFixed(2)}`;
    return `Your ${escape(amount)} test payment is refunded in full, including Relay’s fee. Nothing is paid to the builder.`;
  },
  async endUnmet(form, data) {
    const task = state.detail.task;
    const result = await command(`/api/tasks/${task.id}/end-unmet`, 'POST', {
      expectedVersion: task.version, reason: data.get('reason'), unmetCriteria: data.getAll('unmet'),
    });
    await refresh();
    render();
    notice.textContent = result?.refund === 'started'
      ? 'Work ended. The refund of your test payment has started. You can try another agent from this conversation.'
      : 'Work ended. You can try another agent from this conversation.';
  },
  // Buyer-facing outcome text for an ended run.
  ended(execution) {
    if (execution?.error !== 'BUYER_ENDED_UNMET') return '';
    return `<p>You ended this work because the checklist wasn’t met. It counts as a failed run for this agent.</p>${this.list(this.criteria(), state.detail.acceptance?.unmetCriteria || [])}`;
  },
};
