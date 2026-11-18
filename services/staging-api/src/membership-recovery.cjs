'use strict';
const { localProviderReader } = require('./membership-provider-stream.cjs');
// Operator-only review adapter. Never rebase a source cursor or restore grants.
function createLocalMembershipRecovery({
  pool,
  repository,
  issuer,
  consumerId,
}) {
  localProviderReader(pool);
  if (
    ![issuer, consumerId].every(
      (id) => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/.test(id),
    )
  )
    throw new TypeError('Invalid recovery identity');
  async function review() {
    const { rows } = await pool.query(
      `select c.stream_id,c.sequence,c.retained_through,m.acknowledged,m.retired_at
      from public.relay_membership_clock c left join public.relay_membership_consumers m on m.consumer_id=$1 where c.id=true`,
      [consumerId],
    );
    const c = rows[0];
    if (!c) throw new Error('PROVIDER_UNAVAILABLE');
    const cursor = await repository.read((repo) =>
      repo.get('membership-provider-cursor', issuer),
    );
    let restoreStatus = 'replay-required';
    if (c.retired_at) restoreStatus = 'consumer-retired';
    else if (c.acknowledged === null) restoreStatus = 'consumer-unregistered';
    else if (!cursor) restoreStatus = 'consistent-backup-required';
    else if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 0)
      restoreStatus = 'invalid-source-cursor';
    else if (cursor.streamId !== c.stream_id) restoreStatus = 'stream-mismatch';
    else if (cursor.sequence < Number(c.retained_through))
      restoreStatus = 'history-pruned';
    else if (cursor.sequence > Number(c.sequence))
      restoreStatus = 'provider-behind-source';
    return {
      consumer: consumerId,
      streamId: c.stream_id,
      providerSequence: Number(c.sequence),
      retainedThrough: Number(c.retained_through),
      acknowledged: c.acknowledged === null ? null : Number(c.acknowledged),
      restoreStatus,
      sourceSequence: cursor?.sequence ?? null,
    };
  }
  async function retire({
    review: observed,
    replacement,
    operatorId,
    reason,
    requestId,
  }) {
    if (observed?.consumer !== consumerId) throw new Error('INVALID_REVIEW');
    const result = await pool.query(
      'select public.relay_retire_membership_consumer($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
      [
        consumerId,
        replacement,
        observed.streamId,
        observed.providerSequence,
        observed.retainedThrough,
        observed.acknowledged,
        operatorId,
        reason,
        requestId,
      ],
    );
    return result.rows[0].result;
  }
  return { review, retire };
}
module.exports = { createLocalMembershipRecovery };
