'use strict';

// Serves pages of rows from the export files named in the settings. Files are
// opened read-only and re-read on each request, so a fresh export is picked up
// without a restart. The connector never writes to these files.
const { readFileSync, statSync, realpathSync } = require('node:fs');
const { sep } = require('node:path');
const { parseCsv } = require('./csv.cjs');

const MAX_FILE_BYTES = 200 * 1024 * 1024;

class SourceError extends Error { constructor(code, message) { super(message); this.code = code; } }

function createFolderSource({ root, objects }) {
  function rows(object) {
    const file = objects[object];
    if (!file) throw new SourceError('OBJECT_UNAVAILABLE', `No export is configured for ${object}.`);
    // Checked again on every read: the file may have been replaced by a link.
    let real;
    try { real = realpathSync(file); } catch { throw new SourceError('SOURCE_UNREADABLE', `The ${object} export is missing.`); }
    if (!real.startsWith(root + sep)) throw new SourceError('SOURCE_UNREADABLE', `The ${object} export moved outside the exports folder.`);
    if (statSync(real).size > MAX_FILE_BYTES) throw new SourceError('SOURCE_UNREADABLE', `The ${object} export is larger than 200 MB.`);
    try { return parseCsv(readFileSync(real, 'utf8')); }
    catch (error) { throw new SourceError('SOURCE_UNREADABLE', `The ${object} export couldn’t be read: ${error.message}`); }
  }
  return {
    objects: () => Object.keys(objects),
    read(object, { cursor = '0', limit = 500 } = {}) {
      const all = rows(object);
      const start = /^\d{1,9}$/.test(String(cursor)) ? Number(cursor) : 0;
      const page = all.slice(start, start + Math.min(limit, 500));
      return { rows: page, nextCursor: start + page.length < all.length ? String(start + page.length) : null };
    },
  };
}

module.exports = { createFolderSource, SourceError };
