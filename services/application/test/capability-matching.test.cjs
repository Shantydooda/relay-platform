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
test('seed-category wording matches how buyers describe B2B data and research work', () => {
  assert.ok(matchCapability('Get me 50 contacts at fintech startups', 'Sales prospecting').matches.includes('prospecting'));
  assert.ok(matchCapability('Get me 50 contacts at fintech startups', 'Company research for startups').matches.includes('company'));
  assert.ok(matchCapability('Competitor analysis for our SaaS', 'Market research').matches.includes('research'));
  assert.ok(matchCapability('Enrich my HubSpot contacts with firmographics', 'Data enrichment').matches.includes('enrichment'));
  assert.ok(matchCapability('Clean up our Salesforce records', 'CRM cleanup').matches.includes('crm'));
  assert.ok(matchCapability('Triage our support tickets', 'Customer support automation').matches.includes('support'));
});
test('seed-category additions do not create matches across unrelated work', () => {
  assert.equal(matchCapability('Edit our launch video', 'Market research').score, 0);
  assert.equal(matchCapability('Build a landing page for our startup', 'Sales prospecting').matches.includes('prospecting'), false);
  assert.equal(matchCapability('Write a blog post about research methods', 'CRM cleanup').score, 0);
});
