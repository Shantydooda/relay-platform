'use strict';
// Organizations, projects and the Enterprise page (docs/specs/Enterprise-and-Projects.md):
// Hugging Face's org/resource-group/plan structure with Relay's company workspace.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function ui(state = {}) {
  const context = vm.createContext({ state, Intl, Date, escape: value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`) });
  for (const file of ['work-state-ui.js', 'marketplace-ui.js', 'approvals-ui.js', 'teams-ui.js', 'org-ui.js'])
    vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return { m: vm.runInContext('RelayMarketplace', context), org: vm.runInContext('RelayOrg', context) };
}
const ORG = 'c0000000-0000-4000-8000-000000000001', PROJECT = 'd0000000-0000-4000-8000-000000000001', TASK = 'a0000000-0000-4000-8000-000000000001';
const account = role => ({ user: { id: 'u-' + role, name: 'Sam' }, memberships: [{ id: 'p0000000-0000-4000-8000-000000000001', role: 'owner' }, { id: ORG, name: 'Northwind ERP', role, company: true }] });
const budget = { capMinor: 80000, reservedMinor: 50000, committedMinor: 0, availableMinor: 30000, currency: 'USD' };
const project = { id: PROJECT, tenantId: ORG, name: 'NetSuite migration – Wave 2', description: 'Item and vendor master', leadId: 'u-lead', memberIds: ['u-employee'], capMinor: 80000, status: 'active', version: 2, updatedAt: Date.now(), leadName: 'Lee', taskCount: 1, budget, you: { lead: false, member: true } };
const team = { name: 'Northwind ERP', role: 'owner', members: [{ id: 'u-owner', name: 'Sam', role: 'owner' }, { id: 'u-lead', name: 'Lee', role: 'employee' }], invites: [] };
const pendingTask = (canDecide) => ({ id: TASK, title: 'Vendor master dedupe', status: 'selected', updatedAt: Date.now(), work: { reason: 'APPROVAL_PENDING', phase: 'starting', waitingOn: 'approver' }, package: null, chosenOffer: null, offerCount: 1,
  approval: { id: 'ap1', status: 'pending', version: 1, note: 'Cutover in March', agreement: { agentName: 'CSV Cleaner', amountMinor: 50000, scopeVersion: 1 } },
  approvalActions: { approve: { allowed: canDecide, reason: canDecide ? '' : 'Your company role cannot perform this action.' }, decline: { allowed: canDecide } } });

test('routes: organization tabs, project pages and /enterprise are real paths', () => {
  const { m } = ui({});
  assert.deepEqual({ ...m.parse(`/org/${ORG}`) }, { page: 'org', id: ORG, tab: 'projects' });
  assert.deepEqual({ ...m.parse(`/org/${ORG}/members`) }, { page: 'org', id: ORG, tab: 'members' });
  assert.deepEqual({ ...m.parse(`/org/${ORG}/projects/${PROJECT}`) }, { page: 'project', id: ORG, projectId: PROJECT });
  assert.deepEqual({ ...m.parse('/enterprise') }, { page: 'enterprise', id: null });
  assert.equal(m.parse(`/org/${ORG}/billing`).page, null);
  const target = { account: account('owner') };
  m.apply(m.parse(`/org/${ORG}/projects/${PROJECT}`), target);
  assert.equal(target.tenantId, ORG, 'opening an organization works in it');
  assert.equal(m.path(target), `/org/${ORG}/projects/${PROJECT}`);
  m.apply(m.parse(`/org/${ORG}/spending`), target);
  assert.equal(m.path(target), `/org/${ORG}/spending`);
  m.apply(m.parse('/enterprise'), target);
  assert.equal(m.path(target), '/enterprise');
});

test('organization page: owners get New project and Settings; employees do not', () => {
  const { org } = ui({ account: account('owner'), buyerTab: 'org', orgId: ORG, orgTab: 'projects', projects: [project], team, projectCreateOpen: true });
  const html = org.page();
  assert.match(html, /northwind-erp/);
  assert.match(html, new RegExp(`href="/org/${ORG}/settings"`));
  assert.match(html, /\+ New project/);
  assert.match(html, /id="project-create"/);
  assert.match(html, /<option value="u-lead"/, 'the lead is picked from company members');
  assert.match(html, /\$300\.00 left of \$800\.00/);
  assert.match(html, /Lead Lee/);
  const employee = ui({ account: account('employee'), buyerTab: 'org', orgId: ORG, orgTab: 'settings', projects: [project], team: { ...team, role: 'employee', members: [] } }).org.page();
  assert.doesNotMatch(employee, /\/settings"/);
  assert.doesNotMatch(employee, /New project/);
  assert.match(employee, /NetSuite migration/, 'an unknown tab falls back to Projects');
});

test('non-members see an honest unavailable page', () => {
  const { org } = ui({ account: { user: { id: 'x', name: 'X' }, memberships: [] }, buyerTab: 'org', orgId: ORG });
  assert.match(org.page(), /Organization unavailable/);
});

test('project page: the lead decides in place; members see the request but no decision form', () => {
  const data = (lead) => ({ project, budget, members: [{ id: 'u-lead', name: 'Lee', role: 'lead', active: true }, { id: 'u-employee', name: 'Ana', role: 'member', active: false }],
    tasks: [pendingTask(lead)], you: { owner: false, lead, member: true } });
  const lead = ui({ account: account('employee'), buyerTab: 'org', orgId: ORG, projectId: PROJECT, project: data(true), tasks: [] }).org.page();
  assert.match(lead, /data-approval-task="a0000000-0000-4000-8000-000000000001"/, 'reuses the approval decision form');
  assert.match(lead, /Cutover in March/);
  assert.match(lead, /Post a request in this project/);
  assert.match(lead, /1 request<\/strong> waiting/);
  const member = ui({ account: account('employee'), buyerTab: 'org', orgId: ORG, projectId: PROJECT, project: data(false), tasks: [] }).org.page();
  assert.doesNotMatch(member, /data-approval-task/);
  assert.match(member, /Waiting for approval/);
  const members = ui({ account: account('employee'), buyerTab: 'org', orgId: ORG, projectId: PROJECT, projectTab: 'members', project: data(false), tasks: [] }).org.page();
  assert.match(members, /no longer in the company/);
  assert.doesNotMatch(members, /id="project-edit"/, 'only owners edit a project');
});

test('the Enterprise page claims only what is built', () => {
  const { org } = ui({ account: account('owner') });
  const html = org.enterprise();
  assert.match(html, /Single sign-on \(SAML\) and SCIM provisioning<\/th><td class="mk-plan-none">.*?<\/td><td class="mk-plan-none">.*?<\/td><td class="mk-plan-planned">Planned/);
  assert.match(html, /Projects with members, a lead and a budget cap<\/th><td class="mk-plan-none">.*?<\/td><td class="mk-plan-live">/);
  assert.match(html, /doesn’t connect to ERP systems directly/);
  assert.match(html, /no plan is charged/);
  assert.match(html, new RegExp(`href="/org/${ORG}"`), 'members get a link to their organization');
  assert.doesNotMatch(html, /\$\d/, 'no invented prices');
});

test('Post a request offers organizations and projects, preselecting the project you came from', () => {
  const { m } = ui({ account: account('employee'), tenantId: 'p0000000-0000-4000-8000-000000000001',
    postTargets: [{ tenantId: ORG, name: 'Northwind ERP', projects: [project] }], postTarget: { tenantId: ORG, projectId: PROJECT } });
  const html = m.post();
  assert.match(html, /Where does this belong\?/);
  assert.match(html, /<option value="p0000000-0000-4000-8000-000000000001\|" >Personal workspace/);
  assert.match(html, new RegExp(`<option value="${ORG}\\|${PROJECT}" selected>Northwind ERP / NetSuite migration – Wave 2`));
  const solo = ui({ account: { user: { id: 'u', name: 'U' }, memberships: [{ id: 'p1', role: 'owner' }] }, postTargets: [] }).m.post();
  assert.doesNotMatch(solo, /Where does this belong/, 'people without an organization see no extra field');
});

test('owners’ Settings: the publishing switch and an audit log with file access and a CSV download', () => {
  const entries = [{ at: Date.now(), actor: 'Other Builder', action: 'File downloaded', filename: 'vendors-clean.csv', taskTitle: 'Vendor master dedupe', detail: '' },
    { at: Date.now() - 60000, actor: 'Sam', action: 'Organization setting changed', filename: '', taskTitle: '', detail: 'Members can publish agents: off' }];
  const { org } = ui({ account: account('owner'), orgId: ORG, orgPolicy: { membersCanPublish: false, version: 3 }, orgAudit: { entries, limits: 'Up to 100 requests.' } });
  const html = org.settingsTab();
  assert.match(html, /<form id="org-policy"[^>]*data-version="3"/);
  assert.doesNotMatch(html, /name="membersCanPublish" checked/, 'shows the saved setting');
  assert.match(html, /File downloaded · <code>vendors-clean\.csv<\/code>/);
  assert.match(html, /Members can publish agents: off/);
  assert.match(html, new RegExp(`href="/api/teams/${ORG}/audit\\?format=csv" download`));
});
