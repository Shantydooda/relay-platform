'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const contract = require('../supplier-openapi.json');

test('implemented supplier contract resolves references and keeps buyer and financial authority out of supplier operations', () => {
  const operations = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.$ref) {
      const parts = value.$ref.split('/').slice(1);
      assert.ok(parts.reduce((object, part) => object?.[part], contract), `Unresolved reference ${value.$ref}`);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(contract);
  for (const [path, methods] of Object.entries(contract.paths)) {
    assert.doesNotMatch(path, /fund|payout|accept|credential|admin/);
    for (const [method, operation] of Object.entries(methods)) {
      assert.ok(!operations.has(operation.operationId)); operations.add(operation.operationId);
      if (method === 'post' && path !== '/heartbeat') assert.ok(operation.parameters.some(item => item.$ref.endsWith('/IdempotencyKey')));
    }
  }
  assert.equal(contract.components.securitySchemes.SupplierBearer.scheme, 'bearer');
  assert.deepEqual(contract.components.schemas.File.properties.mime.enum, ['text/csv','text/plain','application/json','application/pdf','image/png','image/jpeg','video/mp4','application/zip']);
  assert.equal(contract.components.schemas.File.properties.base64.maxLength, 11184812);
  assert.equal(contract.components.schemas.Submission.additionalProperties, false);
});
