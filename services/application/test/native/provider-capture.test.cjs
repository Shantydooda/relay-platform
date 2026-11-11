'use strict';
const { Pool } = require('pg');
const {
  localProviderReader,
} = require('../../../staging-api/src/membership-provider-stream.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { readConfig, adminPool } = require('../../scripts/local-postgres.cjs');
test(
  'native provider capture serializes transactions and rolls back without cursor gaps',
  { timeout: 30000 },
  async (t) => {
    const config = readConfig(),
      database = 'relay_provider_fixture_' + randomUUID().replaceAll('-', '');
    const admin = adminPool(config);
    await admin.query(`create database ${database}`);
    const pool = adminPool(config, database);
    let a, b;
    t.after(async () => {
      if (a) a.release();
      if (b) b.release();
      await pool.end();
      await admin.query(`drop database ${database}`);
      await admin.end();
    });
    await pool.query(`create table relay_tenants(id uuid primary key);
    create table relay_memberships(user_id uuid, tenant_id uuid references relay_tenants(id) on delete cascade, role text, primary key(user_id,tenant_id));`);
    // Map provider-only roles to existing local runtime role; no cluster roles are created.
    const sql = readFileSync(
      resolve(
        __dirname,
        '../../../../supabase/migrations/202611010001_membership_changes.sql',
      ),
      'utf8',
    ).replace(/\banon\b|\bauthenticated\b|\bservice_role\b/g, 'relay_app');
    await pool.query(sql);
    a = await pool.connect();
    b = await pool.connect();
    const tenant = randomUUID(),
      user = randomUUID(),
      other = randomUUID();
    await a.query('insert into relay_tenants(id) values($1)', [tenant]);
    await a.query('begin');
    await a.query("insert into relay_memberships values($1,$2,'approver')", [
      user,
      tenant,
    ]);
    let finished = false;
    await b.query('begin');
    const pending = b
      .query("insert into relay_memberships values($1,$2,'employee')", [
        other,
        tenant,
      ])
      .then(() => {
        finished = true;
      });
    // b holds no clock lock until a commits; query must remain blocked.
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(finished, false);
    await a.query('commit');
    await pending;
    await b.query('commit');
    await a.query('begin');
    await a.query(
      "update relay_memberships set role='owner' where user_id=$1",
      [user],
    );
    await a.query('rollback');
    await b.query(
      "update relay_memberships set role='employee' where user_id=$1",
      [user],
    );
    const result = await a.query(
      'select sequence,user_id,revision from relay_membership_changes order by sequence',
    );
    assert.deepEqual(
      result.rows.map((r) => Number(r.sequence)),
      [1, 2, 3],
    );
    assert.deepEqual(
      result.rows
        .filter((r) => r.user_id === user)
        .map((r) => Number(r.revision)),
      [1, 2],
    );
    const readerPool = new Pool({ ...config.runtime, database });
    try {
      const page = await localProviderReader(readerPool)(0);
      assert.equal(page.highWater, 3);
      assert.equal(page.events.length, 3);
      await assert.rejects(
        readerPool.query('delete from relay_membership_changes'),
        { code: '42501' },
      );
    } finally {
      await readerPool.end();
    }
    await a.query(
      readFileSync(
        resolve(
          __dirname,
          '../../../../supabase/migrations/202611020001_membership_retention.sql',
        ),
        'utf8',
      ).replace(/\banon\b|\bauthenticated\b|\bservice_role\b/g, 'relay_app'),
    );
    await a.query(
      "select relay_register_membership_consumer('primary'); select relay_register_membership_consumer('standby');",
    );
    const started = performance.now();
    await a.query(
      `do $$ begin for i in 1..500 loop update relay_memberships set role=case when mod(i,2)=0 then 'approver' else 'employee' end; end loop; end $$;`,
    );
    const top = Number(
      (await a.query('select sequence from relay_membership_clock')).rows[0]
        .sequence,
    );
    assert.equal(top, 1003);
    t.diagnostic(
      `Native capture: 1000 membership changes in ${Math.round(performance.now() - started)}ms; local fixture only`,
    );
    await a.query(
      "update relay_membership_changes set created_at=clock_timestamp()-interval '31 days'",
    );
    await a.query('select relay_ack_membership_consumer($1,$2)', [
      'primary',
      top,
    ]);
    assert.equal(
      Number(
        (await a.query('select relay_prune_membership_changes() as n')).rows[0]
          .n,
      ),
      0,
    );
    await b.query('select relay_ack_membership_consumer($1,$2)', [
      'standby',
      top,
    ]);
    await a.query('begin');
    assert.equal(
      Number(
        (await a.query('select relay_prune_membership_changes() as n')).rows[0]
          .n,
      ),
      100,
    );
    await a.query('rollback');
    assert.equal(
      Number(
        (await b.query('select retained_through from relay_membership_clock'))
          .rows[0].retained_through,
      ),
      0,
    );
    const deleted = await Promise.all([
      a.query('select relay_prune_membership_changes() as n'),
      b.query('select relay_prune_membership_changes() as n'),
    ]);
    assert.deepEqual(
      deleted.map((r) => Number(r.rows[0].n)),
      [100, 100],
    );
    assert.equal(
      Number(
        (await a.query('select retained_through from relay_membership_clock'))
          .rows[0].retained_through,
      ),
      200,
    );
    await a.query(
      readFileSync(
        resolve(
          __dirname,
          '../../../../supabase/migrations/202611020002_membership_retirement.sql',
        ),
        'utf8',
      ).replace(/\banon\b|\bauthenticated\b|\bservice_role\b/g, 'relay_app'),
    );
    const clock = (await a.query('select * from relay_membership_clock'))
      .rows[0];
    const retireSql =
      'select relay_retire_membership_consumer($1,$2,$3,$4,$5,$6,$7,$8,$9) as result';
    const retireArgs = [
      'primary',
      'standby',
      clock.stream_id,
      top,
      200,
      top,
      randomUUID(),
      'Replacement verified by local fixture',
      randomUUID(),
    ];
    await assert.rejects(
      a.query(retireSql, [
        ...retireArgs.slice(0, 3),
        top - 1,
        ...retireArgs.slice(4),
      ]),
      /STALE_RETIREMENT_REVIEW/,
    );
    const retired = await Promise.all([
      a.query(retireSql, retireArgs),
      b.query(retireSql, retireArgs),
    ]);
    assert.deepEqual(retired[0].rows[0].result, retired[1].rows[0].result);
    assert.equal(
      Number(
        (
          await a.query(
            'select count(*) as n from relay_membership_retirement_audit',
          )
        ).rows[0].n,
      ),
      1,
    );
    await assert.rejects(
      a.query("select relay_ack_membership_consumer('primary',$1)", [top]),
      /CONSUMER_NOT_REGISTERED/,
    );
  },
);
