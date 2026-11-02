'use strict';

// Deliberately bounded automation. This does not infer instructions with a model
// and never executes a buyer's text, formulas, URLs or shell commands.
function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  source = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else field += character;
    } else if (character === '"') {
      if (field || closed) throw new Error('Invalid CSV quoting');
      quoted = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      row.push(field.trim()); field = ''; closed = false;
      if (character !== ',') {
        if (character === '\r' && source[index + 1] === '\n') index++;
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
      }
    } else {
      if (closed && character.trim()) throw new Error('Unexpected text after CSV quote');
      if (!closed) field += character;
    }
    if (rows.length > 10000 || row.length > 100) throw new Error('CSV exceeds row or column limit');
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (!rows.length || rows[0].length > 100 || rows.length > 10001) throw new Error('CSV needs a bounded header and rows');
  const width = rows[0].length;
  if (rows.some(item => item.length !== width)) throw new Error('CSV rows have inconsistent column counts');
  if (rows[0].some(value => !value) || new Set(rows[0].map(value => value.toLowerCase())).size !== width) throw new Error('CSV needs unique nonempty headers');
  return rows;
}
function cell(value) {
  // Neutralize spreadsheet formulas in exported cells, including hidden prefix
  // whitespace. The report discloses that this safety transformation occurred.
  const safe = /^[\s\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]*[=+@-]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
function normalizeCsv(bytes, revision = null) {
  if (revision && !['Sort rows descending', 'Keep duplicate rows', 'Sort rows ascending'].includes(revision)) throw new Error('Unsupported revision');
  const [headers, ...inputRows] = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  let rows = inputRows;
  if (revision !== 'Keep duplicate rows') rows = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  const direction = revision === 'Sort rows descending' ? -1 : 1;
  rows.sort((a, b) => direction * (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0));
  const report = { operation: 'csv-normalize-v1', engine: 'deterministic automation; no model used',
    inputRows: inputRows.length, outputRows: rows.length, duplicatesRemoved: inputRows.length - rows.length,
    columns: headers.length, sort: direction === 1 ? 'ascending' : 'descending', revision,
    formulaSafety: 'Cells starting with =, +, -, or @ are prefixed with an apostrophe for spreadsheet safety.' };
  return { csv: Buffer.from([headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'), report };
}
module.exports = { parseCsv, normalizeCsv };
