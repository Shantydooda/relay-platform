'use strict';
const fs = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const KEY = /^[a-f0-9]{64}$/;

// Observation only. Database and disk snapshots are not atomic: an unreferenced
// object may belong to an in-flight transaction and is never safe-to-delete proof.
async function inspectStorage(
  repository,
  directory,
  { limit = 10000, verifyBytes = 64 * 1024 * 1024 } = {},
) {
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10000 ||
    !Number.isSafeInteger(verifyBytes) ||
    verifyBytes < 0
  )
    throw new TypeError('Invalid inspection bounds');
  const references = new Map();
  let referencesPartial = false,
    artifacts = 0,
    invalidReferences = 0;
  await repository.read(async (repo) => {
    let after = '';
    while (artifacts < limit) {
      const rows = await repo.scan('artifact', {
        after,
        limit: Math.min(100, limit - artifacts),
      });
      for (const row of rows) {
        artifacts++;
        if (!row.objectKey) continue; // Inline artifacts have no physical object.
        if (!KEY.test(row.objectKey)) {
          invalidReferences++;
          continue;
        }
        const sizes = references.get(row.objectKey) || new Set();
        sizes.add(row.size);
        references.set(row.objectKey, sizes);
      }
      if (!rows.length) return;
      after = rows.at(-1).id;
    }
    referencesPartial =
      (await repo.scan('artifact', { after, limit: 1 })).length > 0;
  });
  const files = new Map();
  let diskPartial = false,
    temporary = 0;
  if (fs.existsSync(directory)) {
    if (!fs.lstatSync(directory).isDirectory())
      throw new Error('Invalid storage directory');
    const dir = fs.opendirSync(directory);
    try {
      let entry,
        seen = 0;
      while ((entry = dir.readSync())) {
        if (++seen > limit) {
          diskPartial = true;
          break;
        }
        if (KEY.test(entry.name)) files.set(entry.name, entry.isFile());
        else if (entry.name.startsWith('upload-')) temporary++;
      }
    } finally {
      dir.closeSync();
    }
  }
  const counts = {
    verified: 0,
    unverified: 0,
    missing: 0,
    unavailable: 0,
    corrupt: 0,
    unreferencedCandidates: 0,
    temporary,
    invalidReferences,
  };
  const findings = [];
  const report = (key, state) => {
    counts[state]++;
    if (findings.length < 100) findings.push({ key, state });
  };
  let verifiedBytes = 0;
  for (const [key, sizes] of references) {
    let fd;
    try {
      fd = fs.openSync(
        join(directory, key),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
      const stat = fs.fstatSync(fd);
      if (
        !stat.isFile() ||
        stat.size < 1 ||
        stat.size > 8 * 1024 * 1024 ||
        sizes.size !== 1 ||
        !sizes.has(stat.size)
      ) {
        report(key, 'corrupt');
        continue;
      }
      if (verifiedBytes + stat.size > verifyBytes) {
        report(key, 'unverified');
        continue;
      }
      const buffer = Buffer.alloc(stat.size);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(
          fd,
          buffer,
          length,
          buffer.length - length,
          length,
        );
        if (!count) break;
        length += count;
      }
      const bytes = buffer.subarray(0, length);
      verifiedBytes += length;
      if (
        fs.fstatSync(fd).size !== stat.size ||
        createHash('sha256').update(bytes).digest('hex') !== key
      )
        report(key, 'corrupt');
      else counts.verified++;
    } catch (error) {
      report(key, error.code === 'ENOENT' ? 'missing' : 'unavailable');
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  // Never infer absence from a truncated database scan.
  if (!referencesPartial)
    for (const [key] of files)
      if (!references.has(key)) report(key, 'unreferencedCandidates');
  return {
    readOnly: true,
    snapshotAtomic: false,
    artifacts,
    objectsObserved: files.size,
    referencesPartial,
    diskPartial,
    verifiedBytes,
    counts,
    findings,
    findingsTruncated:
      Object.values(counts).reduce((a, b) => a + b, 0) -
        counts.verified -
        counts.temporary -
        counts.invalidReferences >
      findings.length,
  };
}
module.exports = { inspectStorage };
