'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, readdirSync, readFileSync, chmodSync } = require('node:fs');
const { dirname, join } = require('node:path');

function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  if (filename !== ':memory:') chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const name of readdirSync(join(__dirname, '../migrations')).filter(n => n.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name)) continue;
    transaction(db, () => {
      db.exec(readFileSync(join(__dirname, '../migrations', name), 'utf8'));
      db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(name, Date.now());
    });
  }
  return db;
}

// All callbacks are synchronous: never hold a transaction over network or hashing work.
function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = operation(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
module.exports = { openDatabase, transaction };
