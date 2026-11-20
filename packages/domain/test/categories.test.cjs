'use strict';
// The fixed agent category list (packages/domain/src/categories.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { FIELDS, taskById, classify, categoryOf, taxonomy } = require('../src/categories.cjs');

test('seven fields, seed first, every task id unique', () => {
  assert.equal(FIELDS.length, 7);
  assert.equal(FIELDS[0].id, 'data-research');
  assert.equal(FIELDS[0].seed, true);
  const ids = FIELDS.flatMap(f => f.tasks.map(t => t.id));
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(taskById('erp-migration').field, 'erp-finance');
  assert.equal(taskById('other').label, 'Other');
  assert.equal(taskById('nope'), null);
  assert.deepEqual(Object.keys(taxonomy()[0]).sort(), ['id', 'label', 'seed', 'tasks']);
});

test('older free text maps onto the list by whole words', () => {
  assert.equal(classify('Data Normalize CSV'), 'data-cleanup');
  assert.equal(classify('Migrate vendor records into NetSuite'), 'erp-migration');
  assert.equal(classify('Reconcile AP against the bank'), 'reconciliation');
  assert.equal(classify('Find B2B leads for outbound'), 'lead-lists');
  assert.equal(classify('apple orchard pictures'), null, '"ap" inside "apple" is not a match');
  assert.equal(categoryOf({ categoryId: 'seo', category: 'Anything' }), 'seo', 'a builder’s choice wins');
  assert.equal(categoryOf({ category: 'Weather poetry', task: 'Rhymes' }), 'other');
});

test('builders pick from the list; Other carries a suggestion; legacy text is mapped', async t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  const { createSqliteRepository } = require('../../../services/application/src/repository.cjs');
  const { createApplication } = require('../../../services/application/src/service.cjs');
  const app = createApplication({ repository: createSqliteRepository(db), localExecution: true });
  const builder = { user: { id: randomUUID(), name: 'Builder' }, memberships: [{ id: randomUUID(), role: 'owner' }] };
  const add = capabilities => app.marketplace.addAgent(builder, { name: 'Agent', kind: 'general', purpose: 'Does work', integration: 'sdk', capabilities }, randomUUID());
  await add([{ categoryId: 'erp-migration', task: 'Build NetSuite vendor import files', metadata: {} }, { categoryId: 'other', category: 'Grant writing', task: 'Draft grant applications' }, { category: 'Data', task: 'Normalize CSV' }]);
  const [agent] = await app.marketplace.agents(builder);
  assert.deepEqual(agent.capabilities.map(c => [c.categoryId, c.category]), [['erp-migration', 'ERP data migration'], ['other', 'Grant writing'], ['data-cleanup', 'Data']]);
  await assert.rejects(add([{ categoryId: 'made-up', task: 'x' }]), { code: 'INVALID_INPUT' });
  await assert.rejects(add([{ categoryId: 'other', task: 'x' }]), { code: 'INVALID_INPUT' }, 'Other needs a suggestion');
});
