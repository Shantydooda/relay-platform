'use strict';

// Organizations, projects and the Enterprise page (docs/specs/Enterprise-and-Projects.md).
//
// Hugging Face's Team/Enterprise information architecture (an organization page
// with tabs, resource groups, a plan page) carrying Relay's company workspace:
// roles, exact-offer approvals, the company allowance and projects. Everything
// shown comes from the server; nothing on the Enterprise page claims a feature
// that isn't built.
const RelayOrg = {
  ORG_TABS: [['projects', 'Projects'], ['work', 'Work'], ['members', 'Members'], ['spending', 'Spending'], ['settings', 'Settings']],
  PROJECT_TABS: [['work', 'Work'], ['budget', 'Budget'], ['members', 'Members']],
  ICON: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h4.6l2 2H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Zm2 0v12h14V8h-8.2l-2-2H5Z" fill="currentColor"/></svg>',

  // ---- Routes ------------------------------------------------------------
  parse(pathname) {
    if (pathname === '/enterprise') return { page: 'enterprise', id: null };
    const project = /^\/org\/([0-9a-f-]{36})\/projects\/([0-9a-f-]{36})$/.exec(pathname);
    if (project) return { page: 'project', id: project[1], projectId: project[2] };
    const org = /^\/org\/([0-9a-f-]{36})(?:\/(work|members|spending|settings))?$/.exec(pathname);
    if (org) return { page: 'org', id: org[1], tab: org[2] || 'projects' };
    return null;
  },
  apply(route, target = state) {
    if (route.page === 'enterprise') { target.buyerTab = 'enterprise'; target.detail = null; return true; }
    if (route.page !== 'org' && route.page !== 'project') return false;
    target.buyerTab = 'org'; target.detail = null; target.orgId = route.id;
    target.orgTab = route.tab || 'projects';
    if (target.projectId !== (route.projectId || null)) target.projectTab = 'work';
    target.projectId = route.projectId || null;
    // Opening an organization works in it: new requests and lists use it.
    if (target.account?.memberships?.some(m => m.id === route.id && m.company)) target.tenantId = route.id;
    return true;
  },
  path(current = state) {
    if (current.buyerTab === 'enterprise') return '/enterprise';
    if (current.buyerTab !== 'org' || !current.orgId) return null;
    if (current.projectId) return `/org/${current.orgId}/projects/${current.projectId}`;
    return `/org/${current.orgId}${current.orgTab && current.orgTab !== 'projects' ? '/' + current.orgTab : ''}`;
  },
  async load(target = state) {
    target.projects = null; target.project = null;
    if (target.buyerTab === 'org' && this.membership(target)) {
      target.projects = await api(`/api/teams/${target.orgId}/projects`);
      if (target.projectId) {
        try { target.project = await api('/api/projects/' + target.projectId); }
        catch (error) { if (error.status !== 404) throw error; }
      }
    }
    // "Post a request" offers the organizations and projects you can file into.
    target.postTargets = null;
    if (target.buyerTab === 'request') {
      const companies = (target.account?.memberships || []).filter(m => m.company && m.role !== 'approver');
      target.postTargets = await Promise.all(companies.map(async m => ({ tenantId: m.id, name: m.name,
        projects: (await api(`/api/teams/${m.id}/projects`)).filter(p => p.status === 'active') })));
    }
  },

  // ---- Helpers -----------------------------------------------------------
  membership(target = state) {
    return target.account?.memberships?.find(m => m.id === target.orgId && m.company) || null;
  },
  companies() { return (state.account?.memberships || []).filter(m => m.company); },
  money(minor) { return RelayMarketplace.money(minor, 'USD'); },
  role(role) { return { owner: 'Administrator', approver: 'Budget approver', employee: 'Employee' }[role] || role; },
  bar(budget) {
    const used = budget.reservedMinor + budget.committedMinor;
    const pct = budget.capMinor ? Math.min(100, Math.round(used / budget.capMinor * 100)) : 100;
    // A native progress bar: the CSP forbids inline styles.
    return `<progress class="mk-budgetbar" max="100" value="${pct}" aria-label="${pct}% of the budget held">${pct}%</progress>`;
  },
  left(budget) { return `${this.money(budget.availableMinor)} left of ${this.money(budget.capMinor)}`; },
  tabs(items, current, href) {
    return `<nav class="mk-tabs" aria-label="Sections">${items.map(([id, label, count]) => {
      const attrs = `${current === id ? 'aria-current="page"' : ''}`;
      const inner = `${label}${count !== undefined ? ` <span class="mk-count">${count}</span>` : ''}`;
      return href ? `<a href="${href(id)}" data-route ${attrs}>${inner}</a>` : `<button type="button" data-action="project-tab" data-tab="${id}" ${attrs}>${inner}</button>`;
    }).join('')}</nav>`;
  },
  header(org, sub, crumbs, tabs) {
    return `<header class="mk-agent-head mk-org-head">
      <div class="mk-agent-title"><span class="mk-org-avatar" aria-hidden="true">${escape(org.name.slice(0, 1).toUpperCase())}</span><h1>${crumbs}</h1></div>
      <p class="mk-agent-sub">${sub}</p>${tabs}</header>`;
  },
  unavailable(title, body) {
    return `<section class="mk-page"><div class="mk-empty"><h1>${title}</h1><p>${body}</p><a class="mk-primary" href="/enterprise" data-route>About organizations</a></div></section>`;
  },
  people() {
    return (state.team?.members || []).filter(m => m.status !== 'removed');
  },
  peoplePicker(lead, members) {
    const people = this.people();
    return `<label for="project-lead">Project lead</label><select id="project-lead" name="leadId" required>${people.map(p => `<option value="${escape(p.id)}" ${p.id === lead ? 'selected' : ''}>${escape(p.name)} · ${escape(this.role(p.role))}</option>`).join('')}</select>
      <p class="mk-caption">The lead can approve quotes on this project’s work, within its budget.</p>
      <fieldset class="mk-fieldset"><legend>Members</legend>${people.map(p => `<label class="mk-check"><input type="checkbox" name="memberIds" value="${escape(p.id)}" ${members.includes(p.id) ? 'checked' : ''}> ${escape(p.name)}</label>`).join('')}
      <p class="mk-caption">Members see every request, delivery and file in this project. Only the person who posted a request changes it.</p></fieldset>`;
  },

  // ---- Organization page -------------------------------------------------
  page() {
    if (state.projectId) return this.projectPage();
    const m = this.membership();
    if (!m) return this.unavailable('Organization unavailable', 'You’re not a member of this organization, or your access was removed.');
    const owner = m.role === 'owner';
    const tabs = this.ORG_TABS.filter(([id]) => id !== 'settings' || owner)
      .map(([id, label]) => [id, label, id === 'projects' ? (state.projects || []).length : id === 'members' && state.team?.members ? this.people().length : undefined]);
    const tab = tabs.some(([id]) => id === state.orgTab) ? state.orgTab : 'projects';
    const body = { projects: () => this.projectsTab(m), work: () => this.workTab(), members: () => this.membersTab(m), spending: () => this.spendingTab(), settings: () => this.settingsTab() }[tab]();
    return `<article class="mk-agent mk-org">${this.header(m, `Organization · you’re ${escape(this.role(m.role).toLowerCase())}`,
      `<span class="mk-handle-name">${escape(RelayMarketplace.slug(m.name))}</span>`,
      this.tabs(tabs, tab, id => `/org/${state.orgId}${id === 'projects' ? '' : '/' + id}`))}
      <div class="mk-org-body">${body}</div></article>`;
  },
  projectsTab(m) {
    const owner = m.role === 'owner', list = state.projects || [];
    const side = `<aside class="mk-side" aria-label="Project actions">
      ${owner ? `<button type="button" class="mk-side-button mk-side-primary" data-action="project-create-toggle" aria-expanded="${!!state.projectCreateOpen}">+ New project</button>` : ''}
      ${m.role !== 'approver' ? '<a class="mk-side-button" href="/post" data-route>Post a request</a>' : ''}
      <p class="mk-side-note">A project groups a team’s requests, like a migration wave, with its own budget inside the company allowance.</p>
      <h2>Resources</h2><ul class="mk-side-links"><li><a href="/enterprise" data-route>Relay for organizations</a></li><li><a href="/docs/revisions" data-route>Revisions and ending work</a></li></ul></aside>`;
    const create = owner && state.projectCreateOpen ? this.projectForm() : '';
    const rows = list.length ? `<ul class="mk-threads">${list.map(p => `<li><a href="/org/${escape(p.tenantId)}/projects/${escape(p.id)}" data-route class="mk-thread mk-thread-${p.status === 'active' ? 'none' : 'muted'}">
        <span class="mk-thread-icon">${this.ICON}</span>
        <span class="mk-thread-body"><span class="mk-row-title"><span class="mk-work-title">${escape(p.name)}</span><span class="mk-tag">${p.status === 'active' ? 'Active' : 'Archived'}</span>${p.you?.lead ? '<span class="mk-tag mk-tone-active">You lead</span>' : ''}</span>
        <span class="mk-meta">Lead ${escape(p.leadName || 'unknown')}<span class="mk-sep" aria-hidden="true">·</span>${RelayMarketplace.plural(p.taskCount, 'item')}<span class="mk-sep" aria-hidden="true">·</span>${escape(this.left(p.budget))}<span class="mk-sep" aria-hidden="true">·</span>updated ${escape(RelayMarketplace.ago(p.updatedAt))}</span>
        ${this.bar(p.budget)}</span><span class="mk-next">Open →</span></a></li>`).join('')}</ul>`
      : `<div class="mk-empty"><h2>No projects yet</h2><p>${owner ? 'Create a project for each workstream or wave, give it a lead and a budget, and file requests into it.' : 'Your administrator hasn’t added you to a project yet. Work you post outside projects stays private to you.'}</p></div>`;
    return `<div class="mk-cols">${side}<section class="mk-results" aria-labelledby="mk-org-projects"><header class="mk-page-head"><h2 id="mk-org-projects" class="mk-h1">Projects <span class="mk-total">${list.length}</span></h2></header>${create}${rows}</section></div>`;
  },
  projectForm(project = null) {
    const p = project || {}, people = this.people();
    if (!people.length) return '<p class="mk-caption">Loading members…</p>';
    const lead = p.leadId || people.find(x => x.role !== 'approver')?.id || people[0].id;
    return `<form id="${project ? 'project-edit' : 'project-create'}" class="mk-form mk-panel" ${project ? `data-version="${p.version}"` : ''}>
      <h3>${project ? 'Project settings' : 'New project'}</h3>
      <label for="project-name">Name</label><input id="project-name" name="name" maxlength="80" minlength="2" required value="${escape(p.name || '')}" placeholder="e.g. NetSuite migration – Wave 2">
      <label for="project-description">What it covers <span class="mk-optional">optional</span></label><textarea id="project-description" name="description" rows="2" maxlength="1000" placeholder="e.g. Item and vendor master cleanup before cutover">${escape(p.description || '')}</textarea>
      ${this.peoplePicker(lead, p.memberIds || [])}
      <label for="project-cap">Budget (USD)</label><input id="project-cap" name="cap" type="number" min="0" max="1000000" step="0.01" required value="${project ? p.capMinor / 100 : ''}">
      <p class="mk-caption">A cap inside the company allowance. Approvals must fit both; nothing is charged by setting it.</p>
      ${project ? `<label class="mk-check"><input type="checkbox" name="archived" ${p.status === 'archived' ? 'checked' : ''}> Archived: keep history, accept no new requests or approvals</label>` : ''}
      <div class="form-error" role="alert"></div>
      <div class="mk-form-actions"><button class="mk-primary" type="submit">${project ? 'Save project' : 'Create project'}</button>${project ? '' : '<button type="button" data-action="project-create-toggle">Cancel</button>'}</div></form>`;
  },
  workRows(tasks, empty) {
    return tasks.length ? `<ul class="mk-threads">${tasks.map(task => RelayMarketplace.workRow(task)).join('')}</ul>` : `<div class="mk-empty"><p>${empty}</p></div>`;
  },
  workTab() {
    const m = this.membership();
    const tasks = RelayMarketplace.listedWork();
    return `<section class="mk-results"><header class="mk-page-head"><h2 class="mk-h1">Work <span class="mk-total">${tasks.length}</span></h2></header>
      <p class="mk-caption">${m.role === 'owner' ? 'Everything posted in this organization.' : 'Your own requests in this organization. Project work is on each project’s page.'}</p>
      ${this.workRows(tasks, 'No requests in this organization yet.')}</section>`;
  },
  membersTab(m) {
    if (m.role !== 'owner') return `<section class="mk-section"><h2>Members</h2><p>Your role: <strong>${escape(this.role(m.role))}</strong>. Your administrator invites people and sets roles.</p></section>`;
    return typeof RelayTeams === 'object' && state.team ? RelayTeams.people(state.team) : '<p class="mk-caption">Loading members…</p>';
  },
  spendingTab() {
    return `${typeof RelayApprovals === 'object' ? RelayApprovals.workspace() : ''}
      <p class="mk-caption">Reservations are spending permissions, not charges. <button type="button" class="mk-link-button" data-action="buyer-nav" data-tab="billing">History &amp; spend export</button></p>`;
  },
  settingsTab() {
    return `${typeof RelayTeams === 'object' ? RelayTeams.history() : ''}
      <section class="mk-section"><h2>Single sign-on and provisioning</h2><p>Not available yet. Members join by invitation and sign in with their own Relay account. <a href="/enterprise" data-route>See what’s planned</a>.</p></section>`;
  },

  // ---- Project page ------------------------------------------------------
  projectPage() {
    const m = this.membership(), data = state.project;
    if (!m || !data) return this.unavailable('Project unavailable', 'This project doesn’t exist, or you’re not one of its members.');
    const p = data.project;
    const tab = this.PROJECT_TABS.some(([id]) => id === state.projectTab) ? state.projectTab : 'work';
    const pending = data.tasks.filter(task => task.approval?.status === 'pending').length;
    const tabs = this.tabs(this.PROJECT_TABS.map(([id, label]) => [id, label, id === 'work' ? data.tasks.length : id === 'members' ? data.members.length : undefined]), tab);
    const lead = data.members.find(x => x.role === 'lead');
    const crumbs = `<a class="mk-handle-builder" href="/org/${escape(m.id)}" data-route>${escape(RelayMarketplace.slug(m.name))}</a> <span aria-hidden="true">/</span> <span class="mk-handle-name">${escape(p.name)}</span> <span class="mk-tag">${p.status === 'active' ? 'Active' : 'Archived'}</span>`;
    const sub = `Lead ${escape(lead?.name || 'unknown')}${data.you.lead ? ' (you)' : ''}${p.description ? ` · ${escape(p.description)}` : ''}`;
    const body = tab === 'budget' ? this.budgetTab(data) : tab === 'members' ? this.projectMembers(data) : this.projectWork(data, m);
    return `<article class="mk-agent mk-org">${this.header(m, sub, crumbs, tabs)}
      <div class="mk-agent-layout"><div class="mk-agent-main">${body}</div>
        <aside class="mk-buy" aria-label="Project">
          <section class="mk-buy-box"><h2>Budget</h2><p class="mk-org-big">${escape(this.money(data.budget.availableMinor))}</p><p class="mk-caption">left of ${escape(this.money(data.budget.capMinor))}</p>${this.bar(data.budget)}
            ${state.companyBudget?.budget ? `<p class="mk-caption">Company allowance: ${escape(this.money(state.companyBudget.budget.availableMinor))} available. Approvals must fit both.</p>` : ''}</section>
          ${p.status === 'active' && m.role !== 'approver' ? `<section class="mk-buy-box"><h2>New work</h2><p>Requests you post here are visible to everyone in the project.</p><button type="button" class="mk-primary" data-action="project-post" data-tenant="${escape(m.id)}" data-project="${escape(p.id)}">Post a request in this project</button></section>` : ''}
          ${pending ? `<section class="mk-buy-box"><h2>Approvals</h2><p><strong>${RelayMarketplace.plural(pending, 'request')}</strong> waiting for a budget decision.</p></section>` : ''}
        </aside></div></article>`;
  },
  approvalBlock(task) {
    const a = task.approval;
    if (!a) return '';
    const head = `<p class="mk-approval-line"><span class="mk-tag ${a.status === 'pending' ? 'mk-tone-attention' : ''}">${escape({ pending: 'Waiting for approval', approved: 'Approved', declined: 'Changes requested', stale: 'Needs fresh approval' }[a.status] || a.status)}</span> ${escape(a.agreement.agentName)} · ${escape(this.money(a.agreement.amountMinor))} · scope v${a.agreement.scopeVersion}</p>
      ${a.note ? `<p class="mk-caption"><strong>Reason:</strong> ${escape(a.note)}</p>` : ''}`;
    const can = task.approvalActions?.approve?.allowed || task.approvalActions?.decline?.allowed;
    if (a.status !== 'pending' || !can) return `<div class="mk-approval">${head}</div>`;
    return `<div class="mk-approval">${head}<form class="mk-form mk-approval-form" data-approval-task="${escape(task.id)}" data-approval-id="${escape(a.id)}" data-version="${a.version}">
      <label for="decision-${escape(task.id)}">Decision</label><select id="decision-${escape(task.id)}" name="decision"><option value="approved" ${task.approvalActions.approve.allowed ? '' : 'disabled'}>Approve and reserve budget</option><option value="declined" ${task.approvalActions.decline.allowed ? '' : 'disabled'} ${task.approvalActions.approve.allowed ? '' : 'selected'}>Decline with feedback</option></select>
      ${task.approvalActions.approve.allowed ? '' : `<p class="mk-caption">${escape(task.approvalActions.approve.reason || '')}</p>`}
      <label for="note-${escape(task.id)}">Note to the requester</label><textarea id="note-${escape(task.id)}" name="note" rows="2" maxlength="2000" required></textarea>
      <div class="form-error" role="alert"></div><button class="mk-primary" type="submit">Send decision</button></form></div>`;
  },
  projectWork(data, m) {
    const own = (state.tasks || []).filter(task => !task.projectId && task.status !== 'draft' && !['accepted', 'cancelled', 'failed'].includes(task.status) && (m.role === 'owner' || task.mine !== false));
    const add = data.project.status === 'active' && own.length && m.role !== 'approver'
      ? `<form id="project-add-task" class="mk-listbar"><label class="mk-sort"><span>Add your open work:</span><select name="taskId">${own.map(task => `<option value="${escape(task.id)}" data-version="${task.version}">${escape(task.title)}</option>`).join('')}</select></label><button type="submit">Add to project</button></form>` : '';
    const rows = data.tasks.length ? `<ul class="mk-threads">${data.tasks.map(task => `<li class="mk-project-item">${RelayMarketplace.workRow(task).replace(/^<li>|<\/li>$/g, '')}${this.approvalBlock(task)}</li>`).join('')}</ul>`
      : '<div class="mk-empty"><h2>No work in this project yet</h2><p>Post a request here, or add open work you’ve already posted.</p></div>';
    return `<section class="mk-results"><header class="mk-page-head"><h2 class="mk-h1">Work <span class="mk-total">${data.tasks.length}</span></h2></header>${add}${rows}</section>`;
  },
  budgetTab(data) {
    const b = data.budget;
    return `<section class="mk-section"><h2>Budget</h2>
      <div class="mk-strip">${RelayMarketplace.stat('Budget', this.money(b.capMinor), 'cap inside the company allowance')}${RelayMarketplace.stat('Reserved', this.money(b.reservedMinor), 'approved, not started')}${RelayMarketplace.stat('Committed', this.money(b.committedMinor), 'work under way or funded')}${RelayMarketplace.stat('Left', this.money(b.availableMinor), 'for new approvals', b.availableMinor > 0)}</div>
      ${this.bar(b)}
      <h3>How it works</h3><ul class="mk-list">
        <li>Approving a quote reserves its exact price against this project and the company allowance at once.</li>
        <li>Changing the offer or scope, or moving the work to another project, voids the approval and releases the money.</li>
        <li>Accepted, cancelled or failed unpaid work releases its reservation. Nothing here charges a card.</li>
        <li>The lead and company approvers decide; a lead’s approval lapses if the lead changes before work starts.</li></ul></section>`;
  },
  projectMembers(data) {
    const rows = `<ul class="mk-member-list">${data.members.map(x => `<li><span class="mk-org-avatar mk-org-avatar-sm" aria-hidden="true">${escape(x.name.slice(0, 1).toUpperCase())}</span><span>${escape(x.name)}</span><span class="mk-tag">${x.role === 'lead' ? 'Lead' : 'Member'}</span>${x.active ? '' : '<span class="mk-caption">no longer in the company</span>'}</li>`).join('')}</ul>`;
    return `<section class="mk-section"><h2>Members</h2><p class="mk-caption">Members see all work in this project. Company owners see everything.</p>${rows}</section>
      ${data.you.owner ? this.projectForm(data.project) : ''}`;
  },

  // ---- Enterprise page ---------------------------------------------------
  // A plan comparison in the Hugging Face pattern. "Live" means built and
  // working today; everything else is labelled planned and never claimed.
  PLAN_ROWS: [
    ['Browse agents, post requests, hire packages', 'live', 'live', 'live'],
    ['Acceptance checklist and free fixes until it’s met', 'live', 'live', 'live'],
    ['Shared organization with invitations', '', 'live', 'live'],
    ['Roles: administrator, approver, employee', '', 'live', 'live'],
    ['Approval tied to the exact offer and scope', '', 'live', 'live'],
    ['Company allowance with reservations', '', 'live', 'live'],
    ['Projects with members, a lead and a budget cap', '', 'live', 'live'],
    ['Access history and spend export (CSV)', '', 'live', 'live'],
    ['Lead approval thresholds', '', '', 'planned'],
    ['Single sign-on (SAML) and SCIM provisioning', '', '', 'planned'],
    ['Data residency and retention controls', '', '', 'planned'],
    ['Invoicing, purchase orders and procurement', '', '', 'planned'],
  ],
  enterprise() {
    const cell = value => value === 'live' ? '<td class="mk-plan-live"><span aria-hidden="true">✓</span><span class="sr-only">Included</span></td>'
      : value === 'planned' ? '<td class="mk-plan-planned">Planned</td>' : '<td class="mk-plan-none"><span aria-hidden="true">—</span><span class="sr-only">Not included</span></td>';
    const companies = this.companies();
    const cta = companies.length
      ? companies.map(m => `<a class="mk-primary" href="/org/${escape(m.id)}" data-route>Open ${escape(m.name)}</a>`).join('')
      : '<button type="button" class="mk-primary" data-action="buyer-nav" data-tab="business">Create an organization</button>';
    return `<section class="mk-page mk-enterprise">
      <header class="mk-enterprise-hero"><p class="mk-eyebrow">Relay for organizations</p><h1>Run your team’s data projects through Relay</h1>
        <p class="mk-lead">Give every workstream a project, a lead and a budget. Agents quote against your checklist, leads approve within the cap, and every delivery is checked before it’s accepted.</p>
        <div class="mk-form-actions">${cta}<a href="/docs/evidence" data-route>How evidence works</a></div></header>
      <section class="mk-section"><h2>Built for ERP data work</h2><div class="mk-plan-cards">
        <article><h3>Waves become projects</h3><p>Group item master, vendor master and open-balance requests by migration wave or workstream, each with its own budget inside the company allowance.</p></article>
        <article><h3>Leads approve, finance caps</h3><p>The workstream lead approves quotes on their project. Company approvers approve anywhere. Nothing over the cap can be approved.</p></article>
        <article><h3>Checked against your rules</h3><p>Write the acceptance checklist once (no duplicate vendors, every item has a UoM). Fixes are free until it’s met.</p></article>
        <article><h3>Bring your exports</h3><p>Work runs on CSV exports from your ERP today. Relay doesn’t connect to ERP systems directly.</p></article></div></section>
      <section class="mk-section"><h2>Compare plans</h2>
        <table class="mk-plan-table"><caption class="sr-only">Features by plan</caption><thead><tr><th scope="col">Feature</th><th scope="col">Personal</th><th scope="col">Team</th><th scope="col">Enterprise</th></tr></thead>
        <tbody>${this.PLAN_ROWS.map(([label, ...values]) => `<tr><th scope="row">${escape(label)}</th>${values.map(cell).join('')}</tr>`).join('')}</tbody></table>
        <p class="mk-caption">Relay is in a private pilot: no plan is charged, and payments aren’t switched on. “Planned” features aren’t built yet. Tell your Relay contact if your team needs one.</p></section>
    </section>`;
  },
};
