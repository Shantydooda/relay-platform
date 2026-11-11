'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
function driveBudget(limit = 120) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new TypeError('Invalid Drive operation limit');
  return async (repo, tenantId, time) => {
    await repo.lockResource(`drive-budget:${tenantId}`);
    const previous = await repo.get('drive-usage', tenantId, true);
    const usage =
      previous && time < previous.resetAt
        ? previous
        : {
            id: tenantId,
            ownerId: tenantId,
            tenantId,
            count: 0,
            resetAt: time + 3600000,
          };
    if (usage.count >= limit) {
      const minutes = Math.max(1, Math.ceil((usage.resetAt - time) / 60000));
      fail(
        429,
        'DRIVE_WORKSPACE_LIMIT',
        `This workspace has reached its Drive request allowance. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}. Existing saved files and disconnect remain available.`,
      );
    }
    usage.count++;
    await repo.save('drive-usage', usage);
  };
}
module.exports = { driveBudget };
