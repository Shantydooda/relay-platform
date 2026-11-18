'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { syncApproval } = require('./approvals.cjs');

// Reentrant only while the enclosing action is still active. Background jobs
// inherit async context, but must acquire a new guard after that action ends.
function createAccessBoundary(repository) {
  const context = new AsyncLocalStorage();
  const transactions = new AsyncLocalStorage();
  const run = (work) => {
    if (context.getStore()?.active) return work();
    return repository.accessGuard(() => {
      const scope = { active: true };
      return context.run(scope, async () => {
        try {
          return await work();
        } finally {
          scope.active = false;
        }
      });
    });
  };
  return {
    run,
    repository: {
      ...repository,
      read: (work) => {
        const current = transactions.getStore();
        if (current?.active) return work(current.repo);
        return run(() =>
          repository.read((repo) => {
            const scope = { repo, active: true };
            return transactions.run(scope, async () => {
              try {
                return await work(repo);
              } finally {
                scope.active = false;
              }
            });
          }),
        );
      },
      transaction: (key, work, options) =>
        run(() =>
          repository.transaction(key, (repo) => {
            const scope = { repo, active: true };
            return transactions.run(scope, async () => {
              try {
                return await work(repo);
              } finally {
                scope.active = false;
              }
            });
          }, options),
        ),
    },
  };
}

function createApprovalAccessReconciler({ repository, resolveOperator, now }) {
  async function currentEpoch(userId, tenantId) {
    try {
      const principal = await resolveOperator(userId);
      return (
        principal.memberships.find((m) => m.id === tenantId)?.accessEpoch ??
        null
      );
    } catch (error) {
      if (error.code === 'OPERATOR_UNAVAILABLE') return null;
      throw error;
    }
  }

  async function reconcileApprovals() {
    let after = '';
    for (;;) {
      const page = await repository.read((repo) =>
        repo.scan('approval-request', { after, limit: 100 }),
      );
      for (const row of page) {
        if (!['pending', 'approved'].includes(row.status) || row.superseded)
          continue;
        const requesterEpoch = await currentEpoch(
          row.requestedBy,
          row.tenantId,
        );
        const reviewerEpoch = row.decidedBy
          ? await currentEpoch(row.decidedBy, row.tenantId)
          : null;
        if (
          row.requesterEpoch === requesterEpoch &&
          (!row.decidedBy || row.reviewerEpoch === reviewerEpoch)
        )
          continue;
        await repository.transaction(
          `access-invalidation:${row.taskId}`,
          async (repo) => {
            const task = await repo.get('task', row.taskId, true);
            if (
              !task ||
              task.approval?.id !== row.id ||
              !['pending', 'approved'].includes(task.approval.status)
            )
              return;
            task.approval.status = 'stale';
            task.approval.invalidatedReason =
              task.assignment ||
              (task.settlement &&
                !['expired', 'refunded'].includes(task.settlement.status))
                ? 'Company access changed after commitment. Existing work and financial commitments are retained; an administrator can review cancellation separately.'
                : 'Company access changed. Submit a new approval request.';
            task.approval.version++;
            task.version++;
            task.updatedAt = now();
            task.events.push({
              sequence: task.events.length + 1,
              type: 'approval.access_revoked',
              version: task.version,
              createdAt: now(),
              actorId: 'system',
            });
            // Existing commitments are retained; only uncommitted reservations
            // are released. Revocation does not pretend to undo external work.
            await syncApproval(repo, task);
            await repo.save('task', task);
          },
        );
      }
      if (page.length < 100) return;
      after = page.at(-1).id;
    }
  }

  return reconcileApprovals;
}
module.exports = { createAccessBoundary, createApprovalAccessReconciler };
