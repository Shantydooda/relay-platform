'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
const WINDOW_MS = 60 * 60 * 1000;
const DEFAULT_CONVERSATIONS_PER_HOUR = 120;
function workspaceLimits(limit = DEFAULT_CONVERSATIONS_PER_HOUR) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new TypeError('Invalid workspace conversation limit');
  return {
    // Caller holds workspace-create:<tenant> for the whole command, including
    // its receipt. Replays return before charging, and rollback refunds failures.
    async consumeConversation(repo, tenantId, time) {
      const previous = await repo.get(
        'workspace-creation-usage',
        tenantId,
        true,
      );
      // A fixed one-hour window starts with the first accepted request.
      const usage =
        previous && time < previous.resetAt
          ? previous
          : {
              id: tenantId,
              ownerId: tenantId,
              tenantId,
              count: 0,
              resetAt: time + WINDOW_MS,
            };
      if (usage.count >= limit) {
        const minutes = Math.max(1, Math.ceil((usage.resetAt - time) / 60000));
        fail(
          429,
          'WORKSPACE_REQUEST_LIMIT',
          `This workspace has reached its new-conversation limit. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}. Existing work can continue.`,
        );
      }
      usage.count += 1;
      await repo.save('workspace-creation-usage', usage);
    },
  };
}
module.exports = { workspaceLimits, DEFAULT_CONVERSATIONS_PER_HOUR, WINDOW_MS };
