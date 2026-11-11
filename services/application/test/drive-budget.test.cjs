'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createSqliteRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
test('Drive allowance persists failed attempts, rejects before provider access and never blocks disconnect', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const repository = createSqliteRepository(db);
  const actor = {
    user: { id: 'owner' },
    memberships: [{ id: 'team', role: 'owner', accessEpoch: 1 }],
  };
  let calls = 0,
    revokes = 0,
    time = 1000;
  const provider = {
    open: (value) => value,
    seal: (value) => value,
    readFile: async () => {
      calls++;
      throw new Error('fixture failure');
    },
    revoke: async () => {
      revokes++;
    },
    picker: () => ({ fixture: true }),
  };
  const options = {
    repository,
    localExecution: true,
    resolveActor: async () => actor,
    now: () => time,
    driveProvider: provider,
    driveOperationsPerHour: 2,
  };
  await repository.transaction('seed', (repo) =>
    repo.save('drive-connection', {
      id: 'drive:team:owner',
      ownerId: 'owner',
      tenantId: 'team',
      status: 'active',
      version: 1,
      accessEpoch: 1,
      secret: {
        accessToken: 'fixture',
        refreshToken: 'fixture',
        expiresAt: 99999999,
      },
    }),
  );
  let app = createApplication(options);
  await assert.rejects(
    app.importDriveFile(actor, { tenantId: 'team', fileId: 'file1' }),
    /fixture failure/,
  );
  app = createApplication(options);
  await assert.rejects(
    app.importDriveFile(actor, { tenantId: 'team', fileId: 'file1' }),
    /fixture failure/,
  );
  await assert.rejects(
    app.importDriveFile(actor, { tenantId: 'team', fileId: 'file1' }),
    { code: 'DRIVE_WORKSPACE_LIMIT' },
  );
  await assert.rejects(app.drivePicker(actor, { tenantId: 'team' }), {
    code: 'DRIVE_WORKSPACE_LIMIT',
  });
  assert.equal(calls, 2);
  await assert.rejects(app.drivePicker(actor, { tenantId: 'other' }), {
    code: 'ADMIN_REQUIRED',
  });
  time += 3600000;
  assert.deepEqual(await app.drivePicker(actor, { tenantId: 'team' }), {
    fixture: true,
  });
  await app.drivePicker(actor, { tenantId: 'team' });
  const result = await app.disconnectDrive(actor, {
    tenantId: 'team',
    expectedVersion: 1,
  });
  assert.equal(result.disconnected, true);
  assert.equal(revokes, 1);
  await assert.rejects(app.drivePicker(actor, { tenantId: 'team' }), {
    code: 'DRIVE_RECONNECT',
  });
  assert.equal(
    (await repository.read((repo) => repo.get('drive-usage', 'team'))).count,
    2,
  );
});
