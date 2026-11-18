'use strict';

// The browse-first marketplace: the signed-in buyer home, agent pages, the
// "Post a request" form and real links (docs/specs/Marketplace-Model.md → "Layout",
// design reference in docs/design/marketplace/).
//
// Everything shown comes from the server: listings the builder declared and
// evidence Relay recorded. Ways to buy that are not built yet (self-serve runs,
// packages, published prices) show an honest empty state, never sample numbers.
const RelayMarketplace = {
  MIN_RATE_SAMPLE: 20,
  // While the catalogue is small, rows carry one line of description.
  SMALL_CATALOGUE: 30,
  RAIL_CATEGORY_LIMIT: 8,
  // Seed category first (docs/Seed-Category.md): B2B data & research, then sales & marketing.
  SEED: /lead|research|enrich|firmograph|prospect|crm|data|company|market|sales|marketing/i,
  AGENT_TABS: [['card', 'Agent card'], ['evidence', 'Evidence'], ['packages', 'Packages'], ['versions', 'Versions'], ['discussion', 'Discussion']],
  EVIDENCE_FILTERS: [['tested', 'Passed Relay test'], ['runs20', '20+ verified runs'], ['repeat', 'Repeat buyers'], ['hosted', 'Hosted on Relay']],

  // ---- Routes ------------------------------------------------------------
  // Real paths for the pages people share: /, /agents/<id>, /tasks/<id>, /post, /evidence.
  parse(pathname = globalThis.location?.pathname || '/', hash = globalThis.location?.hash || '') {
    const agent = /^\/agents\/([0-9a-f-]{36})$/.exec(pathname)?.[1] ||
      /^#storefront=([0-9a-f-]{36})(?:\?source=(?:market|builder))?$/.exec(hash)?.[1];
    if (agent) return { page: 'agent', id: agent };
    const task = /^\/tasks\/([0-9a-f-]{36})$/.exec(pathname)?.[1] || /^#(?:task|chat)=([0-9a-f-]{36})$/.exec(hash)?.[1];
    if (task) return { page: 'task', id: task };
    if (pathname === '/post') return { page: 'post', id: null };
    if (pathname === '/evidence') return { page: 'evidence', id: null };
    return { page: null, id: null };
  },
  // Apply a route to buyer state. Returns the task id to load, if any.
  apply(route, target = state) {
    target.agentPageId = null;
    if (route.page === 'agent') { target.buyerTab = 'market'; target.agentPageId = route.id; target.agentTab ||= 'card'; target.detail = null; }
    else if (route.page === 'post') { target.buyerTab = 'request'; target.detail = null; }
    else if (route.page === 'evidence') { target.buyerTab = 'evidence'; target.detail = null; }
    return route.page === 'task' ? route.id : null;
  },
  // The canonical path for what the buyer is looking at.
  path(current = state) {
    if (current.detail && current.detail.task.status !== 'draft') return `/tasks/${current.detail.task.id}`;
    if (current.detail) return `/tasks/${current.detail.task.id}`;
    if (current.buyerTab === 'market' && current.agentPageId) return `/agents/${current.agentPageId}`;
    if (current.buyerTab === 'request') return '/post';
    if (current.buyerTab === 'evidence') return '/evidence';
    return '/';
  },
  // Keep the address bar in step after each render. A new page is a new history
  // entry so Back works; other hash-based views keep their hash on "/".
  sync() {
    if (!globalThis.history || !state.account || state.auth || state.account.user.workspace !== 'buyer') return;
    const target = this.path();
    const routed = target !== '/';
    const hash = routed ? '' : (/^#(tasks|market|scheduled|apps|tools|billing|activity|team-invite=.*|payment-recovery)$/.test(location.hash) ? location.hash : '');
    const next = target + hash;
    if (location.pathname + location.hash === next) return;
    if (location.pathname !== target && !this.restoring) history.pushState(null, '', next);
    else history.replaceState(null, '', next);
  },
  async go(path) {
    history.pushState(null, '', path);
    await this.follow();
  },
  async follow() {
    const id = this.apply(this.parse());
    if (!this.parse().page) {
      state.agentPageId = null;
      state.detail = null;
      state.buyerTab = ['tasks', 'activity', 'scheduled', 'apps', 'tools', 'billing'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'market';
    }
    this.restoring = true;
    try { await refresh(id || null); render(); root.querySelector('#workspace-main')?.focus({ preventScroll: true }); }
    finally { this.restoring = false; }
  },

  // ---- Data --------------------------------------------------------------
  async load(target = state) {
    if (target.account?.user.workspace !== 'buyer') return;
    if (target.buyerTab === 'market' && !target.agentPageId) {
      target.market = await api('/api/marketplace?sort=' + encodeURIComponent(target.marketSort || 'runs'));
    }
    target.agentPage = null;
    if (target.buyerTab === 'market' && target.agentPageId) {
      try { target.agentPage = (await api('/api/agent-market/' + target.agentPageId)).agent; }
      catch (error) { if (error.status !== 404) throw error; }
    }
  },

  // ---- Formatting --------------------------------------------------------
  slug(value) {
    return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
  },
  handle(agent) { return `${this.slug(agent.builder)}/${this.slug(agent.name)}`; },
  ago(time, now = Date.now()) {
    if (!time) return '';
    const minutes = Math.max(0, Math.round((now - time) / 60000));
    if (minutes < 60 * 24) return 'today';
    const days = Math.round(minutes / 1440);
    if (days === 1) return '1 day ago';
    if (days < 14) return `${days} days ago`;
    if (days < 60) return `${Math.round(days / 7)} weeks ago`;
    return `${Math.round(days / 30)} months ago`;
  },
  version(value) { return value ? (/^v/i.test(value) ? value : `v${value}`) : ''; },
  plural(count, one, many = `${one}s`) { return `${count} ${count === 1 ? one : many}`; },
  // The evidence a row leads with. A rate only from 20 decided runs; counts and
  // the window otherwise; failures always count.
  evidenceLine(agent) {
    const e = agent.evidence;
    if (!e.runs) return { text: agent.relayTest.passed ? 'Passed Relay test · no runs yet' : 'Relay test not passed · no runs yet', strong: false };
    const repeat = agent.buyers.repeat ? ` · ${this.plural(agent.buyers.repeat, 'repeat buyer')}` : '';
    if (e.acceptedRate !== null && e.runs >= this.MIN_RATE_SAMPLE)
      return { text: `${Math.round(e.acceptedRate * 100)}% accepted · ${e.runs} runs · ${e.windowDays}d${repeat}`, strong: true };
    const parts = [this.plural(e.runs, 'run'), `${e.accepted} accepted`];
    if (e.accepted_after_revision) parts.push(`${e.accepted_after_revision} revised`);
    if (e.failed) parts.push(`${e.failed} failed`);
    if (e.refunded) parts.push(`${e.refunded} refunded`);
    return { text: `${parts.join(' · ')} · ${e.windowDays}d${repeat}`, strong: false };
  },
  ways(agent) {
    const names = { use: 'Use', hire: 'Hire', commission: 'Commission' };
    return agent.waysToBuy.map(way => names[way] || way).join(' · ');
  },
  price(agent) { return agent.fromPrice ? `from ${agent.fromPrice}` : 'Quoted per request'; },
  updated(agent) {
    return agent.version ? `${this.version(agent.version)} · ${this.ago(agent.versionSince || agent.listedAt)}` : `listed ${this.ago(agent.listedAt)}`;
  },
  hue(text) { let h = 0; for (const c of String(text)) h = (h * 31 + c.charCodeAt(0)) % 360; return Math.round(h / 30) % 12; },
  avatar(agent, size = '') {
    return `<span class="mk-avatar mk-hue-${this.hue(agent.builder)} ${size}" aria-hidden="true">${escape(String(agent.builder).slice(0, 1).toUpperCase())}</span>`;
  },
  dot(category) { return `<span class="mk-dot mk-hue-${this.hue(category)}" aria-hidden="true"></span>`; },

  // ---- Shell -------------------------------------------------------------
  topbar(user) {
    const active = state.detail || ['tasks'].includes(state.buyerTab) ? 'work'
      : state.buyerTab === 'activity' ? 'activity' : state.buyerTab === 'evidence' ? 'evidence' : state.buyerTab === 'market' ? 'agents' : '';
    const link = (id, href, label, attrs = '') => `<a class="${active === id ? 'active' : ''}" href="${href}" ${active === id ? 'aria-current="page"' : ''} ${attrs}>${label}</a>`;
    const more = [
      ...(state.features?.recurring ? [['scheduled', 'Scheduled work']] : []),
      ...(state.features?.workspaceApps ? [['apps', 'Apps']] : []),
      ['business', 'Business workspace'], ['billing', 'History & spend'], ['tools', 'Connected tools'],
    ];
    return `<a class="skip-workspace" href="#workspace-main">Skip to content</a><header class="mk-topbar">
      <a class="mk-brand" href="/" data-route aria-label="Relay home">relay</a>
      <form class="mk-search" id="market-search" role="search"><label class="sr-only" for="market-search-input">Search agents</label><span aria-hidden="true">⌕</span><input id="market-search-input" name="q" type="search" placeholder="Search agents, builders, outcomes" value="${escape(state.marketFilters?.q || '')}" autocomplete="off"></form>
      <nav class="mk-nav" aria-label="Main">${link('agents', '/', 'Agents', 'data-route')}${link('work', '/#tasks', 'Your work', 'data-route data-tab="tasks"')}${link('activity', '/#activity', 'Activity', 'data-route data-tab="activity"')}${link('evidence', '/evidence', 'How evidence works', 'data-route')}</nav>
      <div class="mk-account">
        <div id="notification-slot">${typeof RelayNotifications === 'object' ? RelayNotifications.view() : ''}</div>
        <details class="mk-menu"><summary><span class="account-avatar">${escape(user.name.slice(0, 1).toUpperCase())}</span><span class="sr-only">Account and workspace for ${escape(user.name)}</span></summary>
          <div class="mk-menu-panel"><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small>
            ${more.map(([id, label]) => `<button data-action="buyer-nav" data-tab="${id}">${label}</button>`).join('')}
            ${state.payments?.recoveryAccess ? '<button data-action="recovery-open">Payment recovery</button>' : ''}
            <button data-action="toggle-appearance" aria-pressed="${globalThis.document?.documentElement?.dataset.appearance !== 'light'}">Dark mode</button>
            <button data-action="logout">Sign out</button></div></details>
        <button class="mk-publish" data-action="switch">Publish an agent</button>
      </div></header>`;
  },

  // ---- Browse ------------------------------------------------------------
  filters() {
    state.marketFilters ||= { q: '', categories: [], ways: [], works: [], evidence: [], railTab: 'main', allCategories: false };
    return state.marketFilters;
  },
  matches(agent, f = this.filters()) {
    const q = f.q.trim().toLowerCase();
    const text = [agent.builder, agent.name, this.handle(agent), agent.purpose, agent.domain, ...agent.categories,
      ...agent.capabilities.map(item => item.task)].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every(word => text.includes(word))) return false;
    if (f.categories.length && !agent.categories.some(item => f.categories.includes(item))) return false;
    if (f.ways.length && !f.ways.some(way => agent.waysToBuy.includes(way))) return false;
    if (f.works.length && !f.works.every(name => agent.worksWith.includes(name))) return false;
    const evidence = { tested: agent.relayTest.passed, runs20: agent.evidence.runs >= this.MIN_RATE_SAMPLE, repeat: agent.buyers.repeat > 0, hosted: agent.hostedOnRelay };
    return f.evidence.every(key => evidence[key]);
  },
  visible() { return (state.market?.agents || []).filter(agent => this.matches(agent)); },
  categories() {
    const counts = new Map();
    for (const agent of state.market?.agents || []) for (const item of agent.categories) counts.set(item, (counts.get(item) || 0) + 1);
    return [...counts.entries()].sort((a, b) => Number(this.SEED.test(b[0])) - Number(this.SEED.test(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]));
  },
  chip(group, value, label, selected, { disabled = false, count = null, title = '' } = {}) {
    const hint = title || (count !== null ? `${count} ${count === 1 ? 'agent' : 'agents'}` : '');
    return `<button type="button" class="mk-chip" data-action="market-filter" data-group="${group}" data-value="${escape(value)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''} ${hint ? `title="${escape(hint)}"` : ''}>${label}</button>`;
  },
  rail() {
    const f = this.filters();
    const all = state.market?.agents || [];
    const tab = f.railTab;
    const show = id => tab === 'main' || tab === id;
    const cats = this.categories();
    const shown = f.allCategories ? cats : cats.slice(0, this.RAIL_CATEGORY_LIMIT);
    const count = (predicate) => all.filter(predicate).length;
    const evidenceCounts = { tested: count(a => a.relayTest.passed), runs20: count(a => a.evidence.runs >= this.MIN_RATE_SAMPLE), repeat: count(a => a.buyers.repeat > 0), hosted: count(a => a.hostedOnRelay) };
    const connectors = state.market?.connectors || [];
    const tabs = [['main', 'Main'], ['categories', 'Categories'], ['works', 'Works with'], ['evidence', 'Evidence']];
    return `<aside class="mk-rail" aria-label="Filters">
      <div class="mk-rail-tabs" role="group" aria-label="Filter sections">${tabs.map(([id, label]) => `<button type="button" data-action="market-rail-tab" data-tab="${id}" aria-pressed="${tab === id}">${label}</button>`).join('')}</div>
      ${show('categories') ? `<section><h2>Categories</h2>${cats.length ? `<div class="mk-chips">${shown.map(([name, n]) => this.chip('categories', name, `${this.dot(name)}${escape(name)}`, f.categories.includes(name), { count: n })).join('')}${cats.length > shown.length ? `<button type="button" class="mk-chip" data-action="market-more-categories">+ ${cats.length - shown.length}</button>` : ''}</div>` : '<p class="mk-empty-note">No categories yet.</p>'}</section>` : ''}
      ${show('main') ? `<section><h2>Ways to buy</h2><div class="mk-chips">
        ${this.chip('ways', 'use', '<strong>Use it</strong>&nbsp;· self-serve', false, { disabled: true, title: 'Self-serve runs are not available yet' })}
        ${this.chip('ways', 'hire', '<strong>Hire it</strong>&nbsp;· package', false, { disabled: true, title: 'Packages are not available yet' })}
        ${this.chip('ways', 'commission', '<strong>Commission</strong>&nbsp;· custom', f.ways.includes('commission'), { count: count(a => a.waysToBuy.includes('commission')) })}
      </div><p class="mk-empty-note">Self-serve runs and packages aren’t available yet. Every agent quotes on a request today.</p></section>
      <section><h2>Price</h2><p class="mk-empty-note">No published prices yet. Agents quote per request, and you approve the price before any work starts.</p></section>` : ''}
      ${show('works') ? `<section><h2>Works with</h2>${connectors.length ? `<div class="mk-chips">${connectors.map(name => this.chip('works', name, escape(name), f.works.includes(name), { count: count(a => a.worksWith.includes(name)) })).join('')}</div><p class="mk-empty-note">Declared by builders. Access is only granted per task, with your approval.</p>` : '<p class="mk-empty-note">No connectors are set up in this environment yet.</p>'}</section>` : ''}
      ${show('evidence') ? `<section><h2>Evidence</h2><div class="mk-chips">${this.EVIDENCE_FILTERS.map(([id, label]) => this.chip('evidence', id, escape(label), f.evidence.includes(id), { count: evidenceCounts[id] })).join('')}</div></section>` : ''}
      <p class="mk-rail-note">Rankings can’t be bought. The order comes from the sort you choose and results Relay verified, including failures.</p>
    </aside>`;
  },
  row(agent, describe) {
    const evidence = this.evidenceLine(agent);
    const meta = [escape(agent.category || 'Uncategorised'), escape(this.ways(agent)), escape(this.price(agent)),
      `<span class="${evidence.strong ? 'mk-good' : ''}">${escape(evidence.text)}</span>`, escape(this.updated(agent))];
    return `<li class="mk-row"><a href="/agents/${escape(agent.id)}" data-route class="mk-row-link">
      <span class="mk-row-title">${this.avatar(agent)}<span class="mk-handle">${escape(this.handle(agent))}</span>${agent.isNew ? '<span class="mk-new">New</span>' : ''}${agent.own ? '<span class="mk-tag">Yours</span>' : ''}</span>
      <span class="mk-meta">${meta.join('<span class="mk-sep" aria-hidden="true">·</span>')}</span>
      ${describe ? `<span class="mk-desc">${escape(agent.purpose)}</span>` : ''}</a></li>`;
  },
  postCard() {
    return `<section class="mk-post-card"><div><h2>Not finding the right agent?</h2><p>Post a request with your outcome and acceptance checklist. Agents quote on it, and you approve before any work starts.</p></div><a class="mk-primary" href="/post" data-route>Post a request</a></section>`;
  },
  browse() {
    if (!state.market) return '<section class="mk-page" aria-busy="true"><p role="status">Loading agents…</p></section>';
    const f = this.filters();
    const all = state.market.agents;
    const agents = this.visible();
    const describe = all.length < this.SMALL_CATALOGUE;
    const filtered = f.q || f.categories.length || f.ways.length || f.works.length || f.evidence.length;
    const list = !all.length
      ? `<div class="mk-empty"><h2>No agents are listed yet</h2><p>Builders publish an agent after it passes a Relay test. You can still post a request now.</p></div>`
      : agents.length ? `<ul class="mk-list">${agents.map(agent => this.row(agent, describe)).join('')}</ul>`
      : `<div class="mk-empty"><h2>No agents match these filters</h2><p>Try fewer filters, or post a request and let builders quote.</p><button type="button" data-action="market-clear">Clear filters</button></div>`;
    return `<div class="mk-browse">${this.rail()}<section class="mk-results" aria-labelledby="mk-results-title">
      <header class="mk-results-head"><h1 id="mk-results-title">Agents <span class="mk-total">${filtered ? `${agents.length} of ${all.length}` : all.length}</span></h1>
        <label class="mk-filter-name"><span class="sr-only">Filter by name</span><input type="search" data-market-name placeholder="Filter by name" value="${escape(f.q)}"></label>
        <div class="mk-toggles"><label class="mk-check" title="No agent offers packages yet"><input type="checkbox" disabled> Has packages</label><button type="button" class="mk-chip" disabled title="No agent offers self-serve runs yet">Self-serve available</button>
        <label class="mk-sort"><span class="sr-only">Sort agents</span><select data-market-sort><option value="runs" ${state.market.sort === 'runs' ? 'selected' : ''}>Sort: Most verified runs</option><option value="newest" ${state.market.sort === 'newest' ? 'selected' : ''}>Sort: Newest</option><option value="price" disabled>Sort: Price (no prices yet)</option></select></label></div>
      </header>
      <p class="mk-sr-status sr-only" role="status" aria-live="polite">${agents.length} agents shown</p>
      ${list}${this.postCard()}
      <p class="mk-basis">Evidence is recorded by Relay from finished work in this environment, over the last ${state.market.windowDays} days. Local and pilot runs aren’t paid-customer proof. <a href="/evidence" data-route>How evidence works</a></p>
    </section></div>`;
  },
  // Update the list in place so typing keeps focus.
  refreshList() {
    const results = root.querySelector('.mk-results');
    if (!results) return render();
    const scroll = document.scrollingElement?.scrollTop;
    const active = document.activeElement?.matches?.('[data-market-name]') ? 'name' : document.activeElement?.id === 'market-search-input' ? 'search' : null;
    const caret = document.activeElement?.selectionStart;
    const holder = document.createElement('div');
    holder.innerHTML = this.browse();
    root.querySelector('.mk-browse').replaceWith(holder.firstElementChild);
    const input = active === 'name' ? root.querySelector('[data-market-name]') : active === 'search' ? root.querySelector('#market-search-input') : null;
    if (input) { input.focus(); input.setSelectionRange(caret, caret); }
    if (scroll !== undefined) document.scrollingElement.scrollTop = scroll;
  },

  // ---- Agent page --------------------------------------------------------
  stat(label, value, note, good = false) {
    return `<div class="mk-stat"><span>${label}</span><strong class="${good ? 'mk-good' : ''}">${value}</strong><small>${note}</small></div>`;
  },
  strip(m) {
    const e = m.evidence;
    const accepted = !e.runs ? this.stat(`Accepted, last ${e.windowDays} days`, '—', 'No decided runs yet')
      : e.acceptedRate !== null ? this.stat(`Accepted, last ${e.windowDays} days`, `${Math.round(e.acceptedRate * 100)}%`, `${e.accepted} of ${e.runs} decided runs`, true)
      : this.stat(`Accepted, last ${e.windowDays} days`, `${e.accepted} of ${e.runs}`, `decided runs · a rate shows from ${this.MIN_RATE_SAMPLE}`);
    const ended = e.failed + e.refunded;
    return `<div class="mk-strip">${accepted}
      ${this.stat('First time / after fixes', e.runs ? `${e.accepted_first_time} / ${e.accepted_after_revision}` : '—', e.runs ? `${ended} failed, ended unmet or refunded` : 'No decided runs yet')}
      ${this.stat('Repeat buyers', m.buyers.total ? String(m.buyers.repeat) : '—', m.buyers.total ? `of ${this.plural(m.buyers.total, 'buyer')}` : 'No buyers yet')}
      ${this.stat('Relay test', m.relayTest.passed ? 'Passed' : 'Not passed', m.relayTest.passed ? `${escape(m.relayTest.rubric)} · ${escape(this.version(m.relayTest.runtimeVersion))}` : 'Not currently qualified')}
    </div><p class="mk-caption">Recorded by Relay from finished work in this environment, including failures. Not reported by the builder. Local and pilot runs aren’t paid-customer proof. <a href="/evidence" data-route>How evidence works</a></p>`;
  },
  versionsTable(record) {
    const rows = record?.versions || [];
    if (!rows.length) return '<p class="mk-empty-note">No decided runs yet. Results appear per version once buyers accept or reject deliveries.</p>';
    return `<div class="mk-table-wrap"><table class="mk-table"><thead><tr><th scope="col">Version</th><th scope="col">Decided runs</th><th scope="col">Accepted</th><th scope="col">Failed or unmet</th><th scope="col">Last run</th></tr></thead><tbody>
      ${rows.map(item => { const o = item.outcomes; return `<tr><td><code>${escape(item.runtimeVersion ? this.version(item.runtimeVersion) : 'Before versions')}</code>${item.current ? ' <span class="mk-tag">current</span>' : ''}</td><td>${o.runs}</td><td>${o.accepted}${o.acceptedRate !== null ? ` · ${Math.round(o.acceptedRate * 100)}%` : o.runs ? ` · rate after ${this.MIN_RATE_SAMPLE}` : ''}</td><td>${o.failed + o.refunded}</td><td>${escape(this.ago(item.lastRunAt))}</td></tr>`; }).join('')}
    </tbody></table></div>`;
  },
  cardTab(agent, m) {
    const outputs = [...new Set(m.capabilities.flatMap(item => item.metadata?.outputs || []))];
    const regions = [...new Set(m.capabilities.flatMap(item => item.metadata?.regions || []))];
    const industries = [...new Set(m.capabilities.flatMap(item => item.metadata?.industries || []))];
    return `${this.strip(m)}
      <section class="mk-section"><h2>What it does</h2><p class="mk-lead">${escape(m.purpose)}</p>
        <ul class="mk-capabilities">${m.capabilities.map(item => `<li><span>${escape(item.task)}</span><span class="mk-tag ${item.qualification === 'qualified' ? 'mk-tag-good' : ''}">${item.qualification === 'qualified' ? 'Passed Relay test' : 'Declared, not tested'}</span></li>`).join('')}</ul></section>
      <section class="mk-section"><h2>Inputs and output</h2><div class="mk-io">
        <div><h3>You provide</h3><ul><li>The brief you post, with your acceptance checklist</li><li>Any files you attach to the task</li></ul></div>
        <div><h3>You get</h3>${outputs.length ? `<ul>${outputs.map(item => `<li>${escape(item)}</li>`).join('')}<li>A delivery you review before accepting</li></ul>` : '<ul><li>A delivery you review before accepting</li></ul>'}
          ${regions.length || industries.length ? `<p class="mk-declared">Declared by the builder: ${escape([...industries, ...regions].join(' · '))}</p>` : '<p class="mk-declared">Output formats declared by the builder.</p>'}</div>
      </div></section>
      <section class="mk-section"><h2>Checked on every run</h2><p class="mk-empty-note">Relay doesn’t run automatic output checks for this agent yet.</p>
        <ul class="mk-checks"><li>You review every delivery against the checklist you agreed before work started</li><li>Fixes are free until the checklist is met</li><li>After two rounds of changes you can end the work as unmet. It counts as a failed run here.</li></ul></section>
      <section class="mk-section"><h2>Access it asks for</h2><p>It reads the brief and the files you attach to the task. Anything else, such as a connected tool, needs your approval on that task first. Agents can’t move money on Relay.</p></section>
      <section class="mk-section"><h2>Results by version</h2>${this.versionsTable(agent.trackRecord)}</section>`;
  },
  evidenceTab(agent, m) {
    const e = m.evidence;
    const rows = [['Accepted the first time', e.accepted_first_time], ['Accepted after fixes', e.accepted_after_revision], ['Failed or ended unmet', e.failed], ['Refunded', e.refunded], ['Cancelled by the buyer (not counted)', e.cancelled]];
    return `${this.strip(m)}<section class="mk-section"><h2>Every decided run, last ${e.windowDays} days</h2>
      <div class="mk-table-wrap"><table class="mk-table"><tbody>${rows.map(([label, value]) => `<tr><th scope="row">${label}</th><td>${value}</td></tr>`).join('')}<tr><th scope="row">Decided runs</th><td><strong>${e.runs}</strong></td></tr></tbody></table></div>
      <p class="mk-caption">A percentage appears only after ${this.MIN_RATE_SAMPLE} decided runs. Buyer cancellations before a decision aren’t counted as runs.</p></section>
      <section class="mk-section"><h2>Relay test</h2>${m.relayTest.passed ? `<p>Passed <strong>${escape(m.relayTest.title)}</strong> (<code>${escape(m.relayTest.rubric)}</code>) on ${escape(this.version(m.relayTest.runtimeVersion))}${m.relayTest.completedAt ? `, ${escape(this.ago(m.relayTest.completedAt))}` : ''}. A new runtime version has to pass again.</p><p class="mk-caption">A capability test checks a bounded task. It isn’t a guarantee that every request will succeed.</p>` : '<p>This agent hasn’t passed a current Relay test, so it can’t receive direct requests.</p>'}</section>`;
  },
  agent() {
    const agent = state.agentPage;
    const back = '<a class="mk-back" href="/" data-route>← All agents</a>';
    if (!agent) return `<section class="mk-page">${back}<div class="mk-empty"><h1>Agent unavailable</h1><p>This agent isn’t listed for your account right now.</p><a class="mk-primary" href="/" data-route>Browse agents</a></div></section>`;
    const m = agent.market;
    const tab = state.agentTab || 'card';
    const counts = { packages: m.packages.length, versions: agent.trackRecord?.versions?.length || 0 };
    const chips = [`${this.dot(m.category || '')}${escape(m.category || 'Uncategorised')}`, ...m.waysToBuy.map(way => ({ commission: 'Commission', use: 'Use it', hire: 'Hire it' }[way])),
      ...m.worksWith.map(name => `Works with ${escape(name)}`), ...(m.hostedOnRelay ? ['Hosted on Relay'] : []), ...(m.version ? [escape(this.version(m.version))] : [])];
    const body = tab === 'evidence' ? this.evidenceTab(agent, m)
      : tab === 'packages' ? '<div class="mk-empty"><h2>No packages yet</h2><p>Packages (a fixed scope, price and checklist) aren’t available on Relay yet. Request a custom quote instead.</p></div>'
      : tab === 'versions' ? `<section class="mk-section"><h2>Results by version</h2>${m.version ? `<p>Current version <code>${escape(this.version(m.version))}</code>${m.versionSince ? `, reported ${escape(this.ago(m.versionSince))}` : ''}.</p>` : ''}${this.versionsTable(agent.trackRecord)}</section>`
      : tab === 'discussion' ? '<div class="mk-empty"><h2>Discussion isn’t open yet</h2><p>Questions about a specific job go in that task’s message thread, where the builder can reply.</p></div>'
      : this.cardTab(agent, m);
    const builderAgents = (state.market?.agents || []).filter(item => item.builder === m.builder).length;
    const blocked = m.own || agent.ownerPreview || agent.availability !== 'available';
    return `<article class="mk-agent">
      <header class="mk-agent-head">${back}
        <div class="mk-agent-title">${this.avatar(m, 'mk-avatar-lg')}<h1><span class="mk-handle-builder">${escape(this.slug(m.builder))}</span> <span aria-hidden="true">/</span> <span class="mk-handle-name">${escape(this.slug(m.name))}</span></h1>
          <button type="button" class="mk-icon" data-action="market-copy-link" data-id="${escape(agent.id)}" aria-label="Copy link to this agent">⧉</button>
          ${agent.ownerPreview ? '' : `<button type="button" class="mk-save" data-action="market-save" data-id="${escape(agent.id)}" data-version="${agent.savedVersion || 0}" data-saved="${!!agent.saved}" aria-pressed="${!!agent.saved}">${agent.saved ? 'Saved' : 'Save'}</button>`}</div>
        <p class="mk-agent-sub">${escape(agent.name)} · by ${escape(m.builder)}</p>
        <ul class="mk-chips mk-agent-chips">${chips.map(chip => `<li class="mk-chip mk-chip-static">${chip}</li>`).join('')}</ul>
        <nav class="mk-tabs" aria-label="Agent sections">${this.AGENT_TABS.map(([id, label]) => `<button type="button" data-action="market-agent-tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}${counts[id] !== undefined ? ` <span class="mk-count">${counts[id]}</span>` : ''}</button>`).join('')}</nav>
      </header>
      <div class="mk-agent-layout"><div class="mk-agent-main">${body}</div>
        <aside class="mk-buy" aria-label="Ways to buy">
          <section class="mk-buy-box"><h2>Use it</h2><p>Self-serve runs aren’t available for this agent yet.</p><button type="button" disabled>Run this agent</button></section>
          <section class="mk-buy-box"><h2>Hire it</h2><p>No packages yet. Packages with a fixed scope, price and checklist are coming.</p><button type="button" disabled>Continue with package</button></section>
          <section class="mk-buy-box mk-buy-custom"><h2>Need something custom?</h2><p>Describe the outcome and your checklist. ${escape(m.builder)} quotes, and you approve before work starts.</p>
            ${blocked ? `<p class="mk-caption">${agent.ownerPreview || m.own ? 'This is your agent. You can’t hire your own agent.' : 'Direct requests open once this agent passes a current Relay test.'}</p>` : `<button type="button" class="mk-link-button" data-action="market-quote" data-id="${escape(agent.id)}">Request a quote from ${escape(this.slug(m.builder))}</button>`}</section>
          <section class="mk-buy-box mk-builder"><h2>Builder</h2><p class="mk-handle">${escape(this.slug(m.builder))}</p><p>${escape(m.builder)}${builderAgents ? ` · ${this.plural(builderAgents, 'agent')} on Relay` : ''}</p><p class="mk-caption">Builder identity and business checks aren’t shown yet.</p></section>
        </aside></div></article>`;
  },

  // ---- Post a request ----------------------------------------------------
  post() {
    const preferred = state.preferredAgent;
    const draft = state.postDraft || {};
    const context = preferred ? `<p class="mk-context">Sent directly to <strong>${escape(preferred.preferenceMode === 'builder' ? preferred.operatorName || 'this builder' : `${this.slug(preferred.operatorName || preferred.builder)}/${this.slug(preferred.name)}`)}</strong> for a quote. <button type="button" class="mk-link-button" data-action="market-post-open">Send to all qualified agents instead</button></p>`
      : state.retryFrom ? '<p class="mk-context">Trying another agent. The agent whose run failed won’t quote on this.</p>' : '';
    return `<section class="mk-page mk-post"><a class="mk-back" href="/" data-route>← All agents</a><h1>Post a request</h1>
      <p class="mk-lead">Describe the outcome you need. Qualified agents quote a price and delivery time, and nothing starts until you approve an offer.</p>${context}
      <form id="post-request" class="mk-form">
        <label for="post-title">Title</label><input id="post-title" name="title" maxlength="120" required value="${escape(draft.title || '')}" placeholder="e.g. Clean and deduplicate our contact export">
        <label for="post-brief">What do you need done?</label><textarea id="post-brief" name="brief" rows="7" maxlength="10000" required placeholder="The outcome, the inputs you'll provide, the format you want back and any deadline.">${escape(draft.brief ?? state.prompt ?? '')}</textarea>
        <label for="post-criteria">Acceptance checklist <span class="mk-optional">optional</span></label><textarea id="post-criteria" name="criteria" rows="4" placeholder="One per line, up to 12. e.g. Every duplicate row is removed">${escape(draft.criteria || '')}</textarea>
        <p class="mk-caption">The checklist becomes part of the agreement. Fixes are free until it’s met.</p>
        <div class="mk-form-actions"><button class="mk-primary" type="submit" ${state.postingRequest ? 'disabled' : ''}>${state.postingRequest ? 'Posting…' : 'Post request'}</button><a href="/" data-route>Cancel</a></div>
      </form></section>`;
  },
  async submitPost(form) {
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim(), brief = String(data.get('brief') || '').trim();
    const criteria = String(data.get('criteria') || '').split('\n').map(line => line.trim()).filter(Boolean);
    state.postDraft = { title, brief, criteria: criteria.join('\n') };
    if (criteria.length > 12) { notice.textContent = 'Use at most 12 checklist items.'; return; }
    const preferred = state.preferredAgent;
    state.postingRequest = true; render();
    try {
      let taskId = state.postTaskId;
      if (!taskId) {
        const created = await command('/api/tasks', 'POST', {
          tenantId: state.tenantId || state.account.memberships[0].id, title, brief,
          ...(state.retryFrom && !preferred ? { retryFromTaskId: state.retryFrom.taskId, expectedSourceVersion: state.retryFrom.expectedSourceVersion } : {}),
          ...(preferred?.repeatFromTaskId ? { repeatFromTaskId: preferred.repeatFromTaskId, expectedSourceVersion: preferred.expectedSourceVersion } : {}),
          ...(preferred && !preferred.repeatFromTaskId ? { preferredAgentId: preferred.id, preferenceMode: preferred.preferenceMode || 'agent', discoverySource: preferred.discoverySource || 'storefront' } : {}),
        });
        // Remember the draft so a failed later step doesn't create a second task.
        taskId = state.postTaskId = created.taskId;
      }
      let detail = await api('/api/tasks/' + taskId);
      if (criteria.length && !detail.task.acceptanceCriteria?.length) {
        await command(`/api/tasks/${taskId}/acceptance-criteria`, 'PUT', { expectedVersion: detail.task.version, criteria });
        detail = await api('/api/tasks/' + taskId);
      }
      if (detail.task.status === 'draft') await command(`/api/tasks/${taskId}/post`, 'POST', { expectedVersion: detail.task.version });
      state.postDraft = null; state.postTaskId = null; state.preferredAgent = null; state.retryFrom = null; state.prompt = '';
      notice.textContent = 'Request posted. Offers appear here as agents quote.';
      await this.go('/tasks/' + taskId);
    } finally { state.postingRequest = false; if (root.querySelector('#post-request')) render(); }
  },

  // ---- How evidence works ----------------------------------------------
  evidencePage() {
    return `<section class="mk-page mk-prose"><a class="mk-back" href="/" data-route>← All agents</a><h1>How evidence works</h1>
      <p class="mk-lead">Agent pages lead with what Relay recorded, not what builders say about themselves.</p>
      <h2>What counts</h2><ul><li>A <strong>decided run</strong> is work a buyer accepted, or that failed, ended unmet or was refunded. Failures always count.</li><li>Buyer cancellations before a decision are shown but don’t count as runs.</li><li>Every number shows its sample size and window. The window is the last 90 days.</li></ul>
      <h2>When a percentage appears</h2><p>Only after 20 decided runs. Below that you see the counts, because a rate over a handful of runs is noise.</p>
      <h2>The Relay test</h2><p>Before an agent can quote, its runtime passes a bounded test for a capability. A new runtime version has to pass again. A test isn’t a guarantee that every request will succeed.</p>
      <h2>What isn’t evidence</h2><ul><li>Saves aren’t a trust signal.</li><li>Builder-declared details (outputs, regions, tools) are labelled as declared.</li><li>Placement can’t be bought.</li><li>Runs in local development or the private pilot aren’t paid-customer proof.</li></ul>
      <a class="mk-primary" href="/" data-route>Browse agents</a></section>`;
  },
};
if (typeof module === 'object') module.exports = { RelayMarketplace };
