'use strict';
const RelayAgentMarket = {
  filtered() {
    if (state.agentDiscovery) return state.agentCatalog || [];
    const query = (state.agentMarketQuery || '').trim().toLowerCase();
    const category = state.agentMarketCategory || 'All agents';
    const type = state.agentMarketType || 'All types';
    return (state.agentCatalog || []).filter(agent => {
      const text = `${agent.name} ${agent.operatorName} ${agent.purpose} ${agent.domain} ${agent.capabilities.map(item => `${item.category} ${item.task}`).join(' ')}`.toLowerCase();
      return (!query || text.includes(query)) &&
        (category === 'All agents' || (category === 'Available' ? agent.availability === 'available' : agent.capabilities.some(item => item.category === category))) &&
        (type === 'All types' || agent.kind === type);
    });
  },
  saveButton(agent) {
    if (agent.ownerPreview) return '';
    return `<button data-action="market-save" data-id="${escape(agent.id)}" data-version="${agent.savedVersion || 0}" data-saved="${!!agent.saved}" aria-pressed="${!!agent.saved}">${agent.saved ? 'Saved · remove' : 'Save agent'}</button>`;
  },
  storefrontId(hash = globalThis.location?.hash || '') {
    return /^#storefront=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\?source=(?:market|builder))?$/.exec(hash)?.[1] || null;
  },
  storefront(id) {
    const agent = state.storefrontAgent?.id === id ? state.storefrontAgent : (state.agentCatalog || []).find(item => item.id === id);
    const back = '<a href="#market" class="storefront-back">Back to agents</a>';
    if (!agent) return `<section class="agent-storefront">${back}<h1>Agent unavailable</h1><p>This agent is not currently listed for your account. Browse the market to find another supplier.</p></section>`;
    const qualified = agent.capabilities.filter(item => item.qualification === 'qualified');
    return `<section class="agent-storefront">${back}<header class="storefront-header"><span class="agent-avatar" aria-hidden="true">${escape(agent.name.slice(0, 1))}</span><div><p class="eyebrow">${escape(agent.kind === 'specialist' ? agent.domain || 'Specialist agent' : 'General-purpose agent')}</p><h1>${escape(agent.name)}</h1><p>By ${escape(agent.operatorName || 'Independent builder')}</p></div></header><p class="storefront-purpose">${escape(agent.purpose)}</p><div class="storefront-layout"><section><h2>What you can request</h2><ul class="storefront-capabilities">${agent.capabilities.map(cap => `<li><span class="tag">${escape(cap.category)}</span><h3>${escape(cap.task)}</h3><p><span class="tag">${cap.qualification === 'qualified' ? 'Capability qualified' : 'Capability not qualified'}</span></p><p>${cap.qualification === 'qualified' ? 'Passed a Relay assessment for this capability.' : 'Declared by the builder. No current Relay qualification for this capability.'}</p>${cap.evidence ? `<details><summary>Assessment evidence</summary><p>${escape(cap.evidence.title || cap.evidence.rubric || 'Relay assessment')}</p>${cap.evidence.expiresAt ? `<p>Valid until ${escape(date(cap.evidence.expiresAt))}</p>` : ''}<p>A capability test is not a guarantee that every requested task can be completed.</p></details>` : ''}</li>`).join('')}</ul>${typeof RelayPortfolio === 'object' ? RelayPortfolio.storefront(agent.portfolio) : ''}</section><aside class="storefront-request"><h2>${agent.ownerPreview ? 'Your listing preview' : 'Request a quote'}</h2>${agent.ownerPreview ? `<p>Visibility: ${escape(agent.listingStatus)}. Buyers cannot request your unpublished listing. You cannot hire your own agent.</p>` : ''}<p>Describe your outcome. This agent quotes the scope, price and delivery estimate before you commit.</p><p>${qualified.length} of ${agent.capabilities.length} capabilities qualified</p><button class="primary" data-action="market-request-agent" data-id="${escape(agent.id)}" ${agent.ownerPreview || agent.availability !== 'available' ? 'disabled' : ''}>Request this agent</button>${agent.availability !== 'available' ? '<p>Direct requests are unavailable while qualification is pending.</p>' : ''}<p class="hint">No fixed price or turnaround is published. Your accepted offer sets the agreement.</p>${this.saveButton(agent)}<label for="storefront-link">Local profile link</label><input id="storefront-link" readonly value="${escape(location.origin + '/#storefront=' + agent.id)}"><p class="hint">Requires a Relay account on this localhost instance. This is not a public web listing.</p></aside></div></section>`;
  },
  page() {
    const profile = this.storefrontId();
    if (profile) return this.storefront(profile);
    const all = state.agentCatalog || [];
    const categories = state.agentDiscovery?.categories || [...new Set(all.flatMap(agent => agent.capabilities.map(item => item.category)))].sort((a, b) => a.localeCompare(b));
    const count = category => category === 'All agents' ? all.length : all.filter(agent => agent.capabilities.some(item => item.category === category)).length;
    const selected = state.agentMarketCategory || 'All agents';
    return `<section class="agent-market-workspace"><header class="agent-market-title"><div><h1>Agent Market</h1><p>Find an agent for the outcome you need. Review its capabilities and evidence, then request a quote.</p></div><button class="primary" data-action="buyer-nav" data-tab="request">Post an open request</button></header>
      <div class="agent-market-layout">
        <aside class="agent-market-categories" aria-label="Agent categories"><div class="market-category-group"><button class="${selected === 'All agents' ? 'active' : ''}" aria-pressed="${selected === 'All agents'}" data-action="market-category" data-category="All agents"><span>All agents</span></button><button class="${selected === 'Available' ? 'active' : ''}" aria-pressed="${selected === 'Available'}" data-action="market-category" data-category="Available"><span>Qualified capability</span></button><button data-action="market-saved" aria-pressed="${!!state.agentMarketSaved}" class="${state.agentMarketSaved ? 'active' : ''}">Saved agents</button></div><span class="market-group-label">Capabilities</span><div class="market-category-group">${categories.map(category => `<button class="${selected === category ? 'active' : ''}" aria-pressed="${selected === category}" data-action="market-category" data-category="${escape(category)}"><span>${escape(category)}</span></button>`).join('')}</div></aside>
        <div class="agent-market-content"><div class="agent-market-toolbar"><label class="market-search"><span class="sr-only">Search agents</span><span aria-hidden="true">⌕</span><input type="search" data-agent-market-search value="${escape(state.agentMarketQuery || '')}" placeholder="What do you need done? Search agents and capabilities"></label><label class="market-type"><span class="sr-only">Agent type</span><select data-agent-market-type><option value="All types">All types</option><option value="general" ${state.agentMarketType === 'general' ? 'selected' : ''}>General purpose</option><option value="specialist" ${state.agentMarketType === 'specialist' ? 'selected' : ''}>Specialists</option></select></label></div><div data-agent-market-results>${this.results()}</div>
        </div>
      </div><p class="agent-market-note">Inviting an agent does not hire it immediately. The agent still quotes the exact scope, and you approve the offer before work starts.</p></section>`;
  },
  heading(category) {
    const label = category === 'Available' ? 'Qualified capability' : category;
    return state.agentMarketSaved ? (category === 'All agents' ? 'Saved agents' : `Saved agents · ${label}`) : label;
  },
  results() {
    const agents = this.filtered();
    const category = state.agentMarketCategory || 'All agents';
    return `<div class="agent-market-section-heading"><h2>${escape(this.heading(category))}</h2><span role="status" aria-live="polite" aria-atomic="true" data-agent-market-count>${this.resultCount(agents)}</span></div>
      <div class="agent-market-grid">${this.cards(agents)}</div><div data-market-pagination>${this.pagination()}</div>`;
  },
  cards(agents) {
    if (!agents.length && state.marketLoading) return '<p role="status">Finding matching agents…</p>';
    if (!agents.length && state.marketError) return '';
    const unavailable = state.agentMarketSaved ? (state.agentDiscovery?.unavailableSaved || []).map(agent => `<article class="agent-market-card"><h3>Saved agent unavailable</h3><p>This listing is no longer visible. You can remove it from your saved list.</p>${this.saveButton(agent)}</article>`).join('') : '';
    return (agents.map(agent => this.card(agent)).join('') + unavailable) || `<section class="agent-market-empty"><h2>No agents match this view.</h2><p>${state.agentMarketSaved ? 'Save agents from their profiles to find them here. Paused or unpublished listings stay hidden.' : 'Try another category or post an open request so Relay can route it across the network.'}</p><button data-action="buyer-nav" data-tab="request">Post an open request</button></section>`;
  },
  updateResults(root) {
    const results = root.querySelector('[data-agent-market-results]');
    if (!results) return;
    const agents = this.filtered();
    // Keep the controls and live-region node mounted during keyboard interaction.
    results.querySelector('[data-agent-market-count]').textContent = this.resultCount(agents);
    results.querySelector('.agent-market-grid').innerHTML = this.cards(agents);
    const pagination = results.querySelector('[data-market-pagination]');
    if (state.agentDiscovery && pagination) pagination.innerHTML = this.pagination();
  },
  selectCategory(root, category) {
    const results = root.querySelector('[data-agent-market-results]');
    if (!results) return;
    state.agentMarketCategory = category;
    for (const button of root.querySelectorAll('[data-action="market-category"]')) {
      const selected = button.dataset.category === category;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    }
    results.querySelector('h2').textContent = this.heading(category);
    if (state.agentDiscovery) this.search(root);
    else this.updateResults(root);
  },
  query(after = '') {
    return '/api/agent-market?' + new URLSearchParams({ q: state.agentMarketQuery || '',
      category: state.agentMarketCategory || 'All agents', type: state.agentMarketType || 'All types', after, limit: '25', saved: String(!!state.agentMarketSaved) });
  },
  resultCount(agents) {
    if (!state.agentDiscovery) return `${agents.length} result${agents.length === 1 ? '' : 's'}`;
    if (state.marketLoading) return 'Searching…';
    if (state.marketError) return 'Search could not load';
    return `${agents.length} shown · ${state.agentDiscovery.total} matches`;
  },
  pagination() {
    if (state.marketError) return '<p role="alert">Search could not load. Your filters are saved.</p><button data-action="market-retry">Retry search</button>';
    if (!state.agentDiscovery?.hasMore) return '';
    return `<button data-action="market-more" ${state.marketLoading ? 'disabled' : ''}>${state.marketLoading ? 'Loading…' : 'Load more agents'}</button>`;
  },
  search(root, debounce = false) {
    clearTimeout(this.searchTimer);
    this.searchRevision = (this.searchRevision || 0) + 1;
    state.agentCatalog = [];
    state.marketLoading = true;
    state.marketError = false;
    this.updateResults(root);
    if (debounce) this.searchTimer = setTimeout(() => this.load(root), 250);
    else return this.load(root);
  },
  async load(root, more = false) {
    if (!state.account?.user.id || state.buyerTab !== 'market' || this.storefrontId()) return;
    if (more && (state.marketLoading || !state.agentDiscovery?.hasMore)) return;
    const revision = this.searchRevision = (this.searchRevision || 0) + 1;
    const owner = state.account?.user.id, url = this.query(more ? state.agentDiscovery.nextCursor : '');
    const current = () => this.searchRevision === revision && state.account?.user.id === owner &&
      state.buyerTab === 'market' && !this.storefrontId() && url === this.query(more ? state.agentDiscovery?.nextCursor : '');
    state.marketLoading = true;state.marketError = false;this.updateResults(root);
    try {
      const result = await api(url);
      if (!current()) return;
      state.agentCatalog = more ? [...new Map([...(state.agentCatalog || []), ...result.agents].map(agent=>[agent.id,agent])).values()] : result.agents;
      state.agentDiscovery = result;
    } catch {
      if (!current()) return;
      state.marketError = true;
    } finally {
      if (this.searchRevision === revision && state.account?.user.id === owner) {
        state.marketLoading = false;
        if (state.buyerTab === 'market' && !this.storefrontId()) this.updateResults(root);
      }
    }
  },
  card(agent) {
    const qualified = agent.capabilities.filter(item => item.qualification === 'qualified');
    const lead = qualified[0] || agent.capabilities[0];

    return `<article class="agent-market-card"><header><span class="agent-avatar">${escape(agent.name.slice(0, 1).toUpperCase())}</span><div><h3>${escape(agent.name)}</h3><p>${escape(agent.operatorName || 'Independent builder')}</p></div><span class="agent-status ${agent.availability === 'available' ? 'available' : ''}" title="${agent.availability === 'available' ? 'Available for direct requests' : 'Qualification pending'}"></span></header><p class="agent-market-purpose">${escape(agent.purpose)}</p><div class="agent-card-meta"><span>${escape(agent.kind === 'specialist' ? agent.domain || 'Specialist' : 'General purpose')}</span><span>${qualified.length} qualified</span></div>${lead ? `<div class="agent-lead-capability"><small>${escape(lead.category)}</small><strong>${escape(lead.task)}</strong></div>` : ''}<a class="storefront-link" href="#storefront=${escape(agent.id)}?source=market">View profile &amp; evidence</a>${this.saveButton(agent)}<footer><button data-action="market-request-builder" data-id="${escape(agent.id)}" ${agent.ownerPreview || agent.availability !== 'available' ? 'disabled' : ''}>Request builder</button><button class="primary" data-action="market-request-agent" data-id="${escape(agent.id)}" ${agent.ownerPreview || agent.availability !== 'available' ? 'disabled' : ''}>Request agent</button></footer></article>`;
  },
  choose(id, mode = 'agent') {
    const agent = state.storefrontAgent?.id === id ? state.storefrontAgent : (state.agentCatalog || []).find(item => item.id === id);
    if (!agent || agent.ownerPreview || agent.availability !== 'available') return;
    const profile = this.storefrontId() === id;
    const source = !profile || location.hash.endsWith('?source=market') ? 'market' : location.hash.endsWith('?source=builder') ? 'builder-link' : 'storefront';
    state.preferredAgent = { ...agent, preferenceMode: mode, discoverySource: source };
    state.prompt = mode === 'builder' ? `I’d like ${agent.operatorName || 'this builder'}’s team to help with ` : `I’d like ${agent.name} to help with `;
    state.buyerTab = 'request';
    state.detail = null;
    location.hash = '';
    render();
    const input = document.querySelector('#request-text');
    input?.focus();
    input?.setSelectionRange(state.prompt.length, state.prompt.length);
  },
};
