'use strict';
const { randomUUID } = require('node:crypto');
const { saveTask } = require('./supplier-feed.cjs');

// Persist the claim before calling the scanner. No transaction/access lock is
// held during scanning; a restarted worker can reclaim an expired lease.
function createFileScans({ repository, objectStore, fileScanner, now, hash, touch, event }) {
  let after = '';
  const leaseMs = 120000;
  async function reconcileFileScans() {
    if (!objectStore || !fileScanner) return;
    const page = await repository.read(repo => repo.scan('artifact', { after, limit: 20 }));
    after = page.length === 20 ? page.at(-1).id : '';
    for (const candidate of page) {
      if (!candidate.objectKey || ['clean', 'blocked'].includes(candidate.scan?.status)) continue;
      const claim = await repository.transaction(`file-scan:${candidate.taskId}`, async repo => {
        const task = await repo.get('task', candidate.taskId, true);
        const artifact = await repo.get('artifact', candidate.id, true);
        const file = task?.submissions.find(s => s.id === artifact?.submissionId)?.files.find(f => f.id === candidate.id);
        if (!file || !artifact?.objectKey || ['clean', 'blocked'].includes(artifact.scan?.status) || artifact.scanLease?.until > now() || artifact.scan?.retryAt > now()) return null;
        const token = randomUUID();
        artifact.scanLease = { token, until: now() + leaseMs };
        artifact.scan = file.scan = { status: 'scanning', reason: 'Checking this file automatically. You can keep working.', attempts: (artifact.scan?.attempts || 0) + 1 };
        await repo.save('artifact', artifact);
        touch(task, now()); await saveTask(repo, task);
        return { token, artifact, file };
      });
      if (!claim) continue;
      let verdict;
      try {
        const bytes = objectStore.read(claim.artifact.objectKey);
        if (hash(bytes) !== claim.file.sha256 || bytes.length !== claim.file.size) throw new Error('Object integrity failure');
        verdict = await fileScanner.scan(bytes);
        if (!['clean', 'blocked', 'quarantined', 'scan_error'].includes(verdict?.status)) throw new Error('Invalid scanner verdict');
      } catch { verdict = { status: 'scan_error', reason: 'File or scanner unavailable. Relay will retry automatically.' }; }
      await repository.transaction(`file-scan:${candidate.taskId}`, async repo => {
        const task = await repo.get('task', candidate.taskId, true);
        const artifact = await repo.get('artifact', candidate.id, true);
        if (artifact?.scanLease?.token !== claim.token || artifact.scanLease.until <= now()) return;
        const file = task?.submissions.find(s => s.id === artifact.submissionId)?.files.find(f => f.id === artifact.id);
        if (!file || file.sha256 !== claim.file.sha256 || artifact.objectKey !== claim.artifact.objectKey) return;
        const retry = !['clean', 'blocked'].includes(verdict.status);
        artifact.scan = file.scan = { ...verdict, scanner: fileScanner.name, checkedAt: now(), attempts: artifact.scan.attempts,
          ...(retry ? { retryAt: now() + Math.min(300000, 5000 * 2 ** Math.min(artifact.scan.attempts, 6)) } : {}) };
        delete artifact.scanLease;
        await repo.save('artifact', artifact);
        touch(task, now()); event(task, 'system', 'file.scanned', now()); await saveTask(repo, task);
      });
    }
  }
  return { reconcileFileScans };
}
module.exports = { createFileScans };
