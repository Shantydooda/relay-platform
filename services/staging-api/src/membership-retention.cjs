'use strict';
const { localProviderReader } = require('./membership-provider-stream.cjs');
function createLocalProviderRetention({
  pool,
  repository,
  issuer,
  consumerId,
}) {
  localProviderReader(pool); // Enforce the same dedicated localhost boundary.
  if (
    ![issuer, consumerId].every(
      (id) => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id),
    )
  )
    throw new TypeError('Invalid retention identity');
  async function acknowledge() {
    const cursor = await repository.read((repo) =>
      repo.get('membership-provider-cursor', issuer),
    );
    if (
      !cursor ||
      !Number.isSafeInteger(cursor.sequence) ||
      cursor.sequence < 0
    )
      throw new Error('DURABLE_CURSOR_REQUIRED');
    const clock = await pool.query(
      'select stream_id from public.relay_membership_clock where id=true',
    );
    if (!cursor.streamId || cursor.streamId !== clock.rows[0]?.stream_id)
      throw new Error('PROVIDER_STREAM_CHANGED');
    // Never accept a caller-supplied watermark. SQL only advances, so delayed
    // requests cannot regress another worker's committed acknowledgment.
    await pool.query('select public.relay_ack_membership_consumer($1,$2)', [
      consumerId,
      cursor.sequence,
    ]);
    return { acknowledged: cursor.sequence };
  }
  async function prune() {
    const result = await pool.query(
      'select public.relay_prune_membership_changes() as removed',
    );
    return { removed: Number(result.rows[0].removed) };
  }
  return { acknowledge, prune };
}
module.exports = { createLocalProviderRetention };
