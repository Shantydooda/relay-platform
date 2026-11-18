'use strict';
const { createClient } = require('@supabase/supabase-js');
const { loadConfig } = require('../src/config.cjs');
const { pilotObjects, BUCKET, MAX_BYTES } = require('../../storage/src/pilot-objects.cjs');

async function prepareStorage(config = loadConfig()) {
  // Reuse the pilot's strict project/environment checks. Do not accept a URL
  // argument that could accidentally provision storage in staging or demo.
  const client = createClient(config.supabaseURL, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const existing = await client.storage.getBucket(BUCKET);
  if (existing.error) {
    if (String(existing.error.statusCode) !== '404') throw new Error('BUCKET_LOOKUP_FAILED');
    const result = await client.storage.createBucket(BUCKET, {
      public: false, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ['application/octet-stream'],
    });
    if (result.error) throw new Error('BUCKET_CREATION_FAILED');
  }
  // Existing unsafe buckets fail verification; never silently change access.
  await pilotObjects({ projectRef: config.database.projectRef, secret: config.secretKey }).verifyBucket();
  console.info('Pilot private artifact bucket verified. Hosted execution remains disabled.');
}
if (require.main === module) Promise.resolve().then(() => prepareStorage(process.argv.includes('--supervised')
  ? require('../src/supervised-config.cjs').supervisedConfig() : loadConfig())).catch(() => {
  console.error('Pilot storage preparation failed. Check private configuration and bucket settings.');
  process.exitCode = 1;
});
module.exports = { prepareStorage };
