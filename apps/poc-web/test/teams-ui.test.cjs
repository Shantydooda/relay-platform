'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { text } = require('../../../packages/ui/src/components.cjs');
function fixture(role) {
  const state = {
    tenantId: 'company',
    account: {
      memberships: [
        { id: 'company', name: 'Northstar', role: role || 'owner' },
      ],
    },
    team: role
      ? {
          name: 'Northstar',
          role,
          members: [
            {
              id: 'owner',
              name: 'Owner',
              email: 'owner@example.test',
              role: 'owner',
            },
            {
              id: 'employee',
              name: '<img onerror=x>',
              email: 'employee@example.test',
              role: 'employee',
            },
          ],
          invites: [],
        }
      : null,
    companyBudget: role
      ? {
          budget: {
            limitMinor: 50000,
            availableMinor: 30000,
            reservedMinor: 10000,
            committedMinor: 10000,
          },
          requests: [],
        }
      : null,
  };
  const ctx = vm.createContext({ state, escape: text, Intl, Date });
  for (const file of ['approvals-ui.js', 'teams-ui.js'])
    vm.runInContext(
      readFileSync(join(__dirname, '../public', file), 'utf8'),
      ctx,
    );
  return { state, html: () => vm.runInContext('RelayTeams.page()', ctx) };
}
test('personal workspace has a focused setup view without admin or budget controls', () => {
  const f = fixture();
  const html = f.html();
  assert.match(html, /A home for your team/);
  assert.equal((html.match(/id="team-create"/g) || []).length, 1);
  assert.doesNotMatch(
    html,
    /Request work here|id="company-budget"|Access history/,
  );
});
test('administrator sees allowance, compact people, safe management and invitation forms', () => {
  const f = fixture('owner');
  const html = f.html();
  assert.match(html, /business-budget-stats/);
  assert.match(html, /\$300.00/);
  assert.match(html, /team-role-employee/);
  assert.match(html, /expectedRole/);
  assert.match(html, /id="team-invite"/);
  assert.doesNotMatch(html, /<img/);
  f.state.teamRemoval = 'employee';
  assert.match(f.html(), /Confirm removal/);
  assert.match(
    f.html(),
    /business-member-manage" data-disclosure-key="member-employee" open/,
  );
  f.state.teamInviteLink = 'http://127.0.0.1/#team-invite=fixture';
  assert.match(f.html(), /business-invite" open/);
});
test('employee and approver show role-specific actions without administrator forms', () => {
  for (const role of ['employee', 'approver']) {
    const html = fixture(role).html();
    assert.doesNotMatch(
      html,
      /id="company-budget"|id="team-invite"|team-role-employee|Access history/,
    );
    assert.equal(html.includes('Request work here'), role === 'employee');
  }
});
test('pending decisions preserve exact task and version bindings; content is escaped', () => {
  const f = fixture('approver');
  f.state.companyBudget.requests = [
    {
      id: 'approval',
      taskId: 'task',
      version: 7,
      status: 'pending',
      agreement: {
        title: '<script>bad</script>',
        agentName: 'Agent',
        amountMinor: 500,
        scopeVersion: 2,
        offerId: 'offer123456',
        expiresAt: Date.now(),
        brief: 'Brief',
      },
      note: 'Reason',
    },
  ];
  const html = f.html();
  assert.match(html, /data-version="7"/);
  assert.match(html, /data-approval-id="approval"/);
  assert.match(html, /Send decision/);
  assert.doesNotMatch(html, /<script>|Open task conversation/);
});

test('superseded requests cannot show a fresh decision control', () => {
  const f = fixture('approver');
  f.state.companyBudget.requests = [
    {
      id: 'old',
      taskId: 'task',
      version: 1,
      status: 'pending',
      superseded: true,
      agreement: {
        title: 'Old request',
        agentName: 'Agent',
        amountMinor: 100,
        scopeVersion: 1,
        offerId: 'old-offer',
        expiresAt: 1,
        brief: 'Old scope',
      },
      note: 'Reason',
    },
  ];
  assert.doesNotMatch(f.html(), /data-approval-task=/);
  assert.match(f.html(), /Previous request/);
});
