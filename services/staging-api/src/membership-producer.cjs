'use strict';
const { randomUUID, createHash, createHmac } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const {
  exactKeys,
  fail,
} = require('../../../packages/contracts/src/input.cjs');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TTL = 240000,
  REFRESH = 120000,
  LEASE = 30000;
function normalize(body) {
  exactKeys(body, ['userId', 'expectedVersion', 'memberships']);
  if (
    !UUID.test(body.userId) ||
    !Number.isSafeInteger(body.expectedVersion) ||
    body.expectedVersion < 0 ||
    !Array.isArray(body.memberships) ||
    body.memberships.length > 100
  )
    fail(
      400,
      'INVALID_SOURCE_UPDATE',
      'Invalid authoritative membership update.',
    );
  const ids = new Set();
  const memberships = body.memberships
    .map((m) => {
      exactKeys(m, ['id', 'role', 'company']);
      if (
        !UUID.test(m.id) ||
        ids.has(m.id) ||
        !['owner', 'approver', 'employee'].includes(m.role) ||
        typeof m.company !== 'boolean'
      )
        fail(400, 'INVALID_SOURCE_UPDATE', 'Invalid authoritative membership.');
      ids.add(m.id);
      return { id: m.id, role: m.role, company: m.company };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    userId: body.userId,
    expectedVersion: body.expectedVersion,
    memberships,
  };
}
// Source writes are trusted adapter operations, never a buyer-supplied snapshot.
// The outbox and authority history share the same transaction/repository.
function createMembershipProducer({
  repository,
  issuer,
  keyId,
  key,
  send,
  now = Date.now,
  readReceiverRecord,
  beforeRefresh,
}) {
  if (
    typeof issuer !== 'string' ||
    !/^[a-z0-9_-]{1,64}$/.test(issuer) ||
    typeof keyId !== 'string' ||
    !/^[a-z0-9_-]{1,40}$/.test(keyId) ||
    !Buffer.isBuffer(key) ||
    key.length !== 32 ||
    typeof send !== 'function'
  )
    throw new TypeError('Invalid membership producer configuration');
  const signingKey = Buffer.from(key);
  let sourceCursor = '',
    jobCursor = '';
  const lock = (id) => `membership-producer:${issuer}:${id}`;
  const sourceId = (id) => `${issuer}:${id}`;
  async function issue(repo, source, forceEpoch = false) {
    if (forceEpoch || (source.ackExpiresAt && source.ackExpiresAt <= now()))
      for (const m of source.memberships) source.history[m.id].epoch++;
    source.revision++;
    source.refreshAt = now() + REFRESH;
    const snapshot = {
      userId: source.userId,
      revision: source.revision,
      expiresAt: now() + TTL,
      memberships: source.memberships.map((m) => ({
        ...m,
        accessEpoch: source.history[m.id].epoch,
      })),
    };
    const job = {
      id: source.id,
      ownerId: source.userId,
      version: source.revision,
      eventId: randomUUID(),
      body: JSON.stringify(snapshot),
      expiresAt: snapshot.expiresAt,
      revision: source.revision,
      status: 'pending',
      attempts: 0,
      retryAt: now(),
      leaseUntil: 0,
    };
    await repo.save('membership-source', source);
    await repo.save('membership-outbox', job);
  }
  async function update(input, requestId, providerChange) {
    const body = normalize(input);
    if (!UUID.test(requestId))
      fail(400, 'REQUEST_ID_REQUIRED', 'Provide a unique update request ID.');
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify(
          providerChange
            ? {
                ...body,
                expectedVersion: undefined,
                providerRevision: providerChange.revision,
              }
            : body,
        ),
      )
      .digest('hex');
    return repository.transaction(lock(body.userId), async (repo) => {
      const receiptId = `${issuer}:${body.userId}:${requestId}`,
        receipt = await repo.get('membership-source-command', receiptId);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint)
          fail(
            409,
            'SOURCE_COMMAND_CONFLICT',
            'Update request ID was already used.',
          );
        return receipt.result;
      }
      let source = await repo.get(
        'membership-source',
        sourceId(body.userId),
        true,
      );
      if (providerChange) {
        if (providerChange.revision !== (source?.providerRevision || 0) + 1)
          fail(
            409,
            'PROVIDER_SEQUENCE_GAP',
            'Provider changes must be processed in order.',
          );
        body.expectedVersion = source?.version || 0;
      }
      if ((source?.version || 0) !== body.expectedVersion)
        fail(
          409,
          'SOURCE_VERSION_CONFLICT',
          'Refresh the authoritative source version.',
        );
      source ||= {
        id: sourceId(body.userId),
        ownerId: body.userId,
        userId: body.userId,
        issuer,
        version: 0,
        revision: 0,
        history: {},
        memberships: [],
        ackExpiresAt: null,
        status: 'active',
      };
      if (source.providerRevision && !providerChange)
        fail(
          409,
          'PROVIDER_OWNS_SOURCE',
          'Change memberships through the trusted provider.',
        );
      if (source.status === 'conflict' || source.recoveryPending)
        fail(
          409,
          'SOURCE_RECONCILIATION_REQUIRED',
          'Resolve source/receiver revision disagreement before changing access.',
        );
      const active = new Set(source.memberships.map((m) => m.id));
      for (const m of body.memberships) {
        const old = source.history[m.id];
        source.history[m.id] = {
          epoch: old
            ? old.epoch +
              (!active.has(m.id) ||
              old.role !== m.role ||
              old.company !== m.company
                ? 1
                : 0)
            : 1,
          role: m.role,
          company: m.company,
        };
      }
      if (providerChange) source.providerRevision = providerChange.revision;
      source.memberships = body.memberships;
      source.version++;
      await issue(repo, source);
      const result = {
        userId: body.userId,
        version: source.version,
        revision: source.revision,
      };
      await repo.save('membership-source-command', {
        id: receiptId,
        ownerId: body.userId,
        version: 1,
        fingerprint,
        result,
      });
      return result;
    });
  }
  async function applyProviderChange(event) {
    exactKeys(event, ['eventId', 'userId', 'revision', 'memberships']);
    if (!Number.isSafeInteger(event.revision) || event.revision < 1)
      fail(
        400,
        'INVALID_PROVIDER_REVISION',
        'Provide a positive provider revision.',
      );
    return update(
      {
        userId: event.userId,
        expectedVersion: 0,
        memberships: event.memberships,
      },
      event.eventId,
      event,
    );
  }
  // Operator-only APIs. Receiver observations must come from a trusted adapter,
  // never from browser input or an arbitrary revision supplied by a caller.
  async function inspect(userId) {
    if (!UUID.test(userId)) fail(400, 'INVALID_USER', 'Provide a user ID.');
    return repository.read(async (repo) => {
      const source = await repo.get('membership-source', sourceId(userId));
      if (!source) fail(404, 'SOURCE_NOT_FOUND', 'Source not found.');
      const job = await repo.get('membership-outbox', source.id);
      const time = now();
      return {
        userId,
        version: source.version,
        revision: source.revision,
        observedAt: time,
        state:
          source.status === 'conflict'
            ? 'conflict'
            : source.recoveryPending
              ? 'revocation-pending'
              : !source.ackExpiresAt
                ? 'unacknowledged'
                : source.ackExpiresAt <= time
                  ? 'expired'
                  : job?.status === 'blocked'
                    ? 'delivery-blocked'
                    : source.refreshAt <= time
                      ? 'refresh-overdue'
                      : 'current',
        refreshOverdueMs: Math.max(0, time - source.refreshAt),
        acknowledgedAccessRemainingMs: Math.max(
          0,
          (source.ackExpiresAt || 0) - time,
        ),
        delivery: job
          ? {
              status: job.status,
              attempts: job.attempts,
              retryAt: job.retryAt,
              leaseUntil: job.leaseUntil,
              deliveredAt: job.deliveredAt || null,
              error: job.lastError || null,
            }
          : null,
      };
    });
  }
  async function reconcileRevocation(input, requestId) {
    exactKeys(input, [
      'userId',
      'expectedVersion',
      'expectedRevision',
      'receiverRevision',
      'operatorId',
    ]);
    if (
      !UUID.test(input.userId) ||
      !UUID.test(input.operatorId) ||
      !UUID.test(requestId) ||
      !['expectedVersion', 'expectedRevision', 'receiverRevision'].every(
        (field) => Number.isSafeInteger(input[field]) && input[field] >= 1,
      )
    )
      fail(
        400,
        'INVALID_RECONCILIATION',
        'Provide reviewed versions and operator identity.',
      );
    if (typeof readReceiverRecord !== 'function')
      fail(
        503,
        'RECEIVER_OBSERVATION_UNAVAILABLE',
        'A trusted receiver adapter is required.',
      );
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          input.userId,
          input.expectedVersion,
          input.expectedRevision,
          input.receiverRevision,
          input.operatorId,
        ]),
      )
      .digest('hex');
    return repository.transaction(lock(input.userId), async (repo) => {
      const auditId = `${issuer}:${input.userId}:${requestId}`;
      const prior = await repo.get('membership-reconciliation', auditId);
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          fail(
            409,
            'SOURCE_COMMAND_CONFLICT',
            'Reconciliation request ID was already used.',
          );
        return prior.result;
      }
      const source = await repo.get(
        'membership-source',
        sourceId(input.userId),
        true,
      );
      if (
        !source ||
        source.status !== 'conflict' ||
        source.version !== input.expectedVersion ||
        source.revision !== input.expectedRevision
      )
        fail(
          409,
          'SOURCE_VERSION_CONFLICT',
          'Review the current conflicting source.',
        );
      const observed = await readReceiverRecord(input.userId);
      if (
        !observed ||
        observed.userId !== input.userId ||
        observed.revision !== input.receiverRevision
      )
        fail(
          409,
          'RECEIVER_VERSION_CONFLICT',
          'Review the current receiver revision.',
        );
      const revision = Math.max(source.revision, observed.revision);
      if (
        !Number.isSafeInteger(revision + 1) ||
        !Number.isSafeInteger(source.version + 1)
      )
        fail(409, 'REVISION_EXHAUSTED', 'Manual migration is required.');
      // Preserve tombstones too: a later grant must exceed every observed epoch.
      for (const [id, membership] of Object.entries(observed.history || {})) {
        if (
          !UUID.test(id) ||
          !Number.isSafeInteger(membership.accessEpoch) ||
          membership.accessEpoch < 1 ||
          membership.accessEpoch >= Number.MAX_SAFE_INTEGER
        )
          fail(
            409,
            'INVALID_RECEIVER_HISTORY',
            'Receiver history requires review.',
          );
        const old = source.history[id];
        source.history[id] = {
          epoch: Math.max(old?.epoch || 0, membership.accessEpoch),
          role: membership.role,
          company: membership.company,
        };
      }
      source.memberships = [];
      source.version++;
      source.revision = revision;
      source.status = 'active';
      source.recoveryPending = true;
      source.ackExpiresAt = null;
      await issue(repo, source);
      const result = {
        userId: source.userId,
        version: source.version,
        revision: source.revision,
        status: 'revocation-pending',
      };
      await repo.save('membership-reconciliation', {
        id: auditId,
        ownerId: source.userId,
        version: 1,
        fingerprint,
        operatorId: input.operatorId,
        createdAt: now(),
        previousRevision: input.expectedRevision,
        receiverRevision: observed.revision,
        result,
      });
      return result;
    });
  }
  async function bootstrap(records) {
    if (!Array.isArray(records) || records.length > 100)
      fail(
        400,
        'BOOTSTRAP_LIMIT',
        'Bootstrap at most 100 explicit users per batch.',
      );
    const results = [];
    for (const record of records) {
      exactKeys(record, [
        'userId',
        'expectedVersion',
        'memberships',
        'requestId',
      ]);
      if (record.expectedVersion !== undefined && record.expectedVersion !== 0)
        fail(
          400,
          'INVALID_SOURCE_UPDATE',
          'Bootstrap requires an initial source version.',
        );
    }
    for (const { requestId, ...body } of records)
      results.push(await update({ ...body, expectedVersion: 0 }, requestId));
    return results;
  }
  async function refresh() {
    const page = await repository.read((repo) =>
      repo.scan('membership-source', { after: sourceCursor, limit: 100 }),
    );
    sourceCursor = page.length === 100 ? page.at(-1).id : '';
    for (const entry of page) {
      if (entry.issuer !== issuer) continue;
      await repository.transaction(lock(entry.userId), async (repo) => {
        const source = await repo.get('membership-source', entry.id, true);
        if (source.providerRevision && !beforeRefresh)
          fail(
            503,
            'PROVIDER_CAPTURE_REQUIRED',
            'Provider capture is required before refreshing access.',
          );
        if (source.status === 'active' && source.refreshAt <= now())
          await issue(repo, source);
      });
    }
  }
  async function deliver(entry, signal) {
    const job = await repository.transaction(
      lock(entry.ownerId),
      async (repo) => {
        const current = await repo.get('membership-outbox', entry.id, true);
        if (
          !current ||
          !['pending', 'sending'].includes(current.status) ||
          current.retryAt > now() ||
          current.leaseUntil > now()
        )
          return null;
        if (current.expiresAt <= now()) {
          const source = await repo.get('membership-source', entry.id, true);
          await issue(repo, source, true);
          return null;
        }
        current.status = 'sending';
        current.attempts++;
        current.leaseToken = randomUUID();
        current.leaseUntil = now() + LEASE;
        await repo.save('membership-outbox', current);
        return current;
      },
    );
    if (!job) return;
    const body = Buffer.from(job.body),
      timestamp = String(Math.floor(now() / 1000));
    const signature = createHmac('sha256', signingKey)
      .update(`relay-membership-v1\n${issuer}\n${job.eventId}\n${timestamp}\n`)
      .update(body)
      .digest('hex');
    let response, error;
    try {
      response = await send(
        { body, eventId: job.eventId, timestamp, keyId, signature },
        {
          signal: AbortSignal.any([
            AbortSignal.timeout(10000),
            ...(signal ? [signal] : []),
          ]),
        },
      );
      if (
        response?.eventId !== job.eventId ||
        response.revision !== job.revision ||
        !['applied', 'superseded'].includes(response.status)
      )
        throw new Error('INVALID_ACK');
    } catch (cause) {
      error = cause;
    }
    await repository.transaction(lock(entry.ownerId), async (repo) => {
      const current = await repo.get('membership-outbox', entry.id, true);
      if (
        current?.eventId !== job.eventId ||
        current.leaseToken !== job.leaseToken ||
        current.leaseUntil <= now()
      )
        return;
      const source = await repo.get('membership-source', entry.id, true);
      current.leaseUntil = 0;
      delete current.leaseToken;
      if (error?.code === 'ACCESS_EPOCH_REQUIRED') {
        await issue(repo, source, true);
        return;
      }
      if (
        response?.status === 'superseded' ||
        ['ACCESS_REVISION_CONFLICT', 'ACCESS_EVENT_CONFLICT'].includes(
          error?.code,
        )
      ) {
        source.status = 'conflict';
        current.status = 'blocked';
        current.lastError = 'SOURCE_RECONCILIATION_REQUIRED';
      } else if (error) {
        current.status = current.attempts >= 5 ? 'blocked' : 'pending';
        current.retryAt =
          now() + Math.min(30000, 1000 * 2 ** (current.attempts - 1));
        current.lastError = 'DELIVERY_FAILED';
      } else {
        current.status = 'delivered';
        current.deliveredAt = now();
        delete current.lastError;
        source.ackExpiresAt = job.expiresAt;
        delete source.recoveryPending;
      }
      await repo.save('membership-source', source);
      await repo.save('membership-outbox', current);
    });
  }
  async function tick({ signal } = {}) {
    let providerError;
    try {
      if (beforeRefresh) await beforeRefresh();
    } catch (error) {
      providerError = error;
    }
    if (!providerError) await refresh();
    const page = await repository.read((repo) =>
      repo.scan('membership-outbox', { after: jobCursor, limit: 100 }),
    );
    jobCursor = page.length === 100 ? page.at(-1).id : '';
    for (const entry of page) {
      if (signal?.aborted) break;
      if (!entry.id.startsWith(issuer + ':')) continue;
      if (providerError) {
        const source = await repository.read((repo) =>
          repo.get('membership-source', entry.id),
        );
        // A pending explicit recovery must still be able to revoke while capture
        // is blocked. Never refresh or deliver a grant on stale provider state.
        if (!source?.recoveryPending || source.memberships.length) continue;
      }
      await deliver(entry, signal);
    }
    if (providerError) throw providerError;
  }
  async function run({ signal, onError = () => {}, afterTick } = {}) {
    while (!signal?.aborted) {
      try {
        await tick({ signal });
      } catch {
        onError('MEMBERSHIP_WORKER_RETRY');
      }
      if (afterTick) {
        try {
          await afterTick();
        } catch {
          onError('MEMBERSHIP_MONITOR_RETRY');
        }
      }
      try {
        await delay(1000, undefined, { signal });
      } catch {
        break;
      }
    }
  }
  return {
    update: (input, requestId) => update(input, requestId),
    applyProviderChange,
    bootstrap,
    tick,
    run,
    inspect,
    reconcileRevocation,
  };
}
module.exports = { createMembershipProducer };
