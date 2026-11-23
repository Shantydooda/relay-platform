'use strict';

// The Build area: a builder's own pages inside the shared marketplace shell.
// Same top bar as everyone (Agents · Requests · Builders), with a left menu like
// Hugging Face's settings pages: Dashboard, Agents, Opportunities, Projects,
// Earnings, Settings. There is no visible workspace switch; opening a /build page
// selects the builder side, opening any other page selects the buyer side.
const RelayBuild = {
  NAV: [['dashboard', 'Dashboard', ''], ['agents', 'Agents', 'agents'], ['opportunities', 'Opportunities', 'opportunities'],
    ['work', 'Projects', 'projects'], ['earnings', 'Earnings', 'earnings'], ['settings', 'Settings', 'settings']],

  // /build, /build/<section>, /build/new, /build/agents/<id>[/<tab>]. Returns
  // null for any other path.
  parse(pathname = globalThis.location?.pathname || '/') {
    const managed = /^\/build\/agents\/([0-9a-f-]{36})(?:\/([a-z]+))?\/?$/.exec(pathname);
    if (managed) return !managed[2] || this.TABS.some(([id]) => id === managed[2]) ? { page: 'build', id: 'agents', agentId: managed[1], tab: managed[2] || null } : null;
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
    else { target.addingAgent = false; target.setupAgentId = route.agentId || null; target.builderTab = route.id; if (route.agentId) target.agentTab = route.tab; }
    return true;
  },
  path(current = state) {
    if (current.addingAgent) return '/build/new';
    if (current.setupAgentId && (current.agents || []).some(agent => agent.id === current.setupAgentId)) {
      const tab = this.TABS.some(([id]) => id === current.agentTab) && current.agentTab !== 'overview' ? `/${current.agentTab}` : '';
      return `/build/agents/${current.setupAgentId}${tab}`;
    }
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
    if (target.account?.user.workspace === 'buyer' && (target.publishing?.organizations || []).some(org => org.canAct && org.agents > 0)) return true;
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
    if (agent.runtime?.connected || agent.readiness?.connection) return { id: 'testing', label: 'Testing', note: 'Pass a Relay test to publish.' };
    return { id: 'draft', label: 'Draft', note: agent.readiness?.profile ? 'Connect a runtime next.' : 'Finish the profile, then connect a runtime.' };
  },
  // Paid work needs operator checks and payouts; say so once instead of per page.
  payable(agent) { return !!agent.readiness?.canReceivePaidWork; },

  // ---- Shared parts: the same cards and rows the buyer pages use ----------
  slug(value) { return typeof RelayMarketplace === 'object' ? RelayMarketplace.slug(value) : String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent'; },
  builderName() { return this.actingOrg()?.name || state.account?.user?.name || 'you'; },
  // Builder organizations: a member can build as an organization it lets them
  // publish for. Its agents, keys, offers and reputation belong to it.
  organizations() { return (state.publishing?.organizations || []).filter(org => org.canAct); },
  actingOrg() { return state.actingAs ? this.organizations().find(org => org.id === state.actingAs) || null : null; },
  switcher() {
    const orgs = this.organizations();
    if (!orgs.length) return '';
    const me = state.account?.user?.name || 'You';
    const option = (id, name) => `<li><button type="button" data-action="act-as" data-id="${escape(id)}" aria-pressed="${(state.actingAs || '') === id}">${escape(name)}</button></li>`;
    return `<div class="mk-build-as"><span class="mk-caption">Building as</span><ul>${option('', me)}${orgs.map(org => option(org.id, org.name)).join('')}</ul></div>`;
  },
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
    if (!payments.length) stats.splice(3, 2);
    const strip = `<div class="mk-strip mk-build-strip">${stats.map(([label, value, tab, note]) => `<a class="mk-stat" href="/build${tab === 'dashboard' ? '' : '/' + (this.NAV.find(([id]) => id === tab)?.[2] || '')}" data-route><span>${label}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></a>`).join('')}</div>`;
    const attention = [...work.filter(w => w.payment?.reconciliation?.status === 'needs_review').map(w => this.thread({ icon: 'package', tone: 'attention', title: w.title, meta: ['Payment paused for operations review', 'task history is saved'], action: this.next('Review payment', `data-action="builder-payment-review" data-id="${escape(w.id)}"`) })),
      ...agents.filter(a => this.status(a).id !== 'live').map(a => { const s = this.status(a); return this.thread({ icon: 'package', tone: 'attention', title: a.name, meta: [s.label, s.note], action: this.next(['draft', 'testing'].includes(s.id) ? 'Continue setup' : 'Manage', `data-action="open-agent" data-id="${escape(a.id)}"`) }); })];
    const list = rows => `<ul class="mk-threads">${rows.map(r => `<li>${r}</li>`).join('')}</ul>`;
    return strip
      + this.section('Needs attention', attention.length, '', attention.length ? list(attention) : `<p class="mk-empty-note">${agents.length ? 'Nothing needs you. Every agent is live.' : 'No agents yet. Add your first agent to get ready for work.'}</p>`)
      + this.section('Active work', active.length, '<a class="mk-next" href="/build/projects" data-route>All projects →</a>', active.length ? list(active.map(w => this.thread({ icon: 'package', tone: this.tone(w), title: w.title, meta: [`<span class="mk-handle">${escape(this.slug(w.agentName))}</span>`, escape(this.label(w)), w.amountMinor ? escape(money(w.amountMinor, w.currency)) : '', w.updatedAt ? escape(this.ago(w.updatedAt)) : ''], action: this.next('Open', `data-action="builder-task" data-id="${escape(w.id)}"`) }))) : '<p class="mk-empty-note">No work is running. Chosen work and finished deliveries are under Projects.</p>')
      + this.section('Recent offers', pending.length, '<a class="mk-next" href="/build/opportunities" data-route>All offers →</a>', pending.length ? list(pending.slice(0, 3).map(q => this.thread({ title: q.title, meta: [`<span class="mk-handle">${escape(this.slug(q.agentName))}</span>`, escape(money(q.amountMinor, q.currency)), 'waiting for the buyer'] }))) : '<p class="mk-empty-note">No offers waiting for a buyer.</p>');
  },

  // ---- Agents: the browse card, with the owner's status and actions ---------
  agentsPage() {
    const agents = state.agents || [];
    if (!agents.length) return '<div class="mk-empty"><h2>No agents yet</h2><p>Add your first agent. Its capabilities can span any category.</p><a class="mk-primary" href="/build/new" data-route>New agent</a></div>';
    const builder = this.builderName();
    const org = this.actingOrg();
    const unpaid = !agents.some(agent => !this.payable(agent)) ? '' : org
      ? `<p class="mk-caption mk-build-caption">Payouts go to ${escape(org.name)}’s account, which an owner sets up. <a href="/build/settings" data-route>Payout setup →</a></p>`
      : '<p class="mk-caption mk-build-caption">Paid work needs payout setup first. <a href="/build/settings" data-route>Payout setup →</a></p>';
    return `${unpaid}<ul class="mk-list">${agents.map(agent => {
      const s = this.status(agent);
      const categories = [...new Set((agent.capabilities || []).map(item => item.category).filter(Boolean))];
      const meta = [escape(categories.join(', ') || 'No category yet'), escape(this.plural((agent.capabilities || []).length, 'capability', 'capabilities')), escape(this.plural((agent.packages || []).length, 'package')),
      ];
      return `<li class="mk-row"><div class="mk-row-link mk-build-card">
        <span class="mk-row-title">${this.avatar(builder)}<span class="mk-handle">${escape(this.slug(builder))}/${escape(this.slug(agent.name))}</span><span class="mk-status mk-status-${s.id}">${s.label}</span></span>
        <span class="mk-meta">${this.meta(meta)}</span>
        <span class="mk-desc">${escape(agent.purpose || 'No description yet.')}</span>
        <span class="mk-build-conn">${this.connectionBadge(agent)}</span>
        <span class="mk-build-actions"><button type="button" class="mk-chip" data-action="open-agent" data-id="${escape(agent.id)}">${['draft', 'testing'].includes(s.id) ? 'Continue setup' : 'Manage'}</button>${['live', 'paused', 'ready'].includes(s.id) ? `<a class="mk-next" href="/agents/${escape(agent.id)}" data-route>View public page →</a>` : ''}<span class="mk-build-note">${escape(s.note)}</span></span></div></li>`;
    }).join('')}</ul>`;
  },

  // ---- Opportunities ---------------------------------------------------------
  // Requests this builder's agents can quote on, with what the buyer attached.
  opportunity(task, quoteForm) {
    const intake = task.intake;
    const fits = Array.isArray(task.fits) ? task.fits.map(name => this.slug(name)) : (state.agents || []).filter(a => task.categoryId && (a.capabilities || []).some(c => c.categoryId === task.categoryId || c.category === task.categoryLabel)).map(a => this.slug(a.name));
    const facts = [task.direct ? 'Sent to you directly' : '', task.postedAt ? `Posted ${this.ago(task.postedAt)}` : '', task.categoryLabel, task.requiredRegion ? `Needs an agent that processes data in the ${task.requiredRegion.toUpperCase()}` : '', intake && [intake.targetLabel, intake.objectLabel, intake.recordCount ? `${Number(intake.recordCount).toLocaleString('en-US')} records` : ''].filter(Boolean).join(' · '),
      (task.acceptanceCriteria || []).length ? this.plural(task.acceptanceCriteria.length, 'checklist item') : '', (task.checks || []).length ? this.plural(task.checks.length, 'automatic check') : '', fits.length ? `Fits ${fits.join(', ')}` : ''].filter(Boolean);
    const quoted = (task.myOffers || []).length || (state.quotes || []).some(q => q.taskId === task.id && q.status === 'pending');
    const form = String(quoteForm(task) || '').replace(/<summary>[^<]*<\/summary>/, '<summary>Make an offer by hand</summary>');
    const checklist = typeof RelayAcceptance === 'object' && (task.acceptanceCriteria || []).length ? RelayAcceptance.summary(task.acceptanceCriteria, [], 'Buyer’s checklist') : '';
    return `<li class="mk-build-opportunity" data-notification-task="${escape(task.id)}"><div class="mk-thread mk-thread-none"><span class="mk-thread-icon">${this.icon('request')}</span><span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(task.title)}</span>${intake ? '<span class="mk-tag">ERP data</span>' : ''}${quoted ? '<span class="mk-tag mk-tag-good">You offered</span>' : ''}</span>${facts.length ? `<span class="mk-meta">${facts.map(escape).join(' · ')}</span>` : ''}<span class="mk-desc">${escape(task.brief)}</span>${checklist ? `<span class="mk-build-checklist">${checklist}</span>` : ''}${form ? `<span class="mk-build-offer-form">${form}</span>` : ''}</span></div></li>`;
  },
  // A request moves from "New for you" to "Your offers" once every agent that
  // could offer on it has; chosen offers live under Projects.
  offered(task) { return (task.myOffers || []).length > 0 || (state.quotes || []).some(q => q.taskId === task.id && q.status === 'pending'); },
  // New for you: not offered on yet, or one of your agents still can.
  fresh(quoteForm) { return (state.opportunities || []).filter(t => !this.offered(t) || String(quoteForm(t) || '').includes('<form')); },
  opportunities(quoteForm) {
    const rows = state.opportunities || [], fresh = this.fresh(quoteForm);
    const auto = (state.agents || []).filter(a => a.rules?.automaticRequested);
    const caption = auto.length ? `Automatic offers: ${auto.map(a => `<span class="mk-handle">${escape(this.slug(a.name))}</span> ${escape(this.autoSummary(a.rules).split(' · ')[0].toLowerCase())}`).join('; ')}. Anything else, offer by hand.` : 'Your agents don’t offer automatically. Offer by hand, or turn on automatic offers for an agent under Offers & listing.';
    return `<p class="mk-caption mk-build-caption">${caption}</p>${this.section('New for you', fresh.length, '', fresh.length ? `<ul class="mk-threads">${fresh.map(t => this.opportunity(t, quoteForm)).join('')}</ul>` : `<p class="mk-empty-note">${rows.length ? 'You’ve offered on every open request that fits your agents.' : 'No open requests right now. Requests from other buyers that fit your agents appear here.'}</p>`)}${this.offers()}`;
  },
  offers() {
    const quotes = state.quotes || [], open = quotes.filter(q => q.status === 'pending'), past = quotes.filter(q => !['pending', 'selected', 'accepted'].includes(q.status));
    if (!open.length && !past.length) return '';
    const row = q => `<li>${this.thread({ tone: q.status === 'pending' ? 'none' : 'muted', title: q.title, tags: `<span class="mk-status">${escape(this.offerLabel(q.status))}</span>`,
      meta: [`<span class="mk-handle">${escape(this.slug(q.agentName))}</span>`, escape(money(q.amountMinor, q.currency)), escape(`${deliveryDuration(q.deliveryMinutes)} after starting`), q.runtimeBid ? 'sent automatically' : ''] })}</li>`;
    return this.section('Your offers', open.length, '', `${open.length ? `<ul class="mk-threads">${open.map(row).join('')}</ul>` : '<p class="mk-empty-note">No offers waiting for a buyer. Chosen offers are under Projects.</p>'}${past.length ? `<details class="mk-build-past"><summary>Past offers (${past.length})</summary><ul class="mk-threads">${past.map(row).join('')}</ul></details>` : ''}`);
  },
  offerLabel(status) {
    return { pending: 'Waiting for the buyer', selected: 'Chosen · waiting to start', accepted: 'Chosen · waiting to start', rejected: 'Not chosen', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Request changed' }[status] || String(status).replaceAll('_', ' ');
  },

  // ---- Projects: one row each, opening to the full task ---------------------
  projects() {
    const work = state.work || [];
    if (!work.length) return '<div class="mk-empty"><h2>No projects yet</h2><p>When a buyer chooses one of your agents’ offers, the work appears here.</p></div>';
    const focus = String(state.scrollTarget || '');
    const item = w => {
      const body = typeof RelayExecution === 'object' && w.execution ? RelayExecution.builderTask(w)
        : `<div class="mk-build-detail" data-notification-task="${escape(w.id)}">${w.proposal ? `<p>${escape(w.proposal)}</p>` : ''}<p class="mk-empty-note"><strong>Don’t start yet.</strong> The buyer hasn’t started this work: funding, access and the runtime permission aren’t in place.</p>${w.brief ? `<details><summary>Agreed brief</summary><p>${escape(w.brief)}</p></details>` : ''}${typeof builderConversation === 'function' ? builderConversation(w) : ''}</div>`;
      return `<li><details class="mk-build-project" ${focus.includes(w.id) || work.length === 1 ? 'open' : ''}><summary>${this.thread({ icon: 'package', tone: this.tone(w), title: w.title,
        meta: [`<span class="mk-handle">${escape(this.slug(w.agentName))}</span>`, escape(this.label(w)), w.amountMinor ? escape(money(w.amountMinor, w.currency)) : '', w.updatedAt ? `since ${escape(this.ago(w.updatedAt))}` : ''], action: '<span class="mk-next">Details</span>' })}</summary>${body}</details></li>`;
    };
    const groups = [['Needs you or your agent', w => ['queued', 'running'].includes(w.status) || w.payment?.reconciliation?.status === 'needs_review'],
      ['Waiting on the buyer', w => ['selected', 'buyer_review'].includes(w.status)], ['Done', () => true]];
    const placed = new Set();
    return groups.map(([title, test]) => { const rows = work.filter(w => !placed.has(w.id) && test(w)); rows.forEach(w => placed.add(w.id));
      return rows.length ? this.section(title, rows.length, '', `<ul class="mk-threads mk-build-projects">${rows.map(item).join('')}</ul>`) : ''; }).join('');
  },

  // ---- Earnings and settings ------------------------------------------------
  earnings() {
    const org = this.actingOrg();
    return `<div class="mk-strip mk-build-strip"><div class="mk-stat"><span>Paid to you</span><strong>${escape(money(0, 'USD'))}</strong><small>nothing paid yet</small></div><div class="mk-stat"><span>Coming to you</span><strong>${escape(money(0, 'USD'))}</strong><small>once buyers accept work</small></div></div>
      ${this.section('How you get paid', null, '', `<ol class="mk-build-steps"><li>A buyer chooses your offer. Nothing is owed yet.</li><li>The buyer pays Relay, and your agent does the work.</li><li>The buyer accepts the delivery against their checklist.</li><li>Relay sends the money to ${org ? `${escape(org.name)}’s` : 'your'} payout account.</li></ol><p class="mk-empty-note">Payments aren’t switched on yet, so no real money moves here.</p><a class="mk-next" href="/build/settings" data-route>Payout setup →</a>`)}`;
  },
  settings() {
    const back = state.returnAgentId ? `<button type="button" class="mk-chip" data-action="open-agent" data-id="${escape(state.returnAgentId)}">← Back to agent setup</button>` : '';
    const org = this.actingOrg(), name = this.builderName(), agents = state.agents || [];
    const account = this.section('Builder account', null, '', `<div class="mk-table-wrap"><table class="mk-table"><tbody>
      <tr><th scope="row">Name</th><td>${escape(name)}</td><td></td></tr>
      <tr><th scope="row">Public handle</th><td><code>${escape(this.slug(name))}</code></td><td class="mk-empty-note">Shown before each agent name.</td></tr>
      ${org ? `<tr><th scope="row">Organization</th><td>${escape(org.name)}</td><td class="mk-empty-note">Agents, connection keys, offers and reputation belong to ${escape(org.name)}. Its owners, and members while “Members can publish agents” is on, manage them. Each change is in the organization’s audit log.</td></tr>` : ''}
      <tr><th scope="row">Operator verification</th><td><span class="mk-status">Not started</span></td><td class="mk-empty-note">The identity check isn’t connected yet. Signing up doesn’t verify you.</td></tr></tbody></table></div>`);
    const keyKind = agent => {
      const r = agent.runtime || {};
      if (!r.expiresAt && !r.connected) return 'No key';
      return r.transport === 'supplier-api' ? 'Your own runtime (API)' : 'Local CSV runtime';
    };
    const keys = this.section('Connection keys', agents.length, '', agents.length ? `<p class="mk-caption">Each agent has its own key. Create a new one if a key leaks or someone with access leaves; the old one stops working at once.</p><div class="mk-table-wrap"><table class="mk-table mk-keys"><thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col">Key</th><th scope="col">Expires</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead><tbody>${agents.map(agent => {
      const r = agent.runtime || {}, none = keyKind(agent) === 'No key' || this.connection(agent).label.startsWith('Key expired');
      return `<tr><td><span class="mk-handle">${escape(this.slug(name))}/${escape(this.slug(agent.name))}</span></td><td>${this.connectionBadge(agent)}</td><td>${escape(keyKind(agent))}</td><td>${r.expiresAt ? `<span class="mk-keys-label">Key expires </span>${escape(r.expiresAt > Date.now() ? this.until(r.expiresAt) : 'expired')}` : '—'}</td><td><button type="button" class="mk-link-button" data-action="agent-tab" data-id="${escape(agent.id)}" data-tab="connection">${none ? 'Connect' : 'Manage'}</button></td></tr>`;
    }).join('')}</tbody></table></div>` : '<p class="mk-empty-note">No agents yet.</p>');
    const payouts = typeof RelayPayments === 'object' && state.payments?.configured ? this.section('Payouts', null, '', RelayPayments.settings()) : this.section('Payouts', null, '', `<div class="mk-table-wrap"><table class="mk-table"><tbody>
      <tr><th scope="row">Payout account</th><td><span class="mk-status">Not set up</span></td><td class="mk-empty-note">${org ? `One account for ${escape(org.name)}, set up by an owner. ` : ''}Payout setup isn’t available yet. Relay never asks for bank details or wallet keys here.</td></tr></tbody></table></div>`);
    const notifications = this.section('Notifications', null, '', `<p class="mk-caption">Relay tells you in the app, under the bell at the top, about new requests that fit one of your agents or were sent to you directly (for a week, or until you offer), and about work a buyer chose you for: when it starts, messages, revision requests and acceptance. A paused agent isn’t alerted.${org ? ` While you build as ${escape(org.name)}, the bell shows ${escape(org.name)}’s updates, shared with its other members.` : ''} Email comes with hosted email.</p>`);
    return back + account + keys + payouts + notifications;
  },

  // The agent's own setup page is headed like its public page: builder/agent.
  agentTitle(agent) { return `<span class="mk-handle mk-build-title">${escape(this.slug(this.builderName()))}/${escape(this.slug(agent.name))}</span>`; },
  shell(tab, title, lede, action, content) {
    const active = state.setupAgentId || state.addingAgent ? 'agents' : tab === 'quotes' ? 'opportunities' : tab;
    const counts = { agents: (state.agents || []).length, opportunities: this.fresh(typeof quoteForm === 'function' ? quoteForm : () => '').length, work: (state.work || []).length };
    const heading = title ? `${title}${counts[active] !== undefined && this.NAV.some(([id, label]) => id !== 'dashboard' && label === title) ? ` <span class="mk-total">${counts[active]}</span>` : ''}` : '';
    if (!this.isBuilder()) return `<div class="mk-build mk-build-first"><section class="mk-build-main">${this.switcher()}${title ? `<header class="mk-results-head mk-build-head"><div><h1>${heading}</h1>${lede ? `<p class="mk-caption">${lede}</p>` : ''}</div>${action || ''}</header>` : ''}${content}</section></div>`;
    return `<div class="mk-build"><nav class="mk-build-nav" aria-label="Build"><p class="mk-build-who">${this.avatar(this.builderName())}<span class="mk-handle">${escape(this.slug(this.builderName()))}</span></p>${this.switcher()}${this.NAV.map(([id, label, slug]) =>
      `<a href="/build${slug ? '/' + slug : ''}" data-route ${active === id ? 'class="active" aria-current="page"' : ''}>${label}${counts[id] ? ` <span class="mk-count">${counts[id]}</span>` : ''}</a>`).join('')}</nav>
      <section class="mk-build-main">${title ? `<header class="mk-results-head mk-build-head"><div><h1>${heading}</h1>${lede ? `<p class="mk-caption">${lede}</p>` : ''}</div>${action || ''}</header>` : ''}${content}</section></div>`;
  },
  plural(n, one, many = one + 's') { return `${n} ${n === 1 ? one : many}`; },
  // "5 min ago", "3 days ago", or a date after a week.
  ago(time, now = Date.now()) {
    if (!time) return '';
    const minutes = Math.max(0, Math.round((now - time) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    return days < 7 ? this.plural(days, 'day') + ' ago' : new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  // What a connected agent may offer on by itself, in one line.
  autoSummary(rules = {}) {
    if (!rules.automaticRequested) return 'Off. You make every offer by hand.';
    const scope = rules.automaticScope === 'limited' ? `Small requests only: up to ${money(rules.automaticLimitMinor, rules.currency || 'USD')}, never ERP data` : 'Any matching request';
    return `${scope} · from ${money(rules.minimumPayout, rules.currency || 'USD')}${rules.automaticEnabled ? '' : ' · starts once your agent is connected'}`;
  },

  // ---- One agent: an overview first, then a tab per area ----------------------
  // Drafts open on the next setup step; set-up agents open on the overview.
  TABS: [['overview', 'Overview'], ['profile', 'Profile'], ['connection', 'Connection'], ['tests', 'Relay tests'], ['offers', 'Offers & listing'], ['results', 'Results']],
  STEP_TAB: { 1: 'profile', 2: 'connection', 3: 'tests' },
  defaultTab(agent) {
    const id = this.status(agent).id;
    if (id === 'draft') return agent.readiness?.profile ? 'connection' : 'profile';
    return 'overview';
  },
  // ---- Connection: from the last check-in and the key, so it stays true ------
  // between refreshes. The server counts an agent connected for 2 minutes after
  // a check-in; the browser applies the same rule as time passes.
  connection(agent, now = Date.now()) {
    const r = agent.runtime || {};
    const expiry = r.expiresAt && r.expiresAt - now < 48 * 3600000 ? ` · key expires ${this.until(r.expiresAt, now)}` : '';
    if (r.expiresAt && r.expiresAt <= now) return { tone: 'off', label: 'Key expired · create a new one' };
    if (r.connectedAt && now - r.connectedAt <= 120000 && (r.connected || r.expiresAt)) return { tone: 'live', label: `Connected · checked in ${this.since(r.connectedAt, now)}${expiry}` };
    if (!r.expiresAt && !r.connected) return { tone: 'off', label: 'Not connected' };
    if (!r.connectedAt) return { tone: 'wait', label: `Key ready · waiting for the first check-in${expiry}` };
    return { tone: 'stale', label: `Offline · last check-in ${this.since(r.connectedAt, now)}${expiry}` };
  },
  connectionBadge(agent) {
    const r = agent.runtime || {}, c = this.connection(agent);
    return `<span class="mk-conn mk-conn-${c.tone}" data-conn-at="${Number(r.connectedAt) || 0}" data-conn-exp="${Number(r.expiresAt) || 0}" data-conn-on="${r.connected ? 1 : 0}">${escape(c.label)}</span>`;
  },
  // Updates every badge in place (called by a timer; nothing is re-rendered).
  tickConnections(nodes, now = Date.now()) {
    for (const node of nodes) {
      const c = this.connection({ runtime: { connectedAt: Number(node.dataset.connAt) || null, expiresAt: Number(node.dataset.connExp) || null, connected: node.dataset.connOn === '1' } }, now);
      if (node.textContent !== c.label) node.textContent = c.label;
      node.className = `mk-conn mk-conn-${c.tone}`;
    }
  },
  since(time, now = Date.now()) {
    const seconds = Math.max(0, Math.round((now - time) / 1000));
    return seconds < 60 ? `${seconds} s ago` : this.ago(time, now);
  },
  until(time, now = Date.now()) {
    const hours = Math.max(0, Math.round((time - now) / 3600000));
    return hours < 48 ? `in ${hours} h` : `in ${Math.round(hours / 24)} days`;
  },
  setup(agent) {
    const passed = (agent.capabilities || []).some(item => item.qualification === 'qualified');
    const connected = this.connection(agent).tone === 'live';
    return [
      ['profile', 'Describe it', !!agent.readiness?.profile, 'Name, what it does and its capabilities.', 'Edit profile'],
      ['connection', 'Connect it', connected, connected ? this.connection(agent).label : 'Run it where you like and connect it with a key.', 'Connect'],
      ['tests', 'Pass a Relay test', passed, passed ? 'Passed. Buyers see the result on its card.' : 'Relay sends a test job and checks what comes back.', 'Take a test'],
      ['offers', 'Publish it', agent.listingStatus === 'published' && passed, agent.listingStatus === 'published' ? 'Listed on Agents.' : passed ? 'Ready. Publish it to appear on Agents.' : 'Opens after a passed Relay test.', 'Publish'],
    ];
  },
  overview(agent) {
    const steps = this.setup(agent), next = steps.find(step => !step[2]);
    const list = `<ol class="mk-build-setup">${steps.map(([tab, label, done, note, action]) => `<li class="${done ? 'is-done' : next?.[0] === tab ? 'is-next' : ''}"><span class="mk-build-tick" aria-hidden="true">${done ? '✓' : ''}</span><span><strong>${label}</strong><small>${escape(note)}</small></span>${!done && next?.[0] === tab ? `<button type="button" class="mk-primary" data-action="agent-tab" data-id="${escape(agent.id)}" data-tab="${tab}">${action}</button>` : ''}<span class="sr-only">${done ? 'done' : 'to do'}</span></li>`).join('')}</ol>`;
    const tests = (agent.capabilities || []).map(c => `${escape(c.task)} · ${c.qualification === 'qualified' ? 'Relay test passed' : c.qualification === 'expired' ? 'retest needed' : 'no Relay test yet'}`);
    const row = (label, value, tab, link) => `<tr><th scope="row">${label}</th><td>${value}</td><td>${tab ? `<button type="button" class="mk-link-button" data-action="agent-tab" data-id="${escape(agent.id)}" data-tab="${tab}">${link || 'Change'}</button>` : link || ''}</td></tr>`;
    return this.section(next ? 'Get it ready for work' : 'Ready for work', null, '', list)
      + this.section('At a glance', null, '', `<div class="mk-table-wrap"><table class="mk-table"><tbody>
        ${row('Connection', this.connectionBadge(agent), 'connection', 'Keys')}
        ${row('Capabilities', tests.join('<br>') || 'None yet', 'tests', 'Relay tests')}
        ${row('Packages', escape(this.plural((agent.packages || []).length, 'package')), '', `<a href="/agents/${escape(agent.id)}#packages" data-route>Manage on your agent page →</a>`)}
        ${row('Automatic offers', escape(this.autoSummary(agent.rules)), 'offers')}
        ${row('Listing', escape({ published: 'Published · on Agents', paused: 'Paused · hidden', draft: 'Draft · only you' }[agent.listingStatus] || 'Draft · only you'), 'offers')}
        ${row('Paid work', this.payable(agent) ? 'Set up' : 'Not set up yet', '', '<a href="/build/settings" data-route>Payout setup →</a>')}
      </tbody></table></div>`);
  },
  manage(agent, parts) {
    const tab = this.TABS.some(([id]) => id === state.agentTab) ? state.agentTab : this.defaultTab(agent);
    const tabs = `<nav class="mk-tabs mk-build-tabs" aria-label="Agent">${this.TABS.map(([id, label]) => `<button type="button" data-action="agent-tab" data-id="${escape(agent.id)}" data-tab="${id}" ${tab === id ? 'class="active" aria-current="page"' : ''}>${label}</button>`).join('')}</nav>`;
    const body = tab === 'overview' ? this.overview(agent) : (parts[tab] ? parts[tab]() : '');
    return `${tabs}<div class="mk-build-tab">${body}</div>`;
  },
};
