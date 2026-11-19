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

  // Build is for builders: an account counts as one once it has an agent, even a
  // draft. Anyone can become one through "Publish an agent" (/build/new); until
  // then the Build pages and their menu stay out of the way.
  isBuilder(target = state) {
    const count = Array.isArray(target.agents) && target.account?.user.workspace !== 'buyer' ? target.agents.length : target.ownAgentCount;
    return (count || 0) > 0;
  },
  // On the builder side without an agent, every Build page becomes "New agent".
  gate(target = state) {
    if (target.account?.user.workspace !== 'builder' || target.agentPageId || this.isBuilder(target)) return false;
    target.addingAgent = true; target.setupAgentId = null; target.builderTab = 'agents';
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

  // ---- Shared parts: the same cards and rows the buyer pages use ----------
  slug(value) { return typeof RelayMarketplace === 'object' ? RelayMarketplace.slug(value) : String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'; },
  builderName() { return state.account?.user?.name || 'you'; },
  avatar(name) {
    let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return `<span class="mk-avatar mk-hue-${Math.round(h / 30) % 12}" aria-hidden="true">${escape(String(name).slice(0, 1).toUpperCase())}</span>`;
  },
  icon(name) { return typeof RelayMarketplace === 'object' ? RelayMarketplace.ICONS?.[name] || '' : ''; },
  meta(parts) { return parts.filter(Boolean).join('<span class="mk-sep" aria-hidden="true">·</span>'); },
  // One list row, as on Your work: icon, title and tags, one meta line, an action.
  thread({ icon = 'request', tone = 'none', title, tags = '', meta = [], desc = '', action = '' }) {
    return `<div class="mk-thread mk-thread-${tone}"><span class="mk-thread-icon">${this.icon(icon)}</span><span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(title)}</span>${tags}</span>${meta.length ? `<span class="mk-meta">${this.meta(meta)}</span>` : ''}${desc ? `<span class="mk-desc">${escape(desc)}</span>` : ''}</span>${action}</div>`;
  },
  next(label, attrs) { return `<button type="button" class="mk-next mk-link-button" ${attrs}>${label} →</button>`; },
  section(title, count, link, body) {
    return `<section class="mk-section mk-build-section"><div class="mk-build-section-head"><h2>${title}${!count ? '' : ` <span class="mk-total">${count}</span>`}</h2>${link || ''}</div>${body}</section>`;
  },
  label(task) { return typeof builderLabel === 'function' ? builderLabel(task) : typeof taskLabel === 'function' ? taskLabel(task) : String(task.status || '').replaceAll('_', ' '); },
  tone(task) { return typeof RelayWorkState === 'object' && RelayWorkState.known?.(task) ? RelayWorkState.tone(task) || 'none' : task.status === 'buyer_review' ? 'active' : 'none'; },

  // ---- Dashboard ----------------------------------------------------------
  dashboard() {
    const agents = state.agents || [], quotes = state.quotes || [], work = state.work || [];
    const pending = quotes.filter(q => q.status === 'pending'), active = work.filter(w => ['selected', 'queued', 'running', 'buyer_review'].includes(w.status));
    const payments = work.map(w => w.payment).filter(Boolean);
    const total = test => ['USD', 'EUR'].map(currency => { const subset = payments.filter(p => (p.currency || 'USD') === currency && test(p)); return subset.length ? money(subset.reduce((n, p) => n + p.amountMinor, 0), currency) : null; }).filter(Boolean).join(' · ') || money(0, 'USD');
    const stats = [['Agents', agents.length, 'agents', `${agents.filter(a => this.status(a).id === 'live').length} live`], ['Offers waiting', pending.length, 'opportunities', 'for a buyer’s choice'],
      ['Active projects', active.length, 'work', 'chosen or running'], ['Payout pending', total(p => ['creating_transfer', 'transferred', 'creating_payout', 'payout_pending'].includes(p.status)), 'earnings', 'test money only'],
      ['Paid', total(p => p.status === 'paid' && p.reconciliation?.status !== 'needs_review'), 'earnings', 'test money only']];
    const strip = `<div class="mk-strip mk-build-strip">${stats.map(([label, value, tab, note]) => `<a class="mk-stat" href="/build${tab === 'dashboard' ? '' : '/' + (this.NAV.find(([id]) => id === tab)?.[2] || '')}" data-route><span>${label}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></a>`).join('')}</div>`;
    const attention = [...work.filter(w => w.payment?.reconciliation?.status === 'needs_review').map(w => this.thread({ icon: 'package', tone: 'attention', title: w.title, meta: ['Payment paused for operations review', 'task history is saved'], action: this.next('Review payment', `data-action="builder-payment-review" data-id="${escape(w.id)}"`) })),
      ...agents.filter(a => this.status(a).id !== 'live').map(a => { const s = this.status(a); return this.thread({ icon: 'package', tone: 'attention', title: a.name, meta: [s.label, s.note], action: this.next(['draft', 'testing'].includes(s.id) ? 'Continue setup' : 'Manage', `data-action="open-agent" data-id="${escape(a.id)}"`) }); })];
    const list = rows => `<ul class="mk-threads">${rows.map(r => `<li>${r}</li>`).join('')}</ul>`;
    return strip
      + this.section('Needs attention', attention.length, '', attention.length ? list(attention) : `<p class="mk-empty-note">${agents.length ? 'Nothing needs you. Every agent is live.' : 'No agents yet. Add your first agent to get ready for work.'}</p>`)
      + this.section('Active work', active.length, '<a class="mk-next" href="/build/projects" data-route>All projects →</a>', active.length ? list(active.map(w => this.thread({ icon: 'package', tone: this.tone(w), title: w.title, meta: [`<span class="mk-handle">${escape(this.slug(w.agentName))}</span>`, escape(this.label(w)), w.amountMinor ? escape(money(w.amountMinor, w.currency)) : ''], action: this.next('Open', `data-action="builder-task" data-id="${escape(w.id)}"`) }))) : '<p class="mk-empty-note">No work is running. Chosen work and finished deliveries are under Projects.</p>')
      + this.section('Recent offers', pending.length, '<a class="mk-next" href="/build/opportunities" data-route>All offers →</a>', pending.length ? list(pending.slice(0, 3).map(q => this.thread({ title: q.title, meta: [`<span class="mk-handle">${escape(this.slug(q.agentName))}</span>`, escape(money(q.amountMinor, q.currency)), 'waiting for the buyer'] }))) : '<p class="mk-empty-note">No offers waiting for a buyer.</p>');
  },

  // ---- Agents: the browse card, with the owner's status and actions ---------
  agentsPage() {
    const agents = state.agents || [];
    if (!agents.length) return '<div class="mk-empty"><h2>No agents yet</h2><p>Add your first agent. Its capabilities can span any category.</p><a class="mk-primary" href="/build/new" data-route>New agent</a></div>';
    const builder = this.builderName();
    return `<ul class="mk-list">${agents.map(agent => {
      const s = this.status(agent);
      const categories = [...new Set((agent.capabilities || []).map(item => item.category).filter(Boolean))];
      const meta = [escape(categories.join(', ') || 'No category yet'), escape(this.plural((agent.capabilities || []).length, 'capability', 'capabilities')), escape(this.plural((agent.packages || []).length, 'package')),
        this.payable(agent) ? '' : 'not set up for paid work yet'];
      return `<li class="mk-row"><div class="mk-row-link mk-build-card">
        <span class="mk-row-title">${this.avatar(builder)}<span class="mk-handle">${escape(this.slug(builder))}/${escape(this.slug(agent.name))}</span><span class="mk-status mk-status-${s.id}">${s.label}</span></span>
        <span class="mk-meta">${this.meta(meta)}</span>
        <span class="mk-desc">${escape(agent.purpose || 'No description yet.')}</span>
        <span class="mk-build-actions"><button type="button" class="mk-chip" data-action="open-agent" data-id="${escape(agent.id)}">${['draft', 'testing'].includes(s.id) ? 'Continue setup' : 'Manage'}</button>${['live', 'paused', 'ready'].includes(s.id) ? `<a class="mk-next" href="/agents/${escape(agent.id)}" data-route>View public page →</a>` : ''}<span class="mk-build-note">${escape(s.note)}</span></span></div></li>`;
    }).join('')}</ul>`;
  },

  // ---- Opportunities ---------------------------------------------------------
  // Requests this builder's agents can quote on, with what the buyer attached.
  opportunity(task, quoteForm) {
    const intake = task.intake;
    const facts = [task.categoryLabel, intake && [intake.targetLabel, intake.objectLabel, intake.recordCount ? `${Number(intake.recordCount).toLocaleString('en-US')} records` : ''].filter(Boolean).join(' · '),
      (task.acceptanceCriteria || []).length ? this.plural(task.acceptanceCriteria.length, 'checklist item') : '', (task.checks || []).length ? this.plural(task.checks.length, 'automatic check') : ''].filter(Boolean);
    const quoted = (task.myOffers || []).length || (state.quotes || []).some(q => q.taskId === task.id && q.status === 'pending');
    const form = String(quoteForm(task) || '').replace(/<summary>[^<]*<\/summary>/, '<summary>Make an offer by hand</summary>');
    const checklist = typeof RelayAcceptance === 'object' && (task.acceptanceCriteria || []).length ? RelayAcceptance.summary(task.acceptanceCriteria, [], 'Buyer’s checklist') : '';
    return `<li class="mk-build-opportunity"><div class="mk-thread mk-thread-none"><span class="mk-thread-icon">${this.icon('request')}</span><span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(task.title)}</span>${intake ? '<span class="mk-tag">ERP data</span>' : ''}${quoted ? '<span class="mk-tag mk-tag-good">You offered</span>' : ''}</span>${facts.length ? `<span class="mk-meta">${facts.map(escape).join(' · ')}</span>` : ''}<span class="mk-desc">${escape(task.brief)}</span>${checklist ? `<span class="mk-build-checklist">${checklist}</span>` : ''}${form ? `<span class="mk-build-offer-form">${form}</span>` : ''}</span></div></li>`;
  },
  opportunities(quoteForm) {
    const rows = state.opportunities || [];
    return `<p class="mk-caption mk-build-caption">Connected agents offer automatically, following the rules you set for each agent. You can also make an offer by hand.</p>${rows.length ? `<ul class="mk-threads">${rows.map(t => this.opportunity(t, quoteForm)).join('')}</ul>` : '<div class="mk-empty"><h2>No open requests right now</h2><p>Requests from other buyers appear here. Your own requests are never shown to your agents.</p></div>'}${this.offers()}`;
  },
  offers() {
    const quotes = state.quotes || [];
    if (!quotes.length) return '';
    return this.section('Your offers', quotes.length, '', `<ul class="mk-threads">${quotes.map(q => `<li>${this.thread({ tone: ['selected', 'accepted'].includes(q.status) ? 'active' : ['rejected', 'withdrawn', 'expired', 'superseded'].includes(q.status) ? 'muted' : 'none', title: q.title,
      tags: `<span class="mk-status">${escape(this.offerLabel(q.status))}</span>`, meta: [`<span class="mk-handle">${escape(this.slug(q.agentName))}</span>`, escape(money(q.amountMinor, q.currency)), escape(`${deliveryDuration(q.deliveryMinutes)} after starting`)],
      action: ['selected', 'accepted'].includes(q.status) ? '<a class="mk-next" href="/build/projects" data-route>Open project →</a>' : '' })}</li>`).join('')}</ul>`);
  },
  offerLabel(status) {
    return { pending: 'Waiting for the buyer', selected: 'Chosen · waiting to start', accepted: 'Chosen · waiting to start', rejected: 'Not chosen', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Request changed' }[status] || String(status).replaceAll('_', ' ');
  },

  // ---- Projects: one row each, opening to the full task ---------------------
  projects() {
    const work = state.work || [];
    if (!work.length) return '<div class="mk-empty"><h2>No projects yet</h2><p>When a buyer chooses one of your agents’ offers, the work appears here.</p></div>';
    const focus = String(state.scrollTarget || '');
    return `<ul class="mk-threads mk-build-projects">${work.map(w => {
      const body = typeof RelayExecution === 'object' && w.execution ? RelayExecution.builderTask(w)
        : `<div class="mk-build-detail" data-notification-task="${escape(w.id)}">${w.proposal ? `<p>${escape(w.proposal)}</p>` : ''}<p class="mk-empty-note"><strong>Don’t start yet.</strong> The buyer hasn’t started this work: funding, access and the runtime permission aren’t in place.</p>${w.brief ? `<details><summary>Agreed brief</summary><p>${escape(w.brief)}</p></details>` : ''}${typeof builderConversation === 'function' ? builderConversation(w) : ''}</div>`;
      return `<li><details class="mk-build-project" ${focus.includes(w.id) || work.length === 1 ? 'open' : ''}><summary>${this.thread({ icon: 'package', tone: this.tone(w), title: w.title,
        meta: [`<span class="mk-handle">${escape(this.slug(w.agentName))}</span>`, escape(this.label(w)), w.amountMinor ? escape(money(w.amountMinor, w.currency)) : ''], action: '<span class="mk-next">Details</span>' })}</summary>${body}</details></li>`;
    }).join('')}</ul>`;
  },

  // ---- Earnings and settings ------------------------------------------------
  earnings() {
    return `<div class="mk-strip mk-build-strip"><div class="mk-stat"><span>Paid out</span><strong>${escape(money(0, 'USD'))}</strong><small>no payouts yet</small></div><div class="mk-stat"><span>On its way</span><strong>${escape(money(0, 'USD'))}</strong><small>after the buyer accepts</small></div></div>
      ${this.section('How you get paid', null, '', '<ol class="mk-build-steps"><li>A buyer chooses your offer. That isn’t revenue yet.</li><li>The buyer funds the work and your agent delivers.</li><li>The buyer accepts the delivery against their checklist.</li><li>Relay pays out after settlement.</li></ol><p class="mk-empty-note">Payments and payouts aren’t connected in this environment, so nothing here is real money.</p><a class="mk-next" href="/build/settings" data-route>Check payout setup →</a>')}`;
  },
  settings() {
    const back = state.returnAgentId ? `<button type="button" class="mk-chip" data-action="open-agent" data-id="${escape(state.returnAgentId)}">← Back to agent setup</button>` : '';
    return `${back}${this.section('Builder account', null, '', `<div class="mk-table-wrap"><table class="mk-table"><tbody>
      <tr><th scope="row">Name</th><td>${escape(this.builderName())}</td><td></td></tr>
      <tr><th scope="row">Public handle</th><td><code>${escape(this.slug(this.builderName()))}</code></td><td class="mk-empty-note">Shown before each agent name.</td></tr>
      <tr><th scope="row">Operator verification</th><td><span class="mk-status">Not started</span></td><td class="mk-empty-note">The identity check isn’t connected yet. Signing up doesn’t verify you.</td></tr>
      <tr><th scope="row">Payouts</th><td><span class="mk-status">Not set up</span></td><td class="mk-empty-note">Payout setup isn’t available yet. Relay never asks for bank details or wallet keys here.</td></tr></tbody></table></div>`)}`;
  },

  // The agent's own setup page is headed like its public page: builder/agent.
  agentTitle(agent) { return `<span class="mk-handle mk-build-title">${escape(this.slug(this.builderName()))}/${escape(this.slug(agent.name))}</span>`; },
  shell(tab, title, lede, action, content) {
    const active = state.setupAgentId || state.addingAgent ? 'agents' : tab === 'quotes' ? 'opportunities' : tab;
    const counts = { agents: (state.agents || []).length, opportunities: (state.opportunities || []).length, work: (state.work || []).length };
    const heading = title ? `${title}${counts[active] !== undefined && this.NAV.some(([id, label]) => id !== 'dashboard' && label === title) ? ` <span class="mk-total">${counts[active]}</span>` : ''}` : '';
    if (!this.isBuilder()) return `<div class="mk-build mk-build-first"><section class="mk-build-main">${title ? `<header class="mk-results-head mk-build-head"><div><h1>${heading}</h1>${lede ? `<p class="mk-caption">${lede}</p>` : ''}</div>${action || ''}</header>` : ''}${content}</section></div>`;
    return `<div class="mk-build"><nav class="mk-build-nav" aria-label="Build"><p class="mk-build-who">${this.avatar(this.builderName())}<span class="mk-handle">${escape(this.slug(this.builderName()))}</span></p>${this.NAV.map(([id, label, slug]) =>
      `<a href="/build${slug ? '/' + slug : ''}" data-route ${active === id ? 'class="active" aria-current="page"' : ''}>${label}${counts[id] ? ` <span class="mk-count">${counts[id]}</span>` : ''}</a>`).join('')}</nav>
      <section class="mk-build-main">${title ? `<header class="mk-results-head mk-build-head"><div><h1>${heading}</h1>${lede ? `<p class="mk-caption">${lede}</p>` : ''}</div>${action || ''}</header>` : ''}${content}</section></div>`;
  },
  plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; },
};
