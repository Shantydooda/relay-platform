'use strict';
const { createLinkRuntime } = require('../../link-runtime/src/worker.cjs');
const { createModelProcessor } = require('./model.cjs');
function createModelRuntime({ model = 'qwen3:8b', modelFetch, ...options }) {
  return createLinkRuntime({
    ...options,
    processor: createModelProcessor({ model, fetchImpl: modelFetch }),
    profile: {
      name: `Relay local AI link extractor (${model})`,
      version: '1',
      maxInputBytes: 8000,
      progress:
        'Extracting supplied links with the local model; validating against the source.',
      description: `Local AI extraction using ${model}, checked against supplied text. No URLs visited; no research or reachability checks.`,
      proposal:
        'Use a local AI model to extract and organize links from supplied text. Deliver validated JSON and a text report. No browsing, enrichment or research. Unpaid localhost integration test.',
    },
  });
}
module.exports = { createModelRuntime };
