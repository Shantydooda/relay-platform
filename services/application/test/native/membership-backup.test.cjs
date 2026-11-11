'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os');
const { randomUUID, randomBytes } = require('node:crypto');
const { readConfig, adminPool } = require('../../scripts/local-postgres.cjs');
const {
  backupMembership,
  restoreMembership,
} = require('../../scripts/membership-backup.cjs');
const {
  createPostgresRepository,
  postgresPoolDatabase,
} = require('../../src/repository.cjs');
const {
  createMembershipProducer,
} = require('../../../staging-api/src/membership-producer.cjs');
const {
  createMembershipProviderStream,
} = require('../../../staging-api/src/membership-provider-stream.cjs');
const {
  createMembershipAuthority,
} = require('../../../staging-api/src/membership-authority.cjs');
const { createAccessBoundary } = require('../../src/access-boundary.cjs');
test(
  'actual three-store dump/restore bootstraps and replays pending delivery without duplicating source history',
  { timeout: 60000 },
  async (t) => {
    const config = readConfig(),
      suffix = randomUUID().replaceAll('-', '').slice(0, 16),
      admin = adminPool(config);
    const original = {
      provider: 'relay_provider_fixture_' + suffix,
      source: 'relay_membership_source_' + suffix,
      receiver: 'relay_membership_receiver_' + suffix,
    };
    const restored = Object.fromEntries(
      Object.keys(original).map((role) => [
        role,
        'relay_restore_' + role + '_' + suffix,
      ]),
    );
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-member-backup-')),
      directory = path.join(root, 'bundle');
    const pools = [];
    t.after(async () => {
      for (const p of pools) await p.end();
      for (const name of [
        ...Object.values(original),
        ...Object.values(restored),
      ])
        await admin.query(`drop database if exists ${name}`);
      await admin.end();
      fs.rmSync(root, { recursive: true, force: true });
    });
    for (const name of Object.values(original))
      await admin.query(`create database ${name}`);
    const provider = adminPool(config, original.provider);
    pools.push(provider);
    await provider.query(
      'create table relay_tenants(id uuid primary key); create table relay_memberships(user_id uuid,tenant_id uuid references relay_tenants(id),role text,primary key(user_id,tenant_id));',
    );
    for (const file of [
      '202611010001_membership_changes.sql',
      '202611020001_membership_retention.sql',
      '202611020002_membership_retirement.sql',
    ])
      await provider.query(
        fs
          .readFileSync(
            path.resolve(__dirname, '../../../../supabase/migrations', file),
            'utf8',
          )
          .replace(/\banon\b|\bauthenticated\b|\bservice_role\b/g, 'relay_app'),
      );
    const user = randomUUID(),
      tenant = randomUUID();
    await provider.query('insert into relay_tenants(id) values($1)', [tenant]);
    await provider.query(
      "insert into relay_memberships values($1,$2,'approver')",
      [user, tenant],
    );
    async function repository(db, initialize) {
      const pool = adminPool(config, db);
      pools.push(pool);
      return createPostgresRepository(postgresPoolDatabase(pool), {
        initialize,
      });
    }
    const source = await repository(original.source, true);
    const initialReceiver = await repository(original.receiver, true);
    const existingUser = randomUUID();
    const initialBoundary = createAccessBoundary(initialReceiver);
    await createMembershipAuthority({
      repository: initialReceiver,
      boundary: initialBoundary,
    }).apply({
      userId: existingUser,
      revision: 7,
      expiresAt: Date.now() + 240000,
      memberships: [
        { id: tenant, role: 'employee', company: false, accessEpoch: 5 },
      ],
    });
    const key = randomBytes(32),
      issuer = 'restore-test';
    const producer = createMembershipProducer({
      repository: source,
      issuer,
      key,
      keyId: 'current',
      send: async () => {
        throw new Error('receiver paused');
      },
    });
    const event = (
      await provider.query('select * from relay_membership_changes')
    ).rows[0];
    await producer.applyProviderChange({
      eventId: event.event_id,
      userId: user,
      revision: 1,
      memberships: event.memberships,
    });
    const streamId = (
      await provider.query('select stream_id from relay_membership_clock')
    ).rows[0].stream_id;
    await source.transaction('cursor', (r) =>
      r.save('membership-provider-cursor', {
        id: issuer,
        ownerId: issuer,
        version: 1,
        sequence: 1,
        streamId,
        status: 'current',
      }),
    );
    await backupMembership(config, original, directory);
    const dump = path.join(directory, 'source.dump'),
      bytes = fs.readFileSync(dump);
    fs.appendFileSync(dump, 'tampered');
    await assert.rejects(
      restoreMembership(config, directory, restored),
      /BACKUP_INTEGRITY_FAILED/,
    );
    fs.writeFileSync(dump, bytes);
    await restoreMembership(config, directory, restored);
    await assert.rejects(
      restoreMembership(config, directory, restored),
      /RESTORE_TARGET_EXISTS/,
    );
    const restoredSource = await repository(restored.source, false),
      receiver = await repository(restored.receiver, false),
      rp = adminPool(config, restored.provider);
    pools.push(rp);
    const boundary = createAccessBoundary(receiver),
      authority = createMembershipAuthority({ repository: receiver, boundary });
    let stream;
    const replay = createMembershipProducer({
      repository: restoredSource,
      issuer,
      key,
      keyId: 'current',
      beforeRefresh: () => stream.sync(),
      send: async (e) => {
        const snapshot = JSON.parse(e.body);
        await authority.apply(snapshot);
        return {
          eventId: e.eventId,
          revision: snapshot.revision,
          status: 'applied',
        };
      },
    });
    stream = createMembershipProviderStream({
      repository: restoredSource,
      producer: replay,
      issuer,
      readPage: async (after) => {
        const clock = (await rp.query('select * from relay_membership_clock'))
          .rows[0];
        return {
          highWater: Number(clock.sequence),
          streamId: clock.stream_id,
          events: (
            await rp.query(
              'select * from relay_membership_changes where sequence>$1 order by sequence limit 100',
              [after],
            )
          ).rows.map((r) => ({
            eventId: r.event_id,
            userId: r.user_id,
            revision: Number(r.revision),
            sequence: Number(r.sequence),
            memberships: r.memberships,
          })),
        };
      },
    });
    await replay.tick();
    await replay.tick();
    assert.equal((await authority.resolve(user)).memberships[0].accessEpoch, 1);
    assert.equal((await replay.inspect(user)).version, 1);
    await rp.query(
      "update relay_memberships set role='employee';update relay_memberships set role='approver'",
    );
    await replay.tick();
    assert.equal((await authority.resolve(user)).memberships[0].accessEpoch, 3);
  },
);
