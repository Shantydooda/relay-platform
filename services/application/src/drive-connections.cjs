'use strict';
const { randomBytes, randomUUID } = require('node:crypto');
const {
  fail,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');

function createDriveConnections({
  repository,
  resolveActor,
  localExecution,
  driveProvider: provider,
  driveBudget,
  now,
  hash,
  expected,
}) {
  const identity = (actor, tenantId) => `drive:${tenantId}:${actor.user.id}`;
  async function authorize(actor, tenantId) {
    if (!localExecution || !actor?.user?.id || actor.recoveryRequired)
      fail(403, 'FORBIDDEN', 'An active local account is required.');
    const current = await resolveActor(actor.user.id);
    const member = current?.memberships.find((item) => item.id === tenantId);
    if (member?.role !== 'owner')
      fail(403, 'ADMIN_REQUIRED', 'Only the workspace owner can manage Drive.');
    return member;
  }
  async function audit(repo, actor, tenantId, action) {
    await repo.save('tool-audit', {
      id: `${String(now()).padStart(16, '0')}:${randomUUID()}`,
      ownerId: actor.user.id,
      tenantId,
      subjectId: identity(actor, tenantId),
      action,
      createdAt: now(),
    });
  }
  function configured() {
    if (!provider)
      fail(
        503,
        'DRIVE_NOT_CONFIGURED',
        'Google OAuth setup is required before connecting Drive.',
      );
  }
  async function status(actor, tenantId) {
    const member = await authorize(actor, tenantId);
    const item = await repository.read((repo) =>
      repo.get('drive-connection', identity(actor, tenantId)),
    );
    return {
      configured: !!provider,
      connected:
        !!provider &&
        item?.status === 'active' &&
        item.accessEpoch === (member.accessEpoch ?? null),
      version: item?.version || 0,
      tenantId,
    };
  }
  async function begin(actor, body) {
    exactKeys(body, ['tenantId']);
    configured();
    const member = await authorize(actor, body.tenantId);
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(32).toString('base64url');
    const id = identity(actor, body.tenantId);
    if (!actor.csrf)
      fail(403, 'SESSION_REQUIRED', 'Sign in again before connecting Drive.');
    await repository.transaction(id, async (repo) => {
      await authorize(actor, body.tenantId);
      await repo.save('drive-oauth', {
        id,
        ownerId: actor.user.id,
        tenantId: body.tenantId,
        status: 'pending',
        stateHash: hash(state),
        sessionHash: hash(actor.csrf),
        accessEpoch: member.accessEpoch ?? null,
        expiresAt: now() + 600000,
        secret: provider.seal({ verifier }, id),
      });
    });
    return { url: provider.authorization(state, verifier) };
  }
  async function complete(actor, body) {
    exactKeys(body, ['tenantId', 'state', 'code']);
    configured();
    if (
      typeof body.state !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(body.state) ||
      typeof body.code !== 'string' ||
      body.code.length > 4096 ||
      !body.code
    )
      fail(400, 'OAUTH_INVALID', 'Restart the Drive connection.');
    const id = identity(actor, body.tenantId);
    const pending = await repository.transaction(id, async (repo) => {
      const member = await authorize(actor, body.tenantId),
        record = await repo.get('drive-oauth', id, true);
      if (
        !record ||
        record.status !== 'pending' ||
        record.expiresAt <= now() ||
        record.stateHash !== hash(body.state) ||
        !actor.csrf ||
        record.sessionHash !== hash(actor.csrf) ||
        record.accessEpoch !== (member.accessEpoch ?? null)
      )
        fail(
          409,
          'OAUTH_EXPIRED',
          'This connection request expired or belongs to another session. Start again.',
        );
      record.status = 'exchanging';
      await repo.save('drive-oauth', record);
      return record;
    });
    const tokens = await provider.exchange(
      body.code,
      provider.open(pending.secret, id).verifier,
    );
    if (!tokens.refreshToken)
      fail(
        409,
        'DRIVE_OFFLINE_REQUIRED',
        'Reconnect Drive and allow offline access for future reads.',
      );
    await repository.transaction(id, async (repo) => {
      const member = await authorize(actor, body.tenantId),
        current = await repo.get('drive-oauth', id, true);
      if (
        current?.stateHash !== pending.stateHash ||
        current.status !== 'exchanging' ||
        pending.accessEpoch !== (member.accessEpoch ?? null)
      )
        fail(409, 'OAUTH_EXPIRED', 'The connection changed. Start again.');
      const old = await repo.get('drive-connection', id, true);
      await repo.save('drive-connection', {
        id,
        tenantId: body.tenantId,
        ownerId: actor.user.id,
        status: 'active',
        version: (old?.version || 0) + 1,
        accessEpoch: member.accessEpoch ?? null,
        secret: provider.seal(
          { ...tokens, expiresAt: now() + tokens.expiresIn * 1000 },
          id,
        ),
      });
      current.status = 'used';
      delete current.secret;
      await repo.save('drive-oauth', current);
      await audit(repo, actor, body.tenantId, 'drive.connected');
    });
    return { connected: true };
  }
  async function credentialsWithin(repo, actor, tenantId, connectionVersion) {
    configured();
    const id = identity(actor, tenantId);
    const member = await authorize(actor, tenantId);
    const item = await repo.get('drive-connection', id, true);
    if (
      item?.status !== 'active' ||
      item.accessEpoch !== (member.accessEpoch ?? null) ||
      (connectionVersion !== undefined && item.version !== connectionVersion)
    ) {
      fail(
        409,
        'DRIVE_RECONNECT',
        'Drive access changed. Reconnect and select the file again.',
      );
    }
    let tokens = provider.open(item.secret, id);
    if (tokens.expiresAt <= now() + 60000) {
      const fresh = await provider.refresh(tokens.refreshToken);
      tokens = {
        ...fresh,
        refreshToken: fresh.refreshToken || tokens.refreshToken,
        expiresAt: now() + fresh.expiresIn * 1000,
      };
      item.secret = provider.seal(tokens, id);
      await repo.save('drive-connection', item);
    }
    return { item, tokens };
  }
  async function credentials(actor, tenantId) {
    return repository.transaction(identity(actor, tenantId), (repo) =>
      credentialsWithin(repo, actor, tenantId),
    );
  }
  // Internal broker entry point: callers must hold their source/task transaction
  // and enforce the task or installed-app grant before invoking this method.
  async function refreshSourceWithin(repo, source) {
    if (source.provenance?.mode !== 'live-file') return source;
    if (source.status !== 'active')
      fail(409, 'SOURCE_DISABLED', 'This source is disconnected.');
    const actor = await resolveActor(source.ownerId);
    const { tokens } = await credentialsWithin(
      repo,
      actor,
      source.tenantId,
      source.provenance.connectionVersion,
    );
    const file = await provider.readFile(
      tokens.accessToken,
      source.provenance.fileId,
    );
    // A provider error never falls back to cached contents.
    await authorize(actor, source.tenantId);
    if (
      hash(file.content) !== hash(source.content) ||
      file.providerVersion !== source.provenance.providerVersion
    ) {
      if (source.version >= 100)
        fail(
          409,
          'SOURCE_HISTORY_LIMIT',
          'This source reached its local version limit. Review its history before continuing.',
        );
      await repo.save('tool-source-version', {
        ...source,
        id: `${source.id}:${source.version}`,
        sourceId: source.id,
      });
      source.version++;
      source.content = file.content;
      source.name = file.name;
      source.provenance.providerVersion = file.providerVersion;
      source.updatedAt = now();
      await audit(repo, actor, source.tenantId, 'drive.source_updated');
    }
    source.provenance.checkedAt = now();
    await repo.save('tool-source', source);
    return source;
  }
  // Commit admission separately so failed external attempts still count. No
  // outer source/task transaction may call this interactive-only entry point.
  async function admitInteractive(actor, tenantId) {
    configured();
    await repository.transaction(
      `drive-admission:${tenantId}`,
      async (repo) => {
        const member = await authorize(actor, tenantId);
        const item = await repo.get(
          'drive-connection',
          identity(actor, tenantId),
        );
        if (
          item?.status !== 'active' ||
          item.accessEpoch !== (member.accessEpoch ?? null)
        )
          fail(409, 'DRIVE_RECONNECT', 'Reconnect Drive before reading files.');
        await driveBudget(repo, tenantId, now());
      },
    );
  }
  async function picker(actor, body) {
    exactKeys(body, ['tenantId']);
    await admitInteractive(actor, body.tenantId);
    const { tokens } = await credentials(actor, body.tenantId);
    return provider.picker(tokens.accessToken);
  }
  async function importFile(actor, body) {
    exactKeys(body, ['tenantId', 'fileId', 'mode', 'consent']);
    const mode = body.mode || 'snapshot';
    if (!['snapshot', 'live'].includes(mode))
      fail(
        400,
        'SOURCE_MODE_INVALID',
        'Choose a snapshot or latest file contents.',
      );
    if (mode === 'live' && body.consent !== 'read-latest-selected-file')
      fail(
        400,
        'CONSENT_REQUIRED',
        'Allow Relay to read the selected file again for authorized runs.',
      );
    await admitInteractive(actor, body.tenantId);
    const { item, tokens } = await credentials(actor, body.tenantId);
    const file = await provider.readFile(tokens.accessToken, body.fileId);
    return repository.transaction(item.id, async (repo) => {
      const member = await authorize(actor, body.tenantId),
        current = await repo.get('drive-connection', item.id, true);
      if (
        current?.status !== 'active' ||
        current.version !== item.version ||
        current.accessEpoch !== (member.accessEpoch ?? null)
      )
        fail(
          409,
          'DRIVE_RECONNECT',
          'Drive access changed during this import.',
        );
      // Stable identity makes retrying an import safe without storing document bytes
      // or credentials in command receipts. Imports are immutable reviewed snapshots.
      const id = hash(
        mode === 'live'
          ? `${item.id}:${body.fileId}:live`
          : `${item.id}:${body.fileId}:${hash(file.content)}`,
      );
      const previous = await repo.get('tool-source', id, true);
      if (previous) {
        const relinked =
          mode === 'live' &&
          previous.provenance.connectionVersion !== item.version;
        const changed =
          mode === 'live' &&
          (previous.content !== file.content ||
            previous.provenance.providerVersion !== file.providerVersion);
        if (previous.status !== 'active' || relinked || changed) {
          if (previous.version >= 100)
            fail(
              409,
              'SOURCE_HISTORY_LIMIT',
              'This source reached its local version limit.',
            );
          await repo.save('tool-source-version', {
            ...previous,
            id: `${previous.id}:${previous.version}`,
            sourceId: previous.id,
          });
          if (previous.status !== 'active' || relinked)
            previous.accessEpoch = (previous.accessEpoch || 0) + 1;
          previous.status = 'active';
          previous.version++;
          if (mode === 'live') {
            previous.content = file.content;
            previous.name = file.name;
            Object.assign(previous.provenance, {
              connectionVersion: item.version,
              providerVersion: file.providerVersion,
              checkedAt: now(),
            });
          }
          await repo.save('tool-source', previous);
          await audit(
            repo,
            actor,
            body.tenantId,
            relinked ? 'drive.file_relinked' : 'drive.source_updated',
          );
        }
        return { sourceId: id };
      }
      if (
        (await repo.list('tool-source', 'tenant_id', body.tenantId)).length >=
        100
      )
        fail(409, 'SOURCE_LIMIT', 'This workspace supports up to 100 sources.');
      await repo.save('tool-source', {
        id,
        ownerId: actor.user.id,
        tenantId: body.tenantId,
        status: 'active',
        version: 1,
        createdAt: now(),
        updatedAt: now(),
        name: file.name,
        content: file.content,
        provenance: {
          provider: 'google-drive',
          fileId: body.fileId,
          providerVersion: file.providerVersion,
          importedAt: now(),
          mode: mode === 'live' ? 'live-file' : 'imported-snapshot',
          ...(mode === 'live'
            ? { connectionVersion: item.version, checkedAt: now() }
            : {}),
        },
      });
      await repo.save('tool-audit', {
        id: `${String(now()).padStart(16, '0')}:${randomUUID()}`,
        ownerId: actor.user.id,
        tenantId: body.tenantId,
        subjectId: id,
        action:
          mode === 'live' ? 'drive.file_linked' : 'drive.snapshot_imported',
        createdAt: now(),
      });
      return { sourceId: id };
    });
  }
  async function disconnect(actor, body) {
    exactKeys(body, ['tenantId', 'expectedVersion']);
    configured();
    const id = identity(actor, body.tenantId);
    const tokens = await repository.transaction(id, async (repo) => {
      await authorize(actor, body.tenantId);
      const item = await repo.get('drive-connection', id, true);
      if (!item) fail(404, 'NOT_FOUND', 'Connection not found.');
      expected(item, body.expectedVersion);
      const tokens = item.secret ? provider.open(item.secret, id) : null;
      item.status = 'disconnected';
      item.version++;
      delete item.secret;
      await repo.save('drive-connection', item);
      const oauth = await repo.get('drive-oauth', id, true);
      if (oauth) {
        oauth.status = 'cancelled';
        delete oauth.secret;
        await repo.save('drive-oauth', oauth);
      }
      await audit(repo, actor, body.tenantId, 'drive.disconnected');
      return tokens;
    });
    let revoked = true;
    if (tokens) {
      try {
        await provider.revoke(tokens.refreshToken || tokens.accessToken);
      } catch {
        revoked = false;
      }
    }
    return { disconnected: true, providerRevoked: revoked };
  }
  return {
    refreshSourceWithin,
    driveStatus: status,
    beginDrive: begin,
    completeDrive: complete,
    drivePicker: picker,
    importDriveFile: importFile,
    disconnectDrive: disconnect,
  };
}
module.exports = { createDriveConnections };
