'use strict';

// Buyer connections and access grants (docs/specs/Buyer-Connections.md): the
// access requests an agent makes on a request page. Connecting systems lives in
// Settings → Integrations (integrations-ui.js). Credentials are typed once and never shown
// again; agents get scoped, expiring read access that Relay brokers.
const RelayConnections = {
  ENV: { sandbox: 'Sandbox', production: 'Production' },
  money: null,
  when(time) { return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); },

  // ---- Request page --------------------------------------------------------
  taskAccess(detail) {
    const access = detail.access;
    if (!access || (!access.requests.length && !access.grants.length)) return '';
    const canGrant = (state.account?.memberships || []).some(m => m.id === detail.task.tenantId && m.role === 'owner');
    const options = req => (state.connections?.connections || []).filter(c => c.provider === req.provider && c.environment === req.environment && req.objects.every(o => c.objects.includes(o)));
    const pending = access.requests.filter(r => r.status === 'pending' || r.status === 'declined');
    const requestCard = r => {
      const matches = options(r);
      const head = `<p class="mk-approval-line"><span class="mk-tag ${r.status === 'pending' ? 'mk-tone-attention' : ''}">${r.status === 'pending' ? 'Waiting for you' : 'Declined'}</span> <strong>${escape(r.providerLabel)} · ${escape(this.ENV[r.environment] || r.environment)}</strong> · read ${escape(r.objects.join(', '))} · up to ${r.days} day${r.days === 1 ? '' : 's'}</p>
        <p class="mk-caption"><strong>Why:</strong> ${escape(r.purpose)}</p>`;
      if (r.status === 'declined') return `<div class="mk-approval">${head}<p class="mk-caption">The work stays paused. The agent may end it as blocked by you; that isn’t counted against it.</p></div>`;
      if (!canGrant) return `<div class="mk-approval">${head}<p class="mk-caption">A workspace owner needs to approve this.</p></div>`;
      return `<div class="mk-approval">${head}${matches.length ? `<form class="mk-form mk-approval-form" data-access-approve="${escape(r.id)}">
          <label for="access-conn-${escape(r.id)}">Give access to</label><select id="access-conn-${escape(r.id)}" name="connectionId">${matches.map(c => `<option value="${escape(c.id)}">${escape(c.label)} · account ${escape(c.account || '—')}</option>`).join('')}</select>
          <label for="access-days-${escape(r.id)}">For</label><select id="access-days-${escape(r.id)}" name="days">${[1, 3, 7, 14, 30].filter(d => d <= r.days).map(d => `<option value="${d}" ${d === Math.min(r.days, 7) ? 'selected' : ''}>${d} day${d === 1 ? '' : 's'}</option>`).join('')}</select>
          <div class="form-error" role="alert"></div><div class="mk-form-actions"><button class="mk-primary" type="submit">Grant read access</button><button type="button" data-action="access-decline" data-id="${escape(r.id)}">Decline</button></div></form>`
        : `<p class="mk-caption">No matching system is connected. <a href="${typeof RelayIntegrations === 'object' ? RelayIntegrations.href(detail.task.tenantId) : '/settings/integrations'}" data-route>Connect one in Settings → Integrations</a>, or decline.</p><button type="button" data-action="access-decline" data-id="${escape(r.id)}">Decline</button>`}</div>`;
    };
    const grants = access.grants.map(g => `<li><strong>${escape(g.connectionLabel)}</strong> <span class="mk-caption">${escape(g.objects.join(', '))} · ${g.status === 'active' ? `until ${escape(this.when(g.expiresAt))}` : escape(g.status)} · ${g.reads} read${g.reads === 1 ? '' : 's'}, ${g.rowsRead} rows</span>
      ${g.status === 'active' && canGrant ? `<button type="button" class="mk-link-button mk-danger" data-action="access-revoke" data-id="${escape(g.id)}" data-version="${g.version}">Revoke</button>` : ''}</li>`).join('');
    return `<section class="mk-section" aria-labelledby="mk-access-title"><h2 id="mk-access-title">Access to your systems</h2>
      ${pending.map(requestCard).join('')}
      ${grants ? `<ul class="mk-member-list">${grants}</ul>` : ''}
      <p class="mk-caption">Read-only. Relay reads on the agent’s behalf and logs every read; the agent never receives your credentials.</p></section>`;
  },
};
