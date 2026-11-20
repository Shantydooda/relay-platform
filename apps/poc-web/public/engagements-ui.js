'use strict';

// Milestone plans (docs/specs/Engagements-and-Milestones.md; Build-Order step 9).
// A builder can offer a request in 2–6 milestones. The buyer accepts the plan,
// then starts, reviews and accepts one milestone at a time, each on its own page.
const RelayEngagements = {
  MAX: 6,
  STATUS: {
    ready: 'Ready to start', waiting: 'Starts after the one before is accepted', funded: 'Paid, not started',
    in_progress: 'In progress', in_review: 'Delivered · waiting for your review', accepted: 'Accepted',
    failed: 'Ended as unmet', cancelled: 'Cancelled',
  },
  hours(minutes) { return typeof deliveryDuration === 'function' ? deliveryDuration(minutes) : `${minutes} min`; },

  // ---- Builder: the offer form -----------------------------------------
  formFields() {
    const row = i => `<fieldset class="milestone-row"><legend>Milestone ${i + 1}</legend>
      <label>Name<input name="m-title-${i}" minlength="3" maxlength="80" placeholder="${['e.g. Field mapping', 'e.g. Test load', 'e.g. Full load'][i] || ''}"></label>
      <div class="quote-fields"><label>Your price<input type="number" name="m-price-${i}" min="0.01" max="100000" step="0.01"></label>
      <label>Delivery (minutes after it starts)<input type="number" name="m-minutes-${i}" min="1" max="525600" step="1"></label></div>
      <label>How the buyer checks it <small>· one per line</small><textarea name="m-criteria-${i}" rows="2" maxlength="3600"></textarea></label></fieldset>`;
    return `<details class="milestone-fields"><summary>Split into milestones (optional)</summary>
      <p class="hint">For larger work: 2–${this.MAX} stages, each with its own price and checklist. The buyer accepts the plan, then pays for and accepts one milestone at a time; the next can start only after the one before is accepted. Your price and delivery time become the totals. Leave rows empty that you don’t need.</p>
      ${[0, 1, 2].map(row).join('')}<details class="milestone-more"><summary>Add more milestones (up to ${this.MAX})</summary>${Array.from({ length: this.MAX - 3 }, (_, i) => row(i + 3)).join('')}</details></details>`;
  },
  // The filled rows, or null for a single-price offer. A half-filled row is an error.
  formMilestones(data) {
    const rows = [];
    for (let i = 0; i < this.MAX; i++) {
      const value = key => String(data.get(`m-${key}-${i}`) || '').trim();
      const fields = [value('title'), value('price'), value('minutes'), value('criteria')];
      if (fields.every(field => !field)) continue;
      if (fields.some(field => !field)) throw new Error(`Fill in every field of milestone ${i + 1}, or clear it.`);
      rows.push({ title: fields[0], amountMinor: Math.round(Number(fields[1]) * 100), deliveryMinutes: Number(fields[2]),
        criteria: fields[3].split('\n').map(line => line.trim()).filter(Boolean) });
    }
    if (!rows.length) return null;
    if (rows.length < 2) throw new Error('A plan needs at least 2 milestones. For one stage, send a single price.');
    return rows;
  },

  // ---- Buyer: the plan in an offer -------------------------------------
  planSummary(o) {
    if (!o.milestones?.length) return '';
    return `<section class="milestone-plan"><h4>${o.milestones.length} milestones, one at a time</h4><ol>${o.milestones.map(m =>
      `<li><strong>${escape(m.title)}</strong> · ${money(m.totalMinor ?? m.amountMinor, o.currency)} · ${escape(this.hours(m.deliveryMinutes))}<ul>${m.criteria.map(c => `<li>${escape(c.text)}</li>`).join('')}</ul></li>`).join('')}</ol>
      <p class="hint">You pay for each milestone when you start it, and accept it before the next one can start. You can end the plan after any milestone.</p></section>`;
  },
  confirmText(o) {
    return `${escape(o.agentName)} · ${o.milestones.length} milestones, ${money(o.totalMinor ?? o.amountMinor, o.currency)} in total. Nothing is charged now: each milestone is paid for when you start it.`;
  },

  // ---- Buyer: the request page's "Next step" box --------------------------
  nextStep(detail) {
    const e = detail.engagement, m = detail.milestone;
    if (e) {
      if (e.status === 'completed') return ['Plan completed', 'Every milestone is accepted.'];
      const now = e.milestones.find(item => ['ready', 'funded', 'in_progress', 'in_review'].includes(item.status));
      if (e.status === 'ended') return now ? [`Milestone ${now.sequence} carries on`, 'The plan has ended. Accept or end the milestone in progress on its page.'] : ['Plan ended', 'Milestones not started were cancelled. Nothing more is charged.'];
      if (!now) return ['Nothing to start', 'End the plan, or open a milestone to see why it can’t start.'];
      return { ready: [`Start milestone ${now.sequence}`, `Open “${now.title}” to review and start it. It’s paid for when you start it.`],
        funded: [`Start milestone ${now.sequence}`, 'It’s paid for. Open it to start the work.'],
        in_progress: [`Milestone ${now.sequence} in progress`, 'The agent is working on it. You review the delivery against its checklist.'],
        in_review: [`Review milestone ${now.sequence}`, 'A delivery is waiting. Accept it to unlock the next milestone.'] }[now.status];
    }
    if (m && !detail.execution && detail.task.status !== 'cancelled')
      return m.previousAccepted ? ['Start this milestone', 'Review the start requirements. It’s paid for when you start it.']
        : [`Waiting for milestone ${m.sequence - 1}`, 'Each milestone starts after the one before it is accepted.'];
    return null;
  },

  // ---- Buyer: the plan's page ------------------------------------------
  panel(detail) {
    const e = detail.engagement, currency = e.currency;
    const next = e.milestones.find(m => !['accepted', 'cancelled', 'failed'].includes(m.status));
    const heading = { active: 'Milestone plan', completed: 'Plan completed', ended: 'Plan ended' }[e.status];
    const rows = e.milestones.map(m => `<li class="milestone-item milestone-${escape(m.status)}">
      <a href="/tasks/${escape(m.taskId)}" data-route><span class="milestone-step">${m.sequence}</span>
      <span class="milestone-body"><strong>${escape(m.title)}</strong><small>${escape(this.STATUS[m.status] || m.status)} · ${money(m.totalMinor, currency)} · ${escape(this.hours(m.deliveryMinutes))} · ${m.criteria} check${m.criteria === 1 ? '' : 's'}</small></span>
      <span class="mk-next">${m === next && e.status === 'active' ? (m.status === 'ready' ? 'Start' : m.status === 'in_review' ? 'Review' : 'Open') : 'Open'} →</span></a></li>`).join('');
    const canEnd = e.status === 'active' && e.milestones.some(m => ['ready', 'waiting', 'funded'].includes(m.status));
    return `<article class="thread-message relay offer-section" aria-label="Milestone plan"><span class="thread-speaker">Relay</span>
      <section class="panel engagement-panel"><span class="eyebrow">${escape(heading)}</span>
      <p><strong>${escape(e.agentName)}</strong> by ${escape(e.operatorName)} · ${money(e.totals.totalMinor, currency)} in total · ${money(e.totals.acceptedMinor, currency)} accepted so far${e.totals.cancelledMinor ? ` · ${money(e.totals.cancelledMinor, currency)} cancelled` : ''}</p>
      <ol class="milestone-list">${rows}</ol>
      <p class="hint">Each milestone is paid for when you start it and paid out to the builder only when you accept it. Accepted milestones stay accepted whatever happens later.</p>
      ${canEnd ? (state.confirmEndPlan
        ? `<div class="offer-confirm"><p>End the plan? Milestones not started are cancelled and nothing more is charged. ${e.milestones.some(m => ['in_progress', 'in_review'].includes(m.status)) ? 'The milestone in progress carries on until you accept it or end it on its page.' : ''}</p><button class="danger" data-action="end-engagement">End the plan</button><button data-action="keep-engagement">Keep it</button></div>`
        : '<button class="quiet" data-action="confirm-end-engagement">End the remaining milestones</button>') : ''}
      </section></article>`;
  },

  // ---- Buyer: one milestone's page -------------------------------------
  agreement(task, selected) {
    const m = state.detail.milestone;
    const start = !m.previousAccepted ? `<p class="hint">Starts after milestone ${m.sequence - 1} is accepted.</p>`
      : state.detail.approval && state.detail.approval.status !== 'approved' ? '<p class="hint">Company approval is needed. Continue in the approval card below.</p>'
      : state.reviewStart ? '' : '<button class="primary" data-action="review-start">Review and start</button>';
    return `<article class="thread-message relay offer-section" aria-label="Milestone"><span class="thread-speaker">Relay</span>
      <section class="panel selected-agreement"><span class="eyebrow">Milestone ${m.sequence} of ${m.of} · <a href="/tasks/${escape(m.engagementId)}" data-route>${escape(m.engagementTitle || 'the plan')}</a></span>
      <strong class="package-title">${escape(m.title)}</strong>
      <p>${escape(selected?.agentName || '')} · ${money(buyerPrice(selected), selected?.currency)}${priceSplit(selected)} · ${escape(this.hours(selected?.deliveryMinutes || 0))} to delivery after it starts</p>
      <h3>Checklist agreed in the plan</h3><ul>${(task.acceptanceCriteria || []).map(c => `<li>${escape(c.text)}</li>`).join('')}</ul>
      <p class="hint">Fixes are free until the checklist is met. Anything beyond it needs a change request once the milestone starts.</p>
      ${start}</section></article>`;
  },
  banner(detail) {
    const m = detail.milestone;
    return m ? `<p class="milestone-banner">Milestone ${m.sequence} of ${m.of} in <a href="/tasks/${escape(m.engagementId)}" data-route>${escape(m.engagementTitle || 'a plan')}</a></p>` : '';
  },

  // ---- Lists: show the plan once, with where it stands ------------------
  children(task, tasks = state.tasks || []) {
    return tasks.filter(item => item.milestone?.engagementId === task.id).sort((a, b) => a.milestone.sequence - b.milestone.sequence);
  },
  current(task, tasks) {
    return this.children(task, tasks).find(item => !['accepted', 'cancelled', 'failed'].includes(item.status));
  },
  label(task, tasks) {
    const children = this.children(task, tasks), now = this.current(task, tasks);
    const accepted = children.filter(item => item.status === 'accepted').length;
    if (task.engagement.endedAt) return `Plan ended · ${accepted} of ${task.engagement.milestones} accepted`;
    if (!now) return children.length && accepted === children.length ? 'Plan completed' : `Plan · ${accepted} of ${task.engagement.milestones} accepted`;
    const step = typeof RelayWorkState === 'object' && RelayWorkState.known(now) ? RelayWorkState.label(now) : now.status === 'selected' ? 'Ready to start' : now.status;
    return `Milestone ${now.milestone.sequence} of ${now.milestone.of} · ${step}`;
  },
  group(task, tasks) {
    // Ending a plan cancels what hasn't started, so anything left is a milestone in progress.
    const now = this.current(task, tasks);
    if (!now) return 'Completed';
    return typeof RelayWorkState === 'object' && RelayWorkState.known(now) ? RelayWorkState.group(now) : 'Needs you';
  },
};
