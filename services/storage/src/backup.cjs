'use strict';
const fs = require('node:fs');
const { localObjects } = require('./local-objects.cjs');
function snapshotObjects(source, destination) {
  if (!fs.existsSync(source)) return [];
  if (fs.existsSync(destination)) throw new Error('Object backup destination already exists');
  const original = localObjects(source), copy = localObjects(destination);
  return fs.readdirSync(source).filter(key => /^[a-f0-9]{64}$/.test(key)).sort().map(key => {
    const bytes = original.read(key);
    if (copy.put(bytes) !== key) throw new Error('Object copy integrity failure');
    return { key, size: bytes.length };
  });
}
function verifyObjects(directory, manifest) {
  if (!Array.isArray(manifest)) throw new Error('Invalid object manifest');
  if (!manifest.length) return;
  if (!fs.existsSync(directory)) throw new Error('Object backup is missing');
  const store = localObjects(directory);
  for (const item of manifest) if (store.read(item.key).length !== item.size) throw new Error('Object backup size mismatch');
}
module.exports = { snapshotObjects, verifyObjects };
