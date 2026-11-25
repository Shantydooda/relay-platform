'use strict';

// Settings → Integrations: one page for every account, personal or organization,
// laid out like Hugging Face's settings (left menu, a plain list, one row per
// integration with its status and one action; setup opens from its row).
// It brings together the systems agents read during work (connections.cjs, via
// the vault), Google Drive files for requests, and Attio delivery of results.
// Server rules don't change here: the workspace owner manages, members read.
const RelayIntegrations = {
  ENV: { sandbox: 'Sandbox', production: 'Production' },
  ABOUT: {
    'sample-erp': 'Made-up ERP records for trying access requests locally.',
    github: 'Repositories, issues, pull requests and single files.',
    hubspot: 'Contacts, companies and deals.',
    attio: 'Company and people records.',
    netsuite: 'Vendors, customers, items, orders and ledger exports, read inside your network.',
    'sap-s4hana': 'Business partners, materials, orders and ledger exports, read inside your network.',
    'dynamics-365': 'Vendors, customers, items, orders and ledger exports, read inside your network.',
    'erp-exports': 'CSV exports from any ERP or database, read inside your network.',
  },

  // ---- Routes ------------------------------------------------------------
  // /settings/integrations is your own workspace; /settings/integrations/<id> an organization's.
  parse(pathname) {
    const match = /^\/settings\/integrations(?:\/([0-9a-f-]{36}))?\/?$/.exec(pathname);
    return match ? { page: 'integrations', id: match[1] || null } : null;
  },
  apply(route, target = state) {
    if (route?.page !== 'integrations') return false;
    target.buyerTab = 'integrations'; target.detail = null; target.agentPageId = null;
    if (target.integrationsTenant !== route.id) target.integrationOpen = null;
    target.integrationsTenant = route.id;
    return true;
  },
  personal(target = state) {
    const memberships = target.account?.memberships || [];
    return memberships.find(m => !m.company && m.role === 'owner') || memberships.find(m => !m.company) || null;
  },
  workspace(target = state) {
    const memberships = target.account?.memberships || [];
    return (target.integrationsTenant && memberships.find(m => m.id === target.integrationsTenant)) || this.personal(target);
  },
  tenant(target = state) { return this.workspace(target)?.id || null; },
  path(current = state) {
    if (current.buyerTab !== 'integrations') return null;
    const w = this.workspace(current);
    return w && w.company ? `/settings/integrations/${w.id}` : '/settings/integrations';
  },
  // Where to send someone who needs to connect a system for a workspace.
  href(tenantId, target = state) {
    const m = (target.account?.memberships || []).find(item => item.id === tenantId);
    return m?.company ? `/settings/integrations/${tenantId}` : '/settings/integrations';
  },

  // ---- Data --------------------------------------------------------------
  async load(target = state) {
    if (target.buyerTab !== 'integrations') return;
    const w = this.workspace(target);
    if (!w) { target.integrations = null; return; }
    const id = encodeURIComponent(w.id), owner = w.role === 'owner';
    const quiet = async (path, on) => {
      if (!on) return null;
      try { return await api(path); } catch (error) { if (error.status >= 500 || error.status === 403) return null; throw error; }
    };
    const [connections, drive, attio] = await Promise.all([
      quiet(`/api/connections?tenantId=${id}`, true),
      quiet(`/api/drive/status?tenantId=${id}`, owner && target.features?.driveConnections),
      quiet(`/api/attio/status?tenantId=${id}`, owner && target.features?.attioDelivery),
    ]);
    target.integrations = { tenantId: w.id, owner, connections, drive, attio };
  },

  // ---- What the list shows ------------------------------------------------
  items() {
    const data = state.integrations || {}, catalog = data.connections?.catalog || [], connected = data.connections?.connections || [];
    const items = [];
    for (const p of catalog.filter(item => item.available)) {
      const mine = connected.filter(c => c.provider === p.kind);
      if (p.connector) {
        const live = mine.filter(c => c.connector?.online).length;
        items.push({ key: p.kind, group: 'erp', name: p.label, about: this.ABOUT[p.kind] || 'Exports read inside your network.',
          status: !mine.length ? 'Not connected' : live ? `Connector online · ${live}` : mine.some(c => c.connector?.lastSeenAt) ? 'Connector offline' : 'Waiting for connector',
          tone: live ? 'live' : mine.length ? 'ready' : '',
          action: !data.connections?.canManage ? 'Details' : mine.length ? 'Manage' : 'Set up', panel: () => this.connectorPanel(p, mine) });
        continue;
      }
      items.push({ key: p.kind, group: 'read', name: p.label, about: this.ABOUT[p.kind] || `Read-only access to ${p.objects.join(', ')}.`,
        status: mine.length ? `Connected · ${mine.length}` : 'Not connected', tone: mine.length ? 'live' : '',
        action: !data.connections?.canManage ? 'Details' : mine.length ? 'Manage' : 'Connect',
        panel: () => this.connectionPanel(p, mine) });
    }
    if (state.features?.driveConnections) {
      const d = data.drive;
      items.push({ key: 'drive', group: 'files', name: 'Google Drive', about: 'Pick single Docs, text, CSV or JSON files to use in a request.',
        status: !data.owner ? 'Owner managed' : d?.connected ? 'Connected' : d?.configured ? 'Ready to connect' : 'Setup required', tone: d?.connected ? 'live' : d?.configured ? 'ready' : '',
        action: !data.owner || !d?.configured ? 'Details' : d.connected ? 'Manage' : 'Connect', panel: () => this.drivePanel(d) });
    }
    if (state.features?.attioDelivery) {
      const a = data.attio;
      items.push({ key: 'attio-delivery', group: 'send', name: 'Attio delivery', about: 'Send an accepted company CSV to Attio after you review its rows.',
        status: !data.owner ? 'Owner managed' : a?.connected ? 'Connected' : a?.configured ? 'Ready to connect' : 'Setup required', tone: a?.connected ? 'live' : a?.configured ? 'ready' : '',
        action: !data.owner || !a?.configured ? 'Details' : a.connected ? 'Manage' : 'Connect', panel: () => this.attioPanel(a) });
    }
    for (const p of catalog.filter(item => !item.available))
      items.push({ key: p.kind, group: 'planned', name: p.label, about: p.note, status: 'Coming next', planned: true });
    return items;
  },
  GROUPS: [
    ['erp', 'ERP systems, through the Relay Connector', 'The Relay Connector runs inside your network and keeps your ERP login there. It reads only the export files you point it at, and only when you grant an agent access. Relay never holds your ERP credentials.'],
    ['read', 'Agents read during work', 'An agent asks for read access while it works; you choose a system and how long. Relay reads for it and logs every read. Agents never see your credentials.'],
    ['files', 'Files for your requests', 'Files you choose to share with a request. Nothing else in the account is shared.'],
    ['send', 'Send results', 'Where accepted results can go, after you review them.'],
    ['planned', 'Coming next', 'Each ships after a test account and an independent security review. Until then, attach exports to the request.'],
  ],

  // ---- Page --------------------------------------------------------------
  page() {
    const w = this.workspace(), data = state.integrations;
    const memberships = state.account?.memberships || [];
    const nav = [this.personal(), ...memberships.filter(m => m.company)].filter(Boolean).map(m => {
      const href = m.company ? `/settings/integrations/${m.id}` : '/settings/integrations', active = w?.id === m.id;
      return `<a href="${href}" data-route ${active ? 'class="active" aria-current="page"' : ''}>${escape(m.company ? m.name : 'Your account')}</a>`;
    }).join('');
    const name = state.account?.user?.name || '';
    const items = data ? this.items() : [];
    const manage = data?.connections?.canManage ?? data?.owner;
    const body = !data ? '<p class="mk-caption">Loading integrations…</p>'
      : !items.length ? '<div class="mk-empty"><h2>No integrations are available on this server yet</h2><p>Attach files to a request instead. Connectors are switched on per server.</p></div>'
      : this.GROUPS.map(([id, title, note]) => {
        const rows = items.filter(item => item.group === id);
        return rows.length ? `<section class="mk-section mk-build-section"><div class="mk-build-section-head"><h2>${escape(title)} <span class="mk-total">${rows.length}</span></h2></div>
          <p class="mk-caption">${escape(note)}</p><ul class="mk-integrations">${rows.map(item => this.row(item)).join('')}</ul></section>` : '';
      }).join('');
    const who = w?.company ? `${escape(w.name)}’s integrations. ${manage ? 'As an owner you connect and disconnect them.' : 'Owners of this workspace connect systems; you can see what is connected.'}`
      : 'Systems connected to your own account. They’re used only for your requests, and only when you allow it.';
    return `<div class="mk-build mk-settings"><nav class="mk-build-nav" aria-label="Settings">
        <p class="mk-build-who"><span class="mk-org-avatar mk-org-avatar-sm" aria-hidden="true">${escape(name.slice(0, 1).toUpperCase())}</span><span class="mk-handle">Settings</span></p>
        <span class="mk-menu-label">Integrations</span>${nav}</nav>
      <section class="mk-build-main"><header class="mk-results-head mk-build-head"><div><h1>Integrations</h1><p class="mk-caption">${who}</p></div></header>
        ${body}<p class="mk-caption mk-integrations-foot">Access is read-only. Changes come back as files you review and load yourself.</p></section></div>`;
  },
  row(item) {
    const open = state.integrationOpen === item.key && !item.planned;
    const initial = escape(item.name.slice(0, 1));
    return `<li class="mk-integration${item.planned ? ' mk-integration-planned' : ''}" data-integration="${escape(item.key)}">
      <div class="mk-integration-row"><span class="mk-integration-logo" aria-hidden="true">${initial}</span>
        <span class="mk-integration-name"><strong>${escape(item.name)}</strong><span class="mk-caption">${escape(item.about)}</span></span>
        <span class="mk-status${item.tone ? ' mk-status-' + item.tone : ''}">${escape(item.status)}</span>
        ${item.planned ? '' : `<button type="button" class="mk-chip" data-action="integration-open" data-kind="${escape(item.key)}" aria-expanded="${open}">${open ? 'Close' : escape(item.action)}</button>`}</div>
      ${open ? `<div class="mk-integration-panel">${item.panel()}</div>` : ''}</li>`;
  },

  // ---- Panels ------------------------------------------------------------
  connectionPanel(p, mine) {
    const manage = state.integrations?.connections?.canManage;
    const list = mine.length ? `<ul class="mk-member-list">${mine.map(c => `<li><span class="mk-connection-name"><strong>${escape(c.label)}</strong>
        <span class="mk-caption">${escape(this.ENV[c.environment] || c.environment)} · account ${escape(c.account || '—')} · ${escape(c.objects.join(', '))}</span></span>
        <span class="mk-tag">${c.activeGrants ? `${c.activeGrants} active grant${c.activeGrants === 1 ? '' : 's'}` : 'No active grants'}</span>
        ${manage ? (state.disconnecting === c.id
          ? `<span class="mk-inline-confirm" role="alert">Disconnect? Every grant on it stops at once. <button type="button" class="mk-link-button mk-danger" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button> <button type="button" class="mk-link-button" data-action="connection-disconnect-cancel">Keep</button></span>`
          : `<button type="button" class="mk-link-button" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button>`) : ''}</li>`).join('')}</ul>` : '';
    if (!manage) return `${list || '<p class="mk-caption">Nothing connected yet.</p>'}<p class="mk-caption">Owners of this workspace connect systems.</p>`;
    const form = `<form id="connection-create" class="mk-form"><input type="hidden" name="provider" value="${escape(p.kind)}">
      ${mine.length ? '' : `<h3>Connect ${escape(p.label)}</h3>`}
      <p class="mk-caption">${escape(p.help || 'Start with a sandbox. Use a dedicated integration user with read-only permissions, never an administrator login.')}</p>
      ${p.environments.length > 1 ? `<label for="connection-environment">Environment</label><select id="connection-environment" name="environment">${p.environments.map(e => `<option value="${escape(e)}">${escape(this.ENV[e] || e)}</option>`).join('')}</select>`
        : `<input type="hidden" name="environment" value="${escape(p.environments[0])}">`}
      <label for="connection-label">Name</label><input id="connection-label" name="label" maxlength="80" required placeholder="e.g. ${escape(p.label)} ${p.environments.includes('sandbox') ? 'sandbox' : 'read-only'}">
      ${p.credentialFields.map(f => `<label for="connection-${escape(f.name)}">${escape(f.label)}</label><input id="connection-${escape(f.name)}" name="cred-${escape(f.name)}" ${f.secret ? 'type="password" autocomplete="off"' : 'autocomplete="off"'} required>`).join('')}
      <p class="mk-caption">Relay checks these with ${escape(p.label)}, then stores them encrypted. You won’t see them again.</p>
      <div class="form-error" role="alert"></div><div class="mk-form-actions"><button class="mk-primary" type="submit">Connect</button></div></form>`;
    // Once something is connected, adding another is one click away rather than always open.
    return mine.length ? `${list}<details class="mk-integration-more"><summary>Connect another ${escape(p.label)}</summary>${form}</details>` : form;
  },
  // The Relay Connector: setting one up issues a key, shown once, and the steps
  // to run the connector next to the exports.
  ago(time) {
    const s = Math.max(0, Math.round((Date.now() - time) / 1000));
    return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
  },
  connectorStatus(c) {
    const k = c.connector || {};
    if (k.online) return `Online · checked in ${this.ago(k.lastSeenAt)}${c.objects.length ? ` · serves ${c.objects.join(', ')}` : ''}${k.version ? ` · v${k.version}` : ''}`;
    if (k.lastSeenAt) return `Offline · last checked in ${this.ago(k.lastSeenAt)}. Agents can’t read until it’s running again.`;
    return 'Waiting for the connector to check in. Nothing can be granted until it says which exports it serves.';
  },
  connectorSetup(p) {
    const setup = state.connectorSetup;
    if (!setup || setup.kind !== p.kind) return '';
    const settings = JSON.stringify({ relay: location.origin, keyFile: 'relay-connector.key', root: './exports', objects: { vendor: 'vendors.csv', customer: 'customers.csv' } }, null, 2);
    return `<div class="mk-connector-setup" role="status"><h3>Set up “${escape(setup.label)}”</h3>
      <p class="mk-caption"><strong>Copy this key now.</strong> It’s shown once. Anyone with it can answer reads for this connection, so keep it like a password.</p>
      <div class="mk-connector-key"><input id="connector-key" readonly value="${escape(setup.key)}" aria-label="Connector key" spellcheck="false">
        <button type="button" class="mk-chip" data-action="connector-copy">Copy</button></div>
      <ol class="mk-connector-steps">
        <li>On a machine in your network that can read your exports, save the key to <code>relay-connector.key</code>, readable only by you (<code>chmod 600</code>).</li>
        <li>Put your CSV exports in one folder, and name which file serves each object in <code>relay-connector.json</code>:<pre>${escape(settings)}</pre>
          <span class="mk-caption">Objects: vendor, customer, item, account, purchase-order, sales-order, invoice, bill, journal-entry.</span></li>
        <li>Check the settings, then start it: <pre>relay-connector --config relay-connector.json --check
relay-connector --config relay-connector.json</pre><span class="mk-caption">Or with Docker, mounting the exports read-only (see the connector’s README).</span></li>
      </ol>
      <p class="mk-caption">It only calls out to Relay, so no firewall change is needed. It keeps its own log of every read, without the data.</p>
      <div class="mk-form-actions"><button type="button" class="mk-primary" data-action="connector-saved">I’ve saved the key</button></div></div>`;
  },
  connectorPanel(p, mine) {
    const manage = state.integrations?.connections?.canManage;
    const list = mine.length ? `<ul class="mk-member-list">${mine.map(c => `<li><span class="mk-connection-name"><strong>${escape(c.label)}</strong>
        <span class="mk-caption">${escape(this.ENV[c.environment] || c.environment)} · ${escape(this.connectorStatus(c))}</span></span>
        <span class="mk-tag">${c.activeGrants ? `${c.activeGrants} active grant${c.activeGrants === 1 ? '' : 's'}` : 'No active grants'}</span>
        ${manage ? (state.disconnecting === c.id
          ? `<span class="mk-inline-confirm" role="alert">Disconnect? The key stops working and every grant on it stops at once. <button type="button" class="mk-link-button mk-danger" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button> <button type="button" class="mk-link-button" data-action="connection-disconnect-cancel">Keep</button></span>`
          : `<button type="button" class="mk-link-button" data-action="connection-disconnect" data-id="${escape(c.id)}" data-version="${c.version}">Disconnect</button>`) : ''}</li>`).join('')}</ul>` : '';
    if (!manage) return `${list || '<p class="mk-caption">Nothing connected yet.</p>'}<p class="mk-caption">Owners of this workspace set up the Relay Connector.</p>`;
    const form = `<form id="connection-create" class="mk-form"><input type="hidden" name="provider" value="${escape(p.kind)}">
      ${mine.length ? '' : `<h3>Set up ${escape(p.label)} through the Relay Connector</h3>`}
      <p class="mk-caption">Your ${escape(p.label)} login stays in your network. Relay gives you a connector key, and the connector reads the exports you choose. Start with a sandbox.</p>
      <label for="connection-environment">Environment</label><select id="connection-environment" name="environment">${p.environments.map(e => `<option value="${escape(e)}">${escape(this.ENV[e] || e)}</option>`).join('')}</select>
      <label for="connection-label">Name</label><input id="connection-label" name="label" maxlength="80" required placeholder="e.g. ${escape(p.label)} sandbox exports">
      <div class="form-error" role="alert"></div><div class="mk-form-actions"><button class="mk-primary" type="submit">Create connector key</button></div></form>`;
    const setup = this.connectorSetup(p);
    return `${setup}${list}${setup ? '' : mine.length ? `<details class="mk-integration-more"><summary>Set up another ${escape(p.label)} connector</summary>${form}</details>` : form}`;
  },
  drivePanel(d) {
    if (!state.integrations?.owner) return '<p class="mk-caption">The workspace owner connects Google Drive.</p>';
    if (!d?.configured) return '<p class="mk-caption">Google sign-in isn’t set up on this server yet, so no Google account can be connected. No Google data is read.</p>';
    return d.connected
      ? `<p class="mk-caption">Choose files one at a time. Relay reads only the files you pick, and an agent still needs your permission on each request.</p>
        <div class="mk-form-actions"><button type="button" class="mk-primary" data-action="integration-drive" data-operation="pick">Choose a Drive file</button>
        <button type="button" class="mk-link-button mk-danger" data-action="integration-drive" data-operation="disconnect">Disconnect Google Drive</button></div>
        <p class="mk-caption">Disconnecting stops imports and live reads. Saved copies stay in Relay until you remove them.</p>`
      : `<p class="mk-caption">You’ll sign in with Google and allow access to files you pick. Relay never gives a builder your Google credentials.</p>
        <div class="mk-form-actions"><button type="button" class="mk-primary" data-action="integration-drive" data-operation="connect">Connect Google Drive</button></div>`;
  },
  attioPanel(a) {
    if (!state.integrations?.owner) return '<p class="mk-caption">The workspace owner sets up Attio delivery.</p>';
    if (!a?.configured) return '<p class="mk-caption">Attio delivery needs a private Attio integration configured on the server first. Relay never asks for Attio credentials here.</p>';
    return `<p class="mk-caption">Destination: <strong>${escape(a.destination || 'Attio')}</strong>. Up to 50 companies per send, matched by domain. People, deals and custom fields aren’t supported yet.</p>
      <div class="mk-form-actions"><button type="button" class="${a.connected ? 'mk-link-button mk-danger' : 'mk-primary'}" data-action="integration-attio" data-operation="${a.connected ? 'disconnect' : 'connect'}">${a.connected ? 'Disconnect Attio' : 'Turn on Attio delivery'}</button></div>
      ${a.connected ? '<p class="mk-caption">Disconnecting stops future sends. Companies already delivered stay in Attio.</p>' : ''}`;
  },

  // ---- Actions -----------------------------------------------------------
  // Only a real Google sign-in page may receive the browser; anything else is refused.
  googleAuthUrl(value) {
    try {
      const url = new URL(String(value));
      return url.protocol === 'https:' && url.hostname === 'accounts.google.com' && !url.username && !url.password ? url.href : null;
    } catch { return null; }
  },
  async click(button) {
    const action = button.dataset.action, data = state.integrations;
    if (action === 'integration-open') {
      state.integrationOpen = state.integrationOpen === button.dataset.kind ? null : button.dataset.kind;
      state.disconnecting = null; render(); return true;
    }
    if (action === 'connector-copy') {
      const input = document.getElementById('connector-key');
      try { await navigator.clipboard.writeText(input.value); notice.textContent = 'Key copied.'; }
      catch { input.select(); notice.textContent = 'Select the key and copy it.'; }
      return true;
    }
    if (action === 'connector-saved') { state.connectorSetup = null; render(); return true; }
    if (action === 'integration-drive') {
      const op = button.dataset.operation;
      if (op === 'connect' || op === 'pick') {
        try { sessionStorage.setItem('relay-drive-tenant', data.tenantId); } catch { /* blocked storage: continue without the remembered tenant */ }
        if (op === 'pick') { location.assign('/drive/picker'); return true; }
        const result = await api('/api/drive/begin', { method: 'POST', body: { tenantId: data.tenantId } });
        const target = RelayIntegrations.googleAuthUrl(result && result.url);
        if (!target) throw new Error('Google Drive returned an unexpected sign-in address. Try again.');
        location.assign(target); return true;
      }
      const result = await api('/api/drive/disconnect', { method: 'POST', body: { tenantId: data.tenantId, expectedVersion: data.drive.version } });
      notice.textContent = result.providerRevoked ? 'Google Drive disconnected.' : 'Disconnected from Relay. Remove Relay in your Google account permissions to finish revoking Google access.';
      await refresh(); render(); return true;
    }
    if (action === 'integration-attio') {
      await api('/api/attio/control', { method: 'POST', body: { tenantId: data.tenantId, action: button.dataset.operation } });
      notice.textContent = button.dataset.operation === 'connect' ? 'Attio delivery is on.' : 'Attio delivery is off.';
      await refresh(); render(); return true;
    }
    return false;
  },
};
