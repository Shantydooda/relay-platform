'use strict';

// A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and line
// breaks inside quotes, CRLF or LF, and a leading byte-order mark. The first
// row is the header; every value stays text, exactly as exported.
function parseCsv(input) {
  const source = String(input).replace(/^﻿/, '');
  const records = [];
  let row = [], field = '', quoted = false, i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' && source[i + 1] === '\n') i++;
    if (ch === '\n' || ch === '\r') { row.push(field); records.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new Error('The file ends inside a quoted value.');
  if (field !== '' || row.length) { row.push(field); records.push(row); }
  const rows = records.filter(r => !(r.length === 1 && r[0] === ''));
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim());
  if (header.some(h => !h) || new Set(header).size !== header.length) throw new Error('The header row needs a unique name for every column.');
  return rows.slice(1).map((values, n) => {
    if (values.length !== header.length) throw new Error(`Row ${n + 2} has ${values.length} values; the header has ${header.length}.`);
    return Object.fromEntries(header.map((h, k) => [h, values[k]]));
  });
}

module.exports = { parseCsv };
