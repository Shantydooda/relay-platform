'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const {
  readConfig,
  adminPool,
  migrateLocal,
} = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createAttioDelivery } = require('../../src/attio-delivery.cjs');

test('native Attio receipts survive reconnect and competing resume does not resend confirmed rows', async (t) => {
  const config = readConfig(),
    database = 'relay_attio_qa_' + Date.now(),
    admin = adminPool(config);
  let first, second;
  await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
  t.after(async () => {
    await first?.close();
    await second?.close();
    await admin.query(`DROP DATABASE ${database}`);
    await admin.end();
  });
  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
  const qa = {
    ...config,
    runtime: { ...config.runtime, database },
    migrator: { ...config.migrator, database },
  };
  await migrateLocal(qa);
  first = await openLocalPostgres(qa.runtime);
  second = await openLocalPostgres(qa.runtime);
  const actor = { user: { id: randomUUID() } },
    tenantId = randomUUID(),
    taskId = randomUUID(),
    fileId = randomUUID(),
    submissionId = randomUUID();
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const bytes = Buffer.from(
    'company,website\nFirst,first.example\nSecond,second.example',
  );
  const calls = [];
  const provider = {
    tenantId,
    workspaceLabel: 'Local fixture',
    connectionKey: 'fixture',
    assertCompany: async (row) => {
      calls.push(row.domain);
      return { recordId: row.domain };
    },
  };
  const app = (db) =>
    createAttioDelivery({
      repository: db.repository,
      localExecution: true,
      now: Date.now,
      hash,
      verifiedBytes: () => bytes,
      attioProvider: provider,
      resolveActor: async () => ({
        memberships: [{ id: tenantId, role: 'owner', accessEpoch: 1 }],
      }),
      taskFor: (repo, user, id) => repo.get('task', id),
    });
  await first.repository.transaction('seed', async (repo) => {
    await repo.save('task', {
      id: taskId,
      ownerId: actor.user.id,
      tenantId,
      submissions: [
        {
          id: submissionId,
          status: 'accepted',
          files: [
            { id: fileId, filename: 'companies.csv', sha256: hash(bytes) },
          ],
        },
      ],
    });
    await repo.save('artifact', {
      id: fileId,
      ownerId: actor.user.id,
      submissionId,
    });
  });
  await app(first).controlAttio(actor, { tenantId, action: 'connect' });
  const job = await app(first).prepareAttio(actor, {
    taskId,
    submissionId,
    fileId,
  });
  const send = (db) =>
    app(db).sendAttio(actor, {
      id: job.id,
      consent: 'upsert-reviewed-companies',
    });
  assert.equal((await send(first)).completed, 1);
  await first.close();
  first = await openLocalPostgres(qa.runtime);
  const restored = (await app(first).attioDeliveries(actor, taskId))
    .receipts[0];
  assert.equal(restored.completed, 1);
  assert.equal(restored.canContinue, true);
  await Promise.all([send(first), send(second)]);
  assert.deepEqual(calls, ['first.example', 'second.example']);
  await app(second).controlAttio(actor, { tenantId, action: 'disconnect' });
  assert.equal(
    (await app(first).attioDeliveries(actor, taskId)).receipts[0].completed,
    2,
  );
  await assert.rejects(send(first), { code: 'ATTIO_CONNECT' });
});
