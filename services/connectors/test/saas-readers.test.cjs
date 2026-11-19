'use strict';
// Read-only GitHub, HubSpot and Attio connectors against a stubbed network.
// These check the safety rules (fixed hosts, read-only calls, least-privilege
// tokens, bounded responses); they don't prove behaviour against live accounts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGitHubReader, createHubSpotReader, createAttioReader } = require('../src/saas-readers.cjs');

function stub(routes) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, ...init });
    const route = routes.find(([match]) => url.startsWith(match));
    if (!route) return new Response('{}', { status: 404 });
    const [, status, body] = route;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}
const PAT = 'github_pat_11AAAAAAA0123456789';

test('GitHub accepts only fine-grained tokens and reads through fixed, read-only endpoints', async () => {
  const s = stub([
    ['https://api.github.com/user/repos', 200, [{ full_name: 'northwind/erp-scripts', private: true, default_branch: 'main', description: 'Migration scripts', updated_at: '2026-11-01' }]],
    ['https://api.github.com/user', 200, { login: 'northwind-bot' }],
    ['https://api.github.com/repos/northwind/erp-scripts/issues', 200, [{ number: 7, title: 'Vendor dedupe rules', state: 'open', labels: [{ name: 'data' }], user: { login: 'ana' }, body: 'Use tax ID first', pull_request: undefined }]],
    ['https://api.github.com/repos/northwind/erp-scripts/contents/mappings/vendor.csv', 200, { path: 'mappings/vendor.csv', size: 12, sha: 'abc', encoding: 'base64', content: Buffer.from('legacy,new\n').toString('base64') }],
  ]);
  const gh = createGitHubReader({ fetchImpl: s.fetchImpl });
  await assert.rejects(gh.verify({ token: 'ghp_classicTOKEN1234567' }), e => e.rejected === true, 'classic tokens can’t be limited to read-only repositories');
  assert.deepEqual({ ...(await gh.verify({ token: PAT })) }, { account: 'northwind-bot', objects: ['repositories', 'issues', 'pull_requests', 'file'] });
  const repos = await gh.read({ token: PAT }, { object: 'repositories' });
  assert.equal(repos.rows[0].fullName, 'northwind/erp-scripts');
  const issues = await gh.read({ token: PAT }, { object: 'issues', params: { repo: 'northwind/erp-scripts' } });
  assert.deepEqual({ ...issues.rows[0], labels: [...issues.rows[0].labels] }, { number: 7, title: 'Vendor dedupe rules', state: 'open', labels: ['data'], author: 'ana', createdAt: undefined, updatedAt: undefined, body: 'Use tax ID first', isPullRequest: false });
  const file = await gh.read({ token: PAT }, { object: 'file', params: { repo: 'northwind/erp-scripts', path: 'mappings/vendor.csv' } });
  assert.equal(file.rows[0].content, 'legacy,new\n');
  await assert.rejects(gh.read({ token: PAT }, { object: 'file', params: { repo: 'northwind/erp-scripts', path: '../../etc/passwd' } }), { code: 'INVALID_INPUT' });
  await assert.rejects(gh.read({ token: PAT }, { object: 'issues', params: { repo: 'https://evil.example/x' } }), { code: 'INVALID_INPUT' });
  for (const call of s.calls) {
    assert.equal(new URL(call.url).hostname, 'api.github.com');
    assert.equal(call.method, 'GET');
    assert.equal(call.redirect, 'error');
    assert.equal(call.headers.authorization, `Bearer ${PAT}`);
  }
});

test('HubSpot reads CRM objects with paging and maps a refused token to a reconnect message', async () => {
  const s = stub([
    ['https://api.hubapi.com/account-info/v3/details', 200, { portalId: 4400123 }],
    ['https://api.hubapi.com/crm/v3/objects/companies', 200, { results: [{ id: '91', properties: { name: 'Contoso', domain: 'contoso.com' } }], paging: { next: { after: '91' } } }],
  ]);
  const hs = createHubSpotReader({ fetchImpl: s.fetchImpl });
  assert.equal((await hs.verify({ token: 'pat-na1-0000-1111' })).account, '4400123');
  const page = await hs.read({ token: 'pat-na1-0000-1111' }, { object: 'companies' });
  assert.equal(page.rows[0].properties.domain, 'contoso.com');
  assert.equal(page.nextCursor, '91');
  await hs.read({ token: 'pat-na1-0000-1111' }, { object: 'companies', cursor: '91' });
  assert.match(s.calls.at(-1).url, /after=91/);
  await assert.rejects(hs.read({ token: 'pat-na1-0000-1111' }, { object: 'tickets' }), { code: 'INVALID_INPUT' });
  const denied = createHubSpotReader({ fetchImpl: stub([['https://api.hubapi.com/', 401, {}]]).fetchImpl });
  await assert.rejects(denied.verify({ token: 'pat-na1-revoked-00' }), e => e.rejected === true && e.code === 'CONNECTOR_DENIED');
});

test('Attio reads records with a query that only reads, and oversize responses are refused', async () => {
  const s = stub([
    ['https://api.attio.com/v2/self', 200, { workspace_name: 'Northwind' }],
    ['https://api.attio.com/v2/objects/people/records/query', 200, { data: [{ id: { record_id: 'r1' }, created_at: '2026-10-01', values: { name: [{ full_name: 'Ana Ruiz' }] } }] }],
  ]);
  const at = createAttioReader({ fetchImpl: s.fetchImpl });
  assert.equal((await at.verify({ token: 'attio_read_only_token' })).account, 'Northwind');
  const people = await at.read({ token: 'attio_read_only_token' }, { object: 'people' });
  assert.equal(people.rows[0].id, 'r1');
  assert.deepEqual(JSON.parse(s.calls.at(-1).body), { limit: 100, offset: 0 });
  const huge = createAttioReader({ fetchImpl: stub([['https://api.attio.com/', 200, 'x'.repeat(2 * 1024 * 1024 + 1)]]).fetchImpl });
  await assert.rejects(huge.read({ token: 'attio_read_only_token' }, { object: 'people' }), { code: 'CONNECTOR_RESPONSE_TOO_LARGE' });
});
