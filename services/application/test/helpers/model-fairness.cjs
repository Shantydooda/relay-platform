'use strict';
const assert = require('node:assert/strict');
const {
  claimCapacity,
  releaseCapacity,
} = require('../../src/model-capacity.cjs');
async function exerciseFairness(first, second = first) {
  const current = await first.read((repo) =>
    repo.get('model-capacity', 'local-scoping'),
  );
  if (current) await releaseCapacity(first, current);
  await first.transaction('fair-fixture', async (repo) => {
    for (const [id, tenant, createdAt] of [
      ['a1', 'A', 1],
      ['a2', 'A', 2],
      ['a3', 'A', 3],
      ['b1', 'B', 4],
      ['b2', 'B', 5],
      ['c1', 'C', 6],
    ]) {
      await repo.save('task', {
        id: 'task-' + id,
        ownerId: 'owner',
        tenantId: tenant,
      });
      // No tenantId on the job: also verify legacy jobs use task membership.
      await repo.save('scoping-job', {
        id,
        ownerId: 'owner',
        taskId: 'task-' + id,
        createdAt,
        expiresAt: 1000000,
        status: 'pending',
      });
    }
    for (let i = 0; i < 25; i++)
      await repo.save('scoping-job', {
        id: 'history-' + i,
        ownerId: 'owner',
        status: 'completed',
      });
    await repo.save('scoping-job', {
      id: 'expired',
      ownerId: 'owner',
      status: 'pending',
      expiresAt: 1,
    });
  });
  assert.equal(
    (await first.read((repo) => repo.activeScopingJobs({ limit: 100 }))).length,
    7,
  );
  const order = [];
  for (let i = 0; i < 6; i++) {
    const candidate = await second.read((repo) => repo.nextScopingJob(100));
    if (i === 0)
      assert.equal(
        await first.transaction('out-of-order', (repo) =>
          claimCapacity(repo, 'a2', 100, 'A'),
        ),
        null,
      );
    const outcomes = await Promise.all(
      [first, second].map((repo) =>
        repo.transaction('scope-job:' + candidate.id, async (tx) => {
          const job = await tx.get('scoping-job', candidate.id, true);
          if (job.status !== 'pending') return null;
          const task = await tx.get('task', job.taskId);
          const lease = await claimCapacity(tx, job.id, 100, task.tenantId);
          if (lease) {
            job.status = 'running';
            await tx.save('scoping-job', job);
          }
          return lease;
        }),
      ),
    );
    const leases = outcomes.filter(Boolean);
    assert.equal(leases.length, 1);
    order.push(candidate.id);
    await releaseCapacity(second, leases[0]);
  }
  assert.deepEqual(order, ['a1', 'b1', 'c1', 'a2', 'b2', 'a3']);
  assert.equal(await first.read((repo) => repo.nextScopingJob(100)), null);
}
module.exports = { exerciseFairness };
