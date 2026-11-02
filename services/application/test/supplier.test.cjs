'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');

const { exercise } = require('./helpers/supplier-workflow.cjs');
for (const adapter of ['sqlite', 'postgres']) {
  test(`${adapter}: supplier keys, arbitrary brief, revision, ordered updates, cancellation and recovery`, async t => {
    const db = adapter === 'sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
    t.after(() => db.close());
    const repository = adapter === 'sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db, { initialize: true });
    await exercise(repository);
  });
}

