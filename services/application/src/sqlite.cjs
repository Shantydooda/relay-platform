'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, chmodSync } = require('node:fs');
const { dirname } = require('node:path');

function openApplicationDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  return db;
}
module.exports = { openApplicationDatabase };
