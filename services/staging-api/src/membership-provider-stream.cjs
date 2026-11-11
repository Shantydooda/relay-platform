'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
// readPage is a trusted, bounded provider adapter, never a user payload.
function createMembershipProviderStream({
  repository,
  producer,
  issuer,
  readPage,
  now = Date.now,
}) {
  if (!/^[a-z0-9_-]{1,64}$/.test(issuer) || typeof readPage !== 'function')
    throw new TypeError('Invalid provider stream');
  const id = issuer;
  async function sync() {
    const state = await repository.read((repo) =>
      repo.get('membership-provider-cursor', id),
    );
    let cursor = state?.sequence || 0;
    try {
      const page = await readPage(cursor);
      if (
        !Number.isSafeInteger(page.highWater) ||
        page.highWater < cursor ||
        !Array.isArray(page.events) ||
        page.events.length > 100
      )
        fail(
          503,
          'INVALID_PROVIDER_PAGE',
          'Provider change stream is unavailable.',
        );
      if (cursor > 0 && (state.streamId || null) !== (page.streamId || null))
        fail(
          503,
          'PROVIDER_STREAM_CHANGED',
          'Review the provider stream binding before continuing.',
        );
      for (const event of page.events) {
        if (
          !Number.isSafeInteger(event.sequence) ||
          event.sequence !== cursor + 1 ||
          event.sequence > page.highWater
        )
          fail(
            503,
            'PROVIDER_SEQUENCE_GAP',
            'Provider change stream has a gap.',
          );
        await producer.applyProviderChange({
          eventId: event.eventId,
          userId: event.userId,
          revision: event.revision,
          memberships: event.memberships,
        });
        cursor = event.sequence;
        // A crash before this checkpoint retries the same producer command.
        await repository.transaction(
          `membership-provider:${id}`,
          async (repo) => {
            const current = await repo.get(
              'membership-provider-cursor',
              id,
              true,
            );
            if ((current?.sequence || 0) >= cursor) return;
            if ((current?.sequence || 0) !== cursor - 1)
              fail(409, 'PROVIDER_CURSOR_CONFLICT', 'Retry provider capture.');
            await repo.save('membership-provider-cursor', {
              id,
              ownerId: id,
              version: cursor,
              sequence: cursor,
              checkedAt: now(),
              highWater: page.highWater,
              streamId: page.streamId || null,
              status: 'catching-up',
            });
          },
        );
      }
      if (cursor !== page.highWater)
        fail(
          503,
          'PROVIDER_BACKLOG',
          'Provider changes are still being applied.',
        );
      await repository.transaction(
        `membership-provider:${id}`,
        async (repo) => {
          const current = await repo.get(
            'membership-provider-cursor',
            id,
            true,
          );
          if ((current?.sequence || 0) !== cursor)
            fail(409, 'PROVIDER_CURSOR_CONFLICT', 'Retry provider capture.');
          await repo.save('membership-provider-cursor', {
            id,
            ownerId: id,
            version: Math.max(1, cursor),
            sequence: cursor,
            highWater: page.highWater,
            streamId: page.streamId || null,
            checkedAt: now(),
            status: 'current',
          });
        },
      );
    } catch (error) {
      await repository.transaction(
        `membership-provider:${id}`,
        async (repo) => {
          const current = await repo.get(
            'membership-provider-cursor',
            id,
            true,
          );
          await repo.save('membership-provider-cursor', {
            id,
            ownerId: id,
            version: 1,
            sequence: 0,
            ...current,
            status: 'unavailable',
            failedAt: now(),
          });
        },
      );
      throw error;
    }
  }
  return { sync };
}
// Explicit local SQL transport: caller supplies a dedicated local provider pool.
function localProviderReader(pool) {
  const config = pool.options;
  if (
    config?.host !== '127.0.0.1' ||
    !/^relay_provider_fixture_[a-z0-9_]+$/.test(config?.database || '')
  )
    throw new TypeError(
      'A dedicated localhost provider fixture database is required',
    );
  return postgresProviderReader(pool);
}
// Trusted SQL adapter shared by separately validated local and hosted launchers.
function postgresProviderReader(pool) {
  return async (after) => {
    const { rows } = await pool.query(
      `select c.sequence,c.event_id,c.user_id,c.revision,c.memberships,
      (select sequence from public.relay_membership_clock where id=true) as high_water
      from public.relay_membership_changes c where c.sequence>$1 order by c.sequence limit 100`,
      [after],
    );
    // A later high-water can only delay refresh, never skip a change.
    const clock = await pool.query(
      'select * from public.relay_membership_clock where id=true',
    );
    if (after < Number(clock.rows[0].retained_through || 0))
      fail(
        503,
        'PROVIDER_BOOTSTRAP_REQUIRED',
        'The consumer cursor predates retained history. Restore a consistent backup or rebootstrap under review.',
      );
    return {
      highWater: Number(clock.rows[0].sequence),
      streamId: clock.rows[0].stream_id || null,
      events: rows.map((row) => ({
        sequence: Number(row.sequence),
        eventId: row.event_id,
        userId: row.user_id,
        revision: Number(row.revision),
        memberships: row.memberships,
      })),
    };
  };
}
module.exports = { createMembershipProviderStream, localProviderReader, postgresProviderReader };
