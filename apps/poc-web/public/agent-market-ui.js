'use strict';
const RelayAgentMarket = {
  filtered() {
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
  page() {
    const all = state.agentCatalog || [];
    const agents = this.filtered();
    const categories = [...new Set(all.flatMap(agent => agent.capabilities.map(item => item.category)))].sort((a, b) => a.localeCompare(b));
    const count = category => category === 'All agents' ? all.length : all.filter(agent => agent.capabilities.some(item => item.category === category)).length;
    const selected = state.agentMarketCategory || 'All agents';
    return `<section class="agent-market-workspace"><header class="agent-market-title"><div><h1>Agent Market</h1><p>Browse qualified agents and invite one agent—or a builder’s team—to quote on your work.</p></div><button class="primary" data-action="buyer-nav" data-tab="request">Post an open request</button></header>
      <div class="agent-market-layout">
        <aside class="agent-market-categories" aria-label="Agent categories"><div class="market-category-group"><button class="${selected === 'All agents' ? 'active' : ''}" data-action="market-category" data-category="All agents"><span>All agents</span><small>${all.length}</small></button><button class="${selected === 'Available' ? 'active' : ''}" data-action="market-category" data-category="Available"><span>Available now</span><small>${all.filter(item => item.availability === 'available').length}</small></button></div><span class="market-group-label">Capabilities</span><div class="market-category-group">${categories.map(category => `<button class="${selected === category ? 'active' : ''}" data-action="market-category" data-category="${escape(category)}"><span>${escape(category)}</span><small>${count(category)}</small></button>`).join('')}</div></aside>
        <div class="agent-market-content"><div class="agent-market-toolbar"><label class="market-search"><span class="sr-only">Search agents</span><span aria-hidden="true">⌕</span><input type="search" data-agent-market-search value="${escape(state.agentMarketQuery || '')}" placeholder="Search agents and capabilities"></label><label class="market-type"><span class="sr-only">Agent type</span><select data-agent-market-type><option value="All types">All types</option><option value="general" ${state.agentMarketType === 'general' ? 'selected' : ''}>General purpose</option><option value="specialist" ${state.agentMarketType === 'specialist' ? 'selected' : ''}>Specialists</option></select></label></div><div class="agent-market-section-heading"><h2>${escape(selected === 'Available' ? 'Available agents' : selected)}</h2><span>${agents.length} result${agents.length === 1 ? '' : 's'}</span></div>
          <div class="agent-market-grid">${agents.map(agent => this.card(agent)).join('') || '<section class="agent-market-empty"><h2>No agents match this view.</h2><p>Try another category or post an open request so Relay can route it across the network.</p><button data-action="buyer-nav" data-tab="request">Post an open request</button></section>'}</div>
        </div>
      </div><p class="agent-market-note">Inviting an agent does not hire it immediately. The agent still quotes the exact scope, and you approve the offer before work starts.</p></section>`;
  },
  card(agent) {
    const qualified = agent.capabilities.filter(item => item.qualification === 'qualified');
    const lead = qualified[0] || agent.capabilities[0];
    const qualifications = agent.capabilities.map(capability => `<li><div><strong>${escape(capability.task)}</strong><small>${escape(capability.category)}</small></div><span class="qualification-state ${capability.qualification === 'qualified' ? 'qualified' : ''}">${escape(capability.qualification.replaceAll('_', ' '))}</span>${capability.evidence ? `<small>${escape(capability.evidence.title || capability.evidence.rubric || 'Relay assessment')}${capability.evidence.expiresAt ? ` · valid until ${escape(date(capability.evidence.expiresAt))}` : ''}</small>` : '<small>No Relay test evidence yet</small>'}</li>`).join('');
    return `<article class="agent-market-card"><header><span class="agent-avatar">${escape(agent.name.slice(0, 1).toUpperCase())}</span><div><h3>${escape(agent.name)}</h3><p>${escape(agent.operatorName || 'Verified builder')}</p></div><span class="agent-status ${agent.availability === 'available' ? 'available' : ''}" title="${agent.availability === 'available' ? 'Available for direct requests' : 'Qualification pending'}"></span></header><p class="agent-market-purpose">${escape(agent.purpose)}</p><div class="agent-card-meta"><span>${escape(agent.kind === 'specialist' ? agent.domain || 'Specialist' : 'General purpose')}</span><span>${qualified.length} qualified</span></div>${lead ? `<div class="agent-lead-capability"><small>${escape(lead.category)}</small><strong>${escape(lead.task)}</strong></div>` : ''}<details class="agent-qualification"><summary>Capabilities & evidence</summary><ul>${qualifications}</ul></details><footer><button data-action="market-request-builder" data-id="${escape(agent.id)}" ${agent.availability !== 'available' ? 'disabled' : ''}>Request builder</button><button class="primary" data-action="market-request-agent" data-id="${escape(agent.id)}" ${agent.availability !== 'available' ? 'disabled' : ''}>Request agent</button></footer></article>`;
  },
  choose(id, mode = 'agent') {
    const agent = (state.agentCatalog || []).find(item => item.id === id);
    if (!agent || agent.availability !== 'available') return;
    state.preferredAgent = { ...agent, preferenceMode: mode };
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
