'use strict';

// Buyer connections and access grants (docs/specs/Buyer-Connections.md):
// the "Connected systems" tab on an organization, and the access requests an
// agent makes on a request page. Credentials are typed once and never shown
// again; agents get scoped, expiring read access that Relay brokers.
const RelayConnections = {
  ENV: { sandbox: 'Sandbox', production: 'Production' },
  money: null,
  when(time) { return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); },

  // ---- Organization tab ----------------------------------------------------
  tab() {
    const data = state.connections;
    if (!data) return '<p class="mk-caption">Loading connected systems…</p>';
    const rows = data.connections.length ? `<ul class="mk-member-list mk-connection-list">${data.connections.map(c => `<li>
        <span class="mk-org-avatar mk-org-avatar-sm" aria-hidden="true">${escape(c.providerLabel.slice(0, 1))}</span>
        <span class="mk-connection-name"><strong>${escape(c.label)}</strong><span class="mk-caption">${escape(c.providerLabel)} · ${escape(this.ENV[c.environment] || c.environment)} · account ${escape(c.account || '—')} · ${escape(c.objects.join(', '))}</span></span>
        <span class="mk-tag">${c.activeGrants ? `${c.activeGrants} active grant${c.activeGrants === 1 ? '' : 's'}` : 'No active grants'}</span>
        ${data.canManage ? (state.disconnecting === c.id
          ? `<span class="mk-inline-confirm" role="alert">Disconnect? Every grant on it stops at once. <button type="button" class="mk-link-button mk-danger" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button> <button type="button" class="mk-link-button" data-action="connection-disconnect-cancel">Keep</button></span>`
          : `<button type="button" class="mk-link-button" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button>`) : ''}</li>`).join('')}</ul>`
      : '<div class="mk-empty mk-empty-inline"><h3>No systems connected</h3><p>Connect a sandbox first. Agents can then ask for read access during work, and you approve each request.</p></div>';
    const available = data.catalog.filter(p => p.available), planned = data.catalog.filter(p => !p.available);
    return `<section class="mk-section"><h2>Connected systems</h2>
      <p class="mk-caption">Agents never see these credentials. When an agent needs data, it asks; you choose a system and a duration; Relay reads on its behalf and logs every read. Access is read-only: changes come back as files you load with your own import tool.</p>
      ${rows}
      ${data.canManage && available.length ? this.connectForm(available) : data.canManage ? '' : '<p class="mk-caption">Workspace owners connect systems.</p>'}
      ${planned.length ? `<h3>Coming next</h3><ul class="mk-bullets">${planned.map(p => `<li><strong>${escape(p.label)}</strong>: ${escape(p.note)}</li>`).join('')}</ul><p class="mk-caption">Each connector ships after a test account and an independent security review. Until then, attach exports to the request.</p>` : ''}</section>`;
  },
  connectForm(providers) {
    const chosen = providers.find(p => p.kind === state.connectProvider) || providers[0];
    return `<form id="connection-create" class="mk-form mk-panel"><h3>Connect a system</h3>
      <label for="connection-provider">System</label><select id="connection-provider" name="provider" data-connect-provider>${providers.map(p => `<option value="${escape(p.kind)}" ${p.kind === chosen.kind ? 'selected' : ''}>${escape(p.label)}</option>`).join('')}</select>
      <label for="connection-environment">Environment</label><select id="connection-environment" name="environment">${chosen.environments.map(e => `<option value="${escape(e)}">${escape(this.ENV[e] || e)}</option>`).join('')}</select>
      <p class="mk-caption">Start with a sandbox. Use a dedicated integration user with read-only permissions, never an administrator login.</p>
      <label for="connection-label">Name</label><input id="connection-label" name="label" maxlength="80" required placeholder="e.g. NetSuite sandbox (Wave 2)">
      ${chosen.credentialFields.map(f => `<label for="connection-${escape(f.name)}">${escape(f.label)}</label><input id="connection-${escape(f.name)}" name="cred-${escape(f.name)}" ${f.secret ? 'type="password" autocomplete="off"' : 'autocomplete="off"'} required>`).join('')}
      <p class="mk-caption">Relay checks these with the system, then stores them encrypted. You won’t see them again.</p>
      <div class="form-error" role="alert"></div><div class="mk-form-actions"><button class="mk-primary" type="submit">Connect</button></div></form>`;
  },

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
        : `<p class="mk-caption">No matching system is connected. <a href="/org/${escape(detail.task.tenantId)}/connections" data-route>Connect one</a>, or decline.</p><button type="button" data-action="access-decline" data-id="${escape(r.id)}">Decline</button>`}</div>`;
    };
    const grants = access.grants.map(g => `<li><strong>${escape(g.connectionLabel)}</strong> <span class="mk-caption">${escape(g.objects.join(', '))} · ${g.status === 'active' ? `until ${escape(this.when(g.expiresAt))}` : escape(g.status)} · ${g.reads} read${g.reads === 1 ? '' : 's'}, ${g.rowsRead} rows</span>
      ${g.status === 'active' && canGrant ? `<button type="button" class="mk-link-button mk-danger" data-action="access-revoke" data-id="${escape(g.id)}" data-version="${g.version}">Revoke</button>` : ''}</li>`).join('');
    return `<section class="mk-section" aria-labelledby="mk-access-title"><h2 id="mk-access-title">Access to your systems</h2>
      ${pending.map(requestCard).join('')}
      ${grants ? `<ul class="mk-member-list">${grants}</ul>` : ''}
      <p class="mk-caption">Read-only. Relay reads on the agent’s behalf and logs every read; the agent never receives your credentials.</p></section>`;
  },
};
