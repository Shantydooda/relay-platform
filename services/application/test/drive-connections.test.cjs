'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const {
  createGoogleDrive,
  SCOPE,
} = require('../../connectors/src/google-drive.cjs');
for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} Drive session binding, replay, snapshot import, refresh and disconnect`, async (t) => {
    const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
    t.after(() => db.close());
    const repository = postgres
      ? await createPostgresRepository(db, { initialize: true })
      : createSqliteRepository(db);
    let now = 1000,
      exchanges = 0,
      refreshes = 0,
      content = 'Original https://example.test',
      revokeFails = false;
    let releaseDownload, downloadStarted;
    const downloadReady = new Promise((resolve) => {
      downloadStarted = resolve;
    });
    let pauseDownload = false;
    const calls = [];
    const provider = createGoogleDrive({
      clientId: 'client',
      clientSecret: 'secret',
      apiKey: 'picker',
      projectNumber: '123',
      encryptionKey: 'ab'.repeat(32),
      origin: 'http://127.0.0.1:4180',
      fetchImpl: async (url, options) => {
        calls.push(url);
        if (url.includes('/token')) {
          if (options.body.get('grant_type') === 'refresh_token') refreshes++;
          else exchanges++;
          return Response.json({
            access_token: 'private-access',
            refresh_token: 'private-refresh',
            expires_in: 3600,
            token_type: 'Bearer',
            scope: SCOPE,
          });
        }
        if (url.includes('/revoke'))
          return new Response('', { status: revokeFails ? 503 : 200 });
        if (url.includes('fields='))
          return Response.json({
            id: 'file1',
            name: 'Company brief',
            version: '1',
            mimeType: 'text/plain',
            capabilities: { canDownload: true },
          });
        if (pauseDownload) {
          downloadStarted();
          await new Promise((resolve) => {
            releaseDownload = resolve;
          });
        }
        return new Response(content);
      },
    });
    const actor = {
      user: { id: randomUUID() },
      csrf: 'test-session',
      memberships: [{ id: randomUUID(), role: 'owner', accessEpoch: 1 }],
    };
    const tenantId = actor.memberships[0].id;
    const options = {
      repository,
      now: () => now,
      localExecution: true,
      resolveActor: async (id) => (id === actor.user.id ? actor : null),
      driveProvider: provider,
    };
    const app = createApplication(options);
    assert.equal((await app.driveStatus(actor, tenantId)).connected, false);
    await assert.rejects(app.beginDrive(actor, { tenantId: randomUUID() }), {
      code: 'ADMIN_REQUIRED',
    });
    const expired = await app.beginDrive(actor, { tenantId });
    now += 600001;
    await assert.rejects(
      app.completeDrive(actor, {
        tenantId,
        state: new URL(expired.url).searchParams.get('state'),
        code: 'code',
      }),
      { code: 'OAUTH_EXPIRED' },
    );
    const begin = await app.beginDrive(actor, { tenantId }),
      state = new URL(begin.url).searchParams.get('state');
    await assert.rejects(
      app.completeDrive(
        { ...actor, csrf: 'other' },
        { tenantId, state, code: 'code' },
      ),
      { code: 'OAUTH_EXPIRED' },
    );
    const complete = await Promise.allSettled([
      app.completeDrive(actor, { tenantId, state, code: 'code' }),
      app.completeDrive(actor, { tenantId, state, code: 'code' }),
    ]);
    assert.equal(
      complete.filter((item) => item.status === 'fulfilled').length,
      1,
    );
    assert.equal(exchanges, 1);
    assert.equal((await app.driveStatus(actor, tenantId)).connected, true);
    const stored = await repository.read((repo) =>
      repo.list('drive-connection', 'tenant_id', tenantId),
    );
    assert.ok(!JSON.stringify(stored).includes('private-refresh'));
    const imports = await Promise.all([
      app.importDriveFile(actor, { tenantId, fileId: 'file1' }),
      app.importDriveFile(actor, { tenantId, fileId: 'file1' }),
    ]);
    assert.equal(imports[0].sourceId, imports[1].sourceId);
    let view = await app.workspaceApps(actor, tenantId);
    assert.equal(view.sources.length, 1);
    assert.equal(view.grants.length, 0);
    assert.equal(view.sources[0].provenance.mode, 'imported-snapshot');
    assert.ok(!JSON.stringify(view).includes('private-access'));
    const source = view.sources[0];
    await assert.rejects(
      app.saveToolSource(
        actor,
        {
          tenantId,
          id: source.id,
          expectedVersion: 1,
          name: source.name,
          content: 'edited',
          action: 'save',
        },
        randomUUID(),
      ),
      { code: 'SNAPSHOT_IMMUTABLE' },
    );
    content = 'Changed';
    assert.equal(
      (await app.workspaceApps(actor, tenantId)).sources[0].content,
      'Original https://example.test',
    );
    now += 3600000;
    const restarted = createApplication(options);
    await restarted.drivePicker(actor, { tenantId });
    assert.equal(refreshes, 1);
    const next = await restarted.importDriveFile(actor, {
      tenantId,
      fileId: 'file1',
    });
    assert.notEqual(next.sourceId, source.id);
    pauseDownload = true;
    const pendingImport = restarted.importDriveFile(actor, {
      tenantId,
      fileId: 'file1',
    });
    await downloadReady;
    revokeFails = true;
    const result = await restarted.disconnectDrive(actor, {
      tenantId,
      expectedVersion: 1,
    });
    assert.equal(result.providerRevoked, false);
    releaseDownload();
    await assert.rejects(pendingImport, { code: 'DRIVE_RECONNECT' });
    await assert.rejects(restarted.drivePicker(actor, { tenantId }), {
      code: 'DRIVE_RECONNECT',
    });
    assert.equal(
      (await restarted.workspaceApps(actor, tenantId)).sources.length,
      2,
    );
    const record = (
      await repository.read((repo) =>
        repo.list('drive-connection', 'tenant_id', tenantId),
      )
    )[0];
    assert.equal(record.secret, undefined);
    assert.ok(calls.every((url) => !url.includes('private')));
  });
