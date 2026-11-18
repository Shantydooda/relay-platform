'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { monitorEventLoopDelay } = require('node:perf_hooks');
const {
  readConfig,
  adminPool,
  migrateLocal,
} = require('../../scripts/local-postgres.cjs');
const { openLocalPostgres } = require('../../src/postgres.cjs');
const { createApplication } = require('../../src/service.cjs');
const { storageAdmission } = require('../../src/storage-limits.cjs');
const { localObjects } = require('../../../storage/src/local-objects.cjs');
const { inspectStorage } = require('../../../storage/src/reconcile.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test(
  'sustained local mixed workload preserves quotas, reads and integrity',
  { timeout: 120000 },
  async (t) => {
    const duration = Number(process.env.RELAY_LOAD_SECONDS || 60);
    const mode = process.env.RELAY_LOAD_MODE || 'limits';
    assert.ok(['limits', 'steady'].includes(mode));
    const conversationLimit = mode === 'steady' ? 10000 : 30;
    const storageLimit = mode === 'steady' ? 32 * 1024 * 1024 : 256 * 1024;
    assert.ok(Number.isInteger(duration) && duration >= 5 && duration <= 90);
    const config = readConfig(),
      database = 'relay_load_' + Date.now();
    const admin = adminPool(config),
      directory = fs.mkdtempSync(join(tmpdir(), 'relay-load-'));
    const connections = [];
    t.after(async () => {
      await Promise.all(connections.map((c) => c.close()));
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${database}`);
      } finally {
        await admin.end();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
    await admin.query(`CREATE DATABASE ${database} OWNER relay_migrator`);
    await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${database} TO relay_app`);
    const qa = {
      ...config,
      runtime: { ...config.runtime, database },
      migrator: { ...config.migrator, database },
    };
    await migrateLocal(qa);
    connections.push(
      await openLocalPostgres(qa.runtime),
      await openLocalPostgres(qa.runtime),
    );
    const apps = connections.map((c) =>
      createApplication({
        repository: c.repository,
        conversationsPerHour: conversationLimit,
      }),
    );
    const store = localObjects(directory, { maxBytes: 64 * 1024 * 1024 }),
      admit = storageAdmission(storageLimit);
    const metrics = {},
      keys = [[], []],
      created = [[], []];
    async function measured(name, work) {
      const start = performance.now();
      const metric = (metrics[name] ||= { ok: 0, limited: 0, ms: [] });
      try {
        const result = await work();
        metric.ok++;
        return result;
      } catch (error) {
        if (
          !['WORKSPACE_REQUEST_LIMIT', 'WORKSPACE_STORAGE_LIMIT'].includes(
            error.code,
          )
        )
          throw error;
        metric.limited++;
      } finally {
        metric.ms.push(performance.now() - start);
      }
    }
    const lag = monitorEventLoopDelay({ resolution: 20 });
    lag.enable();
    t.after(() => lag.disable());
    const began = performance.now(),
      deadline = began + duration * 1000;
    const actor = (index) => ({
      user: { id: 'buyer-' + index, name: 'Load buyer' },
      memberships: [{ id: 'team-' + index, role: 'owner' }],
    });
    const lanes = Array.from({ length: 4 }, (_, lane) =>
      (async () => {
        const tenant = lane % 2,
          repository = connections[lane % 2].repository;
        for (let iteration = 0; performance.now() < deadline; iteration++) {
          const kind = iteration % 3;
          if (kind === 0)
            await measured('create', async () => {
              const body = {
                  tenantId: 'team-' + tenant,
                  title: 'Load task',
                  brief: 'Disposable load test request',
                },
                key = randomUUID();
              const result = await apps[lane % 2].createTask(
                actor(tenant),
                body,
                key,
              );
              created[tenant].push(result.taskId);
              assert.deepEqual(
                await apps[lane % 2].createTask(actor(tenant), body, key),
                result,
              );
            });
          if (kind === 1)
            await measured('upload', () =>
              repository.transaction(randomUUID(), async (repo) => {
                const bytes = Buffer.alloc(8192, 0);
                bytes.write(randomUUID());
                await admit(repo, 'team-' + tenant, bytes.length);
                const objectKey = store.put(bytes);
                await repo.save('artifact', {
                  id: randomUUID(),
                  ownerId: 'buyer-' + tenant,
                  tenantId: 'team-' + tenant,
                  objectKey,
                  size: bytes.length,
                });
                keys[tenant].push(objectKey);
              }),
            );
          if (kind === 2)
            await measured('read', async () => {
              if (keys[tenant].length)
                assert.equal(
                  store.read(keys[tenant][iteration % keys[tenant].length])
                    .length,
                  8192,
                );
              await repository.read((repo) =>
                repo.page('task', 'tenant_id', 'team-' + tenant, { limit: 20 }),
              );
            });
          await delay(100);
        }
      })(),
    );
    const inspections = (async () => {
      while (performance.now() < deadline) {
        await measured('inspect', async () => {
          const report = await inspectStorage(
            connections[0].repository,
            directory,
          );
          assert.equal(report.counts.missing, 0);
          assert.equal(report.counts.corrupt, 0);
        });
        await delay(2000);
      }
    })();
    // Drain every lane before teardown even if one fails.
    const outcomes = await Promise.allSettled([...lanes, inspections]);
    for (const result of outcomes)
      if (result.status === 'rejected') throw result.reason;
    const final = await inspectStorage(connections[0].repository, directory);
    assert.equal(final.counts.unreferencedCandidates, 0);
    assert.equal(final.counts.verified, keys.flat().length);
    for (let i = 0; i < 2; i++) {
      assert.ok(created[i].length <= conversationLimit);
      assert.ok(keys[i].length * 8192 <= storageLimit);
    }
    if (mode === 'limits' && duration >= 15) {
      assert.ok(metrics.create.limited > 0);
      assert.ok(metrics.upload.limited > 0);
    }
    // Reconnect after the workload: persisted allowance and bytes must agree.
    await connections[1].close();
    connections[1] = await openLocalPostgres(qa.runtime);
    for (let i = 0; i < 2; i++) {
      const bytes = await connections[1].repository.transaction(
        'verify-' + i,
        (repo) => repo.artifactUsage('team-' + i),
      );
      assert.equal(bytes, keys[i].length * 8192);
    }
    if (mode === 'steady') {
      assert.equal(metrics.create.limited, 0);
      assert.equal(metrics.upload.limited, 0);
    }
    const summary = {
      mode,
      durationMs: Math.round(performance.now() - began),
      tasks: created.map((a) => a.length),
      files: keys.map((a) => a.length),
      eventLoopP95Ms: Math.round(lag.percentile(95) / 1e6),
      metrics: {},
    };
    for (const [name, metric] of Object.entries(metrics)) {
      metric.ms.sort((a, b) => a - b);
      summary.metrics[name] = {
        ok: metric.ok,
        limited: metric.limited,
        p95Ms: Math.round(metric.ms[Math.ceil(metric.ms.length * 0.95) - 1]),
        maxMs: Math.round(metric.ms.at(-1)),
      };
    }
    t.diagnostic(JSON.stringify(summary));
  },
);
