'use strict';
const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_BYTES = 65536;

// Relay adapter protocol, not a claim about any provider's native webhooks.
// Caller pins an issuer and a small key ring outside source control.
function createMembershipFeed({
  issuer,
  keys,
  repository,
  boundary,
  authority,
  now = Date.now,
}) {
  if (
    typeof issuer !== 'string' ||
    !/^[a-z0-9_-]{1,64}$/.test(issuer) ||
    !keys ||
    Object.keys(keys).length < 1 ||
    Object.keys(keys).length > 2
  )
    throw new TypeError('Invalid access feed configuration');
  const keyRing = new Map(
    Object.entries(keys).map(([id, key]) => {
      if (
        !/^[a-z0-9_-]{1,40}$/.test(id) ||
        !Buffer.isBuffer(key) ||
        key.length !== 32
      )
        throw new TypeError('Access feed keys require 32 random bytes');
      return [id, Buffer.from(key)];
    }),
  );
  async function receive({ body, eventId, timestamp, keyId, signature }) {
    if (!Buffer.isBuffer(body) || body.length > MAX_BYTES)
      fail(413, 'ACCESS_BODY_LIMIT', 'Access update is too large.');
    const key = keyRing.get(keyId);
    if (
      !key ||
      !UUID.test(eventId) ||
      typeof timestamp !== 'string' ||
      !/^\d{10}$/.test(timestamp) ||
      typeof signature !== 'string' ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      fail(401, 'ACCESS_SIGNATURE_INVALID', 'Invalid access update signature.');
    if (Math.abs(now() - Number(timestamp) * 1000) > 300000)
      fail(401, 'ACCESS_SIGNATURE_EXPIRED', 'Access update signature expired.');
    const expected = createHmac('sha256', key)
      .update(`relay-membership-v1\n${issuer}\n${eventId}\n${timestamp}\n`)
      .update(body)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex')))
      fail(401, 'ACCESS_SIGNATURE_INVALID', 'Invalid access update signature.');
    let snapshot;
    try {
      snapshot = JSON.parse(body.toString('utf8'));
    } catch {
      fail(400, 'INVALID_ACCESS_JSON', 'Invalid access update body.');
    }
    const fingerprint = createHash('sha256').update(body).digest('hex');
    const id = `${issuer}:${eventId}`;
    return boundary.run(async () => {
      const receipt = await repository.read((repo) =>
        repo.get('managed-feed-receipt', id),
      );
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail(
            409,
            'ACCESS_EVENT_CONFLICT',
            'Event ID already used for different content.',
          );
        return {
          eventId,
          revision: receipt.revision,
          status: receipt.status,
          replayed: true,
        };
      }
      let status = 'applied';
      try {
        await authority.apply(snapshot);
      } catch (error) {
        if (error.code !== 'STALE_ACCESS_SNAPSHOT') throw error;
        status = 'superseded';
      }
      // Membership may commit before this receipt. Retrying after a crash uses
      // the authority's revision/fingerprint check and repeats reconciliation.
      const result = {
        eventId,
        revision: snapshot.revision,
        status,
        replayed: false,
      };
      await repository.transaction(`managed-feed:${id}`, (repo) =>
        repo.save('managed-feed-receipt', {
          id,
          ownerId: snapshot.userId,
          version: 1,
          issuer,
          eventId,
          keyId,
          fingerprint,
          revision: snapshot.revision,
          status,
          receivedAt: now(),
        }),
      );
      return result;
    });
  }
  return { receive };
}
module.exports = { createMembershipFeed, MAX_BYTES };
