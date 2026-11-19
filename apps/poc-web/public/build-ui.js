'use strict';

// The Build area: a builder's own pages inside the shared marketplace shell.
// Same top bar as everyone (Agents · Requests · Builders), with a left menu like
// Hugging Face's settings pages: Dashboard, Agents, Opportunities, Projects,
// Earnings, Settings. There is no visible workspace switch; opening a /build page
// selects the builder side, opening any other page selects the buyer side.
const RelayBuild = {
  NAV: [['dashboard', 'Dashboard', ''], ['agents', 'Agents', 'agents'], ['opportunities', 'Opportunities', 'opportunities'],
    ['work', 'Projects', 'projects'], ['earnings', 'Earnings', 'earnings'], ['settings', 'Settings', 'settings']],

  // /build, /build/<section>, /build/new. Returns null for any other path.
  parse(pathname = globalThis.location?.pathname || '/') {
    const match = /^\/build(?:\/([a-z]+))?\/?$/.exec(pathname);
    if (!match) return null;
    if (match[1] === 'new') return { page: 'build', id: 'new' };
    const item = this.NAV.find(([, , slug]) => slug === (match[1] || ''));
    return item ? { page: 'build', id: item[0] } : null;
  },
  apply(route, target = state) {
    if (route?.page !== 'build') return false;
    target.agentPageId = null; target.detail = null;
    if (route.id === 'new') { target.addingAgent = true; target.setupAgentId = null; target.builderTab = 'agents'; }
    else { target.addingAgent = false; target.setupAgentId = null; target.builderTab = route.id; }
    return true;
  },
  path(current = state) {
    if (current.addingAgent) return '/build/new';
    const tab = current.setupAgentId ? 'agents' : current.builderTab === 'quotes' ? 'opportunities' : current.builderTab;
    const slug = this.NAV.find(([id]) => id === tab)?.[2] ?? '';
    return slug ? `/build/${slug}` : '/build';
  },
  // The account's side follows the page: /build pages are the builder side.
  async ensure(route) {
    const want = route?.page === 'build' ? 'builder' : route?.page === 'agent' ? null : 'buyer';
    if (!want || !state.account || state.account.user.workspace === want) return false;
    await api('/api/me/workspace', { method: 'PATCH', body: { workspace: want } });
    state.account.user.workspace = want;
    state.reviewOffer = null; state.editing = false;
    if (want === 'buyer') { state.setupAgentId = null; state.addingAgent = false; }
    return true;
  },

  // One honest status per agent, from what the server enforces: published needs
  // a passed Relay test; paused hides it; a draft can be connected and tested first.
  status(agent) {
    const passed = (agent.capabilities || []).some(item => item.qualification === 'qualified');
    if (agent.listingStatus === 'paused') return { id: 'paused', label: 'Paused', note: 'Hidden from browse. Open requests already quoted stay as they are.' };
    if (agent.listingStatus === 'published' && passed) return { id: 'live', label: 'Live', note: 'Listed on Agents and quoting on requests.' };
    if (passed) return { id: 'ready', label: 'Ready to publish', note: 'Passed a Relay test. Publish it to appear on Agents.' };
    if (agent.runtime?.connected || agent.readiness?.connection) return { id: 'testing', label: 'Testing', note: 'Connected. Pass a Relay test to publish.' };
    return { id: 'draft', label: 'Draft', note: agent.readiness?.profile ? 'Connect a runtime next.' : 'Finish the profile, then connect a runtime.' };
  },
  // Paid work needs operator checks and payouts; say so once instead of per page.
  payable(agent) { return !!agent.readiness?.canReceivePaidWork; },

  agentsPage() {
    const agents = state.agents || [];
    if (!agents.length) return '<div class="empty-box">No agents yet. Add your first agent; its capabilities can span any category.</div>';
    return `<ul class="mk-build-agents">${agents.map(agent => {
      const s = this.status(agent);
      const categories = [...new Set((agent.capabilities || []).map(item => item.category).filter(Boolean))];
      return `<li class="mk-build-agent"><div class="mk-build-agent-head"><strong class="mk-mono">${escape(agent.name)}</strong><span class="mk-status mk-status-${s.id}">${s.label}</span></div>
        <p>${escape(agent.purpose || 'No description yet.')}</p>
        <p class="mk-meta">${categories.length ? escape(categories.join(' · ')) + ' · ' : ''}${this.plural((agent.capabilities || []).length, 'capability', 'capabilities')} · ${this.plural((agent.packages || []).length, 'package')}${this.payable(agent) ? '' : ' · not set up for paid work yet'}</p>
        <p class="mk-empty-note">${escape(s.note)}</p>
        <div class="mk-build-actions"><button data-action="open-agent" data-id="${escape(agent.id)}">${['draft', 'testing'].includes(s.id) ? 'Continue setup' : 'Manage'}</button>${['live', 'paused', 'ready'].includes(s.id) ? `<a class="mk-chip" href="/agents/${escape(agent.id)}" data-route>View public page</a>` : ''}</div></li>`;
    }).join('')}</ul>`;
  },
  // Requests this builder's agents can quote on, with what the buyer attached.
  opportunity(task, quoteForm) {
    const intake = task.intake;
    const facts = [task.categoryLabel, intake && [intake.targetLabel, intake.objectLabel, intake.recordCount ? `${Number(intake.recordCount).toLocaleString('en-US')} records` : ''].filter(Boolean).join(' · '),
      (task.acceptanceCriteria || []).length ? this.plural(task.acceptanceCriteria.length, 'checklist item') : '', (task.checks || []).length ? this.plural(task.checks.length, 'automatic check') : ''].filter(Boolean);
    return `<article class="panel mk-opportunity"><span class="eyebrow">Open request</span><h2>${escape(task.title)}</h2>${facts.length ? `<p class="mk-meta">${facts.map(escape).join(' · ')}</p>` : ''}<p class="offer-details">${escape(task.brief)}</p>${typeof RelayAcceptance === 'object' ? RelayAcceptance.summary(task.acceptanceCriteria, [], 'Buyer’s checklist') : ''}${quoteForm(task)}</article>`;
  },
  offers() {
    const quotes = state.quotes || [];
    if (!quotes.length) return '';
    return `<section class="mk-build-section"><h2>Your offers <span class="mk-total">${quotes.length}</span></h2><ul class="mk-build-offers">${quotes.map(q => `<li><div><strong>${escape(q.title)}</strong><p class="mk-meta">${escape(q.agentName)} · ${money(q.amountMinor, q.currency)} · ${deliveryDuration(q.deliveryMinutes)} after starting</p></div><span class="mk-status">${escape(this.offerLabel(q.status))}</span>${['selected', 'accepted'].includes(q.status) ? '<a class="mk-chip" href="/build/projects" data-route>Open project</a>' : ''}</li>`).join('')}</ul></section>`;
  },
  offerLabel(status) {
    return { pending: 'Waiting for the buyer', selected: 'Chosen · waiting to start', accepted: 'Chosen · waiting to start', rejected: 'Not chosen', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Request changed' }[status] || String(status).replaceAll('_', ' ');
  },

  shell(tab, title, lede, action, content) {
    const active = state.setupAgentId || state.addingAgent ? 'agents' : tab === 'quotes' ? 'opportunities' : tab;
    return `<div class="mk-build"><nav class="mk-build-nav" aria-label="Build">${this.NAV.map(([id, label, slug]) =>
      `<a href="/build${slug ? '/' + slug : ''}" data-route ${active === id ? 'class="active" aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
      <section class="mk-build-main">${title ? `<header class="mk-build-head"><div><h1>${title}</h1>${lede ? `<p>${lede}</p>` : ''}</div>${action || ''}</header>` : ''}${content}</section></div>`;
  },
  plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; },
};
