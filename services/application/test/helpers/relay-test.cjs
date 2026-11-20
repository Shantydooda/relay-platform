'use strict';
const { randomUUID } = require('node:crypto');
const { normalizeCsv } = require('../../../agent-runtime/src/csv.cjs');

// Runs the real CSV Relay test for one capability through the application, as a
// connected runtime would: start, answer round 1, answer the revision round.
async function passRelayTest(app, builder, agentId, principal, capabilityId) {
  const agent = (await app.marketplace.agents(builder)).find(item => item.id === agentId);
  const capability = capabilityId || agent.capabilities[0].id;
  const assessment = await app.startQualification(builder, agentId, { expectedVersion: agent.version, capabilityId: capability, rubric: 'csv-normalize-v1' }, randomUUID());
  for (let round = 1; round <= 2; round++) {
    const job = (await app.qualificationJobs(principal)).find(item => item.id === assessment.assessmentId) || (await app.qualificationJobs(principal))[0];
    const output = normalizeCsv(Buffer.from(job.input), job.revision);
    const { inputRows, outputRows, duplicatesRemoved, sort } = output.report;
    await app.submitQualification(principal, assessment.assessmentId, { round, csv: output.csv.toString(), report: { inputRows, outputRows, duplicatesRemoved, sort } }, randomUUID());
  }
  return (await app.marketplace.agents(builder)).find(item => item.id === agentId);
}

module.exports = { passRelayTest };
