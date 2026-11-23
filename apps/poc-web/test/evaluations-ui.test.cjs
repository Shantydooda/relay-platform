'use strict';
// Open evaluations in the app: the builder's panel (supplier-ui.js), the agent
// page section and the docs guide (marketplace-ui.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
function load(state, files) {
  const context = vm.createContext({ state, escape, date: () => 'Nov 22', Date, Intl, module: undefined });
  for (const file of files) vm.runInContext(fs.readFileSync(require.resolve(`../public/${file}`), 'utf8'), context);
  return context;
}
const suites = {
  limits: { runsPerDay: 3 },
  suites: [
    { key: 'company-research-fields@1', version: 1, title: 'Company research fields', categoryId: 'market-research', category: 'Company & market research', brief: 'Return the fields.', limitation: 'Five synthetic pages.', fields: ['company', 'country'], items: [{ id: 'c1', input: 'Halcyon <Freight> page' }], checks: 2 },
    { key: 'lead-list-fields@1', version: 1, title: 'Lead list fields', categoryId: 'lead-lists', category: 'Lead lists & prospecting', brief: 'Find the lead.', limitation: 'Five synthetic team pages.', fields: ['name'], items: [{ id: 'l1', input: 'Team page' }], checks: 1 },
  ],
};
const agent = {
  id: 'a1', capabilities: [{ id: 'k1', task: 'Research companies', categoryId: 'market-research', qualification: 'unverified' }], runtime: { connected: true },
  evaluations: { runs: [{ id: 'r1', suite: 'company-research-fields@1', status: 'scored', score: { correct: 17, total: 25, items: 5 } }],
    evidence: [{ suite: 'company-research-fields@1', title: 'Company research fields', version: 1, correct: 17, total: 25, items: 5, scoredAt: 1, runtimeName: 'R', runtimeVersion: '1' }] },
};

test('builders run the suites in their agent’s categories and see only their totals', () => {
  const ctx = load({ evaluationSuites: suites, relayTests: { approved: [] } }, ['supplier-ui.js']);
  ctx.agent = agent;
  const html = vm.runInContext('RelaySupplier.evaluations(agent)', ctx);
  assert.match(html, /Open evaluations/);
  assert.match(html, /data-action="start-evaluation" data-id="a1" data-suite="company-research-fields@1"/);
  assert.doesNotMatch(html, /Lead list fields/, 'only suites in its categories');
  assert.match(html, /On the agent card: <strong>17 of 25 fields correct · 5 items<\/strong>/);
  assert.match(html, /no pass mark and it doesn’t unlock publishing/);
  assert.match(html, /3 times a day/);

  ctx.agent = { ...agent, runtime: { connected: false }, evaluations: { runs: [], evidence: [] } };
  const offline = vm.runInContext('RelaySupplier.evaluations(agent)', ctx);
  assert.match(offline, /data-suite="company-research-fields@1" disabled/);
  assert.match(offline, /No score on the card yet/);
  ctx.agent = { ...agent, capabilities: [{ categoryId: 'translation' }] };
  assert.match(vm.runInContext('RelaySupplier.evaluations(agent)', ctx), /No suite covers this agent’s categories yet/);
});

test('an agent page shows each score with its sample and a synthetic-data label, and nothing without one', () => {
  const ctx = load({}, ['marketplace-ui.js']);
  ctx.m = { evaluations: agent.evaluations.evidence };
  const html = vm.runInContext('RelayMarketplace.evaluationsSection(m)', ctx);
  assert.match(html, /Company research fields[\s\S]*17 of 25 fields correct · 5 items/);
  assert.match(html, /Relay evaluation on synthetic data, not buyer work/);
  assert.match(html, /doesn’t change where the agent appears/);
  ctx.m = { evaluations: [] };
  assert.equal(vm.runInContext('RelayMarketplace.evaluationsSection(m)', ctx), '');
});

test('the docs guide lists every suite’s inputs, escaped', () => {
  const ctx = load({ evaluationSuites: suites, docPage: 'evaluations' }, ['marketplace-ui.js']);
  assert.deepEqual({ ...vm.runInContext('RelayMarketplace.parse("/docs/evaluations")', ctx) }, { page: 'docs', id: 'evaluations' });
  const html = vm.runInContext('RelayMarketplace.docsPage("evaluations")', ctx);
  assert.match(html, /<h1 id="mk-evidence-title">Open evaluations/);
  assert.match(html, /Halcyon &#60;Freight&#62; page/);
  assert.match(html, /Lead list fields/);
  assert.match(html, /Answers stay private/);
});
