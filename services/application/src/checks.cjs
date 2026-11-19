'use strict';

// Machine-run acceptance checks (reports/ERP buyer readiness for agent projects.md, M4).
//
// The buyer picks checks from a fixed library and sets the tolerances. They are
// part of the scope and frozen into the agreement like the checklist. Relay runs
// them on every delivery, against the delivered CSV and the request's own files
// (target template, code cross-walks, sample pairs). A failing check counts as an
// unmet item, so fixing it is free. Checks never execute buyer or agent code:
// each one is a bounded comparison over parsed rows.

const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { parseCsv } = require('../../agent-runtime/src/csv.cjs');

const MAX_CHECKS = 12, MAX_ROWS = 100000, EXAMPLES = 5;
const TYPES = Object.freeze({
  row_count: 'Row count',
  required_fields: 'Required fields are filled',
  unique_key: 'Key is unique',
  header_matches_template: 'Columns match the import template',
  values_in_crosswalk: 'Codes exist in the cross-walk',
  control_total: 'Control total ties',
  matches_samples: 'Sample pairs come back as expected',
});

const field = (value, label) => text(value, label, 1, 120);
const fields = (value, label, max) => {
  if (!Array.isArray(value) || !value.length || value.length > max || new Set(value).size !== value.length) fail(400, 'INVALID_INPUT', `${label}: choose 1–${max} columns.`);
  return value.map(v => field(v, label));
};
const number = (value, label, min = -1e15) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || Math.abs(value) > 1e15) fail(400, 'INVALID_INPUT', `${label} must be a number.`);
  return value;
};

// Validate the buyer's chosen checks against the request's files.
function normalizeChecks(value, task) {
  if (!Array.isArray(value) || value.length > MAX_CHECKS) fail(400, 'INVALID_INPUT', `Choose up to ${MAX_CHECKS} checks.`);
  const files = task.attachments || [];
  return value.map((check, index) => {
    if (!check || !TYPES[check.type]) fail(400, 'INVALID_INPUT', 'Choose a check from the list.');
    const id = `k${index + 1}`;
    switch (check.type) {
      case 'row_count':
        exactKeys(check, ['type', 'expected', 'tolerance']);
        return { id, type: check.type, expected: number(check.expected, 'Expected rows', 0), tolerance: number(check.tolerance ?? 0, 'Tolerance', 0) };
      case 'required_fields':
        exactKeys(check, ['type', 'fields']);
        return { id, type: check.type, fields: fields(check.fields, 'Required fields', 30) };
      case 'unique_key':
        exactKeys(check, ['type', 'fields']);
        return { id, type: check.type, fields: fields(check.fields, 'Key', 5) };
      case 'header_matches_template': {
        exactKeys(check, ['type']);
        const template = files.find(f => f.role === 'target_template');
        if (!template) fail(400, 'INVALID_INPUT', 'Add the target import template first.');
        return { id, type: check.type, attachmentId: template.id, filename: template.filename };
      }
      case 'values_in_crosswalk': {
        exactKeys(check, ['type', 'field', 'attachmentId', 'column']);
        const crosswalk = files.find(f => f.id === check.attachmentId && f.role === 'code_crosswalk');
        if (!crosswalk) fail(400, 'INVALID_INPUT', 'Choose one of the request’s code cross-walks.');
        return { id, type: check.type, field: field(check.field, 'Column'), attachmentId: crosswalk.id, filename: crosswalk.filename, column: field(check.column, 'Cross-walk column') };
      }
      case 'control_total':
        exactKeys(check, ['type', 'field', 'expected', 'tolerance']);
        return { id, type: check.type, field: field(check.field, 'Column'), expected: number(check.expected, 'Expected total'), tolerance: number(check.tolerance ?? 0, 'Tolerance', 0) };
      case 'matches_samples':
        exactKeys(check, ['type', 'key']);
        if (!files.some(f => f.role === 'expected_output')) fail(400, 'INVALID_INPUT', 'Add a sample pair first.');
        return { id, type: check.type, key: field(check.key, 'Key column') };
    }
  });
}

function describe(check) {
  switch (check.type) {
    case 'row_count': return `${check.expected.toLocaleString('en-US')} rows${check.tolerance ? ` (± ${check.tolerance})` : ''}`;
    case 'required_fields': return check.fields.join(', ');
    case 'unique_key': return check.fields.join(' + ');
    case 'header_matches_template': return `Same columns, same order as ${check.filename}`;
    case 'values_in_crosswalk': return `${check.field} found in ${check.filename} (${check.column})`;
    case 'control_total': return `Sum of ${check.field} = ${check.expected.toLocaleString('en-US')}${check.tolerance ? ` (± ${check.tolerance})` : ''}`;
    case 'matches_samples': return `Every expected-output row matches by ${check.key}`;
  }
  return '';
}
function checkView(check) { return { ...check, label: TYPES[check.type], description: describe(check) }; }

function table(bytes) {
  const rows = parseCsv(Buffer.from(bytes).toString('utf8'), { maxRows: MAX_ROWS });
  const header = rows[0];
  return { header, rows: rows.slice(1).map(r => Object.fromEntries(header.map((h, i) => [h, r[i]]))) };
}
const toNumber = value => {
  const cleaned = String(value ?? '').replace(/[,\s$€£]/g, '').replace(/^\((.*)\)$/, '-$1');
  return cleaned !== '' && Number.isFinite(Number(cleaned)) ? Number(cleaned) : null;
};

// Run the agreed checks on one delivery. `load(attachmentId)` returns a request
// file's bytes. Returns { file, results } with at most a few failing examples each.
async function runChecks(checks, deliveredFiles, load) {
  const csv = deliveredFiles.find(f => f.mime === 'text/csv' || /\.csv$/i.test(f.filename));
  const result = (check, status, detail, examples = []) => ({ id: check.id, type: check.type, label: TYPES[check.type], description: describe(check), status, detail, examples: examples.slice(0, EXAMPLES) });
  if (!csv) return { file: null, results: checks.map(c => result(c, 'error', 'The delivery has no CSV file to check.')) };
  let out;
  try { out = table(Buffer.from(csv.base64, 'base64')); }
  catch (error) { return { file: csv.filename, results: checks.map(c => result(c, 'error', `The delivered CSV couldn’t be read: ${error.message}.`)) }; }
  const missing = cols => cols.filter(c => !out.header.includes(c));
  const results = [];
  for (const check of checks) {
    try {
      if (check.type === 'row_count') {
        const diff = out.rows.length - check.expected;
        results.push(Math.abs(diff) <= check.tolerance ? result(check, 'pass', `${out.rows.length} rows.`)
          : result(check, 'fail', `${out.rows.length} rows, ${Math.abs(diff)} ${diff > 0 ? 'more' : 'fewer'} than expected.`));
      } else if (check.type === 'required_fields') {
        const absent = missing(check.fields);
        if (absent.length) { results.push(result(check, 'fail', `Missing columns: ${absent.join(', ')}.`)); continue; }
        const bad = [];
        out.rows.forEach((row, i) => { const empty = check.fields.filter(f => !String(row[f] ?? '').trim()); if (empty.length) bad.push(`Row ${i + 2}: ${empty.join(', ')} empty`); });
        results.push(bad.length ? result(check, 'fail', `${bad.length} row${bad.length === 1 ? '' : 's'} with empty required fields.`, bad) : result(check, 'pass', 'Every row has them.'));
      } else if (check.type === 'unique_key') {
        const absent = missing(check.fields);
        if (absent.length) { results.push(result(check, 'fail', `Missing columns: ${absent.join(', ')}.`)); continue; }
        const seen = new Map(), dupes = [];
        out.rows.forEach((row, i) => { const key = check.fields.map(f => String(row[f] ?? '').trim().toLowerCase()).join('\u0001'); if (seen.has(key)) dupes.push(`Rows ${seen.get(key)} and ${i + 2}: ${check.fields.map(f => row[f]).join(' / ')}`); else seen.set(key, i + 2); });
        results.push(dupes.length ? result(check, 'fail', `${dupes.length} duplicate key${dupes.length === 1 ? '' : 's'}.`, dupes) : result(check, 'pass', 'No duplicates.'));
      } else if (check.type === 'header_matches_template') {
        const expected = table(await load(check.attachmentId)).header;
        const same = expected.length === out.header.length && expected.every((h, i) => h === out.header[i]);
        const extra = out.header.filter(h => !expected.includes(h)), lacking = expected.filter(h => !out.header.includes(h));
        results.push(same ? result(check, 'pass', `${expected.length} columns in order.`)
          : result(check, 'fail', lacking.length || extra.length ? `Missing: ${lacking.join(', ') || 'none'}. Unexpected: ${extra.join(', ') || 'none'}.` : 'Same columns, different order.'));
      } else if (check.type === 'values_in_crosswalk') {
        if (missing([check.field]).length) { results.push(result(check, 'fail', `Missing column: ${check.field}.`)); continue; }
        const walk = table(await load(check.attachmentId));
        if (!walk.header.includes(check.column)) { results.push(result(check, 'error', `The cross-walk has no column ${check.column}.`)); continue; }
        const known = new Set(walk.rows.map(r => String(r[check.column] ?? '').trim()));
        const bad = [];
        out.rows.forEach((row, i) => { const v = String(row[check.field] ?? '').trim(); if (v && !known.has(v)) bad.push(`Row ${i + 2}: ${v}`); });
        results.push(bad.length ? result(check, 'fail', `${bad.length} value${bad.length === 1 ? '' : 's'} not in the cross-walk.`, bad) : result(check, 'pass', 'Every code resolves.'));
      } else if (check.type === 'control_total') {
        if (missing([check.field]).length) { results.push(result(check, 'fail', `Missing column: ${check.field}.`)); continue; }
        let sum = 0; const bad = [];
        out.rows.forEach((row, i) => { const n = toNumber(row[check.field]); if (n === null && String(row[check.field] ?? '').trim()) bad.push(`Row ${i + 2}: ${row[check.field]}`); else sum += n || 0; });
        sum = Math.round(sum * 100) / 100;
        if (bad.length) results.push(result(check, 'fail', `${bad.length} value${bad.length === 1 ? ' isn’t a number' : 's aren’t numbers'}.`, bad));
        else results.push(Math.abs(sum - check.expected) <= check.tolerance ? result(check, 'pass', `Total ${sum.toLocaleString('en-US')}.`)
          : result(check, 'fail', `Total ${sum.toLocaleString('en-US')}, off by ${Math.round(Math.abs(sum - check.expected) * 100) / 100}.`));
      } else if (check.type === 'matches_samples') {
        if (missing([check.key]).length) { results.push(result(check, 'fail', `Missing key column: ${check.key}.`)); continue; }
        const byKey = new Map(out.rows.map(r => [String(r[check.key] ?? '').trim(), r]));
        const bad = [];
        for (const sample of check.samples || []) {
          const expected = table(await load(sample.attachmentId));
          for (const row of expected.rows) {
            const key = String(row[check.key] ?? '').trim(), got = byKey.get(key);
            if (!got) { bad.push(`${sample.filename}: ${key} missing`); continue; }
            const wrong = expected.header.filter(h => h !== check.key && String(got[h] ?? '').trim() !== String(row[h] ?? '').trim());
            if (wrong.length) bad.push(`${sample.filename}: ${key} differs in ${wrong.join(', ')}`);
          }
        }
        results.push(bad.length ? result(check, 'fail', `${bad.length} sample row${bad.length === 1 ? '' : 's'} don’t match.`, bad) : result(check, 'pass', 'Every sample row matches.'));
      }
    } catch (error) { results.push(result(check, 'error', `This check couldn’t run: ${error.message}.`)); }
  }
  return { file: csv.filename, results };
}

// Sample pairs are resolved when the check set is frozen into the agreement.
function freeze(checks, task) {
  return (checks || []).map(c => c.type === 'matches_samples'
    ? { ...c, samples: (task.attachments || []).filter(f => f.role === 'expected_output').map(f => ({ attachmentId: f.id, filename: f.filename })) } : { ...c });
}
const failing = checksRun => (checksRun?.results || []).filter(r => r.status !== 'pass').map(r => r.id);

module.exports = { normalizeChecks, runChecks, freeze, failing, checkView, TYPES, MAX_CHECKS };
