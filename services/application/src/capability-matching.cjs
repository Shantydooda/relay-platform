'use strict';
const { exactKeys, fail, text } = require('../../../packages/contracts/src/input.cjs');
const FIELDS = ['industries', 'regions', 'outputs', 'tools'];
function metadata(value = {}) {
  exactKeys(value, FIELDS);
  return Object.fromEntries(FIELDS.map(key => {
    const values = value[key] ?? [];
    if (!Array.isArray(values) || values.length > 12) fail(400, 'INVALID_INPUT', 'Use at most 12 entries per capability detail.');
    return [key, [...new Set(values.map(item => text(item, key, 1, 80)))]];
  }));
}
// Function words plus generic qualifiers ("high quality", "new", "best") that
// describe almost any request. Sharing only these must not count as task fit.
const STOP = new Set([
  'a an and are as at be by for from i in is it me my of on or our please that the their this to we with',
  'work task need want find create build make deliver agent',
  'about also any around best budget can could get give good great help high into just like more new',
  'quality some top using use very would your you',
].join(' ').split(' '));
const GROUPS = {
  prospecting: ['prospecting', 'lead generation', 'leads', 'sales prospects'],
  research: ['research', 'investigate', 'investigation', 'market intelligence'],
  website: ['website', 'websites', 'web development', 'landing page'],
  video: ['video', 'videos', 'film', 'films'],
  presentation: ['presentation', 'presentations', 'pitch deck', 'slide deck'],
  property: ['real estate', 'property', 'properties'],
  company: ['company', 'companies', 'businesses'],
  deduplication: ['deduplicate', 'deduplication', 'dedup', 'duplicate', 'duplicates', 'remove duplicates', 'remove exact duplicates'],
  spreadsheet: ['csv', 'spreadsheet', 'spreadsheets', 'excel', 'xlsx'],
  uk: ['uk', 'united kingdom', 'britain'],
  usa: ['usa', 'united states'],
};
// Conservative plural folding so "leads"/"lead" and "reports"/"report" align.
// Deliberately not a stemmer: "filmmaker" must not match "film".
function singular(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
function normalize(value) { return String(value || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function features(value) {
  const normalized = normalize(value), padded = ` ${normalized} `;
  const tokens = new Set(normalized.split(' ').filter(word => word.length > 2 && !STOP.has(word)).map(singular));
  const concepts = new Set(Object.entries(GROUPS).filter(([, aliases]) => aliases.some(alias => padded.includes(` ${alias} `))).map(([concept]) => concept));
  return {tokens, concepts};
}
function matchCapability(brief, capability, details = {}) {
  const request = features(brief), declared = features(capability);
  const words = [...request.tokens].filter(word => declared.tokens.has(word));
  const concepts = [...request.concepts].filter(concept => declared.concepts.has(concept));
  const matches = [...new Set([...words, ...concepts])];
  // Metadata enriches an existing task match; tags alone cannot qualify an unrelated worker.
  const detailText = FIELDS.flatMap(key => Array.isArray(details[key]) ? details[key] : []).join(' ');
  const detailMatches = [...features(detailText).tokens].filter(word => request.tokens.has(word));
  return { matches, detailMatches, score: Math.min(1, (words.length + concepts.length) / Math.max(1, request.tokens.size + request.concepts.size)) };
}
module.exports = { metadata, matchCapability, FIELDS };
