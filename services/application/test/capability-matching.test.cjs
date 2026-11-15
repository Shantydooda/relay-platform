'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {metadata, matchCapability} = require('../src/capability-matching.cjs');
test('related task language matches without claiming model inference', () => {
  assert.ok(matchCapability('Find sales prospects', 'Lead generation').matches.includes('prospecting'));
  assert.ok(matchCapability('Build a pitch deck', 'Design presentations').matches.includes('presentation'));
  assert.ok(matchCapability('Investigate properties', 'Real estate research').matches.includes('property'));
  assert.equal(matchCapability('Build a website', 'Video production').score, 0);
});
test('metadata cannot turn an unrelated capability into a task match', () => {
  const result = matchCapability('Build a website with Attio', 'Make videos', {tools:['website', 'Attio']});
  assert.equal(result.matches.length, 0);
  assert.ok(result.detailMatches.includes('attio'));
  assert.equal(matchCapability('film', 'filmmaker').matches.length, 0);
});
test('metadata defaults, bounds and unknown fields are validated', () => {
  assert.deepEqual(metadata().tools, []);
  assert.deepEqual(metadata({tools:['Attio','Attio']}).tools, ['Attio']);
  for (const value of [{verified:true}, {tools:'Attio'}, {regions:Array(13).fill('UK')}, {outputs:['x'.repeat(81)]}]) assert.throws(()=>metadata(value));
});
test('generic qualifiers alone never count as task fit', () => {
  assert.equal(matchCapability('I want high quality leads for my SaaS', 'High quality video editing').matches.length, 0);
  assert.equal(matchCapability('Need a list of new restaurants', 'New website builds').matches.length, 0);
});
test('plural forms and common file wording align without broad stemming', () => {
  assert.ok(matchCapability('Deduplicate my CSV list', 'Remove duplicate rows from CSV files').matches.includes('deduplication'));
  assert.ok(matchCapability('Clean my spreadsheet', 'CSV cleanup').matches.includes('spreadsheet'));
  assert.ok(matchCapability('Weekly reports on competitors', 'Competitor report').matches.includes('report'));
  assert.equal(matchCapability('Analysis of business processes', 'Video production').score, 0);
});
