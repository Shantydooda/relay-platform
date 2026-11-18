'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { agentEvidence, MAX_VERSIONS } = require('../src/agent-card.cjs');
const { summarizeOutcomes } = require('../src/outcome-ledger.cjs');

const DAY = 86400000, NOW = 1000 * DAY;
let seq = 0;
function run({ status = 'accepted', version = '2.0.0', at = NOW - DAY, agentId = 'agent', operatorId = 'owner', capabilityId = 'research', content = 'secret buyer brief' } = {}) {
  const id = `t${++seq}`;
  return { id, brief: content, buyerName: 'Acme', offers: [{ id: `${id}-o`, capabilityId }], submissions: [],
    assignment: { id: `${id}-j`, offerId: `${id}-o`, agentId, operatorId, status, runtimeVersion: version,
      acceptedAt: status === 'accepted' ? at : undefined, endedAt: status === 'failed' ? at : undefined } };
}
const agent = { id: 'agent', ownerId: 'owner', runtimeVersion: '2.0.0', capabilities: [{ id: 'research' }, { id: 'leads' }] };

test('the card reports outcomes per runtime version, newest first, marking the current one', () => {
  const history = [run({ version: '1.0.0', at: NOW - 30 * DAY, status: 'failed' }), run({ version: '1.0.0', at: NOW - 20 * DAY }),
    run({ version: '2.0.0' }), run({ version: '2.0.0', status: 'failed' }), run({ version: null, at: NOW - 60 * DAY })];
  const card = agentEvidence(history, agent, NOW);
  assert.deepEqual(card.versions.map(v => [v.runtimeVersion, v.current, v.outcomes.runs]), [['2.0.0', true, 2], ['1.0.0', false, 2], [null, false, 1]]);
  assert.equal(card.outcomes.runs, 5);
  assert.equal(card.versions.reduce((sum, v) => sum + v.outcomes.runs, 0), card.outcomes.runs);
  assert.equal(card.writtenBy, 'relay');
  assert.match(card.versions[0].outcomes.label, /2 runs .* 1 failed .* in this environment/);
});

test('a version earns no rate below the minimum sample, and every run keeps its denominator', () => {
  const history = Array.from({ length: 19 }, () => run());
  assert.equal(agentEvidence(history, agent, NOW).versions[0].outcomes.acceptedRate, null);
  history.push(run({ status: 'failed' }));
  assert.equal(agentEvidence(history, agent, NOW).versions[0].outcomes.acceptedRate, 19 / 20);
});

test('only this agent, its owner and the ledger window count; other agents and builders never leak in', () => {
  const history = [run(), run({ agentId: 'other-agent' }), run({ operatorId: 'someone-else' }), run({ at: NOW - 200 * DAY })];
  const card = agentEvidence(history, agent, NOW);
  assert.equal(card.outcomes.runs, 1);
  assert.deepEqual(card.capabilities.map(c => [c.capabilityId, c.outcomes.runs]), [['research', 1], ['leads', 0]]);
});

test('no buyer content reaches the card, and the version list is bounded', () => {
  const history = Array.from({ length: MAX_VERSIONS + 5 }, (_, i) => run({ version: `0.${i}.0`, at: NOW - (i + 1) * DAY }));
  const card = agentEvidence(history, agent, NOW);
  assert.equal(card.versions.length, MAX_VERSIONS);
  assert.equal(card.versions[0].runtimeVersion, '0.0.0');
  assert.doesNotMatch(JSON.stringify(card), /secret buyer brief|Acme|t\d+-/);
});

test('the ledger filter separates unstamped runs from stamped ones', () => {
  const history = [run({ version: null }), run({ version: '2.0.0' })];
  assert.equal(summarizeOutcomes(history, { now: NOW, runtimeVersion: null }).runs, 1);
  assert.equal(summarizeOutcomes(history, { now: NOW }).runs, 2);
});
