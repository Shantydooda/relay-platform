'use strict';

const { fail } = require('../../../packages/contracts/src/input.cjs');
const PREVIEW_CHARACTERS = 16000;
const TEXT_TYPES = new Set(['text/csv', 'text/plain', 'application/json']);

// Preview is data, never HTML or executable content. The caller must authorize
// the exact submission and verify its original bytes before invoking this.
function filePreview(file) {
  if (!TEXT_TYPES.has(file.mime)) fail(415, 'PREVIEW_UNSUPPORTED', 'This file type has no preview. Download it to review.');
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(file.bytes); }
  catch { fail(409, 'PREVIEW_UNAVAILABLE', 'The file is not valid UTF-8 text.'); }
  if (content.includes('\0')) fail(409, 'PREVIEW_UNAVAILABLE', 'Binary content cannot be previewed as text.');
  let formatted = false;
  if (file.mime === 'application/json') {
    try { content = JSON.stringify(JSON.parse(content), null, 2); formatted = true; }
    catch { /* Preserve original text for review; do not assert JSON validity. */ }
  }
  const truncated = content.length > PREVIEW_CHARACTERS;
  return {
    filename: file.filename, mime: file.mime, size: file.bytes.length,
    sha256: file.sha256, text: content.slice(0, PREVIEW_CHARACTERS),
    truncated, formatted, limit: PREVIEW_CHARACTERS,
    notice: 'File integrity verified. This is a text preview, not a malware scan or a quality assessment.'
  };
}
module.exports = { filePreview, PREVIEW_CHARACTERS };
