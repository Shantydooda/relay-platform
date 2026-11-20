'use strict';

// The browse-first marketplace: the signed-in buyer home, agent pages, the
// "Post a request" form and real links (docs/specs/Marketplace-Model.md → "Layout",
// design reference in docs/design/marketplace/).
//
// Everything shown comes from the server: listings the builder declared and
// evidence Relay recorded. Packages ("Hire it") carry the builder's fixed terms;
// self-serve runs aren't built yet and show an honest empty state, never samples.
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
  // Real paths for the pages people share: /, /agents/<id>, /tasks/<id>, /post, /docs/<guide>.
  parse(pathname = globalThis.location?.pathname || '/', hash = globalThis.location?.hash || '') {
    const agent = /^\/agents\/([0-9a-f-]{36})$/.exec(pathname)?.[1] ||
      /^#storefront=([0-9a-f-]{36})(?:\?source=(?:market|builder))?$/.exec(hash)?.[1];
    if (agent) return { page: 'agent', id: agent };
    const task = /^\/tasks\/([0-9a-f-]{36})$/.exec(pathname)?.[1] || /^#(?:task|chat)=([0-9a-f-]{36})$/.exec(hash)?.[1];
    if (task) return { page: 'task', id: task };
    if (pathname === '/post') return { page: 'post', id: null };
    if (pathname === '/requests') return { page: 'requests', id: null };
    if (pathname === '/builders') return { page: 'builders', id: null };
    const builderHandle = /^\/builders\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/.exec(pathname)?.[1];
    if (builderHandle) return { page: 'builder', id: builderHandle };
    if (pathname === '/evidence') return { page: 'docs', id: 'evidence' };
    const doc = /^\/docs\/([a-z-]+)$/.exec(pathname)?.[1];
    if (doc && this.DOCS.some(item => item.slug === doc)) return { page: 'docs', id: doc };
    const org = typeof RelayOrg === 'object' ? RelayOrg.parse(pathname) : null;
    if (org) return org;
    const build = typeof RelayBuild === 'object' ? RelayBuild.parse(pathname) : null;
    if (build) return build;
    return { page: null, id: null };
  },
  // Apply a route to buyer state. Returns the task id to load, if any.
  apply(route, target = state) {
    target.agentPageId = null;
    if (typeof RelayBuild === 'object' && RelayBuild.apply(route, target)) return null;
    if (typeof RelayOrg === 'object' && RelayOrg.apply(route, target)) return null;
    if (route.page === 'task' && target.detail?.task.id !== route.id) target.requestTab = 'request';
    if (target.buyerTab === 'org' || target.buyerTab === 'enterprise') target.projectId = null;
    if (route.page === 'agent') { target.buyerTab = 'market'; target.agentPageId = route.id; target.agentTab ||= 'card'; target.detail = null; }
    else if (route.page === 'post') { target.buyerTab = 'request'; target.detail = null; }
    else if (route.page === 'requests' || route.page === 'builders') { target.buyerTab = route.page; target.builderHandle = null; target.detail = null; }
    else if (route.page === 'builder') { target.buyerTab = 'builders'; target.builderHandle = route.id; target.detail = null; }
    else if (route.page === 'docs') { target.buyerTab = 'evidence'; target.docPage = route.id; target.detail = null; }
    return route.page === 'task' ? route.id : null;
  },
  // The canonical path for what the buyer is looking at.
  path(current = state) {
    if (current.detail && current.detail.task.status !== 'draft') return `/tasks/${current.detail.task.id}`;
    if (current.detail) return `/tasks/${current.detail.task.id}`;
    if (current.buyerTab === 'market' && current.agentPageId) return `/agents/${current.agentPageId}`;
    if (current.buyerTab === 'request') return '/post';
    if (current.buyerTab === 'requests') return '/requests';
    if (current.buyerTab === 'builders') return current.builderHandle ? `/builders/${current.builderHandle}` : '/builders';
    if (current.buyerTab === 'evidence') return `/docs/${current.docPage || 'evidence'}`;
    const org = typeof RelayOrg === 'object' ? RelayOrg.path(current) : null;
    if (org) return org;
    return '/';
  },
  // Keep the address bar in step after each render. A new page is a new history
  // entry so Back works; other hash-based views keep their hash on "/".
  sync() {
    if (!globalThis.history || !state.account || state.auth) return;
    // Builders open agent pages too (their own, to manage packages); the rest of
    // the builder workspace keeps its hash routes until the shells are merged.
    if (state.account.user.workspace !== 'buyer') {
      const target = state.agentPageId ? `/agents/${state.agentPageId}` : typeof RelayBuild === 'object' ? RelayBuild.path() : '/';
      if (location.pathname !== target) history[!this.restoring && location.pathname !== '/' ? 'pushState' : 'replaceState'](null, '', target + (target !== '/' ? '' : location.hash));
      return;
    }
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
    const route = this.parse();
    if (typeof RelayBuild === 'object') await RelayBuild.ensure(route);
    const id = this.apply(route);
    if (!route.page) {
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
    const buyer = target.account?.user.workspace === 'buyer';
    if (!buyer && !target.agentPageId) return;
    if (buyer && target.buyerTab === 'requests') target.openRequests = (await api('/api/opportunities')).tasks;
    if (buyer && ((target.buyerTab === 'market' && !target.agentPageId) || target.buyerTab === 'builders')) {
      target.market = await api('/api/marketplace?sort=' + encodeURIComponent(target.marketSort || 'runs'));
    }
    if (buyer && typeof RelayOrg === 'object') await RelayOrg.load(target);
    target.agentPage = null;
    if (target.agentPageId && (!buyer || target.buyerTab === 'market')) {
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
  money(amountMinor, currency = 'USD') {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amountMinor / 100);
  },
  duration(minutes) {
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) { const h = Math.floor(minutes / 60), m = minutes % 60; return `${h} hr${m ? ` ${m} min` : ''}`; }
    const days = Math.round(minutes / 1440); return `${days} day${days === 1 ? '' : 's'}`;
  },
  price(agent) { return agent.fromPrice ? `from ${this.money(agent.fromPrice.amountMinor, agent.fromPrice.currency)}` : 'Quoted per request'; },
  INPUT_LABELS: { csv: 'A CSV file' },
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
    const building = state.account?.user.workspace === 'builder';
    const active = building ? (state.agentPageId ? 'agents' : 'build') : state.detail || ['tasks'].includes(state.buyerTab) ? 'work'
      : state.buyerTab === 'activity' ? 'activity' : state.buyerTab === 'evidence' ? 'evidence' : state.buyerTab === 'market' ? 'agents'
      : state.buyerTab === 'requests' ? 'requests' : state.buyerTab === 'builders' ? 'builders'
      : ['org', 'enterprise', 'business'].includes(state.buyerTab) ? 'org' : '';
    const companies = (state.account?.memberships || []).filter(m => m.company);
    const link = (id, href, label, attrs = '') => `<a class="${active === id ? 'active' : ''}" href="${href}" ${active === id ? 'aria-current="page"' : ''} ${attrs}>${label}</a>`;
    const more = [
      ...(state.features?.recurring ? [['scheduled', 'Scheduled work']] : []),
      ...(state.features?.workspaceApps ? [['apps', 'Apps']] : []),
      ['business', companies.length ? 'Create or join an organization' : 'Business workspace'], ['billing', 'History & spend'], ['tools', 'Connected tools'],
    ];
    return `<a class="skip-workspace" href="#workspace-main">Skip to content</a><header class="mk-topbar">
      <a class="mk-brand" href="/" data-route aria-label="Relay home">relay</a>
      <form class="mk-search" id="market-search" role="search"><label class="sr-only" for="market-search-input">Search agents</label><span aria-hidden="true">⌕</span><input id="market-search-input" name="q" type="search" placeholder="Search agents, builders, outcomes" value="${escape(state.marketFilters?.q || '')}" autocomplete="off"></form>
      <nav class="mk-nav" aria-label="Main">${link('agents', '/', 'Agents', 'data-route')}${link('requests', '/requests', 'Requests', 'data-route')}${link('builders', '/builders', 'Builders', 'data-route')}${typeof RelayBuild !== 'object' || RelayBuild.isBuilder() ? link('build', '/build', 'Build', 'data-route') : ''}${link('work', '/#tasks', 'Your work', 'data-route data-tab="tasks"')}${link('activity', '/#activity', 'Activity', 'data-route data-tab="activity"')}${link('evidence', '/docs/evidence', 'Docs', 'data-route')}${companies.length === 1 ? link('org', `/org/${companies[0].id}`, escape(companies[0].name), 'data-route') : link('org', '/enterprise', 'Enterprise', 'data-route')}</nav>
      <div class="mk-account">
        <div id="notification-slot">${typeof RelayNotifications === 'object' ? RelayNotifications.view() : ''}</div>
        <details class="mk-menu"><summary><span class="account-avatar">${escape(user.name.slice(0, 1).toUpperCase())}</span><span class="sr-only">Account and workspace for ${escape(user.name)}</span></summary>
          <div class="mk-menu-panel"><strong>${escape(user.name)}</strong><small>${escape(user.email)}</small>
            ${companies.length ? `<span class="mk-menu-label">Organizations</span>${companies.map(m => `<a href="/org/${escape(m.id)}" data-route>${escape(m.name)}</a>`).join('')}<a href="/enterprise" data-route>Relay for organizations</a>` : ''}
            ${more.map(([id, label]) => `<button data-action="buyer-nav" data-tab="${id}">${label}</button>`).join('')}
            ${state.payments?.recoveryAccess ? '<button data-action="recovery-open">Payment recovery</button>' : ''}${state.relayTestReviewer?.[state.account?.user?.id] ? '<a href="/build/tests" data-route>Review Relay tests</a>' : ''}
            <button data-action="toggle-appearance" aria-pressed="${globalThis.document?.documentElement?.dataset.appearance !== 'light'}">Dark mode</button>
            <button data-action="logout">Sign out</button></div></details>
        ${state.publishing?.allowed === false ? '' : '<a class="mk-publish" href="/build/new" data-route>Publish an agent</a>'}
      </div></header>`;
  },

  // ---- Browse ------------------------------------------------------------
  // Where an agent processes data: the builder's declaration (processing-region.cjs).
  REGIONS: { eu: 'EU', us: 'US' },
  regionRules() { return state.agentPage?.regionRules || state.market?.regionRules || []; },
  // Companies whose rule refuses this agent. The buyer may still use it from another workspace.
  regionBlocks(m) { return this.regionRules().filter(rule => m.processingRegion !== rule.region); },
  regionNote(m) {
    const blocks = this.regionBlocks(m);
    if (!blocks.length || m.own) return '';
    return `<p class="mk-region-note" role="note">${escape(blocks.map(rule => rule.name).join(' and '))} only ${blocks.length > 1 ? 'use' : 'uses'} agents that process data in ${escape([...new Set(blocks.map(rule => `the ${this.REGIONS[rule.region]}`))].join(' or '))}. ${m.processingRegion ? `This agent declares ${escape(`the ${this.REGIONS[m.processingRegion]}`)}` : 'This agent hasn’t declared a region'}, so Relay won’t let ${blocks.length > 1 ? 'their' : 'its'} requests use it.</p>`;
  },
  filters() {
    state.marketFilters ||= { q: '', categories: [], ways: [], works: [], evidence: [], railTab: 'main', allCategories: false, price: [0, this.PRICE_STOPS.length - 1] };
    state.marketFilters.price ||= [0, this.PRICE_STOPS.length - 1];
    state.marketFilters.regions ||= [];
    return state.marketFilters;
  },
  matches(agent, f = this.filters()) {
    const q = f.q.trim().toLowerCase();
    const text = [agent.builder, agent.name, this.handle(agent), agent.purpose, agent.domain, ...agent.categories,
      ...agent.capabilities.map(item => item.task)].join(' ').toLowerCase();
    if (q && !q.split(/\s+/).every(word => text.includes(word))) return false;
    // Category filters are task ids, or "field:<id>" for a whole field.
    if (f.categories.length && !f.categories.some(value => value.startsWith('field:')
      ? (agent.fieldIds || []).includes(value.slice(6)) : (agent.categoryIds || []).includes(value) || agent.categories.includes(value))) return false;
    if (f.ways.length && !f.ways.some(way => agent.waysToBuy.includes(way))) return false;
    if (!this.priceMatches(agent, f)) return false;
    if (f.works.length && !f.works.every(name => agent.worksWith.includes(name))) return false;
    if (f.regions.length && !f.regions.includes(agent.processingRegion)) return false;
    const evidence = { tested: agent.relayTest.passed, runs20: agent.evidence.runs >= this.MIN_RATE_SAMPLE, repeat: agent.buyers.repeat > 0, hosted: agent.hostedOnRelay };
    return f.evidence.every(key => evidence[key]);
  },
  visible() { return (state.market?.agents || []).filter(agent => this.matches(agent)); },
  categories() {
    const counts = new Map();
    for (const agent of state.market?.agents || []) for (const item of agent.categories) counts.set(item, (counts.get(item) || 0) + 1);
    return [...counts.entries()].sort((a, b) => Number(this.SEED.test(b[0])) - Number(this.SEED.test(a[0])) || b[1] - a[1] || a[0].localeCompare(b[0]));
  },
  // Main tab: the busiest tasks as flat chips, seed field first, then "+N" to the
  // full grouped list under Categories.
  categoryChips(f) {
    const fields = state.market?.taxonomy || [], agents = state.market?.agents || [];
    const tasks = fields.flatMap(field => field.tasks.map(t => ({ ...t, seed: !!field.seed, n: agents.filter(a => (a.categoryIds || []).includes(t.id)).length })))
      .filter(t => t.n || f.categories.includes(t.id)).sort((a, b) => Number(b.seed) - Number(a.seed) || b.n - a.n || a.label.localeCompare(b.label));
    if (!tasks.length) return '<section><h2>Categories</h2><p class="mk-empty-note">No categories yet.</p></section>';
    const shown = tasks.slice(0, this.RAIL_CATEGORY_LIMIT), rest = fields.reduce((n, field) => n + field.tasks.length, 0) - shown.length;
    return `<section><h2>Categories</h2><div class="mk-chips">${shown.map(t => this.chip('categories', t.id, `${this.dot(t.label)}${escape(t.label)}`, f.categories.includes(t.id), { count: t.n })).join('')}
      ${rest > 0 ? `<button type="button" class="mk-chip" data-action="market-rail-tab" data-tab="categories" title="All categories">+ ${rest}</button>` : ''}</div></section>`;
  },
  // Price: two handles over fixed stops, like the design reference. Agents with
  // no listed price are quoted per request, so a narrowed range hides them.
  PRICE_STOPS: [['< $10', 0], ['$50', 5000], ['$250', 25000], ['$1k', 100000], ['$5k', 500000], ['$25k', 2500000], ['$100k', 10000000], ['$100k+', Infinity]],
  priceMatches(agent, f) {
    const [lo, hi] = f.price || [0, this.PRICE_STOPS.length - 1];
    if (lo === 0 && hi === this.PRICE_STOPS.length - 1) return true;
    const amount = agent.fromPrice?.amountMinor;
    if (amount === undefined || amount === null) return false;
    // The end stops are open: "< $10" as the upper handle means up to $10, and
    // "$100k+" as the lower handle means from $100k.
    const last = this.PRICE_STOPS.length - 1;
    const min = lo === last ? this.PRICE_STOPS[last - 1][1] : this.PRICE_STOPS[lo][1];
    const max = hi === 0 ? 1000 : this.PRICE_STOPS[hi][1];
    return amount >= min && amount <= max;
  },
  priceRange(agents) {
    const f = this.filters(), [lo, hi] = f.price, last = this.PRICE_STOPS.length - 1, narrowed = lo !== 0 || hi !== last;
    const unpriced = agents.filter(a => !a.fromPrice).length;
    // With no listed prices a slider would filter nothing; say so instead.
    if (!agents.some(a => a.fromPrice)) return '<h2>Price</h2><p class="mk-empty-note">No package prices yet. Agents quote per request, and you approve the price before any work starts.</p>';
    return `<div class="mk-price">
      <div class="mk-price-head"><h2>Price</h2>${narrowed ? '<button type="button" class="mk-chip mk-reset" data-action="market-price-reset">Reset</button>' : ''}</div>
      <div class="mk-price-stops" aria-hidden="true">${this.PRICE_STOPS.map(([label], i) => `<span class="${i === lo || i === hi ? 'mk-price-on' : ''}">${escape(label)}</span>`).join('')}</div>
      <div class="mk-price-track"><span class="mk-price-bar" aria-hidden="true">${Array.from({ length: last }, (_, i) => `<span class="${i >= lo && i < hi ? 'mk-price-fill' : ''}"></span>`).join('')}</span>
        <input type="range" min="0" max="${last}" step="1" value="${lo}" data-price-range="lo" aria-label="Lowest price: ${escape(this.PRICE_STOPS[lo][0])}">
        <input type="range" min="0" max="${last}" step="1" value="${hi}" data-price-range="hi" aria-label="Highest price: ${escape(this.PRICE_STOPS[hi][0])}"></div>
      <p class="mk-empty-note">${narrowed && unpriced ? `${this.plural(unpriced, 'agent')} without a listed price ${unpriced === 1 ? 'is' : 'are'} hidden while a range is set. ` : ''}Custom work is quoted per request.</p></div>`;
  },
  // Hugging Face's task list pattern: fields as headings, tasks as chips with
  // counts. Tasks nobody covers yet stay behind "Show all categories".
  categoryRail(f) {
    const fields = state.market?.taxonomy || [], agents = state.market?.agents || [];
    if (!fields.length) return '<section><h2>Categories</h2><p class="mk-empty-note">No categories yet.</p></section>';
    const count = id => agents.filter(a => (a.categoryIds || []).includes(id)).length;
    const fieldCount = id => agents.filter(a => (a.fieldIds || []).includes(id)).length;
    return `<section class="mk-category-rail"><h2>Categories</h2>${fields.map(field => {
      const tasks = field.tasks.map(t => ({ ...t, n: count(t.id) })).filter(t => f.allCategories || t.n || f.categories.includes(t.id));
      const n = fieldCount(field.id);
      if (!tasks.length && !n && !f.allCategories) return '';
      return `<div class="mk-category-field"><h3>${this.chip('categories', 'field:' + field.id, `${escape(field.label)}${field.seed ? ' <span class="mk-seed">focus</span>' : ''}`, f.categories.includes('field:' + field.id), { count: n })}</h3>
        <div class="mk-chips">${tasks.map(t => this.chip('categories', t.id, `${this.dot(t.label)}${escape(t.label)}`, f.categories.includes(t.id), { count: t.n, disabled: !t.n && !f.categories.includes(t.id), title: t.n ? '' : 'No agents for this yet' })).join('')}</div></div>`;
    }).join('')}
      <button type="button" class="mk-link-button" data-action="market-more-categories">${f.allCategories ? 'Show only categories with agents' : 'Show all categories'}</button></section>`;
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
    return `<aside class="${this.railClass()}" aria-label="Filters">
      <div class="mk-rail-tabs" role="group" aria-label="Filter sections">${tabs.map(([id, label]) => `<button type="button" data-action="market-rail-tab" data-tab="${id}" aria-pressed="${tab === id}">${label}</button>`).join('')}</div>
      ${tab === 'categories' ? this.categoryRail(f) : tab === 'main' ? this.categoryChips(f) : ''}
      ${show('main') ? `<section><h2>Ways to buy</h2><div class="mk-chips">
        ${this.chip('ways', 'use', '<strong>Use it</strong>&nbsp;· self-serve', false, { disabled: true, title: 'Self-serve runs are not available yet' })}
        ${this.chip('ways', 'hire', '<strong>Hire it</strong>&nbsp;· package', f.ways.includes('hire'), { count: count(a => a.waysToBuy.includes('hire')), disabled: !count(a => a.waysToBuy.includes('hire')), title: count(a => a.waysToBuy.includes('hire')) ? '' : 'No agent offers a package yet' })}
        ${this.chip('ways', 'commission', '<strong>Commission</strong>&nbsp;· custom', f.ways.includes('commission'), { count: count(a => a.waysToBuy.includes('commission')) })}
      </div><p class="mk-empty-note">Self-serve runs aren’t available yet. Packages have a fixed price and checklist; anything else is quoted per request.</p></section>
      <section>${this.priceRange(all)}</section>
      <section><h2>Data processed in</h2><div class="mk-chips">${Object.entries(this.REGIONS).map(([id, label]) => this.chip('regions', id, escape(label), f.regions.includes(id), { count: count(a => a.processingRegion === id) })).join('')}</div><p class="mk-empty-note">Declared by builders, not verified by Relay.${this.regionRules().length ? ` ${escape(this.regionRules().map(r => `${r.name} requires ${this.REGIONS[r.region]}`).join('; '))}.` : ''}</p></section>` : ''}
      ${show('works') ? `<section><h2>Works with</h2>${connectors.length ? `<div class="mk-chips">${connectors.map(name => this.chip('works', name, escape(name), f.works.includes(name), { count: count(a => a.worksWith.includes(name)) })).join('')}</div><p class="mk-empty-note">Declared by builders. Access is only granted per task, with your approval.</p>` : '<p class="mk-empty-note">No connectors are set up in this environment yet.</p>'}</section>` : ''}
      ${show('evidence') ? `<section><h2>Evidence</h2><div class="mk-chips">${this.EVIDENCE_FILTERS.map(([id, label]) => this.chip('evidence', id, escape(label), f.evidence.includes(id), { count: evidenceCounts[id] })).join('')}</div></section>` : ''}
      <p class="mk-rail-note">Rankings can’t be bought. The order comes from the sort you choose and results Relay verified, including failures.</p>
    </aside>`;
  },
  row(agent, describe) {
    const evidence = this.evidenceLine(agent);
    const meta = [escape(agent.categoryLabel || agent.category || 'Uncategorised'), escape(this.ways(agent)), escape(this.price(agent)),
      `<span class="${evidence.strong ? 'mk-good' : ''}">${escape(evidence.text)}</span>`, ...(agent.processingRegion ? [`Data in ${this.REGIONS[agent.processingRegion]}`] : []), escape(this.updated(agent))];
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
    return `<div class="mk-browse">${this.railToggle()}${this.rail()}<section class="mk-results" aria-labelledby="mk-results-title">
      <header class="mk-results-head"><h1 id="mk-results-title">Agents <span class="mk-total">${filtered ? `${agents.length} of ${all.length}` : all.length}</span></h1>
        <label class="mk-filter-name"><span class="sr-only">Filter by name</span><input type="search" data-market-name placeholder="Filter by name" value="${escape(f.q)}"></label>
        <div class="mk-toggles"><label class="mk-check"><input type="checkbox" data-market-has-packages ${f.ways.includes('hire') ? 'checked' : ''} ${all.some(a => a.waysToBuy.includes('hire')) ? '' : 'disabled title="No agent offers a package yet"'}> Has packages</label><button type="button" class="mk-chip" disabled title="No agent offers self-serve runs yet">Self-serve available</button>
        <label class="mk-sort"><span class="sr-only">Sort agents</span><select data-market-sort><option value="runs" ${state.market.sort === 'runs' ? 'selected' : ''}>Sort: Most verified runs</option><option value="newest" ${state.market.sort === 'newest' ? 'selected' : ''}>Sort: Newest</option><option value="price" ${state.market.sort === 'price' ? 'selected' : ''}>Sort: Lowest package price</option></select></label></div>
      </header>
      <p class="mk-sr-status sr-only" role="status" aria-live="polite">${agents.length} agents shown</p>
      ${list}${this.postCard()}
      <p class="mk-basis">Evidence is recorded by Relay from finished work in this environment, over the last ${state.market.windowDays} days. Local and pilot runs aren’t paid-customer proof. <a href="/docs/evidence" data-route>How evidence works</a></p>
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
      ${this.stat('Relay test', m.relayTest.passed ? 'Passed' : 'Not passed', m.relayTest.passed ? `${escape(m.relayTest.rubric || m.relayTest.title)} · ${escape(this.version(m.relayTest.runtimeVersion))}` : 'Not currently qualified')}
    </div><p class="mk-caption">Recorded by Relay from finished work in this environment, including failures. Not reported by the builder. Local and pilot runs aren’t paid-customer proof. <a href="/docs/evidence" data-route>How evidence works</a></p>`;
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
      <section class="mk-section"><h2>Relay test</h2>${m.relayTest.passed ? `<p>Passed <strong>${escape(m.relayTest.title)}</strong>${m.relayTest.rubric ? ` (<code>${escape(m.relayTest.rubric)}</code>)` : ''} on ${escape(this.version(m.relayTest.runtimeVersion))}${m.relayTest.completedAt ? `, ${escape(this.ago(m.relayTest.completedAt))}` : ''}. A new runtime version has to pass again.</p>${m.relayTest.proposed ? `<p class="mk-caption">${m.relayTest.proposed.byThisBuilder ? 'This test was written by this agent’s own builder' : `This test was written by another builder, ${escape(m.relayTest.proposed.authorName)}`} and approved by Relay staff.</p>` : ''}<p class="mk-caption">A capability test checks a bounded task. It isn’t a guarantee that every request will succeed.</p>` : '<p>This agent hasn’t passed a current Relay test, so it can’t receive direct requests.</p>'}</section>`;
  },
  // ---- Packages ("Hire it") --------------------------------------------
  packageTerms(item) {
    const inputs = item.inputs.map(key => this.INPUT_LABELS[key] || key);
    return `<dl class="mk-terms"><div><dt>Price</dt><dd><strong>${escape(this.money(item.totalMinor ?? item.priceMinor, item.currency))}</strong></dd></div>
      <div><dt>Delivery</dt><dd>${escape(this.duration(item.deliveryMinutes))} after work starts</dd></div>
      <div><dt>You provide</dt><dd>${escape(inputs.join(', '))}, plus any notes</dd></div>
      <div><dt>Changes</dt><dd>Fixes free until the checklist is met${item.extraRounds ? ` · ${this.plural(item.extraRounds, 'extra round')} for other changes` : ''}</dd></div></dl>
      <h4>Checklist agreed up front</h4><ul class="mk-checks">${item.criteria.map(c => `<li>${escape(c.text)}</li>`).join('')}</ul>`;
  },
  packageCard(agent, item, owner) {
    const status = owner ? `<span class="mk-tag ${item.status === 'published' ? 'mk-tag-good' : ''}">${{ published: 'Published', draft: 'Draft', paused: 'Paused' }[item.status]}</span>` : '';
    const actions = owner
      ? `<div class="mk-package-actions"><button type="button" data-action="package-edit" data-id="${escape(item.id)}">Edit</button>${item.status === 'published'
        ? `<button type="button" data-action="package-status" data-id="${escape(item.id)}" data-status="paused">Pause</button>`
        : `<button type="button" class="mk-primary" data-action="package-status" data-id="${escape(item.id)}" data-status="published">Publish</button>`}</div>`
      : `<button type="button" class="mk-primary" data-action="package-buy" data-agent="${escape(agent.id)}" data-id="${escape(item.id)}" data-version="${item.version}">Hire for ${escape(this.money(item.totalMinor ?? item.priceMinor, item.currency))}</button>`;
    return `<article class="mk-package"><header><h3>${escape(item.title)}</h3>${status}<span class="mk-caption">v${item.version}</span></header>
      <p>${escape(item.included)}</p>${this.packageTerms(item)}${actions}</article>`;
  },
  packageForm(agent, m) {
    const tested = m.capabilities.filter(item => item.qualification === 'qualified');
    if (!tested.length) return '<div class="mk-empty"><h2>Pass a Relay test first</h2><p>Packages can only be sold for a capability that has passed its Relay test, so buyers know it was checked. Connect a runtime and run the test in your agent settings.</p></div>';
    const edit = state.packageForm.id ? (agent.ownerPackages || []).find(item => item.id === state.packageForm.id) : null;
    const v = edit || { title: '', included: '', priceMinor: '', deliveryMinutes: 60, criteria: [], extraRounds: 0, capabilityId: tested[0].id };
    return `<form id="package-form" class="mk-form mk-package-form" data-id="${escape(edit?.id || '')}">
      <h3>${edit ? `Edit ${escape(edit.title)}` : 'New package'}</h3>
      ${edit?.status === 'published' ? '<p class="mk-caption">Saving makes a new version. Buyers who already hired this package keep the terms they bought.</p>' : ''}
      <label for="package-capability">Capability</label><select id="package-capability" name="capabilityId">${tested.map(item => `<option value="${escape(item.id)}" ${item.id === v.capabilityId ? 'selected' : ''}>${escape(item.task)}</option>`).join('')}</select>
      <label for="package-title">Package title</label><input id="package-title" name="title" minlength="3" maxlength="80" required value="${escape(v.title)}" placeholder="e.g. Clean one CSV export">
      <label for="package-included">What’s included</label><textarea id="package-included" name="included" rows="3" minlength="3" maxlength="2000" required placeholder="Exactly what the buyer gets back.">${escape(v.included)}</textarea>
      <div class="mk-form-row"><div><label for="package-price">Price (${escape(m.capabilities.length ? (agent.ownerPackages?.[0]?.currency || 'USD') : 'USD')})</label><input id="package-price" name="price" aria-describedby="package-price-fee" type="number" min="0.01" step="0.01" required value="${v.priceMinor ? (v.priceMinor / 100).toFixed(2) : ''}">${state.features?.fees?.charging ? `<p class="mk-caption" id="package-price-fee">What you receive. Buyers see it plus Relay’s fee (${escape(state.features.fees.rule)}).</p>` : ''}</div>
        <div><label for="package-delivery">Delivery, minutes after start</label><input id="package-delivery" name="delivery" type="number" min="1" step="1" required value="${v.deliveryMinutes}"></div>
        <div><label for="package-rounds">Extra rounds</label><select id="package-rounds" name="extraRounds">${[0, 1, 2, 3].map(n => `<option value="${n}" ${n === v.extraRounds ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
      <label for="package-criteria">Checklist, one item per line (1–12)</label><textarea id="package-criteria" name="criteria" rows="4" required placeholder="No duplicate rows remain&#10;The header row is kept">${escape(v.criteria.map(c => c.text).join('\n'))}</textarea>
      <p class="mk-caption">Buyers provide a CSV file and notes. Fixes for unmet checklist items are always free; extra rounds cover other changes.</p>
      <div class="mk-package-actions"><button type="submit" class="mk-primary">${edit ? 'Save new version' : 'Save as draft'}</button><button type="button" data-action="package-cancel">Cancel</button></div>
    </form>`;
  },
  packagesTab(agent, m) {
    if (agent.ownerPreview) {
      const own = agent.ownerPackages || [];
      const list = own.length ? `<div class="mk-packages">${own.map(item => this.packageCard(agent, item, true)).join('')}</div>`
        : '<p class="mk-empty-note">No packages yet. A package is a fixed scope, price and checklist buyers can hire without waiting for a quote.</p>';
      return `<section class="mk-section"><div class="mk-section-head"><h2>Your packages</h2>${state.packageForm ? '' : '<button type="button" class="mk-primary" data-action="package-new">New package</button>'}</div>
        ${state.packageForm ? this.packageForm(agent, m) : ''}${list}
        <p class="mk-caption">Only published packages for a capability that currently passes its Relay test are shown to buyers.</p></section>`;
    }
    if (!m.packages.length) return '<div class="mk-empty"><h2>No packages yet</h2><p>This agent doesn’t offer a fixed-price package. Request a custom quote instead.</p></div>';
    return `<section class="mk-section"><h2>Packages</h2><p class="mk-caption">Fixed scope, price and checklist, agreed before you hire. You attach your file and start when ready.</p>
      <div class="mk-packages">${m.packages.map(item => this.packageCard(agent, item, false)).join('')}</div></section>`;
  },
  hireBox(agent, m) {
    if (agent.ownerPreview || m.own) return `<section class="mk-buy-box"><h2>Hire it</h2><p>${(agent.ownerPackages || []).length ? 'Manage your packages on the Packages tab.' : 'Add a package so buyers can hire this agent at a fixed price.'}</p><button type="button" class="mk-link-button" data-action="market-agent-tab" data-tab="packages">Your packages →</button></section>`;
    if (!m.packages.length) return '<section class="mk-buy-box"><h2>Hire it</h2><p>No packages for this agent. Request a custom quote below.</p></section>';
    return `<section class="mk-buy-box"><h2>Hire it</h2><ul class="mk-buy-packages">${m.packages.map(item => `<li><span><strong>${escape(item.title)}</strong><small>${escape(this.duration(item.deliveryMinutes))} · ${this.plural(item.criteria.length, 'check')}</small></span>
      <button type="button" data-action="package-buy" data-agent="${escape(agent.id)}" data-id="${escape(item.id)}" data-version="${item.version}">${escape(this.money(item.totalMinor ?? item.priceMinor, item.currency))}</button></li>`).join('')}</ul>
      <p class="mk-caption">Hiring fixes the terms. Nothing starts until you attach your file and confirm.</p></section>`;
  },
  async buyPackage(button) {
    const result = await command(`/api/agent-market/${button.dataset.agent}/packages/${button.dataset.id}/buy`, 'POST',
      { tenantId: state.tenantId || state.account.memberships[0].id, expectedPackageVersion: Number(button.dataset.version) });
    notice.textContent = 'Package hired. Attach your CSV, then review and start.';
    await this.go('/tasks/' + result.taskId);
  },
  async submitPackage(form) {
    const data = new FormData(form), agent = state.agentPage;
    const body = { expectedVersion: agent.agentVersion, capabilityId: String(data.get('capabilityId')), title: String(data.get('title')).trim(),
      included: String(data.get('included')).trim(), priceMinor: Math.round(Number(data.get('price')) * 100), deliveryMinutes: Number(data.get('delivery')),
      criteria: String(data.get('criteria')).split('\n').map(line => line.trim()).filter(Boolean), inputs: ['csv'], extraRounds: Number(data.get('extraRounds')) };
    const id = form.dataset.id;
    await command(`/api/agents/${agent.id}/packages${id ? `/${id}` : ''}`, id ? 'PUT' : 'POST', body);
    state.packageForm = null;
    notice.textContent = id ? 'Package saved as a new version.' : 'Package saved as a draft. Publish it when it’s ready for buyers.';
    await refresh(null); render();
  },
  async setPackageStatus(button) {
    await command(`/api/agents/${state.agentPage.id}/packages/${button.dataset.id}`, 'PATCH', { expectedVersion: state.agentPage.agentVersion, status: button.dataset.status });
    notice.textContent = button.dataset.status === 'published' ? 'Package published. Buyers can hire it now.' : 'Package paused. Buyers who already hired it keep their terms.';
    await refresh(null); render();
  },

  agent() {
    const agent = state.agentPage;
    const back = '<a class="mk-back" href="/" data-route>← All agents</a>';
    if (!agent) return `<section class="mk-page">${back}<div class="mk-empty"><h1>Agent unavailable</h1><p>This agent isn’t listed for your account right now.</p><a class="mk-primary" href="/" data-route>Browse agents</a></div></section>`;
    const m = agent.market;
    const tab = state.agentTab || 'card';
    const counts = { packages: (agent.ownerPreview ? agent.ownerPackages || [] : m.packages).length, versions: agent.trackRecord?.versions?.length || 0 };
    const chips = [`${this.dot(m.category || '')}${escape(m.category || 'Uncategorised')}`, ...m.waysToBuy.map(way => ({ commission: 'Commission', use: 'Use it', hire: 'Hire it' }[way])),
      ...m.worksWith.map(name => `Works with ${escape(name)}`), ...(m.hostedOnRelay ? ['Hosted on Relay'] : []), ...(m.processingRegion ? [`Data processed in ${this.REGIONS[m.processingRegion]}`] : []), ...(m.version ? [escape(this.version(m.version))] : [])];
    const body = tab === 'settings' && agent.ownerPreview ? this.ownerTab(agent)
      : tab === 'evidence' ? this.evidenceTab(agent, m)
      : tab === 'packages' ? this.packagesTab(agent, m)
      : tab === 'versions' ? `<section class="mk-section"><h2>Results by version</h2>${m.version ? `<p>Current version <code>${escape(this.version(m.version))}</code>${m.versionSince ? `, reported ${escape(this.ago(m.versionSince))}` : ''}.</p>` : ''}${this.versionsTable(agent.trackRecord)}</section>`
      : tab === 'discussion' ? '<div class="mk-empty"><h2>Discussion isn’t open yet</h2><p>Questions about a specific job go in that task’s message thread, where the builder can reply.</p></div>'
      : this.cardTab(agent, m);
    const builderAgents = (state.market?.agents || []).filter(item => (item.builderId || item.builder) === (m.builderId || m.builder)).length;
    const profile = `/builders/${escape(this.slug(m.builder))}`;
    const tabs = agent.ownerPreview ? [...this.AGENT_TABS, ['settings', 'Settings']] : this.AGENT_TABS;
    const blocked = m.own || agent.ownerPreview || agent.availability !== 'available';
    return `<article class="mk-agent">
      <header class="mk-agent-head">${back}
        <div class="mk-agent-title">${this.avatar(m, 'mk-avatar-lg')}<h1><a class="mk-handle-builder" href="${profile}" data-route>${escape(this.slug(m.builder))}</a> <span aria-hidden="true">/</span> <span class="mk-handle-name">${escape(this.slug(m.name))}</span></h1>
          <button type="button" class="mk-icon" data-action="market-copy-link" data-id="${escape(agent.id)}" aria-label="Copy link to this agent">⧉</button>
          ${agent.ownerPreview ? '' : `<button type="button" class="mk-save" data-action="market-save" data-id="${escape(agent.id)}" data-version="${agent.savedVersion || 0}" data-saved="${!!agent.saved}" aria-pressed="${!!agent.saved}">${agent.saved ? 'Saved' : 'Save'}</button>`}</div>
        <p class="mk-agent-sub">${escape(agent.name)} · by ${escape(m.builder)}</p>
        <ul class="mk-chips mk-agent-chips">${chips.map(chip => `<li class="mk-chip mk-chip-static">${chip}</li>`).join('')}</ul>
        <nav class="mk-tabs" aria-label="Agent sections">${tabs.map(([id, label]) => `<button type="button" data-action="market-agent-tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${label}${counts[id] !== undefined ? ` <span class="mk-count">${counts[id]}</span>` : ''}</button>`).join('')}</nav>
      </header>
      <div class="mk-agent-layout"><div class="mk-agent-main">${body}</div>
        <aside class="mk-buy" aria-label="Ways to buy">${this.regionNote(m)}
          <section class="mk-buy-box"><h2>Use it</h2><p>Self-serve runs aren’t available for this agent yet.</p><button type="button" disabled>Run this agent</button></section>
          ${this.hireBox(agent, m)}
          <section class="mk-buy-box mk-buy-custom"><h2>Need something custom?</h2><p>Describe the outcome and your checklist. ${escape(m.builder)} quotes, and you approve before work starts.</p>
            ${blocked ? `<p class="mk-caption">${agent.ownerPreview || m.own ? 'This is your agent. You can’t hire your own agent.' : 'Direct requests open once this agent passes a current Relay test.'}</p>` : `<button type="button" class="mk-link-button" data-action="market-quote" data-id="${escape(agent.id)}">Request a quote from ${escape(this.slug(m.builder))}</button>`}</section>
          <section class="mk-buy-box mk-builder"><h2>Builder</h2><p><a class="mk-handle" href="${profile}" data-route>${escape(this.slug(m.builder))}</a></p><p>${escape(m.builder)}${builderAgents ? ` · ${this.plural(builderAgents, 'agent')} on Relay` : ''}</p><p class="mk-caption">Builder identity and business checks aren’t shown yet.</p></section>
        </aside></div></article>`;
  },

  // Owner-only: where to change each part of this agent. The forms live in
  // Build, at their own addresses, so they exist once.
  ownerTab(agent) {
    const link = (tab, label, note) => `<tr><th scope="row">${label}</th><td class="mk-empty-note">${note}</td><td><a class="mk-next" href="/build/agents/${escape(agent.id)}/${tab}" data-route>Open →</a></td></tr>`;
    return `<section class="mk-section"><h2>Settings</h2><p class="mk-caption">Only you see this tab. Changes are made in Build.</p><div class="mk-table-wrap"><table class="mk-table"><tbody>
      ${link('profile', 'Profile and capabilities', 'Name, description and what it can do. This is what buyers read on the card.')}
      ${link('connection', 'Connection and keys', 'Where it runs, its connection key and the last check-in.')}
      ${link('tests', 'Relay tests', 'Passing one lets you publish it and sell packages.')}
      ${link('offers', 'Listing and automatic offers', 'Publish or pause it, and which requests it offers on by itself.')}
      ${link('results', 'Results', 'Where its buyers came from and how its offers did.')}
      <tr><th scope="row">Packages</th><td class="mk-empty-note">Fixed-price offers buyers can buy straight away.</td><td><button type="button" class="mk-link-button" data-action="market-agent-tab" data-tab="packages">Packages tab</button></td></tr>
    </tbody></table></div></section>`;
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
        ${this.postTargetField()}
        ${typeof RelayIntake === 'object' ? RelayIntake.postFields() : ''}
        ${(state.taxonomy || []).length ? `<label for="post-category">Category <span class="mk-optional">optional</span></label><select id="post-category" name="categoryId"><option value="">Choose the closest fit</option>${state.taxonomy.map(f => `<optgroup label="${escape(f.label)}">${f.tasks.map(t => `<option value="${escape(t.id)}" ${draft.categoryId === t.id ? 'selected' : ''}>${escape(t.label)}</option>`).join('')}</optgroup>`).join('')}</select><p class="mk-caption">Helps builders who work in this category find your request.</p>` : ''}
        <label for="post-title">Title</label><input id="post-title" name="title" maxlength="120" required value="${escape(draft.title || '')}" placeholder="e.g. Clean and deduplicate our contact export">
        <label for="post-brief">What do you need done?</label><textarea id="post-brief" name="brief" rows="7" maxlength="10000" required placeholder="The outcome, the inputs you'll provide, the format you want back and any deadline.">${escape(draft.brief ?? state.prompt ?? '')}</textarea>
        <label for="post-criteria">Acceptance checklist <span class="mk-optional">optional</span></label><textarea id="post-criteria" name="criteria" rows="4" placeholder="One per line, up to 12. e.g. Every duplicate row is removed">${escape(draft.criteria || '')}</textarea>
        <p class="mk-caption">The checklist becomes part of the agreement. Fixes are free until it’s met.</p>
        <label for="post-input">Input file <span class="mk-optional">optional · CSV up to 256 KB</span></label><input id="post-input" name="input" type="file" accept=".csv,text/csv">
        ${state.postFile ? `<p class="mk-caption">Attached: <strong>${escape(state.postFile.name)}</strong>. Choose another file to replace it.</p>` : '<p class="mk-caption">Agents that work on files, like CSV cleanup agents, quote only when the file is attached.</p>'}
        <div class="mk-form-actions"><button class="mk-primary" type="submit" ${state.postingRequest ? 'disabled' : ''}>${state.postingRequest ? 'Posting…' : 'Post request'}</button><a href="/" data-route>Cancel</a></div>
      </form></section>`;
  },
  // Organizations and projects you can file a request into (docs/specs/Enterprise-and-Projects.md).
  postTargetValue() {
    const t = state.postTarget;
    if (t) return `${t.tenantId}|${t.projectId || ''}`;
    return `${state.tenantId || state.account?.memberships?.[0]?.id || ''}|`;
  },
  postTargetField() {
    const targets = state.postTargets || [];
    if (!targets.length || state.retryFrom || state.preferredAgent?.repeatFromTaskId) return '';
    const personal = (state.account?.memberships || []).find(m => !m.company);
    const current = this.postTargetValue();
    const option = (value, label) => `<option value="${escape(value)}" ${current === value ? 'selected' : ''}>${escape(label)}</option>`;
    return `<label for="post-target">Where does this belong?</label><select id="post-target" name="target">
      ${personal ? option(`${personal.id}|`, 'Personal workspace') : ''}
      ${targets.map(t => `<optgroup label="${escape(t.name)}">${option(`${t.tenantId}|`, `${t.name} · not in a project (private to you)`)}${t.projects.map(p => option(`${t.tenantId}|${p.id}`, `${t.name} / ${p.name}`)).join('')}</optgroup>`).join('')}</select>
      <p class="mk-caption">Requests in a project are visible to its members, and its lead can approve the quote.</p>`;
  },
  async submitPost(form) {
    const data = new FormData(form);
    const title = String(data.get('title') || '').trim(), brief = String(data.get('brief') || '').trim();
    const [targetTenant, targetProject] = String(data.get('target') || this.postTargetValue()).split('|');
    state.postTarget = { tenantId: targetTenant, projectId: targetProject || null };
    const criteria = String(data.get('criteria') || '').split('\n').map(line => line.trim()).filter(Boolean);
    const erp = data.get('kind') === 'erp' && typeof RelayIntake === 'object';
    const intake = erp ? RelayIntake.intakeFromForm(data, state.account) : null;
    const categoryId = String(data.get('categoryId') || '') || null;
    state.postDraft = { title, brief, criteria: criteria.join('\n'), intake, categoryId };
    if (criteria.length > 12) { notice.textContent = 'Use at most 12 checklist items.'; return; }
    // Read the file before re-rendering: the file field doesn't survive a render.
    const file = form.elements.input?.files?.[0];
    if (file) {
      if (!/\.csv$/i.test(file.name)) { notice.textContent = 'Attach a CSV file.'; return; }
      state.postFile = { name: file.name, base64: await csvFileBase64(file) };
    }
    const preferred = state.preferredAgent;
    state.postingRequest = true; render();
    try {
      let taskId = state.postTaskId;
      if (!taskId) {
        const created = await command('/api/tasks', 'POST', {
          tenantId: targetTenant || state.tenantId || state.account.memberships[0].id, title, brief,
          ...(targetProject ? { projectId: targetProject } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(state.retryFrom && !preferred ? { retryFromTaskId: state.retryFrom.taskId, expectedSourceVersion: state.retryFrom.expectedSourceVersion } : {}),
          ...(preferred?.repeatFromTaskId ? { repeatFromTaskId: preferred.repeatFromTaskId, expectedSourceVersion: preferred.expectedSourceVersion } : {}),
          ...(preferred && !preferred.repeatFromTaskId ? { preferredAgentId: preferred.id, preferenceMode: preferred.preferenceMode || 'agent', discoverySource: preferred.discoverySource || 'storefront' } : {}),
        });
        // Remember the draft so a failed later step doesn't create a second task.
        taskId = state.postTaskId = created.taskId;
      }
      let detail = await api('/api/tasks/' + taskId);
      if (state.postFile && !detail.task.input) {
        await command(`/api/tasks/${taskId}/input`, 'POST', { expectedVersion: detail.task.version, filename: state.postFile.name, base64: state.postFile.base64, notes: brief.slice(0, 2000) });
        detail = await api('/api/tasks/' + taskId);
      }
      if (criteria.length && !detail.task.acceptanceCriteria?.length) {
        await command(`/api/tasks/${taskId}/acceptance-criteria`, 'PUT', { expectedVersion: detail.task.version, criteria });
        detail = await api('/api/tasks/' + taskId);
      }
      // An ERP data request opens for offers only once its intake is complete:
      // the files are added on the request page, which then opens it.
      if (intake && !detail.intake) {
        await command(`/api/tasks/${taskId}/intake`, 'POST', { expectedVersion: detail.task.version, intake });
        detail = await api('/api/tasks/' + taskId);
      }
      if (detail.task.status === 'draft' && (!detail.intake || detail.intake.readiness.complete)) await command(`/api/tasks/${taskId}/post`, 'POST', { expectedVersion: detail.task.version });
      state.postDraft = null; state.postTaskId = null; state.postFile = null; state.postTarget = null; state.preferredAgent = null; state.retryFrom = null; state.prompt = '';
      state.postKind = null;
      notice.textContent = intake ? 'Request saved. Add the files below; offers open once the intake is complete.' : 'Request posted. Offers appear here as agents quote.';
      await this.go('/tasks/' + taskId);
    } finally { state.postingRequest = false; if (root.querySelector('#post-request')) render(); }
  },

  // ---- Requests (open to builders) --------------------------------------
  // Open requests agents can quote on. Shown only to people who have an agent:
  // the server returns nothing to anyone else, so briefs aren't public.
  requestsPage() {
    const rows = state.openRequests;
    const side = this.side(`<a class="mk-side-button mk-side-primary" href="/post" data-route>+ Post a request</a><button type="button" class="mk-side-button" data-action="switch">Publish an agent</button>
      <p class="mk-side-note">Agents that passed a Relay test for the work quote a price and delivery time. The buyer chooses; nothing starts until they do.</p>`);
    const list = !rows ? '<p role="status">Loading requests…</p>'
      : !rows.length ? `<div class="mk-empty"><h2>No open requests to show</h2><p>Open requests are shown to builders with an agent on Relay, so they can quote. Publish an agent to see them, or post your own request.</p></div>`
      : `<ul class="mk-threads">${rows.map(r => {
        const intake = r.intake ? [r.intake.targetLabel, r.intake.objectLabel, r.intake.recordCount ? `${Number(r.intake.recordCount).toLocaleString()} records` : null].filter(Boolean).join(' · ') : null;
        const meta = [r.categoryLabel, intake, r.acceptanceCriteria?.length ? this.plural(r.acceptanceCriteria.length, 'checklist item') : null, r.checks?.length ? this.plural(r.checks.length, 'automatic check') : null,
          r.input ? `input ${r.input.filename}` : null, r.myOffers?.length ? 'You quoted' : null].filter(Boolean).map(escape);
        return `<li><div class="mk-thread mk-thread-none"><span class="mk-thread-icon">${this.ICONS.request}</span>
          <span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(r.title)}</span>${r.intake ? '<span class="mk-tag">ERP data</span>' : ''}</span>
          <span class="mk-meta">${meta.join('<span class="mk-sep" aria-hidden="true">·</span>')}</span><span class="mk-desc">${escape(r.brief)}</span></span>
          <button type="button" class="mk-next mk-link-button" data-action="switch">Quote →</button></div></li>`; }).join('')}</ul>`;
    return `<div class="mk-cols">${side}<section class="mk-results" aria-labelledby="mk-requests-title">
      <header class="mk-page-head"><h1 id="mk-requests-title">Requests <span class="mk-total">${rows?.length || 0}</span></h1></header>
      <p class="mk-caption">Briefs, checklists and file names only. Files and the buyer’s systems open to an agent after the buyer starts the work.</p>${list}</section></div>`;
  },

  // ---- Builders ----------------------------------------------------------
  // Builders with published agents, from the same listings as the Agents page.
  // Builders are grouped by their opaque id, never by display name: two people
  // can share a name. Their profile is /builders/<handle>.
  builderGroups(agents = state.market?.agents || []) {
    const groups = new Map();
    for (const agent of agents) {
      const key = agent.builderId || agent.builder;
      if (!groups.has(key)) groups.set(key, { id: key, name: agent.builder, kind: agent.builderKind || 'person', agents: [] });
      groups.get(key).agents.push(agent);
    }
    return [...groups.values()].map(b => ({ ...b, runs: b.agents.reduce((n, a) => n + (a.evidence?.runs || 0), 0),
      categories: [...new Set(b.agents.map(a => a.categoryLabel).filter(Boolean))] })).sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  },
  builderMeta(b) {
    return [b.kind === 'organization' ? 'Organization' : '', this.plural(b.agents.length, 'agent'), b.runs ? `${this.plural(b.runs, 'verified run')} · ${state.market.windowDays}d` : 'No verified runs yet', ...b.categories.slice(0, 3)].filter(Boolean).map(escape).join('<span class="mk-sep" aria-hidden="true">·</span>');
  },
  builderPage() {
    const back = '<a class="mk-back" href="/builders" data-route>← All builders</a>';
    if (!state.market) return '<section class="mk-page" aria-busy="true"><p role="status">Loading builder…</p></section>';
    const matches = this.builderGroups().filter(b => this.slug(b.name) === state.builderHandle);
    if (!matches.length) return `<section class="mk-page">${back}<div class="mk-empty"><h1>No builder by that name</h1><p>Builders appear once one of their agents passes a Relay test and is published.</p><a class="mk-primary" href="/builders" data-route>All builders</a></div></section>`;
    const one = b => `<section class="mk-section"><div class="mk-builder-head">${this.avatar({ builder: b.name }, 'mk-avatar-lg')}<div><h${matches.length > 1 ? 2 : 1}><span class="mk-handle">${escape(this.slug(b.name))}</span></h${matches.length > 1 ? 2 : 1}><p class="mk-agent-sub">${escape(b.name)}</p></div></div>
      <p class="mk-meta">${this.builderMeta(b)}</p><ul class="mk-list">${b.agents.map(a => this.row(a)).join('')}</ul></section>`;
    return `<section class="mk-results mk-page">${back}${matches.length > 1 ? `<header class="mk-results-head"><h1><span class="mk-handle">${escape(state.builderHandle)}</span></h1></header><p class="mk-caption">${matches.length} builders use this name. Each one’s agents are listed separately.</p>` : ''}
      ${matches.map(one).join('')}<p class="mk-caption">Counts come from work Relay recorded in this environment. Builder identity and business checks aren’t shown yet.</p></section>`;
  },
  buildersPage() {
    if (state.builderHandle) return this.builderPage();
    if (!state.market) return '<section class="mk-page" aria-busy="true"><p role="status">Loading builders…</p></section>';
    const builders = this.builderGroups();
    const cards = builders.length ? `<ul class="mk-list">${builders.map(b => `<li class="mk-row"><div class="mk-row-link">
        <span class="mk-row-title">${this.avatar({ builder: b.name })}<a class="mk-handle" href="/builders/${escape(this.slug(b.name))}" data-route>${escape(this.slug(b.name))}</a></span>
        <span class="mk-meta">${this.builderMeta(b)}</span>
        <span class="mk-builder-agents">${b.agents.map(a => `<a href="/agents/${escape(a.id)}" data-route class="mk-handle">${escape(this.handle(a))}</a>`).join('')}</span></div></li>`).join('')}</ul>`
      : '<div class="mk-empty"><h2>No builders yet</h2><p>Builders appear here once one of their agents passes a Relay test and is published.</p></div>';
    return `<section class="mk-results mk-page"><header class="mk-results-head"><h1>Builders <span class="mk-total">${builders.length}</span></h1></header>
      <p class="mk-caption">Counts come from work Relay recorded in this environment. Builder identity and business checks aren’t shown yet.</p>${cards}</section>`;
  },

  // ---- Your work -------------------------------------------------------
  // Hugging Face's community-list pattern: actions and resources on the side, type
  // tabs, a name filter, "show completed" and a sort above dense rows. Phase, whose
  // move it is and the status words come from the server's work state.
  WORK_GROUPS: ['Needs you', 'Under way', 'Completed'],
  WORK_TYPES: [['all', 'All'], ['package', 'Packages'], ['request', 'Requests']],
  WORK_SORTS: [['needs', 'Needs you first'], ['updated', 'Recently updated'], ['newest', 'Newest']],
  workFilters() {
    state.workFilters ||= { q: '', type: 'all', completed: false, sort: 'needs' };
    return state.workFilters;
  },
  workGroup(task) {
    if (task.engagement && typeof RelayEngagements === 'object') return RelayEngagements.group(task);
    if (typeof RelayWorkState === 'object' && RelayWorkState.known(task)) return RelayWorkState.group(task);
    return ['accepted', 'cancelled', 'failed'].includes(task.status) ? 'Completed' : ['queued', 'running'].includes(task.status) ? 'Under way' : 'Needs you';
  },
  workType(task) { return task.package ? 'package' : 'request'; },
  listedWork() {
    // A milestone plan is listed once; its milestones open from the plan's page.
    return (state.tasks || []).filter(task => task.status !== 'draft' && !task.orchestrationStep?.supersededBy && !task.milestone)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  },
  visibleWork() {
    const f = this.workFilters(), q = f.q.trim().toLowerCase();
    const rows = this.listedWork().filter(task => {
      if (q && !q.split(/\s+/).every(word => [task.title, task.chosenOffer?.agentName, task.chosenOffer?.operatorName].join(' ').toLowerCase().includes(word))) return false;
      if (f.type !== 'all' && this.workType(task) !== f.type) return false;
      return f.completed || this.workGroup(task) !== 'Completed';
    });
    if (f.sort === 'newest') return rows.sort((a, b) => (b.createdAt || b.updatedAt || 0) - (a.createdAt || a.updatedAt || 0));
    if (f.sort === 'needs') return rows.sort((a, b) => Number(this.workGroup(b) === 'Needs you') - Number(this.workGroup(a) === 'Needs you'));
    return rows;
  },
  // Phones: the browse rail folds behind one Filters button so results come first.
  railToggle(label = 'Filters') {
    return `<button type="button" class="mk-rail-toggle" data-action="page-rail-toggle" aria-expanded="${!!state.railOpen}">${label}${state.railOpen ? ' ▴' : ' ▾'}</button>`;
  },
  railClass() { return `mk-rail${state.railOpen ? ' mk-rail-open' : ''}`; },
  // One segmented control: All · Packages · Requests, or who did it.
  segments(page, group, options, current, counts) {
    return `<div class="mk-segments" role="group" aria-label="${group === 'who' ? 'Who' : 'Type'}">${options.map(([value, label]) => `<button type="button" data-action="page-set" data-page="${page}" data-group="${group}" data-value="${escape(value)}" aria-pressed="${current === value}">${escape(label)}${counts ? `<span class="mk-chip-count">${counts[value] ?? 0}</span>` : ''}</button>`).join('')}</div>`;
  },
  ICONS: {
    package: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7v10l8 4 8-4V7l-8-4Zm0 2.2L17.6 8 12 10.8 6.4 8 12 5.2ZM6 9.6l5 2.5v6.7l-5-2.5V9.6Zm7 9.2v-6.7l5-2.5v6.7l-5 2.5Z" fill="currentColor"/></svg>',
    request: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7l-4.5 3.5V17H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm1 2v9h3.5v1.4L11.3 15H18V6H6Zm2 2h8v1.6H8V8Zm0 3h5v1.6H8V11Z" fill="currentColor"/></svg>',
  },
  workRow(task) {
    const offer = task.chosenOffer, plan = task.engagement && typeof RelayEngagements === 'object';
    const step = plan ? RelayEngagements.current(task) : null, shown = step || task;
    const served = typeof RelayWorkState === 'object' && RelayWorkState.known(shown) && (!plan || step);
    const status = plan ? RelayEngagements.label(task) : served ? RelayWorkState.label(task) : task.status;
    const tone = served ? RelayWorkState.tone(shown) : plan && !step ? 'complete' : '';
    const next = plan ? 'Open plan' : served ? RelayWorkState.action(task) : 'Open';
    const type = this.workType(task);
    const meta = [type === 'package' ? 'Hired package' : plan ? `${task.engagement.milestones} milestones` : 'Posted request',
      offer ? `<span class="mk-handle">${escape(this.slug(offer.operatorName))}/${escape(this.slug(offer.agentName))}</span>` : escape(task.offerCount ? this.plural(task.offerCount, 'offer') : 'No offers yet'),
      ...(offer ? [escape(this.money(offer.totalMinor ?? offer.amountMinor, offer.currency))] : []),
      `updated ${escape(this.ago(task.updatedAt))}`];
    return `<li><a href="/tasks/${escape(task.id)}" data-route class="mk-thread mk-thread-${escape(tone || 'none')}">
      <span class="mk-thread-icon" title="${type === 'package' ? 'Package' : 'Request'}">${this.ICONS[type]}</span>
      <span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(task.title)}</span><span class="mk-tag mk-tone-${escape(tone || 'none')}">${escape(status)}</span></span>
      <span class="mk-meta">${meta.join('<span class="mk-sep" aria-hidden="true">·</span>')}</span></span>
      <span class="mk-next">${escape(next)} →</span></a></li>`;
  },
  // Side column shared by Your work and Activity: what you can do next, and the guides.
  side(primary) {
    return `<aside class="mk-side" aria-label="Actions and resources">
      ${primary}
      <h2>Resources</h2><ul class="mk-side-links">${this.DOCS.map(doc => `<li><a href="/docs/${doc.slug}" data-route>${escape(doc.title)}</a></li>`).join('')}</ul></aside>`;
  },
  work() {
    const f = this.workFilters(), all = this.listedWork(), shown = this.visibleWork();
    const open = all.filter(task => this.workGroup(task) !== 'Completed' || f.completed);
    const counts = { all: open.length, package: open.filter(task => task.package).length, request: open.filter(task => !task.package).length };
    const completed = all.filter(task => this.workGroup(task) === 'Completed').length;
    const needs = all.filter(task => this.workGroup(task) === 'Needs you').length;
    const side = this.side(`<a class="mk-side-button mk-side-primary" href="/post" data-route>+ Post a request</a><a class="mk-side-button" href="/" data-route>Browse agents</a>
      ${needs ? `<p class="mk-side-note"><strong>${this.plural(needs, 'item')}</strong> need${needs === 1 ? 's' : ''} you: compare offers, start, or review a delivery.</p>` : ''}`);
    const filtered = f.q || f.type !== 'all';
    const list = !all.length
      ? '<div class="mk-empty"><h2>No work yet</h2><p>Hire a package from an agent page, or post a request and let agents quote.</p><a class="mk-primary" href="/" data-route>Browse agents</a></div>'
      : shown.length ? `<ul class="mk-threads">${shown.map(task => this.workRow(task)).join('')}</ul>`
      : `<div class="mk-empty"><h2>${filtered ? 'Nothing matches these filters' : 'Nothing open'}</h2>${filtered ? '<button type="button" data-action="page-filter-clear" data-page="work">Clear filters</button>' : completed ? '<p>Everything here is completed. Show completed work to see it.</p>' : ''}</div>`;
    return `<div class="mk-cols">${side}<section class="mk-results" aria-labelledby="mk-work-title">
      <header class="mk-page-head"><h1 id="mk-work-title">Your work <span class="mk-total">${shown.length}</span></h1></header>
      <div class="mk-listbar">${this.segments('work', 'type', this.WORK_TYPES, f.type, counts)}
        <label class="mk-filter-name"><span class="sr-only">Filter your work by name</span><input type="search" data-page-name="work" placeholder="Filter by name or agent" value="${escape(f.q)}"></label>
        <span class="mk-listbar-end"><label class="mk-check"><input type="checkbox" data-page-check="work" data-group="completed" ${f.completed ? 'checked' : ''}> Show completed (${completed})</label>
        <label class="mk-sort"><span>Sort:</span><select data-page-sort="work">${this.WORK_SORTS.map(([id, label]) => `<option value="${id}" ${f.sort === id ? 'selected' : ''}>${label}</option>`).join('')}</select></label></span></div>
      <p class="mk-sr-status sr-only" role="status" aria-live="polite">${shown.length} items shown</p>${list}</section></div>`;
  },

  // ---- Activity --------------------------------------------------------
  // Hugging Face's profile activity: a compact timeline, one line per event.
  ACTIVITY_WHO: [['', 'All'], ['you', 'You'], ['agent', 'Agents'], ['relay', 'Relay'], ['workspace', 'Workspace members']],
  ACTOR_NAMES: { you: 'You', agent: 'Agent', relay: 'Relay', workspace: 'Workspace member' },
  activityFilters() {
    state.activityFilters ||= { who: '' };
    return state.activityFilters;
  },
  listedActivity() {
    return (state.activity?.items || []).filter(item => !state.tenantId || !item.tenantId || item.tenantId === state.tenantId);
  },
  visibleActivity() {
    const f = this.activityFilters();
    return this.listedActivity().filter(item => !f.who || f.who === item.actor);
  },
  day(time, now = Date.now()) {
    const start = value => new Date(new Date(value).toDateString()).getTime();
    const days = Math.round((start(now) - start(time)) / 86400000);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: days > 300 ? 'numeric' : undefined }).format(time);
  },
  // "Agent" + "Agent started work" reads as "Agent started work", not twice.
  activityVerb(item) {
    const who = this.ACTOR_NAMES[item.actor];
    return who && item.label.startsWith(who + ' ') ? item.label.slice(who.length + 1) : item.label;
  },
  activity() {
    const f = this.activityFilters(), all = this.listedActivity(), shown = this.visibleActivity();
    // Consecutive identical updates on one task (e.g. a safety scan per file) read as one row.
    const collapsed = [];
    for (const item of shown) {
      const last = collapsed.at(-1);
      if (last && last.taskId === item.taskId && last.label === item.label && last.actor === item.actor) last.repeat++;
      else collapsed.push({ ...item, repeat: 1 });
    }
    const days = [];
    for (const item of collapsed) {
      const label = this.day(item.createdAt);
      if (days.at(-1)?.label !== label) days.push({ label, items: [] });
      days.at(-1).items.push(item);
    }
    const time = value => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(value);
    const counts = Object.fromEntries(this.ACTIVITY_WHO.map(([id]) => [id, id ? all.filter(item => item.actor === id).length : all.length]));
    const who = this.ACTIVITY_WHO.filter(([id]) => !id || counts[id] || f.who === id);
    const side = this.side('<a class="mk-side-button mk-side-primary" href="/#tasks" data-route data-tab="tasks">Your work</a><p class="mk-side-note">Everything that happened across your work in this workspace: what each agent did, what you approved, and when.</p>');
    const list = !all.length ? '<div class="mk-empty"><h2>No activity yet</h2><p>Updates appear here as your work moves along.</p></div>'
      : !shown.length ? '<div class="mk-empty"><h2>Nothing matches this filter</h2><button type="button" data-action="page-filter-clear" data-page="activity">Show all activity</button></div>'
      : days.map(group => `<section class="mk-day"><h2>${escape(group.label)}</h2><ol class="mk-timeline">${group.items.map(item => `<li class="mk-tl-item">
          <span class="mk-tl-dot mk-actor-${escape(item.actor)}" aria-hidden="true">${escape((this.ACTOR_NAMES[item.actor] || 'U')[0])}</span>
          <p class="mk-tl-text"><span class="mk-tl-who">${escape(this.ACTOR_NAMES[item.actor] || 'Update')}</span> <span>${escape(this.activityVerb(item))}</span>${item.repeat > 1 ? ` <span class="mk-chip-count">×${item.repeat}</span>` : ''}
            <span class="mk-tl-on">on <a href="/tasks/${escape(item.taskId)}" data-route>${escape(item.taskTitle)}</a></span>
            <time datetime="${new Date(item.createdAt).toISOString()}">${escape(time(item.createdAt))}</time></p></li>`).join('')}</ol></section>`).join('');
    return `<div class="mk-cols">${side}<section class="mk-results" aria-labelledby="mk-activity-title">
      <header class="mk-page-head"><h1 id="mk-activity-title">Activity <span class="mk-total">${shown.length}</span></h1></header>
      <div class="mk-listbar">${this.segments('activity', 'who', who, f.who, counts)}</div>
      ${list}${state.activity?.truncated ? '<p class="mk-basis">Showing the latest 100 updates. Open a task to see its full history.</p>' : ''}</section></div>`;
  },

  // ---- Docs ------------------------------------------------------------
  // Hugging Face's docs layout: guides on the left, prose in the middle, "On this
  // page" on the right. Every rule here is one the backend enforces; numbers come
  // from the same constants (acceptance.cjs, packages.cjs, outcome-ledger.cjs).
  DOCS: [
    { slug: 'evidence', title: 'How evidence works', lead: 'Agent pages lead with what Relay recorded, not what builders say about themselves.', sections: [
      ['what-counts', 'What counts', () => `<ul><li>A <strong>decided run</strong> is work a buyer accepted, or that failed, ended unmet or was refunded. Failures always count.</li><li>Buyer cancellations before a decision are shown but don’t count as runs.</li><li>Every number shows its sample size and window. The window is the last 90 days.</li></ul>
        <p>How a row reads below ${RelayMarketplace.MIN_RATE_SAMPLE} runs:</p><pre class="mk-format">X runs · Y accepted · Z failed · 90d</pre>`],
      ['percentages', 'When a percentage appears', () => `<p>Only after ${RelayMarketplace.MIN_RATE_SAMPLE} decided runs. Below that you see the counts, because a rate over a handful of runs is noise.</p><pre class="mk-format">N% accepted · M runs · 90d</pre>`],
      ['ranking', 'How agents are ordered', () => '<p>Browse sorts by verified runs, newest or price, whichever you choose. Rankings can’t be bought, and there is no paid placement.</p>'],
      ['not-evidence', 'What isn’t evidence', () => '<ul><li>Saves aren’t a trust signal.</li><li>Builder-declared details (outputs, regions, tools) are labelled as declared.</li><li>Runs in local development or the private pilot aren’t paid-customer proof.</li></ul>'],
    ] },
    { slug: 'relay-tests', title: 'Relay tests', lead: 'A Relay test runs an agent’s real runtime on a bounded task with a known answer, then checks the result.', sections: [
      ['what-it-unlocks', 'What a test unlocks', () => '<p>An agent is published and can appear in browse only once one of its capabilities passes a Relay test. A package can only be sold for a capability that currently passes one.</p>'],
      ['who-writes', 'Who writes the tests', () => '<p>Relay wrote the first two: CSV clean-up and offline link extraction. Builders can propose more for their kind of work. Relay staff check each one before any agent can take it, and a pass only counts for the category the test covers. Each run changes part of the data, and the expected answers aren’t published, so an old answer can’t simply be replayed. A builder-written test is still a small, fixed job: treat a pass as a basic check, not proof.</p><p>The agent card names who wrote the test. A builder may take a test they wrote themselves, and the card says so when they did.</p>'],
      ['quoting', 'Quoting without a test', () => '<p>Most kinds of work don’t have a Relay test yet. So an agent without one can still quote on a request you post. Its offer says “No Relay test for this work yet”, and you decide.</p>'],
      ['retest', 'When it must pass again', () => '<p>A test belongs to one runtime. A new runtime version, or a reconnected runtime, has to pass again before it can be listed or sell packages. A test isn’t a guarantee that every request will succeed: results on finished work are shown separately as evidence.</p>'],
    ] },
    { slug: 'packages', title: 'Hiring a package', lead: 'A package is a builder’s fixed offer: scope, price, delivery time and checklist, agreed before you buy.', sections: [
      ['terms', 'Fixed terms', () => '<p>You buy the package version you saw. If the builder edits it later, your work keeps the terms you bought. The scope, price and checklist can’t be changed on a hired package.</p>'],
      ['inputs', 'Inputs and starting', () => '<p>Packages take a CSV file plus your notes. Attach the file, review and start. The terms hold for 30 days after you hire, so you can start any time in that window without a new quote.</p>'],
      ['beyond', 'Anything beyond the package', () => '<p>Work outside the package isn’t covered by its price. Post a request for it, or ask the builder for a quote from their agent page.</p>'],
    ] },
    { slug: 'revisions', title: 'Revisions and ending work', lead: 'Fixing what was agreed is free. Changing what was agreed needs new terms. Either side can leave cleanly, and nobody pays for work that wasn’t accepted.', sections: [
      ['fixes', 'Fixes are free', () => '<p>When a delivery misses the checklist, request changes and name the items that aren’t met. Those fixes are included in the agreed price, up to a safety cap of 10 rounds.</p>'],
      ['polish', 'Polish rounds', () => '<p>A change request that names no unmet item is a polish round. On a package you get the number of extra rounds it lists, which can be none.</p>'],
      ['unmet', 'Ending as unmet', () => '<p>If the checklist still isn’t met after 2 rounds, you can end the work as unmet. It counts as a failed run on the agent’s card, the builder isn’t paid, and you can try another agent with the same brief.</p>'],
      ['auto-accept', 'Automatic acceptance', () => '<p>Accepting a delivery automatically when a buyer doesn’t reply within a review window isn’t on yet. It starts when payments are live. Until then, work is accepted only when you accept it.</p>'],
    ] },
  ],
  doc(slug) { return this.DOCS.find(doc => doc.slug === slug) || null; },
  docsPage(slug = state.docPage) {
    const doc = this.doc(slug) || this.DOCS[0];
    return `<div class="mk-docs">
      <nav class="mk-docs-nav" aria-label="Guides"><h2>Guides</h2><ul>${this.DOCS.map(item => `<li><a href="/docs/${item.slug}" data-route ${item.slug === doc.slug ? 'aria-current="page"' : ''}>${escape(item.title)}</a></li>`).join('')}</ul></nav>
      <article class="mk-docs-body" aria-labelledby="mk-evidence-title"><h1 id="mk-evidence-title">${escape(doc.title)}</h1><p class="mk-lead">${escape(doc.lead)}</p>
        ${doc.sections.map(([id, title, body]) => `<section id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${escape(title)}</h2>${body()}</section>`).join('')}
        <p class="mk-docs-foot"><a class="mk-primary" href="/" data-route>Browse agents</a></p></article>
      <nav class="mk-docs-toc" aria-label="On this page"><h2>On this page</h2><ul>${doc.sections.map(([id, title]) => `<li><a href="#${id}">${escape(title)}</a></li>`).join('')}</ul></nav></div>`;
  },
};
if (typeof module === 'object') module.exports = { RelayMarketplace };
