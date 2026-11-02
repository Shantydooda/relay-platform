'use strict';
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const { join, resolve } = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

// Private content-addressed objects. No user filename ever becomes a disk path.
function localObjects(directory, { maxBytes = 1024 ** 3 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1)
    throw new TypeError('Invalid object capacity');
  const root = resolve(directory);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink())
    throw new Error('Object root must not be a symbolic link');
  function path(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid object key');
    return join(root, key);
  }
  function read(key) {
    const fd = fs.openSync(
      path(key),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024)
        throw new Error('Invalid object size');
      const bytes = fs.readFileSync(fd);
      if (digest(bytes) !== key) throw new Error('Object integrity failure');
      return bytes;
    } finally {
      fs.closeSync(fd);
    }
  }
  // SQLite supplies an OS-released cross-process lock. A killed writer cannot
  // leave a stale PID lock that requires guessing whether it is safe to reclaim.
  function withWriter(work) {
    const lockPath = join(root, '.writer.sqlite');
    if (fs.existsSync(lockPath) && fs.lstatSync(lockPath).isSymbolicLink())
      throw new Error('Invalid writer lock');
    const db = new DatabaseSync(lockPath);
    try {
      db.exec('PRAGMA busy_timeout = 50');
      try {
        db.exec('BEGIN IMMEDIATE');
      } catch (error) {
        if (error.errcode === 5 || error.errcode === 6)
          fail(
            503,
            'OBJECT_STORAGE_BUSY',
            'File storage is busy. Please retry shortly.',
          );
        throw error;
      }
      try {
        const result = work();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  }
  function removeInterruptedUploads() {
    let removed = 0;
    const names = fs.readdirSync(root);
    for (const name of names) {
      if (!/^upload-[a-f0-9-]{36}$/.test(name)) continue;
      const temporary = join(root, name);
      if (!fs.lstatSync(temporary).isFile())
        throw new Error('Invalid temporary object');
      fs.unlinkSync(temporary);
      removed++;
    }
    return { removed, names };
  }
  function syncDirectory() {
    const fd = fs.openSync(root, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  function recoverUploads() {
    return withWriter(() => {
      const { removed } = removeInterruptedUploads();
      syncDirectory();
      return { removed };
    });
  }
  function put(bytes) {
    if (
      !Buffer.isBuffer(bytes) ||
      !bytes.length ||
      bytes.length > 8 * 1024 * 1024
    )
      throw new Error('Invalid object size');
    return withWriter(() => {
      const { names } = removeInterruptedUploads();
      const key = digest(bytes),
        target = path(key);
      if (fs.existsSync(target)) {
        read(key);
        return key;
      }
      // Publication is serialized by the writer lock. Reuse this directory
      // snapshot; removed temporary names are excluded by the key filter.
      const used = names
        .filter((name) => /^[a-f0-9]{64}$/.test(name))
        .reduce((sum, name) => {
          const stat = fs.lstatSync(path(name));
          if (!stat.isFile()) throw new Error('Invalid stored object');
          return sum + stat.size;
        }, 0);
      if (used + bytes.length > maxBytes)
        fail(
          409,
          'OBJECT_STORAGE_LIMIT',
          'File storage is full. Existing files remain available. Contact the administrator before retrying.',
        );
      const temporary = join(root, `upload-${randomUUID()}`);
      try {
        const fd = fs.openSync(temporary, 'wx', 0o600);
        try {
          fs.writeFileSync(fd, bytes);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        try {
          fs.linkSync(temporary, target);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
          read(key);
        }
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
      }
      syncDirectory();
      return key;
    });
  }
  return { root, put, read, recoverUploads };
}
module.exports = { localObjects, digest };
