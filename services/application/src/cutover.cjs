'use strict';

const { createHash } = require('node:crypto');

// The caller stops the application before taking these snapshots. Auth remains
// separate locally; only the existing canonical application store is imported.
function readSqliteSnapshot(db) {
  db.exec('BEGIN');
  try {
    const documents = db.prepare('SELECT * FROM relay_v1_documents ORDER BY kind,id').all();
    const receipts = db.prepare('SELECT * FROM relay_v1_receipts ORDER BY actor_id,request_key').all();
    const digest = createHash('sha256').update(JSON.stringify({ documents, receipts })).digest('hex');
    db.exec('COMMIT');
    return { documents, receipts, digest };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
async function importSnapshot(repository, snapshot) {
  return repository.transaction('sqlite-to-native-postgres-v1', async repo => {
    const previous = await repo.get('migration', 'sqlite-native-v1');
    if (previous) {
      if (previous.digest !== snapshot.digest) throw new Error('SQLite changed after cutover. Refusing to overwrite canonical PostgreSQL data.');
      return { imported: false, documents: previous.documents, receipts: previous.receipts };
    }
    // A target containing live writes must never be merged with an old snapshot.
    if (await repo.hasRecords()) throw new Error('Import requires an empty target database.');
    for (const row of snapshot.documents) await repo.save(row.kind, JSON.parse(row.payload));
    for (const row of snapshot.receipts) await repo.saveReceipt(row.actor_id, row.request_key, row.fingerprint, JSON.parse(row.response));
    await repo.save('migration', { id: 'sqlite-native-v1', ownerId: 'system', digest: snapshot.digest,
      documents: snapshot.documents.length, receipts: snapshot.receipts.length, importedAt: Date.now() });
    return { imported: true, documents: snapshot.documents.length, receipts: snapshot.receipts.length };
  });
}
module.exports = { readSqliteSnapshot, importSnapshot };
