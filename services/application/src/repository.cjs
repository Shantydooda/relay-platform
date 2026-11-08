'use strict';

// Both adapters expose the same repository and transaction contract. Application
// services never branch on SQLite versus Postgres or issue provider HTTP calls.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_v1_documents (
  kind TEXT NOT NULL, id TEXT NOT NULL, owner_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL, status TEXT NOT NULL, version INTEGER NOT NULL,
  payload TEXT NOT NULL, PRIMARY KEY(kind,id)
);
CREATE INDEX IF NOT EXISTS relay_v1_owner ON relay_v1_documents(kind,owner_id,id);
CREATE INDEX IF NOT EXISTS relay_v1_tenant ON relay_v1_documents(kind,tenant_id,id);
CREATE INDEX IF NOT EXISTS relay_v1_status ON relay_v1_documents(kind,status,id);
CREATE INDEX IF NOT EXISTS relay_v1_settlement_task ON relay_v1_documents(json_extract(payload,'$.taskId'),id) WHERE kind='sandbox-settlement-history';
CREATE INDEX IF NOT EXISTS relay_v1_tenant_owner ON relay_v1_documents(kind,tenant_id,owner_id,id);
CREATE TABLE IF NOT EXISTS relay_v1_receipts (
  actor_id TEXT NOT NULL, request_key TEXT NOT NULL, fingerprint TEXT NOT NULL,
  response TEXT NOT NULL, PRIMARY KEY(actor_id,request_key)
);`;

function documents(query, { postgres = false, readOnly = false } = {}) {
  return {
    async lockResource(key) {
      if (readOnly) throw new Error('Resource admission requires a write transaction');
      if (postgres) await query('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [key]);
    },
    async artifactUsage(tenantId) {
      if (readOnly) throw new Error('Storage admission requires a write transaction');
      if (postgres) await query('SELECT pg_advisory_xact_lock(hashtextextended(?,0))', [`storage:${tenantId}`]);
      const size = postgres ? "CAST(payload::jsonb->>'size' AS BIGINT)" : "json_extract(payload, '$.size')";
      const rows = await query(`SELECT COALESCE(SUM(${size}),0) AS bytes FROM relay_v1_documents WHERE kind='artifact' AND tenant_id=?`, [tenantId]);
      return Number(rows[0].bytes);
    },
    async membershipOperationsStats(ownerId) {
      const size = postgres ? 'octet_length(payload)' : 'length(CAST(payload AS BLOB))';
      const rows = await query(`SELECT kind, COUNT(*) AS count, COALESCE(SUM(${size}),0) AS bytes
        FROM relay_v1_documents WHERE (id=? OR substr(id,1,?)=?) AND kind IN
        ('membership-alert-event','membership-alert-state','membership-watchdog-event','membership-watchdog-state',
         'membership-source','membership-outbox','membership-source-command','membership-reconciliation','membership-provider-cursor') GROUP BY kind`, [ownerId,ownerId.length+1,ownerId+':']);
      return rows.map(row => ({ kind: row.kind, count: Number(row.count), bytes: Number(row.bytes) }));
    },
    async pruneMembershipEvents(ownerId, cutoff) {
      if (readOnly || !Number.isSafeInteger(cutoff) || cutoff < 0) throw new TypeError('Invalid retention command');
      const stamp = postgres ? "CAST(payload::jsonb->>'observedAt' AS BIGINT)" : "json_extract(payload, '$.observedAt')";
      let removed = 0;
      for (const kind of ['membership-alert-event','membership-watchdog-event']) {
        // Always retain the newest 100 transitions. Never delete current state,
        // provider history, delivery receipts or access generations.
        const rows = await query(`SELECT id FROM relay_v1_documents WHERE kind=? AND owner_id=? AND ${stamp}<?
          AND id NOT IN (SELECT id FROM relay_v1_documents WHERE kind=? AND owner_id=? ORDER BY id DESC LIMIT 100)
          ORDER BY id LIMIT 100`, [kind,ownerId,cutoff,kind,ownerId]);
        for (const row of rows) { await query('DELETE FROM relay_v1_documents WHERE kind=? AND id=? AND owner_id=?',[kind,row.id,ownerId]); removed++; }
      }
      return removed;
    },
    async spendingBatch(tenantId, ownerId, after = '') {
      const filter = ownerId ? ' AND owner_id=?' : '';
      const params = ownerId ? [tenantId, ownerId, after] : [tenantId, after];
      const size = postgres ? 'octet_length(payload)' : 'length(CAST(payload AS BLOB))';
      const selected = await query(`SELECT id, ${size} AS bytes FROM relay_v1_documents WHERE kind='task' AND tenant_id=?${filter} AND id>? ORDER BY id LIMIT 25`, params);
      if (!selected.length) return { tasks: [], history: [] };
      const ids = selected.map(row => row.id);
      const placeholders = ids.map(() => '?').join(',');
      const taskId = postgres ? "payload::jsonb->>'taskId'" : "json_extract(payload,'$.taskId')";
      const where = `kind='sandbox-settlement-history' AND ${taskId} IN (${placeholders})`;
      const stats = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(${size}),0) AS bytes FROM relay_v1_documents WHERE ${where}`, ids))[0];
      if (Number(stats.count) > 5000 || Number(stats.bytes) + selected.reduce((sum, row) => sum + Number(row.bytes), 0) > 10 * 1024 * 1024)
        require('../../../packages/contracts/src/input.cjs').fail(422, 'REPORT_CAPACITY_EXCEEDED', 'A task has too much financial history for this report. No partial report was saved.');
      const tasks = await query(`SELECT payload FROM relay_v1_documents WHERE kind='task' AND id IN (${placeholders}) ORDER BY id`, ids);
      const history = await query(`SELECT payload FROM relay_v1_documents WHERE ${where} ORDER BY id LIMIT 5000`, ids);
      return { tasks: tasks.map(row => JSON.parse(row.payload)), history: history.map(row => JSON.parse(row.payload)) };
    },
    async deleteSpendingSnapshot(id, ownerId) {
      if (readOnly) throw new Error('Read-only repository');
      await query("DELETE FROM relay_v1_documents WHERE owner_id=? AND ((kind='spending-report' AND id=?) OR (kind='spending-report-page' AND substr(id,1,?)=?))", [ownerId, id, id.length + 1, id + ':']);
    },
    async spendingRecords(tenantId, ownerId) {
      const filter = ownerId ? ' AND owner_id=?' : '';
      const params = ownerId ? [tenantId, ownerId] : [tenantId];
      const taskId = postgres ? "h.payload::jsonb->>'taskId'" : "json_extract(h.payload,'$.taskId')";
      const taskWhere = `kind='task' AND tenant_id=?${filter}`;
      const historyWhere = `h.kind='sandbox-settlement-history' AND ${taskId} IN (SELECT id FROM relay_v1_documents WHERE ${taskWhere})`;
      const size = column => postgres ? `octet_length(${column})` : `length(CAST(${column} AS BLOB))`;
      // Preflight within the same read snapshot, before parsing any payloads.
      // Never return a truncated financial report or a partial CSV.
      const taskStats = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(${size('payload')}),0) AS bytes FROM relay_v1_documents WHERE ${taskWhere}`, params))[0];
      const historyStats = (await query(`SELECT COUNT(*) AS count, COALESCE(SUM(${size('h.payload')}),0) AS bytes FROM relay_v1_documents h WHERE ${historyWhere}`, params))[0];
      if (Number(taskStats.count) > 1000 || Number(historyStats.count) > 5000 ||
          Number(taskStats.bytes) + Number(historyStats.bytes) > 10 * 1024 * 1024) {
        require('../../../packages/contracts/src/input.cjs').fail(422, 'REPORT_CAPACITY_EXCEEDED',
          'This workspace exceeds the current report capacity. No partial totals or export were generated. Contact your administrator.');
      }
      const tasks = await query(`SELECT payload FROM relay_v1_documents WHERE ${taskWhere} ORDER BY id LIMIT 1000`, params);
      const history = await query(`SELECT h.payload FROM relay_v1_documents h WHERE ${historyWhere} ORDER BY h.id LIMIT 5000`, params);
      return { tasks: tasks.map(row => JSON.parse(row.payload)), history: history.map(row => JSON.parse(row.payload)) };
    },
    async hasRecords() {
      const rows = await query('SELECT (EXISTS (SELECT 1 FROM relay_v1_documents) OR EXISTS (SELECT 1 FROM relay_v1_receipts)) AS present');
      return !!rows[0].present;
    },
    async get(kind, id, lock = false) {
      const rows = await query(`SELECT payload FROM relay_v1_documents WHERE kind=? AND id=?${postgres && lock && !readOnly ? ' FOR UPDATE' : ''}`, [kind, id]);
      return rows[0] ? JSON.parse(rows[0].payload) : null;
    },
    async list(kind, column, value, limit = 100) {
      if (!['owner_id', 'tenant_id', 'status'].includes(column)) throw new TypeError('Invalid repository filter');
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind=? AND ${column}=? ORDER BY id LIMIT ?`, [kind, value, limit])).map(row => JSON.parse(row.payload));
    },
    async acquisitionBatch(agentId, after = '') {
      const value = postgres ? "payload::jsonb->'acquisition'->>'agentId'" : "json_extract(payload,'$.acquisition.agentId')";
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind='task' AND ${value}=? AND id>? ORDER BY id LIMIT 100`, [agentId, after])).map(row => JSON.parse(row.payload));
    },
    async portfolioRecords(field, id) {
      if (!['agentId', 'taskId'].includes(field)) throw new TypeError('Invalid portfolio filter');
      const value = postgres ? `payload::jsonb->>'${field}'` : `json_extract(payload,'$.${field}')`;
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind='portfolio' AND ${value}=? ORDER BY id LIMIT 21`, [id])).map(row => JSON.parse(row.payload));
    },
    async discoveryBatch(ownerId, after = '') {
      const listing = postgres ? "COALESCE(payload::jsonb->>'listingStatus','published')" : "COALESCE(json_extract(payload,'$.listingStatus'),'published')";
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind='agent' AND owner_id<>? AND id>? AND ${listing}='published' ORDER BY id LIMIT 250`, [ownerId, after])).map(row => JSON.parse(row.payload));
    },
    async catalogAgents(limit = 100) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid agent catalog query');
      return (await query("SELECT payload FROM relay_v1_documents WHERE kind='agent' ORDER BY id LIMIT ?", [limit])).map(row => JSON.parse(row.payload));
    },
    async recent(kind, column, value, limit = 20) {
      if (!['owner_id', 'tenant_id', 'status'].includes(column) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid recent-record query');
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind=? AND ${column}=? ORDER BY id DESC LIMIT ?`, [kind, value, limit])).map(row => JSON.parse(row.payload));
    },
    async page(kind, column, value, { after = '', limit = 50, statuses = [] } = {}) {
      if (!['owner_id', 'tenant_id', 'status'].includes(column) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid repository page');
      if (!Array.isArray(statuses) || statuses.length > 5 || statuses.some(status => typeof status !== 'string')) throw new TypeError('Invalid status filter');
      const filter = statuses.length ? ` AND status IN (${statuses.map(() => '?').join(',')})` : '';
      return (await query(`SELECT payload FROM relay_v1_documents WHERE kind=? AND ${column}=? AND id>?${filter} ORDER BY id LIMIT ?`, [kind, value, after, ...statuses, limit])).map(row => JSON.parse(row.payload));
    },
    async activeScopingJobs({ after = '', limit = 20 } = {}) {
      if (typeof after !== 'string' || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Invalid active job page');
      return (await query("SELECT payload FROM relay_v1_documents WHERE kind='scoping-job' AND status IN ('pending','running') AND id>? ORDER BY id LIMIT ?", [after, limit])).map(row => JSON.parse(row.payload));
    },
    async nextScopingJob(time) {
      const expiry = postgres ? "CAST(j.payload::jsonb->>'expiresAt' AS BIGINT)" : "json_extract(j.payload, '$.expiresAt')";
      const created = postgres ? "CAST(j.payload::jsonb->>'createdAt' AS BIGINT)" : "json_extract(j.payload, '$.createdAt')";
      const taskId = postgres ? "j.payload::jsonb->>'taskId'" : "json_extract(j.payload, '$.taskId')";
      // A task join preserves workspace identity for jobs written before tenantId
      // was included in the job. Oldest eligible job wins within a workspace.
      const rows = await query(`SELECT j.payload FROM relay_v1_documents j
        LEFT JOIN relay_v1_documents t ON t.kind='task' AND t.id=${taskId}
        LEFT JOIN relay_v1_documents w ON w.kind='model-workspace' AND w.id=COALESCE(t.tenant_id,j.tenant_id)
        WHERE j.kind='scoping-job' AND j.status='pending' AND ${expiry}>?
        ORDER BY COALESCE(w.version,0), COALESCE(${created},${expiry}-180000), j.id LIMIT 1`, [time]);
      return rows[0] ? JSON.parse(rows[0].payload) : null;
    },
    async scan(kind, { after = '', limit = 20 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100 || typeof after !== 'string') throw new TypeError('Invalid scan');
      return (await query('SELECT payload FROM relay_v1_documents WHERE kind=? AND id>? ORDER BY id LIMIT ?', [kind, after, limit])).map(row => JSON.parse(row.payload));
    },
    async save(kind, record) {
      await query(`INSERT INTO relay_v1_documents(kind,id,owner_id,tenant_id,status,version,payload)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET
        owner_id=excluded.owner_id,tenant_id=excluded.tenant_id,status=excluded.status,
        version=excluded.version,payload=excluded.payload`,
      [kind, record.id, record.ownerId, record.tenantId || record.ownerId, record.status || 'saved', record.version || 1, JSON.stringify(record)]);
    },
    async receipt(actorId, key) {
      const rows = await query('SELECT fingerprint,response FROM relay_v1_receipts WHERE actor_id=? AND request_key=?', [actorId, key]);
      return rows[0] ? { fingerprint: rows[0].fingerprint, result: JSON.parse(rows[0].response) } : null;
    },
    async saveReceipt(actorId, key, fingerprint, result) {
      await query('INSERT INTO relay_v1_receipts VALUES (?,?,?,?)', [actorId, key, fingerprint, JSON.stringify(result)]);
    }
  };
}

function createSqliteRepository(db) {
  db.exec(SCHEMA);
  let tail = Promise.resolve();
  function serial(work) {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  const query = async (sql, values = []) => {
    const statement = db.prepare(sql);
    return sql.trimStart().startsWith('SELECT') ? statement.all(...values) : (statement.run(...values), []);
  };
  const repository = documents(query);
  const reader = documents(query, { readOnly: true });
  let accessTail = Promise.resolve();
  return {
    accessGuard(work) {
      const result = accessTail.then(work);
      accessTail = result.catch(() => {});
      return result;
    },
    read: work => serial(async () => {
      db.exec('BEGIN');
      try {
        const result = await work(reader);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }),
    transaction: (_lock, work) => serial(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await work(repository);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    })
  };
}

// The caller supplies an explicit transaction-capable database/pool. Never use
// separate HTTP queries to pretend that a multi-write transaction is atomic.
async function createPostgresRepository(database, { initialize = false } = {}) {
  const { migrate, assertCurrentSchema } = require('./migrations.cjs');
  // Embedded tests may bootstrap explicitly. The native launcher always passes
  // initialize:false: its restricted runtime role cannot perform DDL.
  if (initialize) await migrate(database);
  await assertCurrentSchema(database);
  const queryFor = client => async (sql, values = []) => {
    let parameter = 0;
    const postgresSql = sql.replace(/relay_v1_(documents|receipts)/g, 'relay_private.relay_v1_$1').replace(/\?/g, () => `$${++parameter}`);
    return (await client.query(postgresSql, values)).rows;
  };
  let accessTail = Promise.resolve();
  return {
    // Queue before borrowing a connection, so local waiters cannot exhaust the
    // pool needed by the guarded command. The advisory lock also covers other
    // processes using this database and the same identity authority.
    accessGuard(work) {
      const result = accessTail.then(() => database.transaction(async client => {
        // This connection deliberately waits while a separate command transaction
        // runs. Do not let the pool's idle timeout silently drop its access lock.
        await client.query('SET LOCAL idle_in_transaction_session_timeout = 0');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['relay:local-company-access:v1']);
        return work();
      }));
      accessTail = result.catch(() => {});
      return result;
    },
    read: work => database.transaction(client => work(documents(queryFor(client), { postgres: true, readOnly: true })), { readOnly: true }),
    transaction: (lock, work, { snapshot = false } = {}) => database.transaction(async client => {
      if (snapshot) await client.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      // Serialize receipt replays, including when their target does not yet exist.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [lock]);
      return work(documents(queryFor(client), { postgres: true }));
    })
  };
}

function postgresPoolDatabase(pool) {
  return {
    exec: sql => pool.query(sql),
    async transaction(work, { readOnly = false } = {}) {
      const client = await pool.connect();
      try {
        await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
      }
      catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure if the connection was lost. */ }
        throw error;
      }
      finally { client.release(); }
    }
  };
}
module.exports = { createSqliteRepository, createPostgresRepository, postgresPoolDatabase, SCHEMA };
