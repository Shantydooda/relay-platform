'use strict';

// Read-only connectors for buyer tools: GitHub, HubSpot and Attio
// (docs/specs/Buyer-Connections.md). Each implements the provider contract:
//   verify(credentials) -> { account, objects }
//   read(credentials, { object, cursor, params }) -> { rows, nextCursor }
//
// Safety rules shared by all three:
// - Fixed hosts and a fixed object -> endpoint map. No caller-supplied URLs.
// - Read operations only (Attio's record query is a POST that reads).
// - Least privilege at the source: each tool's token is created by the buyer
//   with read-only scopes (the connect form says which). GitHub must be a
//   fine-grained token, which is limited to chosen repositories.
// - 10 s timeout, no redirects, 2 MB response cap, tokens never logged or echoed.
// Not yet verified against live accounts: the tests use a recorded-shape stub.

const { HttpError } = require('../../../packages/contracts/src/input.cjs');
const MAX_BODY = 2 * 1024 * 1024;
const PAGE = 100;

function upstream(code, message, extra = {}) { return Object.assign(new HttpError(502, code, message), extra); }
const invalid = message => new HttpError(400, 'INVALID_INPUT', message);

async function call(fetchImpl, host, path, token, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(path, `https://${host}`);
  if (url.hostname !== host || url.protocol !== 'https:') throw new TypeError('Connector URL left its host');
  let response;
  try {
    response = await fetchImpl(url.toString(), { method, redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined });
  } catch { throw upstream('CONNECTOR_UNAVAILABLE', 'The connected tool couldn’t be reached. Try again shortly.'); }
  const text = await response.text();
  if (text.length > MAX_BODY) throw upstream('CONNECTOR_RESPONSE_TOO_LARGE', 'The tool returned more data than one read allows. Narrow the request.');
  if (response.status === 401 || response.status === 403) throw Object.assign(upstream('CONNECTOR_DENIED', 'The tool refused this token. The buyer may need to reconnect it.'), { rejected: true });
  if (response.status === 404) throw upstream('CONNECTOR_NOT_FOUND', 'That record or repository isn’t visible to this token.');
  if (response.status === 429) throw upstream('CONNECTOR_RATE_LIMITED', 'The tool is rate-limiting requests. Wait and retry.');
  if (!response.ok) throw upstream('CONNECTOR_UNAVAILABLE', 'The connected tool returned an error.');
  try { return { json: text ? JSON.parse(text) : null, headers: response.headers }; }
  catch { throw upstream('CONNECTOR_UNAVAILABLE', 'The connected tool returned an unreadable response.'); }
}
function token(credentials) {
  if (typeof credentials?.token !== 'string' || credentials.token.length < 10 || credentials.token.length > 400 || /\s/.test(credentials.token))
    throw Object.assign(new Error('Enter a valid access token.'), { rejected: true });
  return credentials.token;
}
function param(params, name, pattern, max = 200) {
  const value = params?.[name];
  if (typeof value !== 'string' || !value || value.length > max || !pattern.test(value) || value.includes('..'))
    throw invalid(`Give a valid ${name}.`);
  return value;
}
const page = cursor => { const n = Number(cursor || 1); return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1; };
const clip = (value, max = 20000) => typeof value === 'string' && value.length > max ? value.slice(0, max) + '…' : value;

// ---- GitHub ------------------------------------------------------------------
function createGitHubReader({ fetchImpl = fetch } = {}) {
  const host = 'api.github.com', headers = { 'x-github-api-version': '2022-11-28', 'user-agent': 'relay-connector', accept: 'application/vnd.github+json' };
  const REPO = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, PATH = /^[A-Za-z0-9_./ -]{1,300}$/, REF = /^[A-Za-z0-9_./-]{1,200}$/;
  const get = (path, credentials) => call(fetchImpl, host, path, token(credentials), { headers });
  return {
    kind: 'github', label: 'GitHub', environments: ['production'],
    objects: ['repositories', 'issues', 'pull_requests', 'file'],
    objectParams: { issues: ['repo'], pull_requests: ['repo'], file: ['repo', 'path', 'ref'] },
    credentialFields: [{ name: 'token', label: 'Fine-grained access token (read-only)', secret: true }],
    help: 'Create a fine-grained token limited to the repositories this work needs, with read-only Contents, Issues, Pull requests and Metadata.',
    async verify(credentials) {
      // Classic tokens can't be limited to repositories or to read-only access.
      if (!token(credentials).startsWith('github_pat_')) throw Object.assign(new Error('Use a fine-grained token.'), { rejected: true });
      const { json } = await get('/user', credentials);
      return { account: String(json?.login || ''), objects: this.objects };
    },
    async read(credentials, { object, cursor, params }) {
      const n = page(cursor), next = rows => rows.length === PAGE ? String(n + 1) : null;
      if (object === 'repositories') {
        const { json } = await get(`/user/repos?per_page=${PAGE}&page=${n}&sort=updated`, credentials);
        const rows = (json || []).map(r => ({ fullName: r.full_name, private: !!r.private, defaultBranch: r.default_branch, description: clip(r.description, 500), updatedAt: r.updated_at }));
        return { rows, nextCursor: next(json || []) };
      }
      const repo = param(params, 'repo', REPO);
      if (object === 'issues' || object === 'pull_requests') {
        const kind = object === 'issues' ? 'issues' : 'pulls';
        const { json } = await get(`/repos/${repo}/${kind}?state=all&per_page=${PAGE}&page=${n}`, credentials);
        const rows = (json || []).map(i => ({ number: i.number, title: clip(i.title, 500), state: i.state, labels: (i.labels || []).map(l => l.name), author: i.user?.login || null,
          createdAt: i.created_at, updatedAt: i.updated_at, body: clip(i.body), ...(kind === 'issues' ? { isPullRequest: !!i.pull_request } : { merged: !!i.merged_at }) }));
        return { rows, nextCursor: next(json || []) };
      }
      if (object === 'file') {
        const path = param(params, 'path', PATH, 300);
        const ref = params?.ref ? param(params, 'ref', REF) : null;
        const { json } = await get(`/repos/${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, credentials);
        if (Array.isArray(json)) return { rows: json.map(e => ({ path: e.path, type: e.type, size: e.size })), nextCursor: null };
        const content = json?.encoding === 'base64' && json.size <= 1024 * 1024 ? Buffer.from(json.content || '', 'base64').toString('utf8') : null;
        return { rows: [{ path: json?.path, size: json?.size, sha: json?.sha, content, truncated: content === null }], nextCursor: null };
      }
      throw invalid('Unknown object.');
    },
  };
}

// ---- HubSpot -----------------------------------------------------------------
function createHubSpotReader({ fetchImpl = fetch } = {}) {
  const host = 'api.hubapi.com', CURSOR = /^[0-9]{1,30}$/;
  const PROPERTIES = { contacts: 'email,firstname,lastname,company,phone,lifecyclestage', companies: 'name,domain,industry,country,numberofemployees', deals: 'dealname,amount,dealstage,pipeline,closedate' };
  return {
    kind: 'hubspot', label: 'HubSpot', environments: ['sandbox', 'production'],
    objects: ['contacts', 'companies', 'deals'], objectParams: {},
    credentialFields: [{ name: 'token', label: 'Private app access token (read-only scopes)', secret: true }],
    help: 'Create a private app with only the read scopes the work needs, for example crm.objects.contacts.read and crm.objects.companies.read. Use a sandbox account first.',
    async verify(credentials) {
      const { json } = await call(fetchImpl, host, '/account-info/v3/details', token(credentials));
      return { account: String(json?.portalId || ''), objects: this.objects };
    },
    async read(credentials, { object, cursor }) {
      if (!PROPERTIES[object]) throw invalid('Unknown object.');
      const after = cursor && CURSOR.test(String(cursor)) ? `&after=${cursor}` : '';
      const { json } = await call(fetchImpl, host, `/crm/v3/objects/${object}?limit=${PAGE}&archived=false&properties=${PROPERTIES[object]}${after}`, token(credentials));
      return { rows: (json?.results || []).map(r => ({ id: r.id, properties: r.properties || {}, createdAt: r.createdAt, updatedAt: r.updatedAt })), nextCursor: json?.paging?.next?.after || null };
    },
  };
}

// ---- Attio -------------------------------------------------------------------
function createAttioReader({ fetchImpl = fetch } = {}) {
  const host = 'api.attio.com';
  return {
    kind: 'attio', label: 'Attio', environments: ['production'],
    objects: ['companies', 'people'], objectParams: {},
    credentialFields: [{ name: 'token', label: 'Access token (read-only scopes)', secret: true }],
    help: 'Create an access token with read-only record and object scopes. Relay never writes to Attio through a connection.',
    async verify(credentials) {
      const { json } = await call(fetchImpl, host, '/v2/self', token(credentials));
      return { account: String(json?.workspace_name || json?.workspace_id || ''), objects: this.objects };
    },
    async read(credentials, { object, cursor }) {
      if (!this.objects.includes(object)) throw invalid('Unknown object.');
      const offset = Number.isInteger(Number(cursor)) && Number(cursor) >= 0 ? Number(cursor) : 0;
      // A record query is a POST, but it only reads.
      const { json } = await call(fetchImpl, host, `/v2/objects/${object}/records/query`, token(credentials), { method: 'POST', body: { limit: PAGE, offset } });
      const rows = (json?.data || []).map(r => ({ id: r.id?.record_id, createdAt: r.created_at, values: r.values || {} }));
      return { rows, nextCursor: rows.length === PAGE ? String(offset + PAGE) : null };
    },
  };
}

module.exports = { createGitHubReader, createHubSpotReader, createAttioReader };
