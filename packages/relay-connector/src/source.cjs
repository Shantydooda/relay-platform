'use strict';

// Serves pages of rows from the export files named in the settings. Files are
// opened read-only and re-read on each request, so a fresh export is picked up
// without a restart. The connector never writes to these files.
const { openSync, closeSync, fstatSync, readFileSync, statSync, realpathSync, constants } = require('node:fs');
const { sep } = require('node:path');
const { parseCsv } = require('./csv.cjs');

const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_PAGE = 500;
const CURSOR_PATTERN = /^(0|[1-9]\d{0,8})$/;

// `message` is what Relay sees and must never contain a local path or an
// operating-system error. `detail` is for the local audit log only.
class SourceError extends Error {
  constructor(code, message, detail) { super(message); this.code = code; if (detail) this.detail = detail; }
}

const UNREADABLE = 'The export could not be read.';

// A cursor from Relay is a canonical non-negative integer string, or absent.
function parseCursor(cursor) {
  if (cursor === undefined || cursor === null) return 0;
  if (typeof cursor !== 'string' || !CURSOR_PATTERN.test(cursor)) throw new SourceError('INVALID_CURSOR', 'The read position is not valid.');
  return Number(cursor);
}

function parseLimit(limit) {
  if (limit === undefined || limit === null) return MAX_PAGE;
  if (!Number.isInteger(limit) || limit < 1) throw new SourceError('INVALID_LIMIT', 'The page size is not valid.');
  return Math.min(limit, MAX_PAGE);
}

function createFolderSource({ root, objects }) {
  function rows(object) {
    const file = Object.hasOwn(objects, object) ? objects[object] : undefined;
    if (!file) throw new SourceError('OBJECT_UNAVAILABLE', 'No export is configured for that object.');
    // Opened once, without following a final link. Every check is then made on
    // that open handle and the rows are read from it, so the file cannot be
    // swapped between the check and the read.
    let fd;
    try {
      fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      const opened = fstatSync(fd);
      if (!opened.isFile()) throw new SourceError('SOURCE_UNREADABLE', UNREADABLE, 'not a regular file');
      const real = realpathSync(file);
      if (!real.startsWith(root + sep)) throw new SourceError('SOURCE_UNREADABLE', UNREADABLE, 'export is outside the exports folder');
      const named = statSync(real);
      if (named.dev !== opened.dev || named.ino !== opened.ino) throw new SourceError('SOURCE_UNREADABLE', UNREADABLE, 'export changed while opening');
      if (opened.size > MAX_FILE_BYTES) throw new SourceError('SOURCE_UNREADABLE', 'The export is larger than 200 MB.', 'size limit');
      return parseCsv(readFileSync(fd, 'utf8'));
    } catch (error) {
      if (error instanceof SourceError) throw error;
      throw new SourceError('SOURCE_UNREADABLE', UNREADABLE, error.message);
    } finally {
      if (fd !== undefined) { try { closeSync(fd); } catch { /* already closed */ } }
    }
  }
  return {
    objects: () => Object.keys(objects),
    read(object, { cursor, limit } = {}) {
      const start = parseCursor(cursor);
      const size = parseLimit(limit);
      const all = rows(object);
      const page = all.slice(start, start + size);
      return { rows: page, nextCursor: start + page.length < all.length ? String(start + page.length) : null };
    },
  };
}

module.exports = { createFolderSource, SourceError };
