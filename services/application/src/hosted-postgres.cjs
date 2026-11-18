'use strict';

const { Pool } = require('pg');
const { createPostgresRepository, postgresPoolDatabase } = require('./repository.cjs');

function hostedPoolOptions(config) {
  const invalid = () => { throw new Error('INVALID_PILOT_DATABASE_CONFIG'); };
  const { projectRef, excludedProjectRefs, host, port, user, password, ca } = config || {};
  if (!/^[a-z]{20}$/.test(projectRef || '') || !Array.isArray(excludedProjectRefs) ||
      excludedProjectRefs.length === 0 || excludedProjectRefs.includes(projectRef)) invalid();
  // Limit the first pilot to direct or session-pooler connections. Transaction
  // pooling and its startup-parameter behavior are not qualified here.
  const direct = host === `db.${projectRef}.supabase.co` && user === 'postgres';
  const sessionPooler = typeof host === 'string' &&
    /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host) &&
    user === `postgres.${projectRef}`;
  if ((!direct && !sessionPooler) || port !== 5432 ||
      typeof password !== 'string' || password.length === 0 ||
      (ca !== undefined && (typeof ca !== 'string' || !ca.includes('-----BEGIN CERTIFICATE-----')))) invalid();
  return {
    host, port, user, password, database: 'postgres',
    ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) },
    max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
    application_name: 'relay-private-pilot',
  };
}

async function openHostedPostgres(config, { PoolClass = Pool, openRepository = createPostgresRepository } = {}) {
  const pool = new PoolClass(hostedPoolOptions(config));
  pool.on('error', () => console.error('Pilot database connection interrupted. Requests will fail safely.'));
  try {
    // Migrations are an explicit provisioning operation, never an implicit
    // side effect of an app restart or a wrongly selected database.
    const repository = await openRepository(postgresPoolDatabase(pool), { initialize: false });
    return { repository, pool, close: () => pool.end() };
  } catch {
    await pool.end().catch(() => {});
    throw new Error('PILOT_DATABASE_STARTUP_FAILED');
  }
}

module.exports = { hostedPoolOptions, openHostedPostgres };
