'use strict';

// The request page: a posted request is a commission, not a chat
// (docs/specs/Marketplace-Model.md → "Commission it"; docs/specs/Enterprise-and-Projects.md).
//
// Laid out like a Hugging Face discussion page: the request on top with who
// posted it and where it belongs, offers from builders' agents, then approval,
// start, delivery and the activity log. There's no Relay chat voice, and no
// message box until an agent is hired, because nobody reads messages before then.
// The existing renderers (offers, input, approval, payment, start, delivery,
// change requests, retry) are reused unchanged inside this layout.
const RelayRequestPage = {
  TABS: [['request', 'Request'], ['activity', 'Activity']],
  EVENTS: {
    'task.created': 'Request created',
    'task.posted': 'Posted to agents',
    'task.project_changed': 'Moved to another project',
    'task.retried': 'Another agent asked to try',
    'scope.updated': 'Scope changed · earlier offers need a fresh quote',
    'scope.reviewed': 'Scope reviewed · terms unchanged',
    'criteria.updated': 'Checklist changed · earlier offers need a fresh quote',
    'offer.received': 'Offer received',
    'offer.selected': 'Offer chosen · work not started',
    'approval.requested': 'Budget approval requested',
    'approval.approved': 'Budget approved',
    'approval.declined': 'Changes requested before approval',
    'revision.requested': 'Changes requested',
    'delivery.accepted': 'Delivery accepted',
    'delivery.auto_accepted': 'Delivery accepted automatically',
    'execution.ended_unmet': 'Work ended · checklist not met',
    'task.cancelled': 'Request closed',
    'message.added': 'Message added',
  },

  // Requests and hired packages use this page. Drafts, schedules and multi-step
  // plans keep their own screens.
  applies(detail) {
    const t = detail?.task;
    return !!t && (t.status !== 'draft' || !!detail.intake) && !t.orchestrationPlan && !t.orchestrationStep && !t.recurringScheduleId && !t.scheduleId &&
      !(t.workPlan && t.workPlan.cadence !== 'once');
  },
  hired(detail = state.detail) { return !!detail.execution; },
  org(detail = state.detail) {
    return (state.account?.memberships || []).find(m => m.id === detail.task.tenantId && m.company) || null;
  },
  nextStep(detail, offers) {
    const t = detail.task;
    if (t.status === 'draft' && detail.intake) {
      const r = detail.intake.readiness;
      return r.complete ? ['Open for offers', 'The intake is complete. Open the request so qualified agents can quote.']
        : ['Finish the intake', `Still needed: ${r.missing.join('; ')}.`];
    }
    if (t.status === 'posted' && !detail.execution) {
      const live = offers.filter(o => o.expiresAt > Date.now());
      return live.length ? ['Choose an offer', `${RelayMarketplace.plural(live.length, 'offer')} to compare: price, delivery time and each agent’s evidence.`]
        : ['Waiting for offers', 'Qualified agents quote a price and delivery time against your checklist. You choose one; nothing starts until you do.'];
    }
    return typeof taskNextStep === 'function' ? taskNextStep(detail, offers) : ['', ''];
  },
  crumbs(detail) {
    const org = this.org(detail), p = detail.project;
    if (!org) return '<a class="mk-back" href="/#tasks" data-route data-tab="tasks">← Your work</a>';
    return `<nav class="mk-crumbs" aria-label="Where this request belongs"><a href="/org/${escape(org.id)}" data-route>${escape(RelayMarketplace.slug(org.name))}</a>${p ? ` <span aria-hidden="true">/</span> <a href="/org/${escape(org.id)}/projects/${escape(p.id)}" data-route>${escape(p.name)}</a>` : ''}</nav>`;
  },
  status(task) {
    return typeof RelayWorkState === 'object' && RelayWorkState.known(task)
      ? `<span class="mk-tag mk-tone-${escape(RelayWorkState.tone(task) || 'none')}" role="status">${escape(RelayWorkState.label(task))}</span>`
      : `<span class="mk-tag" role="status">${escape(typeof taskLabel === 'function' ? taskLabel(task) : task.status)}</span>`;
  },
  // Offers from builders. Before any arrive, a plain empty state instead of the
  // old assistant copy.
  offers(detail) {
    const t = detail.task;
    if (t.package) return `<section class="mk-section mk-request-offers" aria-labelledby="mk-offers-title"><h2 id="mk-offers-title">Hired package</h2>${typeof offerCards === 'function' ? offerCards() : ''}</section>`;
    const count = (state.offers || []).length;
    // Before a choice, every offer is a visible card in the server's order (fair
    // exposure included), each with its own Review and Choose actions.
    const chosen = (state.offers || []).some(o => o.selected) || detail.execution;
    const body = count && !chosen && typeof offerCard === 'function'
      ? `<div class="mk-offer-list">${state.offers.map(o => offerCard(o, t)).join('')}</div><p class="mk-caption">Offers are listed in Relay’s order: fit and verified outcomes, with a rotating place for qualified newcomers. No one pays for placement.</p>`
      : count ? (typeof offerCards === 'function' ? offerCards() : '')
      : t.status === 'posted' ? `<div class="mk-empty mk-empty-inline"><h3>No offers yet</h3><p>Agents that have passed a Relay test for this kind of work can quote. ${t.input ? '' : 'Agents that work on files quote once your input file is attached. '}Your request stays open until you close it.</p></div>` : '';
    if (!body) return '';
    return `<section class="mk-section mk-request-offers" aria-labelledby="mk-offers-title"><h2 id="mk-offers-title">${detail.execution ? 'Agreed offer' : 'Offers'} ${count && !detail.execution ? `<span class="mk-total">${count}</span>` : ''}</h2>${body}</section>`;
  },
  editor(task) {
    return `<form id="edit" class="mk-form mk-panel"><h3>Change the request</h3><p class="mk-caption">Changing the scope asks agents for fresh offers; earlier offers and any approval need review again.</p>
      <label for="title">Title</label><input id="title" name="title" value="${escape(task.title)}" maxlength="120" required>
      <label for="brief">What do you need done?</label><textarea id="brief" name="brief" rows="6" maxlength="10000" required>${escape(task.brief)}</textarea>
      <div class="form-error" role="alert"></div><div class="mk-form-actions"><button class="mk-primary" type="submit">Save and ask for fresh offers</button><button type="button" data-action="stop-edit">Keep the current request</button></div></form>`;
  },
  description(detail) {
    const t = detail.task;
    if (state.editing) return this.editor(t);
    const editable = detail.mine !== false && ['posted', 'selected'].includes(t.status) && !detail.execution && !t.package;
    return `<section class="mk-desc" aria-label="The request">
      <header class="mk-desc-head"><span class="mk-org-avatar mk-org-avatar-sm" aria-hidden="true">${escape((detail.postedBy || '?').slice(0, 1).toUpperCase())}</span><strong>${escape(detail.postedBy || 'Requester')}</strong><span class="mk-caption">posted ${escape(RelayMarketplace.ago(t.createdAt))} · scope v${t.scopeVersion}</span>
        ${editable ? '<button type="button" class="mk-link-button" data-action="edit">Edit</button>' : ''}</header>
      <div class="mk-desc-body"><p class="mk-brief">${escape(t.brief)}</p>
        ${typeof RelayAcceptance === 'object' ? RelayAcceptance.scope(t) : ''}
</div></section>`;
  },
  messages(detail) {
    const items = (detail.messages || []).slice(1).filter(m => typeof isAssistantSystemNotice !== 'function' || !isAssistantSystemNotice(m));
    const thread = items.map(m => `<article class="mk-comment"><header><strong>${escape(m.role === 'supplier' ? m.authorName : m.authorName === state.account?.user.name ? 'You' : m.authorName || 'Member')}</strong><span class="mk-caption">${escape(RelayMarketplace.ago(m.createdAt))}</span></header><p class="mk-brief">${escape(m.body)}</p></article>`).join('');
    const open = this.hired(detail) && detail.task.status !== 'cancelled' && !detail.task.package?.closed;
    const box = open && typeof composer === 'function'
      ? composer('message', 'Write to the agent working on this request…', 'Send', state.messageDrafts?.[detail.task.id] || '', 'The agent doing the work reads these messages and replies here.')
      : `<p class="mk-caption">${detail.task.status === 'cancelled' ? 'This request is closed.' : 'Messages open once you choose an agent and start the work. Until then, agents see only the request, its checklist and file details.'}</p>`;
    return `<section class="mk-section" aria-labelledby="mk-messages-title"><h2 id="mk-messages-title">Messages ${items.length ? `<span class="mk-total">${items.length}</span>` : ''}</h2>${thread}${box}</section>`;
  },
  activity(detail) {
    const events = detail.events || [];
    return `<section class="mk-section"><h2>Activity</h2><ol class="mk-timeline">${events.slice().reverse().map(e => `<li class="mk-tl-item"><span class="mk-tl-dot mk-actor-relay" aria-hidden="true"></span><span class="mk-tl-text">${escape(this.EVENTS[e.type] || e.type.replace(/[._]/g, ' '))}</span><time class="mk-caption">${escape(RelayMarketplace.ago(e.createdAt))}</time></li>`).join('')}</ol>
      ${detail.scopes?.length > 1 ? `<details><summary>Earlier versions of the request</summary>${detail.scopes.map(v => `<p><strong>Scope v${v.version}</strong><br>${escape(v.brief)}</p>`).join('')}</details>` : ''}</section>`;
  },
  view() {
    const detail = state.detail, t = detail.task, offers = state.offers || [];
    const tab = this.TABS.some(([id]) => id === state.requestTab) ? state.requestTab : 'request';
    const [step, why] = this.nextStep(detail, offers);
    const org = this.org(detail);
    const approval = typeof RelayApprovals === 'object' && detail.approval ? RelayApprovals.task(t, detail.approval) : '';
    const main = tab === 'activity' ? this.activity(detail) : `${this.description(detail)}
      ${typeof RelayIntake === 'object' ? RelayIntake.section(detail) + RelayIntake.checksSection(detail) : ''}
      ${!state.editing && detail.mine !== false && typeof RelayExecution === 'object' && !detail.execution ? RelayExecution.input(t) : ''}
      ${state.editing ? '' : this.offers(detail)}
      ${approval}
      ${typeof RelayConnections === 'object' ? RelayConnections.taskAccess(detail) : ''}
      ${typeof RelayPayments === 'object' ? RelayPayments.task(t, detail.payment, false, detail.execution) : ''}
      ${state.reviewStart && typeof startReview === 'function' ? startReview(t) : ''}
      ${typeof RelayIntake === 'object' ? RelayIntake.checkResults(detail) : ''}
      ${typeof RelayExecution === 'object' ? RelayExecution.delivery(t) : ''}${typeof RelayApps === 'object' ? RelayApps.permissionDecisions(t) : ''}
      ${typeof changeProposalCards === 'function' ? changeProposalCards(t, detail.changeProposals) : ''}${typeof repeatHireCard === 'function' ? repeatHireCard() : ''}${typeof retryCard === 'function' ? retryCard() : ''}
      ${this.messages(detail)}`;
    const own = detail.mine !== false;
    return `<article class="mk-agent mk-request" data-task-id="${escape(t.id)}">
      <header class="mk-agent-head">${this.crumbs(detail)}
        <div class="mk-agent-title"><h1 class="mk-request-title">${escape(t.title)}</h1>${this.status(t)}</div>
        <p class="mk-agent-sub">${t.package ? 'Hired package' : 'Request'} · posted by ${escape(detail.postedBy || 'a member')} · ${escape(RelayMarketplace.ago(t.createdAt))}${org ? ` · ${escape(org.name)}` : ''}</p>
        <nav class="mk-tabs" aria-label="Request sections">${this.TABS.map(([id, label]) => `<button type="button" data-action="request-tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}${id === 'activity' ? ` <span class="mk-count">${(detail.events || []).length}</span>` : ''}</button>`).join('')}</nav></header>
      <div class="mk-agent-layout"><div class="mk-agent-main mk-request-main">${main}</div>
        <aside class="mk-buy" aria-label="Request status">
          <section class="mk-buy-box mk-next-step"><h2>Next step</h2><p><strong>${escape(step)}</strong></p><p class="mk-caption">${escape(why)}</p></section>
          <section class="mk-buy-box"><h2>Details</h2><dl class="mk-facts">
            <dt>Workspace</dt><dd>${org ? `<a href="/org/${escape(org.id)}" data-route>${escape(org.name)}</a>` : 'Personal'}</dd>
            ${detail.project ? `<dt>Project</dt><dd><a href="/org/${escape(org.id)}/projects/${escape(detail.project.id)}" data-route>${escape(detail.project.name)}</a></dd>` : ''}
            <dt>Offers</dt><dd>${offers.length}</dd>
            ${t.acceptanceCriteria?.length ? `<dt>Checklist</dt><dd>${RelayMarketplace.plural(t.acceptanceCriteria.length, 'item')}</dd>` : ''}
            <dt>Scope</dt><dd>v${t.scopeVersion}</dd></dl>
            ${detail.project && !own ? '<p class="mk-caption">You can see this because you’re in the project. Only the person who posted it can change it.</p>' : ''}</section>
          ${own && ['posted', 'selected'].includes(t.status) && !detail.execution ? '<section class="mk-buy-box"><button type="button" class="mk-link-button mk-danger" data-action="cancel">Close request</button></section>' : ''}
        </aside></div></article>`;
  },
};
