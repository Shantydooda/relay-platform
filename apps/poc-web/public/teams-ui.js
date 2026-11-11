'use strict';
const RelayTeams = {
  entryTenant(memberships, currentId) {
    if (memberships.some(item => item.id === currentId && item.company)) return currentId;
    const companies = memberships.filter(item => item.company);
    return companies.length === 1 ? companies[0].id : currentId;
  },
  role(role) {
    return (
      {
        owner: 'Administrator',
        approver: 'Budget approver',
        employee: 'Employee',
      }[role] || role
    );
  },
  history() {
    const history = state.teamHistory;
    const labels = {
      'workspace.created': 'Created workspace',
      'invitation.created': 'Invited teammate',
      'invitation.accepted': 'Joined workspace',
      'invitation.revoked': 'Revoked invitation',
      'member.removed': 'Removed access',
      'member.role_changed': 'Changed role',
    };
    return `<details class="business-card business-history"><summary>Access history <span>Membership and role changes</span></summary><div class="business-disclosure-body">${(history?.entries || []).map((entry) => `<article class="business-history-row"><span class="business-history-dot" aria-hidden="true"></span><div><strong>${escape(labels[entry.action] || entry.action)}</strong><p>${escape(entry.subjectName)} · ${escape(entry.actorName)}${entry.details?.from ? ` · ${escape(entry.details.from)} → ${escape(entry.details.to)}` : ''}</p></div><time>${escape(new Date(entry.createdAt).toLocaleString())}</time></article>`).join('') || '<p class="muted">No access changes yet.</p>'}<div class="inline-actions">${state.teamHistoryBefore ? '<button data-action="team-history">Latest changes</button>' : ''}${history?.nextCursor ? `<button data-action="team-history" data-before="${escape(history.nextCursor)}">Older changes</button>` : ''}</div></div></details>`;
  },
  create() {
    return `<form id="team-create" class="market-form"><label>Company name<input name="name" maxlength="80" required placeholder="e.g. Northstar Studio" autocomplete="organization"></label><div class="form-error" role="alert"></div><button class="primary" type="submit">Create workspace</button></form>`;
  },
  join() {
    return `<form id="team-preview" class="market-form"><label>Invitation token<input name="token" value="${escape(state.teamInviteToken || '')}" required autocomplete="off" placeholder="Paste the token from your invitation"></label><p class="hint">Review the company and your role before joining. Sign in with the email that was invited.</p><div class="form-error" role="alert"></div><button type="submit">Review invitation</button></form>${state.invitationPreview ? `<form id="team-accept" class="market-form business-invite-result"><h3>Join ${escape(state.invitationPreview.name)}</h3><p>${escape(this.role(state.invitationPreview.role))} · Your personal workspace stays separate.</p><input type="hidden" name="token" value="${escape(state.teamInviteToken)}"><div class="form-error" role="alert"></div><button class="primary" type="submit">Accept invitation</button></form>` : ''}`;
  },
  switcher() {
    return `<label class="business-switcher">Working in<select aria-label="Working in" id="team-workspace">${state.account.memberships.map((m) => `<option value="${escape(m.id)}" ${state.tenantId === m.id ? 'selected' : ''}>${escape(m.name)} · ${escape(this.role(m.role))}</option>`).join('')}</select></label>`;
  },
  personal() {
    return `<section class="market-workspace business-workspace"><header class="builder-page-title"><div><span class="eyebrow">WORK BETTER TOGETHER</span><h1>A home for your team.</h1><p>Bring company requests, people and approvals into one workspace.</p></div></header>${state.account.memberships.length > 1 ? this.switcher() : ''}<div class="business-welcome-grid"><section class="business-card business-start"><span class="business-symbol" aria-hidden="true">▦</span><h2>Make room for company work.</h2><p>Set up a shared workspace. Your personal conversations and tasks stay separate.</p><ul class="business-benefits"><li><strong>One place for requests</strong><span>Employees request work; administrators keep an overview.</span></li><li><strong>Clear budget decisions</strong><span>Review the exact offer before reserving an allowance.</span></li><li><strong>Access you control</strong><span>Invite people, assign roles and keep a history of changes.</span></li></ul></section><section class="business-card"><span class="eyebrow">START YOUR WORKSPACE</span><h2>What’s your company called?</h2><p>You’ll be its administrator. Invite your team once you’re ready.</p>${this.create()}</section></div><details class="business-card business-join" ${state.teamInviteToken || state.invitationPreview ? 'open' : ''}><summary>Already invited? <span>Join an existing workspace</span></summary><div class="business-disclosure-body">${this.join()}</div></details></section>`;
  },
  member(member) {
    const edit = member.role !== 'owner';
    return `<article class="business-member"><span class="business-avatar" aria-hidden="true">${escape((member.name || '?').slice(0, 1).toUpperCase())}</span><div class="business-member-identity"><strong>${escape(member.name)}</strong><span>${escape(member.email)}</span></div><span class="tag">${escape(this.role(member.role))}</span>${edit ? `<details class="business-member-manage" data-disclosure-key="member-${escape(member.id)}" ${state.teamRemoval === member.id ? 'open' : ''}><summary>Manage</summary><div class="business-member-settings"><form id="team-role-${escape(member.id)}" class="market-form"><input type="hidden" name="memberId" value="${escape(member.id)}"><input type="hidden" name="expectedRole" value="${escape(member.role)}"><label>Role for ${escape(member.name)}<select name="role"><option value="employee" ${member.role === 'employee' ? 'selected' : ''}>Employee — request work</option><option value="approver" ${member.role === 'approver' ? 'selected' : ''}>Approver — review budgets</option></select></label><div class="form-error" role="alert"></div><button type="submit">Save role</button></form>${state.teamRemoval === member.id ? `<div class="business-removal" role="alert"><p>Remove ${escape(member.name)}? Company access ends immediately. Existing work and history stay with the company.</p><button data-action="team-remove" data-member="${escape(member.id)}">Confirm removal</button><button data-action="team-remove-cancel">Keep access</button></div>` : `<button class="quiet" data-action="team-remove" data-member="${escape(member.id)}">Remove access</button>`}</div></details>` : ''}</article>`;
  },
  people(team) {
    return `<section class="business-card"><header class="business-section-heading"><div><h2>People</h2><p>Everyone with access to ${escape(team.name)}.</p></div><span class="tag">${team.members.length} members</span></header><div class="business-members">${team.members.map((m) => this.member(m)).join('')}</div><details class="business-invite" ${state.teamInviteLink ? 'open' : ''}><summary>Invite a teammate</summary><div class="business-disclosure-body"><form id="team-invite" class="market-form"><label>Email<input type="email" name="email" required placeholder="teammate@company.com"></label><label>Role<select name="role"><option value="employee">Employee — request work</option><option value="approver">Approver — review budget requests</option></select></label><p class="hint">Local testing: share the generated link yourself. No email is sent.</p><div class="form-error" role="alert"></div><button class="primary" type="submit">Create invitation</button></form>${state.teamInviteLink ? `<div class="business-invite-result" role="status"><strong>Ready to share</strong><label>Local invitation link<input readonly value="${escape(state.teamInviteLink)}"></label><p>Expires in 24 hours. Save this link now; it is shown once.</p></div>` : ''}</div></details>${team.invites.length ? `<details class="business-invite"><summary>Invitations <span>${team.invites.filter((i) => i.status === 'pending').length} pending</span></summary><div class="business-disclosure-body">${team.invites.map((i) => `<article class="business-invitation-row"><div><strong>${escape(i.email)}</strong><p>${escape(this.role(i.role))} · ${escape(i.status)}</p></div>${i.status === 'pending' ? `<div class="inline-actions"><button data-action="team-revoke" data-invite="${escape(i.id)}">${state.teamRemoval === i.id ? 'Confirm revocation' : 'Revoke invitation'}</button>${state.teamRemoval === i.id ? '<button data-action="team-remove-cancel">Keep invitation</button>' : ''}</div>` : ''}</article>`).join('')}</div></details>` : ''}</section>`;
  },
  page() {
    const team = state.team;
    if (!team) return this.personal();
    const role = team.role;
    const guidance =
      role === 'owner'
        ? 'Manage your people, review requests and keep work moving.'
        : role === 'approver'
          ? 'Review the offer and request reason, then approve or send feedback.'
          : 'Request work and track your budget decisions in one place.';
    return `<section class="market-workspace business-workspace"><header class="builder-page-title"><div><span class="eyebrow">BUSINESS WORKSPACE · ${escape(this.role(role))}</span><h1>${escape(team.name)}</h1><p>${guidance}</p></div>${role !== 'approver' ? '<button class="primary" data-action="new">Request work here</button>' : '<span class="tag">Budget review</span>'}</header><div class="business-context">${this.switcher()}<p>${role === 'employee' ? 'You see your own requests. Your administrator manages people and permissions.' : role === 'approver' ? 'Your role reviews company budgets. Switch to your personal workspace to request your own work.' : 'Company work stays in this workspace. Personal work stays in yours.'}</p></div>${typeof RelayApprovals === 'object' ? RelayApprovals.workspace() : ''}${role === 'owner' ? this.people(team) + this.history() : ''}<details class="business-card business-join" ${state.teamInviteToken || state.invitationPreview ? 'open' : ''}><summary>Workspace settings <span>Create or join another workspace</span></summary><div class="business-settings-grid business-disclosure-body"><section><h3>Create another workspace</h3>${this.create()}</section><section><h3>Join a workspace</h3>${this.join()}</section></div></details></section>`;
  },
};
