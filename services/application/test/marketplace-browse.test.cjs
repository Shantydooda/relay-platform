'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browseRow, buyersFor, workingConnectors } = require('../src/marketplace-browse.cjs');

const NOW = 100 * 86400000;
const agent = { id: 'a1', ownerId: 'op', name: 'csv-normalizer', operatorName: 'Tidy Rows', purpose: 'Cleans CSVs', kind: 'specialist',
  runtimeVersion: '1.3.0', runtimeVersionSince: NOW - 86400000, createdAt: NOW - 5 * 86400000, runtimeKind: 'supplier-hosted',
  capabilities: [{ id: 'c1', assessmentId: 't1' }], assessments: [{ id: 't1', rubric: 'csv-normalize-v1', runtimeVersion: '1.3.0', completedAt: NOW - 1000 }] };
const listing = (qualification = 'qualified', tools = []) => ({ availability: qualification === 'qualified' ? 'available' : 'qualification_pending',
  capabilities: [{ id: 'c1', category: 'CSV cleanup', task: 'Normalize CSV', qualification, metadata: { outputs: ['CSV'], tools } }] });
let n = 0;
function run(tenantId, status, { at = NOW - 1000, revisions = 0, agentId = 'a1' } = {}) {
  n++;
  return { id: `t${n}`, tenantId, offers: [{ id: `o${n}` }], submissions: Array.from({ length: revisions }, () => ({ status: 'revision_requested' })),
    assignment: { id: `j${n}`, offerId: `o${n}`, operatorId: 'op', agentId, status, acceptedAt: at, endedAt: at, cancelledAt: at } };
}
const row = (history, extra = {}) => browseRow({ agent, listing: listing(extra.qualification, extra.tools), history, now: NOW,
  connectors: extra.connectors || [], actor: { user: { id: extra.viewer || 'buyer' } } });

test('a row shows what is built and leaves the rest empty, never invented', () => {
  const r = row([]);
  assert.deepEqual(r.waysToBuy, ['commission']);
  assert.deepEqual(r.packages, []);
  assert.equal(r.fromPrice, null);
  assert.equal(r.hostedOnRelay, false);
  assert.equal(r.isNew, true, 'passed the Relay test with no runs yet');
  assert.deepEqual(r.relayTest, { passed: true, title: 'CSV normalization', rubric: 'csv-normalize-v1', runtimeVersion: '1.3.0', completedAt: NOW - 1000 });
  assert.equal(r.version, '1.3.0');
  assert.equal(r.own, false);
  assert.equal(row([], { viewer: 'op' }).own, true);
  const untested = row([], { qualification: 'unverified' });
  assert.equal(untested.relayTest.passed, false);
  assert.equal(untested.isNew, false);
});

test('evidence counts every decided run, failures included, and shows a rate only from 20', () => {
  const history = [run('b1', 'accepted'), run('b1', 'accepted', { revisions: 1 }), run('b2', 'failed'), run('b2', 'cancelled'),
    run('b3', 'accepted', { at: NOW - 91 * 86400000 }), run('b4', 'accepted', { agentId: 'other' })];
  const r = row(history);
  assert.equal(r.evidence.runs, 3, 'cancelled, out-of-window and other agents are not counted');
  assert.equal(r.evidence.failed, 1);
  assert.equal(r.evidence.accepted_after_revision, 1);
  assert.equal(r.evidence.acceptedRate, null);
  assert.equal(r.isNew, false);
  const many = Array.from({ length: 20 }, (_, i) => run(`m${i}`, i < 17 ? 'accepted' : 'failed'));
  assert.equal(row(many).evidence.acceptedRate, 17 / 20);
});

test('repeat buyers accepted work at least twice in the window', () => {
  const history = [run('b1', 'accepted'), run('b1', 'accepted'), run('b2', 'accepted'), run('b2', 'failed'), run('b3', 'cancelled')];
  assert.deepEqual(buyersFor(history, agent, NOW), { total: 2, repeat: 1 });
});

test('"works with" lists only connectors that are configured here', () => {
  assert.deepEqual(workingConnectors({ capabilities: { driveConnections: true, attioDelivery: true } }), []);
  assert.deepEqual(workingConnectors({ capabilities: { driveConnections: true, attioDelivery: false }, driveProvider: {}, attioProvider: {} }), ['Google Drive']);
  const r = row([], { tools: ['Google Drive', 'Salesforce'], connectors: ['Google Drive'] });
  assert.deepEqual(r.worksWith, ['Google Drive'], 'a declared tool without a working connector is not shown');
  assert.deepEqual(r.declaredTools, ['Google Drive', 'Salesforce']);
});
