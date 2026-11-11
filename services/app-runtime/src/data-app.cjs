'use strict';

// A declarative interpreter, never a JavaScript/SQL/template evaluator.
// Each step has bounded work and can only transform the supplied records.
const {
  fail,
  exactKeys,
  text,
} = require('../../../packages/contracts/src/input.cjs');
const forbidden = new Set(['__proto__', 'constructor', 'prototype']);
function field(value) {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ||
    forbidden.has(value)
  )
    fail(
      400,
      'APP_INVALID',
      'Use simple field names without paths or reserved names.',
    );
  return value;
}
function scalar(value) {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}
function validatePackage(value) {
  exactKeys(value, [
    'format',
    'version',
    'name',
    'description',
    'input',
    'steps',
  ]);
  if (
    value.format !== 'relay-data-app' ||
    value.version !== 1 ||
    value.input !== 'json-records'
  )
    fail(
      400,
      'APP_UNSUPPORTED',
      'Use Relay data-app version 1 with JSON records.',
    );
  const name = text(value.name, 'App name', 1, 80);
  const description = text(value.description, 'Description', 1, 500);
  if (
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > 20
  )
    fail(400, 'APP_INVALID', 'Provide 1–20 data steps.');
  const steps = value.steps.map((step) => {
    if (!step || typeof step !== 'object' || Array.isArray(step))
      fail(400, 'APP_INVALID', 'Each step must be an object.');
    switch (step.op) {
      case 'filter':
        exactKeys(step, ['op', 'field', 'compare', 'value']);
        field(step.field);
        if (
          !['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(step.compare) ||
          !scalar(step.value)
        )
          fail(400, 'APP_INVALID', 'Invalid filter.');
        if (
          !['eq', 'ne'].includes(step.compare) &&
          typeof step.value !== 'number'
        )
          fail(400, 'APP_INVALID', 'Ordered filters require numeric values.');
        break;
      case 'select':
        exactKeys(step, ['op', 'fields']);
        if (
          !Array.isArray(step.fields) ||
          step.fields.length < 1 ||
          step.fields.length > 30 ||
          new Set(step.fields).size !== step.fields.length
        )
          fail(400, 'APP_INVALID', 'Select 1–30 unique fields.');
        step.fields.forEach(field);
        break;
      case 'sort':
        exactKeys(step, ['op', 'field', 'direction']);
        field(step.field);
        if (!['asc', 'desc'].includes(step.direction))
          fail(400, 'APP_INVALID', 'Choose ascending or descending order.');
        break;
      case 'deduplicate':
        exactKeys(step, ['op', 'field']);
        field(step.field);
        break;
      case 'limit':
        exactKeys(step, ['op', 'count']);
        if (
          !Number.isInteger(step.count) ||
          step.count < 1 ||
          step.count > 1000
        )
          fail(400, 'APP_INVALID', 'Limit must be 1–1000.');
        break;
      default:
        fail(
          400,
          'APP_UNSUPPORTED',
          'This app requests an unsupported operation.',
        );
    }
    return structuredClone(step);
  });
  return {
    format: 'relay-data-app',
    version: 1,
    name,
    description,
    input: 'json-records',
    steps,
  };
}
function parsePackage(bytes) {
  if (bytes.length > 16384)
    fail(400, 'APP_LIMIT', 'App packages must be at most 16 KiB.');
  let value;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(400, 'APP_INVALID', 'The app package must be UTF-8 JSON.');
  }
  return validatePackage(value);
}
function runPackage(manifest, content) {
  const app = validatePackage(manifest);
  if (typeof content !== 'string' || Buffer.byteLength(content) > 16000)
    fail(400, 'SOURCE_INVALID', 'Use at most 16 KB of JSON records.');
  let rows;
  try {
    rows = JSON.parse(content);
  } catch {
    fail(
      400,
      'SOURCE_INVALID',
      'The selected source must be a JSON array of records.',
    );
  }
  if (
    !Array.isArray(rows) ||
    rows.length > 1000 ||
    rows.some(
      (row) =>
        !row ||
        typeof row !== 'object' ||
        Array.isArray(row) ||
        Object.keys(row).length > 30 ||
        Object.entries(row).some(
          ([key, value]) => forbidden.has(key) || !scalar(value),
        ),
    )
  )
    fail(
      400,
      'SOURCE_INVALID',
      'Use up to 1,000 flat records with at most 30 fields each.',
    );
  const steps = [];
  for (const step of app.steps) {
    const before = rows.length;
    const required =
      step.op === 'select' ? step.fields : step.field ? [step.field] : [];
    if (rows.some((row) => required.some((key) => !Object.hasOwn(row, key))))
      fail(
        400,
        'SOURCE_INVALID',
        'A required app field is missing from the source.',
      );
    if (step.op === 'filter')
      rows = rows.filter((row) => {
        const v = row[step.field],
          t = step.value;
        if (step.compare === 'eq') return v === t;
        if (step.compare === 'ne') return v !== t;
        if (typeof v !== 'number')
          fail(
            400,
            'SOURCE_INVALID',
            'Numeric filters require numeric source fields.',
          );
        return step.compare === 'gt'
          ? v > t
          : step.compare === 'gte'
            ? v >= t
            : step.compare === 'lt'
              ? v < t
              : v <= t;
      });
    if (step.op === 'select')
      rows = rows.map((row) =>
        Object.fromEntries(step.fields.map((key) => [key, row[key]])),
      );
    if (step.op === 'sort')
      rows.sort((a, b) => {
        const x = a[step.field],
          y = b[step.field];
        const order =
          typeof x === 'number' && typeof y === 'number'
            ? x - y
            : String(x) < String(y)
              ? -1
              : String(x) > String(y)
                ? 1
                : 0;
        return step.direction === 'asc' ? order : -order;
      });
    if (step.op === 'deduplicate') {
      const seen = new Set();
      rows = rows.filter((row) => {
        const key = JSON.stringify(row[step.field]);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (step.op === 'limit') rows = rows.slice(0, step.count);
    steps.push({
      operation: step.op,
      inputRows: before,
      outputRows: rows.length,
    });
  }
  const output = JSON.stringify(rows, null, 2);
  if (Buffer.byteLength(output) > 65536)
    fail(400, 'APP_LIMIT', 'App output exceeds 64 KiB.');
  return { output, steps };
}
module.exports = { validatePackage, parsePackage, runPackage };
