'use strict';
const { createHash } = require('node:crypto');
const PROJECT = 'nnxtpkksvurcrajyjqmn';
const BUCKET = 'relay-pilot-artifacts';
const MAX_BYTES = 8 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Server-only, private storage. Object possession is not authorization: callers
// must check task membership and scan status before exposing any bytes.
function pilotObjects({ projectRef, secret, fetchImpl = fetch }) {
  if (projectRef !== PROJECT || typeof secret !== 'string' || secret.length < 30)
    throw new Error('PILOT_STORAGE_CONFIGURATION_REQUIRED');
  const root = `https://${PROJECT}.supabase.co/storage/v1`;
  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
  function keyPath(key) {
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('INVALID_OBJECT_KEY');
    return `${root}/object/${BUCKET}/${key}`;
  }
  async function request(url, options = {}) {
    // No redirects: credentials must never be forwarded to another host.
    try {
      return await fetchImpl(url, { ...options, headers: { ...headers, ...options.headers },
        redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw new Error('PILOT_STORAGE_UNAVAILABLE'); }
  }
  async function read(key) {
    const response = await request(keyPath(key));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('PILOT_OBJECT_UNAVAILABLE');
    }
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) {
      await response.body?.cancel();
      throw new Error('INVALID_OBJECT_SIZE');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('PILOT_OBJECT_UNAVAILABLE');
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_BYTES) throw new Error('INVALID_OBJECT_SIZE');
        chunks.push(Buffer.from(part.value));
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    const bytes = Buffer.concat(chunks);
    if (!bytes.length || digest(bytes) !== key) throw new Error('OBJECT_INTEGRITY_FAILURE');
    return bytes;
  }
  async function put(bytes) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES)
      throw new Error('INVALID_OBJECT_SIZE');
    const key = digest(bytes);
    const response = await request(keyPath(key), { method: 'POST', body: bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false' } });
    await response.body?.cancel();
    // Lost acknowledgments and concurrent writes are replay-safe. Never
    // overwrite: verify the stored object even if the provider reports failure.
    try { await read(key); }
    catch { throw new Error('PILOT_OBJECT_WRITE_UNCONFIRMED'); }
    return key;
  }
  async function verifyBucket() {
    const response = await request(`${root}/bucket/${BUCKET}`);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('PILOT_PRIVATE_BUCKET_REQUIRED');
    }
    const bucket = await response.json();
    if (bucket.id !== BUCKET || bucket.public !== false || Number(bucket.file_size_limit) !== MAX_BYTES)
      throw new Error('PILOT_PRIVATE_BUCKET_REQUIRED');
  }
  return { read, put, verifyBucket };
}
module.exports = { pilotObjects, PROJECT, BUCKET, MAX_BYTES };
