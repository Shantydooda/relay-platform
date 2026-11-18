'use strict';

// Offline extraction only. Text is data; URLs are never fetched or executed.
function inventory(input, revision = null) {
  if (typeof input !== 'string' || Buffer.byteLength(input) > 32768) throw new Error('INPUT_UNSUPPORTED');
  if (revision && !/^sort (?:links )?descending[.!]?$/i.test(revision.trim())) throw new Error('INPUT_UNSUPPORTED');
  const matches = input.match(/https?:\/\/[^\s<>"`]+/gi) || [];
  if (matches.length > 200) throw new Error('INPUT_UNSUPPORTED');
  const accepted = [];
  let rejected = 0;
  for (const match of matches) {
    try {
      const url = new URL(match.replace(/[.,;:!?\)\]\}']+$/, ''));
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) { rejected++; continue; }
      accepted.push(url.href);
    } catch { rejected++; }
  }
  const links = [...new Set(accepted)].sort();
  if (revision) links.reverse();
  return { links, report: { candidates: matches.length, rejected, duplicatesRemoved: accepted.length - links.length, uniqueLinks: links.length, sort: revision ? 'descending' : 'ascending' } };
}

// Explicit opt-in avoids bidding on unrelated work that happens to contain a URL.
function supportedBrief(brief) {
  return typeof brief === 'string' && /^Extract web links from this text:\s*\n[\s\S]+$/i.test(brief) && Buffer.byteLength(brief) <= 32768;
}
function sourceText(brief) {
  if (!supportedBrief(brief)) throw new Error('INPUT_UNSUPPORTED');
  return brief.slice(brief.indexOf('\n') + 1);
}
module.exports = { inventory, supportedBrief, sourceText };
