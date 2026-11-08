'use strict';
const RelayApps = {
  data() {
    return (
      state.workspaceApps || {
        sources: [],
        apps: [],
        grants: [],
        runs: [],
        audit: [],
        hosting: { entitlement: { plan: 'free', status: 'none', canHost: false, includedHosts: 0 }, hosts: [] },
      }
    );
  },
  owner() {
    return (
      state.account?.memberships.find((m) => m.id === state.tenantId)?.role ===
      'owner'
    );
  },
  driveCard() {
    if (!this.owner() || !state.features?.driveConnections) return '';
    const drive = state.drive || {};
    return `<section class="panel"><span class="tag">Google Drive · ${drive.connected ? 'Connected' : 'Not connected'}</span><h2>Your documents, with your task.</h2><p>Choose individual Google Docs, text, CSV or JSON files (up to 16 KB). Choose a saved snapshot or explicitly allow latest-file reads for authorized work. Agents still need task-specific read permission.</p>${drive.configured ? `<div class="app-actions"><button class="primary" data-action="app-drive-${drive.connected ? 'pick' : 'connect'}">${drive.connected ? 'Choose a Drive file' : 'Connect Google Drive'}</button>${drive.connected ? '<button data-action="app-drive-disconnect">Disconnect Google Drive</button></div><p>Disconnecting stops imports and live reads. Saved snapshots remain in Relay; disconnect those sources below to stop agent access.</p>' : '</div><p>Google’s selected-file permission allows managing chosen files. Relay implements reads only and never gives a builder your Google credentials.</p>'}` : '<p>Google OAuth setup is required. No Google account is connected and no external data is accessed.</p>'}</section>`;
  },
  sources() {
    return this.data()
      .sources.filter((source) => source.status === 'active')
      .map(
        (source) =>
          `<option value="${escape(source.id)}">${escape(source.name)} · v${source.version}</option>`,
      )
      .join('');
  },
  contextPicker(task) {
    if (!state.features?.workspaceApps) return '';
    const refs = task.contextReferences || [];
    const sources = this.data().sources.filter(
      (source) => source.status === 'active',
    );
    const editable = task.status === 'draft' && this.owner();
    const suggested = sources.filter((source) =>
      task.brief.toLowerCase().includes(source.name.toLowerCase()),
    );
    return `<section class="panel task-context"><h3>Supporting context</h3>
      <p>${refs.length ? refs.map((ref) => `<span class="tag">@${escape(ref.name)} · ${ref.provenance?.mode === 'live-file' && ref.mode === 'latest' ? 'Latest from Drive' : ref.provenance?.provider === 'google-drive' ? 'Drive snapshot' : ref.mode === 'snapshot' ? 'saved v' + ref.version : 'latest each use'}</span>`).join(' ') : 'No sources selected. Connected tools are not automatically shared.'}</p>
      ${
        editable
          ? `<details data-context-picker><summary>Add context · @</summary><p>Select a source explicitly. This identifies context; your agent still needs read permission.</p>
      ${suggested.length ? `<p>Possible matches in your brief: ${suggested.map((source) => escape(source.name)).join(', ')}. Choose the intended source below.</p>` : ''}
      ${sources.length ? `<form id="task-context" class="market-form"><label>Find a document or data source<input type="search" data-context-search placeholder="Type a source name"></label><label>Source<select name="sourceId" required>${sources.map((source) => `<option value="${escape(source.id)}">${escape(source.name)}${source.provenance?.mode === 'live-file' ? ' · Latest from Drive' : source.provenance ? ' · Drive snapshot' : ''}</option>`).join('')}</select></label><label>Data version<select name="mode"><option value="latest">Latest available data each use</option><option value="snapshot">Save this version</option></select></label><button name="operation" value="add">Attach source</button><button name="operation" value="remove">Remove selected source</button><div class="form-error" role="alert"></div></form>` : '<p>Add a local source or import a Drive snapshot in Connected tools first.</p><button data-action="buyer-nav" data-tab="tools">Connected tools</button>'}</details>`
          : ''
      }
      ${task.contextReads?.length ? `<details><summary>Sources read by your agent</summary>${task.contextReads.map((read) => `<p>${escape(read.name)} · Relay version ${read.version} · ${escape(date(read.readAt))}<br><small>${escape(read.mode === 'live-file' ? 'Checked against Drive before use' : 'Saved source version')}</small></p>`).join('')}</details>` : ''}
      ${(task.permissionRequests || [])
        .map((request) => {
          const ref = refs.find((item) => item.sourceId === request.sourceId);
          return `<article class="permission-request"><h3>Agent requests read access</h3><p><strong>${escape(ref?.name || 'Selected source')}</strong> · ${escape(request.status)}</p><p>${escape(request.reason)}</p>
          ${['pending', 'declined'].includes(request.status) && this.owner() && ['queued', 'running'].includes(task.status) ? `<form id="permission-${escape(request.id)}" data-permission-request="${escape(request.id)}" class="market-form"><input type="hidden" name="sourceId" value="${escape(request.sourceId)}"><p>Work waits for your approval; you can also cancel the task. Read only, this assignment, up to 24 hours. Revocable in Connected tools. No write or send permission.</p><button name="decision" value="approve">Allow read access</button>${request.status === 'pending' ? '<button name="decision" value="decline">Decline</button>' : ''}<div class="form-error" role="alert"></div></form>` : ''}</article>`;
        })
        .join('')}
      </section>`;
  },
  taskControls(task) {
    if (!state.features?.workspaceApps || !this.owner()) return '';
    const accepted = task.status === 'accepted';
    const active = ['queued', 'running'].includes(task.status);
    if (
      active &&
      task.permissionRequests?.some((request) =>
        ['pending', 'declined'].includes(request.status),
      )
    )
      return '';
    const offer = state.offers?.find((item) => item.selected);
    const hasPackage = (
      state.detail?.task?.id === task.id
        ? state.detail.submissions
        : task.submissions
    )
      ?.at(-1)
      ?.files?.some((file) => file.filename === 'relay-app.json');
    if (
      accepted &&
      offer &&
      !hasPackage &&
      !['csv-normalize-v1', 'link-inventory-v1'].includes(
        offer.qualificationEvidence?.rubric,
      )
    )
      return '';
    if (!accepted && !active) return '';
    const installed = this.data().apps.find(
      (app) => app.sourceTaskId === task.id,
    );
    if (installed)
      return '<p><button data-action="buyer-nav" data-tab="apps">Open installed automation</button></p>';
    const grants = this.data().grants.filter(
      (grant) => grant.subjectId === task.id,
    );
    return `<details class="app-task-controls"><summary>${accepted ? 'Install a reusable app' : 'Agent tool permissions'}</summary>
      <p>${accepted ? (hasPackage ? 'Install the data app from this accepted delivery. Relay checks the package before installation. Choose the one source it may read; results stay in Relay for your review. Scheduling is off.' : 'Install this supported CSV or link tool. Choose a source it may read. Results stay in Relay for review; scheduling is off.') : 'Allow the assigned agent to read one selected local source while its execution lease is active. It cannot write or access other tools.'}</p>
      ${this.sources() ? `<form id="${accepted ? 'app-install' : 'task-tool-grant'}" class="market-form"><label>Data source<select name="sourceId" required>${this.sources()}</select></label><label>Access duration<select name="expiresDays"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label><label class="app-consent"><input type="checkbox" name="consent" required> Allow read access to this source. No writing or sending.</label><button class="primary">${accepted ? 'Install app' : 'Grant read access'}</button><div class="form-error" role="alert"></div></form>` : '<p>Add a local data source in Connected tools first. Your delivery stays here.</p><button data-action="buyer-nav" data-tab="tools">Connected tools</button>'}
      ${grants.map((grant) => this.grant(grant)).join('')}</details>`;
  },
  grant(grant) {
    const source = this.data().sources.find(
      (item) => item.id === grant.sourceId,
    );
    const expired = grant.expiresAt <= Date.now();
    return `<div class="app-permission"><p><strong>Read ${escape(source?.name || 'local source')}</strong> · ${escape(expired && grant.status === 'active' ? 'expired' : grant.status)}<br><small>Until ${escape(date(grant.expiresAt))} · ${grant.subjectKind === 'task' ? 'This agent assignment only' : 'This installed automation only'}</small></p>${grant.status === 'active' && this.owner() ? `<button data-action="app-revoke" data-id="${escape(grant.id)}">Revoke access</button>` : ''}</div>`;
  },
  toolIcon(id) {
    if (id === 'attio') return '<img src="/assets/attio.ico" width="24" height="24" alt="" aria-hidden="true">';
    // Brand marks: Simple Icons v11.15.0 (CC0); bundled locally, no external image requests.
    const marks = {
      drive: "<path d=\"M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z\"/>",
      notion: "<path d=\"M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z\"/>",
      slack: "<path d=\"M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z\"/>",
      teams: "<path d=\"M20.625 8.127q-.55 0-1.025-.205-.475-.205-.832-.563-.358-.357-.563-.832Q18 6.053 18 5.502q0-.54.205-1.02t.563-.837q.357-.358.832-.563.474-.205 1.025-.205.54 0 1.02.205t.837.563q.358.357.563.837.205.48.205 1.02 0 .55-.205 1.025-.205.475-.563.832-.357.358-.837.563-.48.205-1.02.205zm0-3.75q-.469 0-.797.328-.328.328-.328.797 0 .469.328.797.328.328.797.328.469 0 .797-.328.328-.328.328-.797 0-.469-.328-.797-.328-.328-.797-.328zM24 10.002v5.578q0 .774-.293 1.46-.293.685-.803 1.194-.51.51-1.195.803-.686.293-1.459.293-.445 0-.908-.105-.463-.106-.85-.329-.293.95-.855 1.729-.563.78-1.319 1.336-.756.557-1.67.861-.914.305-1.898.305-1.148 0-2.162-.398-1.014-.399-1.805-1.102-.79-.703-1.312-1.664t-.674-2.086h-5.8q-.411 0-.704-.293T0 16.881V6.873q0-.41.293-.703t.703-.293h8.59q-.34-.715-.34-1.5 0-.727.275-1.365.276-.639.75-1.114.475-.474 1.114-.75.638-.275 1.365-.275t1.365.275q.639.276 1.114.75.474.475.75 1.114.275.638.275 1.365t-.275 1.365q-.276.639-.75 1.113-.475.475-1.114.75-.638.276-1.365.276-.188 0-.375-.024-.188-.023-.375-.058v1.078h10.875q.469 0 .797.328.328.328.328.797zM12.75 2.373q-.41 0-.78.158-.368.158-.638.434-.27.275-.428.639-.158.363-.158.773 0 .41.158.78.159.368.428.638.27.27.639.428.369.158.779.158.41 0 .773-.158.364-.159.64-.428.274-.27.433-.639.158-.369.158-.779 0-.41-.158-.773-.159-.364-.434-.64-.275-.275-.639-.433-.363-.158-.773-.158zM6.937 9.814h2.25V7.94H2.814v1.875h2.25v6h1.875zm10.313 7.313v-6.75H12v6.504q0 .41-.293.703t-.703.293H8.309q.152.809.556 1.5.405.691.985 1.19.58.497 1.318.779.738.281 1.582.281.926 0 1.746-.352.82-.351 1.436-.966.615-.616.966-1.43.352-.815.352-1.752zm5.25-1.547v-5.203h-3.75v6.855q.305.305.691.452.387.146.809.146.469 0 .879-.176.41-.175.715-.48.304-.305.48-.715t.176-.879Z\"/>",
      gmail: "<path d=\"M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z\"/>",
      hubspot: "<path d=\"M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z\"/>",
      salesforce: "<path d=\"M10.006 5.415a4.195 4.195 0 013.045-1.306c1.56 0 2.954.9 3.69 2.205.63-.3 1.35-.45 2.1-.45 2.85 0 5.159 2.34 5.159 5.22s-2.31 5.22-5.176 5.22c-.345 0-.69-.044-1.02-.104a3.75 3.75 0 01-3.3 1.95c-.6 0-1.155-.15-1.65-.375A4.314 4.314 0 018.88 20.4a4.302 4.302 0 01-4.05-2.82c-.27.062-.54.076-.825.076-2.204 0-4.005-1.8-4.005-4.05 0-1.5.811-2.805 2.01-3.51-.255-.57-.39-1.2-.39-1.846 0-2.58 2.1-4.65 4.65-4.65 1.53 0 2.85.705 3.72 1.8\"/>",
      github: "<path d=\"M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12\"/>",
      local: '<path d="M6 20V7h5v2c1-2 3-3 7-3v5c-4 0-7 1-7 5v4Z"/>'
    };
    return `<svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24" aria-hidden="true" focusable="false">${marks[id] || marks.local}</svg>`;
  },
  toolLibrary() {
    const tools = [
      [
        'local',
        'Relay sources',
        'Files & knowledge',
        'Bring text, CSV or JSON into your conversations.',
      ],
      [
        'drive',
        'Google Drive',
        'Files & knowledge',
        'Use selected documents and data files as context.',
      ],
      [
        'notion',
        'Notion',
        'Files & knowledge',
        'Company knowledge, project notes and documents.',
      ],
      [
        'slack',
        'Slack',
        'Communication',
        'Team conversations and delivery notifications.',
      ],
      [
        'teams',
        'Microsoft Teams',
        'Communication',
        'Shared conversations and team updates.',
      ],
      [
        'gmail',
        'Gmail',
        'Communication',
        'Email context and reviewed drafts.',
      ],
      [
        'hubspot',
        'HubSpot',
        'Sales & CRM',
        'Contacts, companies and pipeline context.',
      ],
      [
        'attio',
        'Attio',
        'Sales & CRM',
        'Send reviewed company CSV deliveries to your CRM.',
      ],
      [
        'salesforce',
        'Salesforce',
        'Sales & CRM',
        'Customer records and sales workflows.',
      ],
      [
        'github',
        'GitHub',
        'Development',
        'Repository context, issues and delivery handoffs.',
      ],
    ];
    return `<section class="tool-library" aria-label="Tool library">
      <div class="tool-library-toolbar"><label>Find a tool<input type="search" data-tool-search placeholder="Search tools or categories…"></label><label>Category<select data-tool-category><option>All categories</option>${['Files & knowledge', 'Communication', 'Sales & CRM', 'Development'].map((category) => `<option>${escape(category)}</option>`).join('')}</select></label></div>
      <div class="tool-library-grid">${tools
        .map(([id, name, category, description]) => {
          const available =
            id === 'local' || (id === 'attio' && state.features?.attioDelivery && this.owner()) ||
            (id === 'drive' &&
              state.features?.driveConnections &&
              this.owner());
          const status = id === 'attio' && available ? (state.attio?.connected ? 'Connected' : state.attio?.configured ? 'Ready to connect' : 'Setup required') :
            id === 'drive' && state.features?.driveConnections && !this.owner()
              ? 'Administrator managed'
              : id === 'local'
                ? 'Available now'
                : id === 'drive' && available
                  ? state.drive?.connected
                    ? 'Connected'
                    : state.drive?.configured
                      ? 'Ready to connect'
                      : 'Setup required'
                  : 'Not available yet';
          return `<article class="tool-library-card" data-tool-card data-search="${escape(`${name} ${category} ${description}`.toLowerCase())}" data-category="${escape(category)}"><div class="tool-card-top"><span class="tool-monogram tool-${id}" aria-hidden="true">${this.toolIcon(id)}</span><span class="tool-availability">${status}</span></div><h2>${name}</h2><p>${description}</p><small>${escape(category)}</small>${available ? `<button data-action="${id === 'drive' && state.drive?.configured && !state.drive?.connected ? 'app-drive-connect' : 'app-tool-open'}" data-tool="${id}">${id === 'attio' ? 'View connection' : id === 'local' ? (this.owner() ? 'Add a source' : 'View sources') : state.drive?.configured && !state.drive?.connected ? 'Connect' : 'View connection'}</button>` : `<span class="tool-coming">${id === 'drive' && state.features?.driveConnections ? 'Ask your administrator to manage this connection' : 'Connector not built yet'}</span>`}</article>`;
        })
        .join(
          '',
        )}</div><p data-tool-empty hidden role="status">No tools match. Try another name or category.</p>
      <p class="hint">Connecting a tool does not give every agent access. You choose the sources and approve access for each task.</p>
    </section>`;
  },
  filterTools(root) {
    const query =
      root.querySelector('[data-tool-search]')?.value.trim().toLowerCase() ||
      '';
    const category =
      root.querySelector('[data-tool-category]')?.value || 'All categories';
    let visible = 0;
    for (const card of root.querySelectorAll('[data-tool-card]')) {
      card.hidden =
        !card.dataset.search.includes(query) ||
        (category !== 'All categories' && card.dataset.category !== category);
      if (!card.hidden) visible++;
    }
    const empty = root.querySelector('[data-tool-empty]');
    if (empty) empty.hidden = visible > 0;
  },
  attioCard() {
    if (!state.features?.attioDelivery || !this.owner()) return '';
    const connection = state.attio;
    return `<section class="panel" id="tool-attio"><h2>Attio delivery</h2><p>Send an accepted company CSV to Attio after reviewing its rows. Existing companies are matched by domain; supplied names are updated.</p>${connection?.configured ? `<p>Destination: <strong>${escape(connection.destination)}</strong></p><button data-action="app-attio-control" data-operation="${connection.connected ? 'disconnect' : 'connect'}">${connection.connected ? 'Disconnect Attio' : 'Enable Attio delivery'}</button><p class="hint">Disconnecting blocks future sends. It does not delete companies already delivered.</p>` : '<p class="hint">Local setup required: configure a private Attio integration on the server. No credentials are collected in chat. Company CSV delivery supports up to 50 rows; people, deals and custom fields are not supported yet.</p>'}</section>`;
  },
  attioReceipt(receipt) {
    const complete = receipt.status === 'sent';
    const canContinue = receipt.canContinue && state.attio?.connected;
    const status = complete ? 'Delivered' : receipt.status === 'review' ? 'Ready for your review' : receipt.status === 'failed' ? 'Needs attention' : state.attioSending ? 'Sending' : 'Paused';
    return `<article class="panel" aria-label="Attio delivery receipt"><h4>${escape(receipt.filename)}</h4><p><strong>${receipt.completed} of ${receipt.total} companies confirmed</strong> · ${status}</p><p>${escape(receipt.destination)}</p><details ${receipt.status === 'review' ? 'open' : ''}><summary>Review companies & confirmations</summary><ul>${receipt.rows.map(row => `<li>${escape(row.name || row.domain)} · ${escape(row.domain)}${receipt.results?.some(result => result.domain === row.domain) ? ' · Confirmed' : ' · Not confirmed'}</li>`).join('')}</ul></details>${complete ? '<p>Delivery complete. Refreshing this task does not send these rows again.</p>' : `<p class="hint">Creates companies or updates matching domains and supplied names. This sends data outside Relay. No emails are sent.</p>${receipt.error ? `<p role="alert">${escape(receipt.error)}</p>` : ''}${receipt.blockedReason ? `<p>${escape(receipt.blockedReason)}</p>` : ''}${canContinue ? `<button class="primary" data-action="app-attio-send" ${state.attioSending ? 'disabled' : ''} data-id="${escape(receipt.id)}">${receipt.status === 'review' ? 'Confirm & send companies' : 'Resume remaining companies'}</button>` : '<p class="hint">Refresh to check readiness, or review the file again after resolving the connection.</p>'}`}</article>`;
  },
  attioDelivery(task, submission) {
    if (!state.features?.attioDelivery || !this.owner() || submission?.status !== 'accepted') return '';
    const receipts = [...(state.attioReceipts || []).filter(item => item.taskId === task.id)];
    const review = state.attioReview?.taskId === task.id ? state.attioReview : null;
    if (review) {
      const existing = receipts.findIndex(item => item.fileId === review.fileId);
      if (existing < 0) receipts.push(review);
      else if (review.updatedAt > receipts[existing].updatedAt) receipts[existing] = review;
    }
    const files = submission.files.filter(file => file.filename.toLowerCase().endsWith('.csv'));
    if (!files.length && !receipts.length) return '';
    return `<section class="panel"><h3>Attio delivery</h3>${state.attio?.connected ? `<p>Review companies before sending to ${escape(state.attio.destination)}.</p>${files.map(file => `<button data-action="app-attio-prepare" ${state.attioSending ? 'disabled' : ''} data-id="${escape(file.id)}" data-submission="${escape(submission.id)}">Review ${escape(file.filename)}</button>`).join('')}` : '<p>Connect Attio in Tools to send companies. Past confirmations below remain available.</p>'}<div aria-live="polite">${receipts.map(receipt => this.attioReceipt(receipt)).join('')}</div></section>`;
  },
  toolsPage() {
    const data = this.data();
    return `<section class="market-workspace tools-workspace"><header class="builder-page-title"><div><span class="eyebrow">YOUR TOOLS, TOGETHER</span><h1>Bring your context.</h1><p>Find a tool, choose what to share, and put it to work.</p></div></header>${this.toolLibrary()}<div id="tool-drive">${this.driveCard()}</div>${this.attioCard()}<h2>Your sources</h2><p class="hint">Use @ in a conversation to select a saved source. Nothing is shared automatically.</p>
      ${this.owner() ? `<details class="panel" id="tool-local"><summary>Add a local source</summary><form id="app-source-create" class="market-form"><label>Name<input name="name" maxlength="80" required placeholder="Weekly lead list"></label><label>CSV, JSON or text<textarea name="content" maxlength="16000" required placeholder="Paste test data here"></textarea></label><button class="primary">Save local source</button><div class="form-error" role="alert"></div></form></details>` : '<p id="tool-local">Your workspace administrator manages sources and connections.</p>'}
      ${data.sources.map((source) => (source.provenance?.provider === 'google-drive' ? `<details class="panel"><summary>${escape(source.name)} · ${source.provenance.mode === 'live-file' ? 'Live Drive file' : 'Drive snapshot'} · ${escape(source.status)}</summary><p>${source.provenance.mode === 'live-file' ? 'Last checked ' + escape(date(source.provenance.checkedAt)) + '. Authorized latest-data reads check Drive again. Preview below is the last saved version.' : 'Imported ' + escape(date(source.provenance.importedAt)) + '. This saved copy does not sync with Drive.'}</p><pre>${escape(source.content)}</pre>${source.status === 'active' ? `<button data-action="app-disconnect" data-id="${escape(source.id)}">Disconnect this source</button>` : '<p>Import the file again to reconnect. Old permissions stay revoked.</p>'}</details>` : `<details class="panel"><summary>${escape(source.name)} · v${source.version} · ${escape(source.status)}</summary><form id="app-source-edit" data-id="${escape(source.id)}" class="market-form"><label>Name<input name="name" value="${escape(source.name)}" required maxlength="80"></label><label>Source content<textarea name="content" required maxlength="16000">${escape(source.content)}</textarea></label><button class="primary">${source.status === 'active' ? 'Save new version' : 'Reconnect local source'}</button>${source.status === 'active' ? `<button type="button" data-action="app-disconnect" data-id="${escape(source.id)}">Disconnect</button>` : '<p>Reconnecting does not restore old permissions. Grant access again.</p>'}<div class="form-error" role="alert"></div></form></details>`)).join('')}
      <h2>Permissions</h2>${
        data.grants
          .filter((grant) => grant.status === 'active')
          .map((grant) => this.grant(grant))
          .join('') || '<p>No apps or agents have tool access.</p>'
      }
      <details class="panel"><summary>Access and run history</summary>${data.audit.map((item) => `<p>${escape(date(item.createdAt))} · ${escape(item.action.replaceAll('.', ' '))}</p>`).join('') || '<p>No activity yet.</p>'}</details></section>`;
  },
  page() {
    const data = this.data();
    const pending = data.runs.filter(
      (run) => run.status === 'needs_review',
    ).length;
    return `<section class="market-workspace apps-workspace">
      <header class="builder-page-title"><div><span class="eyebrow">YOUR WORKSPACE TOOLKIT</span><h1>Apps</h1><p>Tools you keep. Results you can review.</p></div><button data-action="buyer-nav" data-tab="tools">Data & permissions</button></header>
      <div class="work-mode-grid">
        <section class="work-mode-card"><span class="mode-symbol" aria-hidden="true">▦</span><h2>A tool you run</h2><p>Use an installed app on a chosen source. Run it when needed, review the result, then save it.</p><span class="tag">${data.apps.length} installed${pending ? ` · ${pending} awaiting review` : ''}</span></section>
        <section class="work-mode-card"><span class="mode-symbol" aria-hidden="true">↻</span><h2>A job that repeats</h2><p>Ask an agent for an outcome every day, week or month. Confirm its context, budget and schedule first.</p><button data-action="buyer-nav" data-tab="scheduled">Plan scheduled work</button></section>
      </div>
      ${this.hostingPanel()}
      <div class="row-heading apps-section-heading"><h2>Your installed apps</h2><span class="muted">Local runs · no charges</span></div>
      ${data.apps.length ? data.apps.map((app) => this.card(app)).join('') : `<section class="apps-empty"><span class="mode-symbol" aria-hidden="true">▦</span><h2>Your first reusable tool starts with a request.</h2><p>Ask for a tool, try its delivery, then explicitly install it. Ordinary files stay in the task—they do not become apps.</p><div class="app-actions"><button class="primary" data-action="app-request" data-kind="data">Request a custom data tool</button><button data-action="app-request" data-kind="csv">Request a CSV cleaner</button><button data-action="app-request" data-kind="links">Request a link organizer</button></div><details><summary>What can run in Relay today?</summary><p>Builders can deliver data tools that filter, sort, select fields, remove duplicates and limit JSON records. CSV cleaning and link extraction are also supported. Custom dashboards, arbitrary supplier code and external writes cannot run here yet.</p></details></section>`}
      <p class="hint">An app can also run on a schedule you explicitly enable in its settings. Scheduled agent work remains a separate request with its own offers and deliveries.</p>
    </section>`;
  },
  hostingPanel() {
    const hosting = this.data().hosting || { entitlement: { plan: 'free', canHost: false, includedHosts: 0 }, hosts: [] };
    const entitlement = hosting.entitlement;
    return `<section class="relay-hosting ${entitlement.canHost ? 'hosting-enabled' : 'hosting-locked'}"><div class="hosting-copy"><span class="mode-symbol" aria-hidden="true">◫</span><div><span class="eyebrow">RELAY HOSTING</span><h2>Run installed apps without operating the infrastructure.</h2><p>Hosted automations run the reviewed release in a separate local worker, using only the approved input. Runs and outputs stay in this workspace.</p><ol class="hosting-flow"><li><span>1</span>Install a reviewed delivery</li><li><span>2</span>Approve its data access</li><li><span>3</span>Provision and manage a release</li></ol><small>Local worker execution is active. No public cloud compute, public URL or hosting charge is created.</small></div></div>${entitlement.canHost ? `<div class="hosting-plan"><span class="tag success">${escape(entitlement.plan)} plan</span><strong>${hosting.hosts.length} of ${entitlement.includedHosts} hosts used</strong><span>Subscription entitlement active</span></div>` : `<div class="hosting-plan"><span class="tag">Subscription feature</span><strong>Pro or Business required</strong><span>Pro includes 2 hosts. Business includes 10. Hosting subscriptions use local fixtures; checkout is not enabled.</span><button data-action="app-hosting-plans">View hosting access</button></div>`}</section>`;
  },
  card(app) {
    const data = this.data(),
      grant = data.grants.find((g) => g.id === app.grantId);
    const source = data.sources.find((item) => item.id === app.sourceId);
    const runs = data.runs.filter((run) => run.appId === app.id);
    const host = data.hosting?.hosts?.find((item) => item.appId === app.id);
    const canHost = !!data.hosting?.entitlement?.canHost;
    const hostingBlocked = !!host && (!canHost || host.status !== 'running');
    const valid =
      grant?.status === 'active' &&
      grant.expiresAt > Date.now() &&
      source?.status === 'active' &&
      (grant.sourceEpoch || 0) === (source.accessEpoch || 0);
    return `<article class="panel installed-app" data-app-id="${escape(app.id)}"><header class="section-heading"><div><h2>${escape(app.title)}</h2><p>${escape(data.recipes?.[app.recipe]?.title || app.recipe)} · version ${app.recipeVersion}</p></div><span class="tag">${valid ? escape(app.status) : 'Needs permission'}</span></header>
      <ol class="app-flow" aria-label="How this app works"><li><small>Source</small><strong>${escape(source?.name || 'Unavailable source')}</strong></li><li><small>Process</small><strong>${escape(data.recipes?.[app.recipe]?.title || (app.recipe === 'link-inventory-v1' ? 'Organize links' : 'Clean CSV'))}</strong></li><li><small>Delivery</small><strong>Review & save in Relay</strong></li></ol>
      ${app.appPackage ? `<p>${escape(app.appPackage.description)}</p><details><summary>What this app does · ${app.appPackage.steps.length} steps</summary><ol>${app.appPackage.steps.map((step) => `<li>${escape(this.stepLabel(step))}</li>`).join('')}</ol><p>Delivered by ${escape(app.agentName || 'your builder')}. This installed version stays fixed when the original delivery changes.</p><small>Package: ${escape(app.packageHash?.slice(0, 12))}…</small></details>` : ''}
      ${app.reason ? `<p role="status">${escape(app.reason)}</p>` : ''}
      <p>${app.calendar ? `${escape(app.calendar.cadence)} at ${escape(app.calendar.time)} (${escape(app.calendar.timezone)}) · ${app.status === 'active' ? 'Next: ' + escape(date(app.nextAt)) : 'Paused'}` : 'Runs when you choose.'}</p>
      ${hostingBlocked ? '<p class="app-next-action" role="status">Hosting is paused. Restore your subscription and start the host to run again. Saved outputs remain available.</p>' : ''}
      ${!valid ? '<p class="app-next-action">Read permission needs attention. Open Permissions below before running this app.</p>' : runs.some((r) => r.status === 'needs_review') ? '<p class="app-next-action">Your result is ready. Review or discard it below before starting another run.</p>' : app.status !== 'active' ? '<p class="app-next-action">This app is paused. Resume it when you are ready to run again.</p>' : ''}<div class="app-actions"><button class="primary" data-action="app-control" data-id="${escape(app.id)}" data-control="run" ${hostingBlocked || !valid || app.status !== 'active' || runs.some((r) => r.status === 'needs_review') ? 'disabled' : ''}>Run now</button><button data-action="app-control" data-id="${escape(app.id)}" data-control="${app.status === 'active' ? 'pause' : 'resume'}">${app.status === 'active' ? 'Pause' : 'Resume'}</button><button data-action="task" data-id="${escape(app.sourceTaskId)}">Open task conversation</button></div>
      <details class="app-host-details"><summary>Relay hosting · ${host ? escape(host.status.replaceAll('_', ' ')) : canHost ? 'ready to provision' : 'subscription required'}</summary>${host ? `<div class="host-status-line"><span class="host-state host-${escape(host.status)}"></span><strong>${host.status === 'subscription_hold' ? 'Suspended until the subscription is active' : host.status === 'running' ? 'Local worker ready' : 'Runtime is stopped'}</strong></div><div class="host-metrics"><span><small>Runtime</small><strong>${escape(host.runtime)}</strong></span><span><small>Release</small><strong>v${host.release}</strong></span><span><small>Worker heap</small><strong>64 MB</strong></span><span><small>Last deploy</small><strong>${escape(date(host.lastDeployAt))}</strong></span></div><p>Each hosted run uses a separate local process with a five-second deadline. An active subscription and current approved grant are required. Permission revocation blocks starts and redeploys. Arbitrary code, shell access, inbound public traffic and silent external writes remain disabled.</p><div class="app-actions">${host.status === 'running' || host.status === 'subscription_hold' ? `<button data-action="app-host" data-id="${escape(app.id)}" data-host-action="stop">Stop host</button>` : `<button class="primary" data-action="app-host" data-id="${escape(app.id)}" data-host-action="start" ${!canHost ? 'disabled' : ''}>Start host</button>`}<button data-action="app-host" data-id="${escape(app.id)}" data-host-action="redeploy" ${!canHost ? 'disabled' : ''}>Deploy current release</button></div><details class="host-remove"><summary>Remove hosted runtime</summary><p>This disables hosted execution, not the installed app, task history or saved outputs.</p><button data-action="app-host" data-id="${escape(app.id)}" data-host-action="deprovision">Deprovision host</button></details>` : canHost ? `<p>Provision this reviewed app in your Relay hosting allowance. Its existing data grant is rechecked before the runtime is created.</p><button class="primary" data-action="app-host" data-id="${escape(app.id)}" data-host-action="provision">Provision host</button>` : '<p>Upgrade to Pro or Business to provision this installed app. Manual local runs remain available and use the same permission checks.</p><button data-action="app-hosting-plans">See subscription requirements</button>'}</details>
      <details><summary>Permissions</summary>${grant ? this.grant(grant) : ''}<form id="app-renew" data-id="${escape(app.id)}"><label class="app-consent"><input type="checkbox" name="consent" required> Allow this app to read this source for the next 30 days.</label><button>Renew read access</button><div class="form-error" role="alert"></div></form></details>
      <details><summary>App schedule · ${app.calendar ? 'enabled' : 'off'}</summary><form id="app-calendar" data-id="${escape(app.id)}" class="market-form"><label>Frequency<select name="cadence"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Time<input type="time" name="time" value="09:00" required></label><label>Timezone<input name="timezone" value="${escape(Intl.DateTimeFormat().resolvedOptions().timeZone)}" required></label><label data-calendar-day>Day (weekly: Monday 1–Sunday 7; monthly: 1–31)<input type="number" name="day" value="1" min="1" max="31" required></label><p>One result at a time. Review the previous result before the next run. Missed slots are skipped; no catch-up burst.</p><button>Enable schedule</button>${app.calendar ? `<button type="button" data-action="app-control" data-id="${escape(app.id)}" data-control="unschedule">Remove schedule</button>` : ''}<div class="form-error" role="alert"></div></form></details>
      <h3>Recent runs</h3>${runs.map((run) => `<section class="app-result" data-run-id="${escape(run.id)}"><strong>${escape(date(run.createdAt))} · ${escape(run.status.replaceAll('_', ' '))}</strong><p>Source v${run.sourceVersion} · ${escape(run.filename)}</p>${run.stepEvidence ? `<details><summary>Run details · ${run.stepEvidence.length} completed steps</summary><ol>${run.stepEvidence.map((step) => `<li>${escape(step.operation)} · ${step.inputRows} → ${step.outputRows} records</li>`).join('')}</ol></details>` : ''}<details><summary>Review output</summary><pre>${escape(run.output)}</pre></details>${run.status === 'saved' ? `<a href="/api/app-runs/${encodeURIComponent(run.id)}/download">Download ${escape(run.filename)}</a>` : ''}${run.status === 'needs_review' ? `<div class="app-actions"><button data-action="app-review" data-id="${escape(run.id)}" data-review="save" ${!valid || run.grantId !== app.grantId ? 'disabled' : ''}>Approve & save in Relay</button><button data-action="app-review" data-id="${escape(run.id)}" data-review="discard">Discard result</button></div>` : ''}</section>`).join('') || '<p>No runs yet.</p>'}</article>`;
  },
  stepLabel(step) {
    if (step.op === 'filter')
      return `Keep records where ${step.field} ${{ eq: 'equals', ne: 'does not equal', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most' }[step.compare]} ${JSON.stringify(step.value)}`;
    if (step.op === 'select') return `Keep ${step.fields.join(', ')}`;
    if (step.op === 'sort')
      return `Sort ${step.field} ${step.direction === 'asc' ? 'ascending' : 'descending'}`;
    if (step.op === 'deduplicate')
      return `Remove duplicate ${step.field} values`;
    return `Keep the first ${step.count} records`;
  },
  async submit(form, data) {
    const id = form.dataset.id,
      current = this.data();
    if (form.id.startsWith('app-source-')) {
      const source = current.sources.find((s) => s.id === id);
      await command('/api/tool-sources', 'POST', {
        tenantId: state.tenantId,
        ...(source ? { id, expectedVersion: source.version } : {}),
        name: data.get('name'),
        content: data.get('content'),
        action: 'save',
      });
    } else if (form.id === 'app-install' || form.id === 'task-tool-grant') {
      await command(
        `/api/tasks/${state.detail.task.id}/${form.id === 'app-install' ? 'install-app' : 'tool-grant'}`,
        'POST',
        {
          expectedVersion: state.detail.task.version,
          sourceId: data.get('sourceId'),
          expiresDays: Number(data.get('expiresDays')),
          consent: data.has('consent') ? 'local-source-read' : '',
        },
      );
      if (form.id === 'app-install') {
        state.buyerTab = 'apps';
        state.detail = null;
        location.hash = 'apps';
      }
    } else {
      const app = current.apps.find((a) => a.id === id);
      await command('/api/workspace-apps/' + id, 'POST', {
        expectedVersion: app.version,
        action: form.id === 'app-renew' ? 'renew' : 'schedule',
        ...(form.id === 'app-renew'
          ? { consent: data.has('consent') ? 'local-source-read' : '' }
          : {
              calendar: {
                cadence: data.get('cadence'),
                time: data.get('time'),
                timezone: data.get('timezone'),
                day: Number(data.get('day')),
              },
            }),
      });
    }
    await refresh();
    render();
  },
  async click(button) {
    const id = button.dataset.id,
      action = button.dataset.action,
      data = this.data();
    if (action === 'app-attio-control') {
      await api('/api/attio/control', { method: 'POST', body: { tenantId: state.tenantId, action: button.dataset.operation } });
      state.attioReview = null;
      await refresh(); render(); return;
    }
    if (action === 'app-attio-prepare') {
      state.attioReview = await api('/api/attio/prepare', { method: 'POST', body: { taskId: state.detail.task.id, submissionId: button.dataset.submission, fileId: id } });
      render(); return;
    }
    if (action === 'app-attio-send') {
      if (state.attioSending) return;
      state.attioSending = true;
      const taskId = state.detail?.task.id;
      const tenantId = state.tenantId;
      try {
        for (let row = 0; row < 50; row++) {
          if (state.detail?.task.id !== taskId || state.tenantId !== tenantId) break;
          state.attioReview = await api('/api/attio/send', { method: 'POST', body: { id, consent: 'upsert-reviewed-companies' } });
          render();
          if (state.attioReview.status !== 'sending') break;
        }
      } finally { state.attioSending = false; render(); }
      return;
    }
    if (action === 'app-tool-open') {
      const target = document.getElementById(
        'tool-' + button.dataset.tool,
      );
      if (target) {
        if (target.tagName === 'DETAILS') target.open = true;
        target.scrollIntoView({
          behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
          block: 'center',
        });
        const focus = target.querySelector('input, button');
        if (focus) focus.focus({ preventScroll: true });
        else {
          target.tabIndex = -1;
          target.focus({ preventScroll: true });
        }
      }
      return;
    }
    if (action === 'app-hosting-plans') {
      notice.textContent = 'Relay hosting will require an active paid Pro or Business subscription. Hosting subscription checkout is not enabled; local subscription fixtures are used for testing.';
      return;
    }
    if (action === 'app-request') {
      state.prompt =
        button.dataset.kind === 'data'
          ? 'Build a reusable overdue-invoice report app for Relay. From JSON invoice records, keep overdue invoices, sort by amount descending and show customer, amount and daysOverdue. Deliver relay-app.json and a sample result so I can review and install it.'
          : button.dataset.kind === 'csv'
            ? 'Build a reusable CSV-cleaning tool. I want to test it on a sample, review the result, then decide whether to install it in Relay.'
            : 'Build a reusable tool that extracts and deduplicates web links from text. Let me review a sample result before installing it in Relay.';
      state.buyerTab = 'request';
      state.detail = null;
      location.hash = '';
      render();
      document.querySelector('#request-text')?.focus();
      return;
    } else if (action === 'app-drive-connect' || action === 'app-drive-pick') {
      sessionStorage.setItem('relay-drive-tenant', state.tenantId);
      if (action === 'app-drive-pick') {
        location.assign('/drive/picker');
        return;
      }
      const result = await api('/api/drive/begin', {
        method: 'POST',
        body: { tenantId: state.tenantId },
      });
      location.assign(result.url);
      return;
    } else if (action === 'app-drive-disconnect') {
      const result = await api('/api/drive/disconnect', {
        method: 'POST',
        body: {
          tenantId: state.tenantId,
          expectedVersion: state.drive.version,
        },
      });
      if (!result.providerRevoked)
        notice.textContent =
          'Disconnected from Relay. Remove Relay in your Google account permissions to finish revoking Google access.';
    } else if (action === 'app-host') {
      const app = data.apps.find((item) => item.id === id);
      const host = data.hosting?.hosts?.find((item) => item.appId === id);
      await command('/api/workspace-apps/' + id + '/host', 'POST', {
        expectedVersion: host?.version || app.version,
        action: button.dataset.hostAction,
      });
    } else if (action === 'app-revoke') {
      await command('/api/tool-grants/' + id, 'POST', {
        expectedVersion: data.grants.find((g) => g.id === id).version,
      });
    } else if (action === 'app-disconnect') {
      const source = data.sources.find((s) => s.id === id);
      await command('/api/tool-sources', 'POST', {
        tenantId: state.tenantId,
        id,
        expectedVersion: source.version,
        name: source.name,
        content: source.content,
        action: 'disconnect',
      });
    } else if (action === 'app-review') {
      const run = data.runs.find((r) => r.id === id);
      await command('/api/app-runs/' + encodeURIComponent(id), 'POST', {
        expectedVersion: run.version,
        action: button.dataset.review,
        outputHash: run.outputHash,
      });
    } else {
      await command('/api/workspace-apps/' + id, 'POST', {
        expectedVersion: data.apps.find((a) => a.id === id).version,
        action: button.dataset.control,
      });
    }
    await refresh();
    render();
  },
};
