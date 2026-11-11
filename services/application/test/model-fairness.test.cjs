'use strict';
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const {
  createSqliteRepository,
  createPostgresRepository,
} = require('../src/repository.cjs');
const { exerciseFairness } = require('./helpers/model-fairness.cjs');
for (const postgres of [false, true])
  test(`${postgres ? 'postgres' : 'sqlite'} shared workspace fairness and active-job lookup`, async (t) => {
    const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
    t.after(() => db.close());
    const repo = postgres
      ? await createPostgresRepository(db, { initialize: true })
      : createSqliteRepository(db);
    await exerciseFairness(repo);
  });
