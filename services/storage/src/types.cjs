'use strict';
const { fail } = require('../../../packages/contracts/src/input.cjs');
function validateType(filename, mime, bytes) {
  const extensions = { 'text/csv': ['csv'], 'text/plain': ['txt', 'md'], 'application/json': ['json'], 'application/pdf': ['pdf'], 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'video/mp4': ['mp4'], 'application/zip': ['zip'] };
  const extension = filename?.split('.').at(-1)?.toLowerCase();
  if (!extensions[mime]?.includes(extension)) fail(400, 'INVALID_FILE', 'Filename extension must match the declared file type.');
  const prefix = bytes.subarray(0, 12);
  const matches = {
    'application/pdf': prefix.subarray(0, 5).toString() === '%PDF-',
    'image/png': prefix.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')),
    'image/jpeg': prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255,
    'video/mp4': prefix.subarray(4, 8).toString() === 'ftyp',
    'application/zip': prefix.subarray(0, 4).equals(Buffer.from('504b0304', 'hex'))
  };
  if (Object.hasOwn(matches, mime) && !matches[mime]) fail(400, 'INVALID_FILE', 'File signature does not match its declared type.');
  if (mime.startsWith('text/') || mime === 'application/json') {
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail(400, 'INVALID_FILE', 'Text files must use UTF-8.'); }
    if (bytes.includes(0)) fail(400, 'INVALID_FILE', 'Binary content is not a text file.');
  }
}
module.exports = { validateType };
