'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function fixture() {
  const state = { work: [{ id: 'accepted', title: 'Accepted', execution: { agentId: 'agent', status: 'accepted' } }, { id: 'pending', title: 'Pending', execution: { agentId: 'agent', status: 'buyer_review' } }] };
  const ctx = vm.createContext({ state, escape: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') });
  vm.runInContext(fs.readFileSync(require.resolve('../public/portfolio-ui.js'), 'utf8') + '\nglobalThis.ui=RelayPortfolio;', ctx);
  return ctx.ui;
}
const example = { id: 'example', title: '<script>', summary: '<private>', sample: '<img onerror=bad>', kind: 'relay-task', version: 2, agentName: 'Agent' };
test('portfolio excerpts are escaped, distinguish approval from assessment and never embed files', () => {
  const html = fixture().storefront([example]);
  assert.match(html, /Customer-approved excerpt/);
  assert.match(html, /separate from Relay capability assessments/);
  assert.doesNotMatch(html, /<script>|<img|iframe|href=/);
  assert.match(html, /&lt;private>/);
});
test('sharing review exposes decisions only to authorized owner and only for current state', () => {
  const ui = fixture();
  assert.doesNotMatch(ui.requests([{ ...example, status: 'pending', canDecide: false }]), /data-decision=/);
  const pending = ui.requests([{ ...example, status: 'pending', canDecide: true }]);
  assert.match(pending, /data-decision="approve"/); assert.match(pending, /data-decision="decline"/);
  const approved = ui.requests([{ ...example, status: 'published', canDecide: true }]);
  assert.match(approved, /data-decision="revoke"/); assert.doesNotMatch(approved, /data-decision="approve"/);
  assert.doesNotMatch(ui.requests([{ ...example, status: 'revoked', canDecide: true }]), /data-decision=/);
});
test('builder chooses accepted work, confirms rights, and cannot edit an approved excerpt', () => {
  const html = fixture().settings({ id: 'agent', version: 4, portfolio: [{ ...example, status: 'published', taskId: 'source-task' }] });
  assert.match(html, /data-action="builder-task" data-id="source-task"/);
  assert.doesNotMatch(html, /href="#task=/);
  assert.match(html, /value="accepted"/); assert.doesNotMatch(html, /value="pending"/);
  assert.match(html, /type="checkbox" name="consent" required/);
  assert.match(html, /fresh approval/); assert.match(html, /data-decision="withdraw"/);
});
