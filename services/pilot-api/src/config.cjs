'use strict';
const { loadConfig: managedConfig } = require('../../staging-api/src/config.cjs');
const { hostedPoolOptions } = require('../../application/src/hosted-postgres.cjs');
const PROJECT = 'nnxtpkksvurcrajyjqmn';
function loadConfig(env = process.env) {
  const managed = managedConfig(env);
  if (env.RELAY_ENVIRONMENT !== 'private-pilot' || managed.supabaseURL !== `https://${PROJECT}.supabase.co` ||
      !/^https:\/\/relay-pilot-[a-z0-9-]+\.onrender\.com$/.test(managed.origin)) {
    throw new Error('PILOT_ENVIRONMENT_REQUIRED');
  }
  // Payments stay disconnected until the pilot's own test webhook is qualified.
  if (Object.entries(env).some(([key, value]) => key.includes('STRIPE') && value)) {
    throw new Error('PILOT_PAYMENTS_NOT_CONFIGURED');
  }
  if (!/^[a-f0-9]{64}$/i.test(env.RELAY_MEMBERSHIP_KEY || '')) throw new Error('PILOT_MEMBERSHIP_KEY_REQUIRED');
  const database = {
    projectRef: PROJECT, excludedProjectRefs: ['pjnhmlhaabjqqifjixio', 'mhtybwyjublmjtldmvys'],
    host: 'aws-1-us-east-1.pooler.supabase.com', port: 5432,
    user: `postgres.${PROJECT}`, password: env.RELAY_PILOT_DATABASE_PASSWORD,
    ca: env.RELAY_DATABASE_CA,
  };
  if (!database.ca) throw new Error('PILOT_DATABASE_CA_REQUIRED');
  hostedPoolOptions(database);
  if (env.RELAY_PILOT_STORAGE && !['private-bucket', 'disabled'].includes(env.RELAY_PILOT_STORAGE))
    throw new Error('INVALID_PILOT_STORAGE_MODE');
  const storageEnabled = env.RELAY_PILOT_STORAGE === 'private-bucket';
  // Unpaid execution by supplier-hosted runtimes. Off unless the operator sets it.
  // It never enables payments, local processes or scheduled work.
  if (env.RELAY_PILOT_UNPAID_EXECUTION && !['enabled', 'disabled'].includes(env.RELAY_PILOT_UNPAID_EXECUTION))
    throw new Error('INVALID_PILOT_UNPAID_EXECUTION');
  const unpaidExecution = env.RELAY_PILOT_UNPAID_EXECUTION === 'enabled';
  const port = Number(env.PORT || 10000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');
  return { ...managed, database, port, storageEnabled, unpaidExecution, membershipKey: Buffer.from(env.RELAY_MEMBERSHIP_KEY, 'hex') };
}
module.exports = { loadConfig };
