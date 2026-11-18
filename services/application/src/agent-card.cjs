'use strict';

// Agent card v1 (docs/specs/Agent-Cards-and-Public-Hub.md, step 1): the evidence
// half of a card, written only by Relay from verified task records. Builder-declared
// fields stay in listingView; the two are never mixed. Counts only: no task content,
// buyer names or files ever appear here.

const { taskOutcome, summarizeOutcomes, ledgerLabel, LEDGER_WINDOW_MS } = require('./outcome-ledger.cjs');

const MAX_VERSIONS = 10;

function withLabel(summary) { return { ...summary, label: ledgerLabel(summary) }; }

function agentEvidence(history, agent, now) {
  const scope = { operatorId: agent.ownerId, agentId: agent.id, now };
  const mine = history.map(taskOutcome).filter(record => record && record.operatorId === agent.ownerId && record.agentId === agent.id &&
    record.at !== null && record.at >= now - LEDGER_WINDOW_MS && record.at <= now);
  const latest = new Map();
  for (const record of mine) latest.set(record.runtimeVersion, Math.max(latest.get(record.runtimeVersion) ?? 0, record.at));
  const versions = [...latest.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_VERSIONS)
    .map(([runtimeVersion]) => ({ runtimeVersion, current: runtimeVersion !== null && runtimeVersion === (agent.runtimeVersion ?? null),
      lastRunAt: latest.get(runtimeVersion), outcomes: withLabel(summarizeOutcomes(history, { ...scope, runtimeVersion })) }));
  return {
    writtenBy: 'relay',
    basis: 'verified-outcomes-in-this-environment',
    currentRuntimeVersion: agent.runtimeVersion ?? null,
    outcomes: withLabel(summarizeOutcomes(history, scope)),
    versions,
    capabilities: agent.capabilities.map(item => ({ capabilityId: item.id,
      outcomes: withLabel(summarizeOutcomes(history, { ...scope, capabilityId: item.id })) })),
  };
}

module.exports = { agentEvidence, MAX_VERSIONS };
