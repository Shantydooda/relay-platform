'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { text } = require('../../../packages/ui/src/components.cjs');
function fixture(role = 'owner', drive = {}) {
  const state = {
    tenantId: 'team',
    account: { memberships: [{ id: 'team', role }] },
    features: { driveConnections: true },
    drive,
  };
  const ctx = vm.createContext({ state, escape: text });
  vm.runInContext(
    fs.readFileSync(
      path.join(__dirname, '../public/workspace-apps-ui.js'),
      'utf8',
    ),
    ctx,
  );
  return vm.runInContext('RelayApps', ctx);
}
test('catalog never presents unimplemented connectors as connected or actionable', () => {
  const html = fixture().toolLibrary();
  assert.match(html, /Setup required/);
  assert.doesNotMatch(html, /data-action="app-drive-connect"/);
  for (const provider of ['Slack', 'HubSpot', 'Notion']) {
    const card = html
      .split('<article')
      .find((part) => part.includes(`<h2>${provider}</h2>`))
      .split('</article>')[0];
    assert.match(card, /Not available yet/);
    assert.doesNotMatch(card, /<button/);
  }
  assert.match(
    fixture('owner', { configured: true }).toolLibrary(),
    /Ready to connect/,
  );
  assert.match(
    fixture('owner', { connected: true, configured: true }).toolLibrary(),
    /Connected/,
  );
});
test('configured Drive can begin OAuth directly from its card', () => {
  assert.match(
    fixture('owner', { configured: true }).toolLibrary(),
    /data-action="app-drive-connect"/,
  );
  assert.doesNotMatch(
    fixture('owner', { configured: true, connected: true }).toolLibrary(),
    /data-action="app-drive-connect"/,
  );
});

test('employees see administrator-managed connection without owner-only actions', () => {
  const html = fixture('employee', { connected: true }).toolLibrary();
  assert.match(html, /Administrator managed/);
  assert.doesNotMatch(html, /data-tool="drive"/);
  assert.match(html, /View sources/);
  assert.equal(fixture('employee').driveCard(), '');
});
test('search and category intersect and can recover from no matches', () => {
  const cards = [
    {
      dataset: {
        search: 'google drive documents',
        category: 'Files & knowledge',
      },
    },
    { dataset: { search: 'slack team', category: 'Communication' } },
  ];
  const search = { value: 'DRIVE' },
    category = { value: 'All categories' },
    empty = {};
  const root = {
    querySelector: (selector) =>
      ({
        '[data-tool-search]': search,
        '[data-tool-category]': category,
        '[data-tool-empty]': empty,
      })[selector],
    querySelectorAll: () => cards,
  };
  const ui = fixture();
  ui.filterTools(root);
  assert.equal(cards[0].hidden, false);
  assert.equal(cards[1].hidden, true);
  category.value = 'Communication';
  ui.filterTools(root);
  assert.equal(empty.hidden, false);
  search.value = '';
  ui.filterTools(root);
  assert.equal(cards[1].hidden, false);
  assert.equal(empty.hidden, true);
});
