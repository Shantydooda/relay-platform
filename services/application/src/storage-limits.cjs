'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
const DEFAULT_STORAGE_BYTES = 256 * 1024 * 1024;

// Logical retained bytes, including historical and quarantined artifacts. The
// repository serializes admissions per workspace until the transaction commits.
function storageAdmission(limit = DEFAULT_STORAGE_BYTES) {
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new TypeError('Invalid workspace storage limit');
  return async (repo, tenantId, bytes) => {
    if (!Number.isSafeInteger(bytes) || bytes < 1)
      throw new TypeError('Invalid artifact byte count');
    const used = await repo.artifactUsage(tenantId);
    if (!Number.isSafeInteger(used) || used < 0)
      throw new Error('Invalid stored artifact usage');
    if (used + bytes > limit)
      fail(
        409,
        'WORKSPACE_STORAGE_LIMIT',
        'This workspace has reached its file storage limit. Existing files remain available. Contact the workspace administrator before retrying.',
      );
  };
}
module.exports = { storageAdmission, DEFAULT_STORAGE_BYTES };
