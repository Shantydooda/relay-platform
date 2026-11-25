'use strict';

// The sample agent's actual work: clean a CSV. Trim cells, drop empty rows,
// remove exact duplicate rows and sort. Deterministic code, no AI model.
// Replace this file (and my-agent.cjs) with calls to your own agent.

function parseCsv(source, { maxRows = 10000 } = {}) {
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  source = source.replace(/^﻿/, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') { quoted = false; closed = true; }
      else field += character;
    } else if (character === '"') {
      if (field || closed) throw new Error('A quote appears in the middle of a value.');
      quoted = true;
    } else if (character === ',' || character === '\n' || character === '\r') {
      row.push(field.trim()); field = ''; closed = false;
      if (character !== ',') {
        if (character === '\r' && source[index + 1] === '\n') index++;
        if (row.some(value => value !== '')) rows.push(row);
        row = [];
      }
    } else {
      if (closed && character.trim()) throw new Error('Text follows a closing quote.');
      if (!closed) field += character;
    }
    if (rows.length > maxRows || row.length > 100) throw new Error('More than 10,000 rows or 100 columns.');
  }
  if (quoted) throw new Error('A quoted value is never closed.');
  row.push(field.trim());
  if (row.some(value => value !== '')) rows.push(row);
  if (!rows.length) throw new Error('The file is empty.');
  const width = rows[0].length;
  if (rows.some(item => item.length !== width)) throw new Error('Rows have different numbers of columns.');
  if (rows[0].some(value => !value) || new Set(rows[0].map(value => value.toLowerCase())).size !== width) throw new Error('Every column needs a unique name in the header.');
  return rows;
}

// Spreadsheet safety: a cell starting with = + - or @ could run as a formula.
function cell(value) {
  const safe = /^[\s\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯]*[=+@-]/u.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

// options: { sort: 'ascending' | 'descending', keepDuplicates: boolean }
function cleanCsv(bytes, { sort = 'ascending', keepDuplicates = false } = {}) {
  const [headers, ...inputRows] = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  let rows = inputRows;
  if (!keepDuplicates) rows = [...new Map(rows.map(row => [JSON.stringify(row), row])).values()];
  const direction = sort === 'descending' ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    const x = JSON.stringify(a), y = JSON.stringify(b);
    return direction * (x < y ? -1 : x > y ? 1 : 0);
  });
  const csv = Buffer.from([headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n');
  return { csv, report: { inputRows: inputRows.length, outputRows: rows.length, duplicatesRemoved: inputRows.length - rows.length, columns: headers.length, sort } };
}

// Reads a buyer's revision note. Anything it doesn't recognise keeps the defaults,
// and the delivery evidence says so: never pretend to have followed an instruction.
function optionsFrom(note) {
  const text = String(note || '');
  const options = {
    sort: /descend|reverse|z\s*(?:to|-)\s*a/i.test(text) ? 'descending' : 'ascending',
    keepDuplicates: /keep\b.*duplicat/i.test(text),
  };
  const understood = !text || options.sort === 'descending' || options.keepDuplicates || /ascend|a\s*(?:to|-)\s*z|duplicat|sort/i.test(text);
  return { options, understood };
}

module.exports = { cleanCsv, optionsFrom, parseCsv };
