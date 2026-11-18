'use strict';
const { randomUUID } = require('node:crypto');
const KEY = 'local-scoping';
// Capacity is shared by all application processes using this database. The
// lease exceeds the bounded local queue + inference timeout (25s + 150s).
async function claimCapacity(repo, jobId, now, workspaceId = null) {
  await repo.lockResource(`model-capacity:${KEY}`);
  const previous = await repo.get('model-capacity', KEY, true);
  if (previous?.token && previous.expiresAt > now) return null;
  if (workspaceId && (await repo.nextScopingJob(now))?.id !== jobId)
    return null;
  const turn = (previous?.version || 0) + 1;
  if (workspaceId)
    await repo.save('model-workspace', {
      id: workspaceId,
      ownerId: workspaceId,
      tenantId: workspaceId,
      version: turn,
    });
  const lease = {
    version: turn,
    id: KEY,
    ownerId: KEY,
    tenantId: KEY,
    jobId,
    token: randomUUID(),
    expiresAt: now + 180000,
  };
  await repo.save('model-capacity', lease);
  return lease;
}
async function ownsCapacity(repo, lease, now, lock = false) {
  if (lock) await repo.lockResource(`model-capacity:${KEY}`);
  const current = await repo.get('model-capacity', KEY);
  return current?.token === lease.token && current.expiresAt > now;
}
async function releaseCapacity(repository, lease) {
  await repository.transaction(`model-capacity:${KEY}`, async (repo) => {
    const current = await repo.get('model-capacity', KEY, true);
    if (current?.token !== lease.token) return;
    current.token = null;
    current.expiresAt = 0;
    await repo.save('model-capacity', current);
  });
}
module.exports = { claimCapacity, ownsCapacity, releaseCapacity };
