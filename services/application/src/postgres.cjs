'use strict';

const { Pool } = require('pg');
const { createPostgresRepository, postgresPoolDatabase } = require('./repository.cjs');

function localPool(config) {
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error('Local PostgreSQL requires an explicit loopback address and unprivileged port.');
  }
  const pool = new Pool({
    host: config.host, port: config.port, database: config.database,
    user: config.user, password: config.password,
    max: 8, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000,
    statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000,
    application_name: 'relay-local-v1'
  });
  // No query, connection string or server detail is printed on pool errors.
  pool.on('error', () => console.error('Local database connection interrupted. Requests will fail safely until it is available.'));
  return pool;
}

async function openLocalPostgres(config) {
  const pool = localPool(config);
  try {
    const repository = await createPostgresRepository(postgresPoolDatabase(pool), { initialize: false });
    return { repository, pool, close: () => pool.end() };
  } catch (error) {
    await pool.end();
    throw error;
  }
}

module.exports = { localPool, openLocalPostgres };
