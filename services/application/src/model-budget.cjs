'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
function modelBudget(limit = 60) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new TypeError('Invalid model attempt limit');
  return async (repo, tenantId, time) => {
    await repo.lockResource(`model-budget:${tenantId}`);
    const previous = await repo.get('model-usage', tenantId, true);
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
        'MODEL_WORKSPACE_LIMIT',
        `This workspace has reached its AI reply allowance. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or review the brief manually. No AI reply was started.`,
      );
    }
    usage.count++;
    await repo.save('model-usage', usage);
  };
}
module.exports = { modelBudget };
