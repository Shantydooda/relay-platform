'use strict';

const { fail } = require('./security.cjs');
const { pageInput } = require('../../application/src/supplier-feed.cjs');
const PREFIX = '/v1/supplier';

// Pull-based protocol: no server-side calls to arbitrary supplier URLs, webhook
// secrets or browser sessions. All transitions use shared application commands.
async function supplierApi({ req, url, store, jsonBody, send, origin }) {
  if (!url.pathname.startsWith(`${PREFIX}/`)) return false;
  if (!store.features?.localExecution || !store.issueSupplierCredential) fail(404, 'NOT_FOUND', 'Supplier API is unavailable.');
  if (req.headers.origin && req.headers.origin !== origin) fail(403, 'ORIGIN_REQUIRED', 'Origin is not permitted.');
  const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
  const principal = await store.runtimePrincipal(bearer?.[1], { kind: 'supplier-api' });
  const path = url.pathname.slice(PREFIX.length), method = req.method;
  const key = req.headers['idempotency-key'];
  if (path === '/heartbeat' && method === 'POST') {
    send(200, await store.heartbeat(principal, await jsonBody(req))); return true;
  }
  if (path === '/qualifications' && method === 'GET') {
    send(200, { jobs: await store.qualificationJobs(principal) }); return true;
  }
  const assessment = path.match(/^\/qualifications\/([0-9a-f-]{36})$/);
  if (assessment && method === 'POST') {
    send(200, await store.submitQualification(principal, assessment[1], await jsonBody(req), key)); return true;
  }
  const page = () => pageInput(url.searchParams.get('after') || '', Number(url.searchParams.get('limit') || 50));
  if (path === '/events' && method === 'GET') {
    const { after, limit } = page();
    send(200, await store.supplierEvents(principal, after, limit)); return true;
  }
  if (path === '/opportunities' && method === 'GET') {
    const { after, limit } = page();
    send(200, await store.supplierOpportunities(principal, after, limit)); return true;
  }
  if (path === '/assignments' && method === 'GET') {
    const { after, limit } = page();
    send(200, await store.supplierAssignments(principal, after, limit)); return true;
  }
  const conversation = path.match(/^\/tasks\/([0-9a-f-]{36})\/(messages|change-proposals)$/);
  if(conversation && method==='POST') {
    const methodName = conversation[2]==='messages'?'supplierMessage':'proposeChange';
    send(200,await store[methodName](principal.actor,conversation[1],await jsonBody(req),key,principal)); return true;
  }
  const permission = path.match(/^\/tasks\/([0-9a-f-]{36})\/permission-requests$/);
  if (permission && method === 'POST') { send(200, await store.requestToolPermission(principal, permission[1], await jsonBody(req), key)); return true; }
  const tool = path.match(/^\/tasks\/([0-9a-f-]{36})\/tool-read$/);
  if (tool && method === 'POST') { send(200, await store.readAgentTool(principal, tool[1], await jsonBody(req), key)); return true; }
  const task = path.match(/^\/tasks\/([0-9a-f-]{36})(?:\/(offers|claim|progress|submit|fail))?$/);
  if (!task) fail(404, 'NOT_FOUND', 'Supplier endpoint not found.');
  const [, id, action] = task;
  if (!action && method === 'GET') { send(200, await store.supplierAssignment(principal, id)); return true; }
  if (method !== 'POST') fail(405, 'METHOD_NOT_ALLOWED', 'Method not permitted.');
  const body = await jsonBody(req, action === 'submit' ? 23000000 : 32768);
  if (action === 'offers') {
    if (body.agentId !== principal.agentId) fail(403, 'FORBIDDEN', 'Credential cannot act for another agent.');
    send(201, await store.marketplace.quote(principal.actor, id, body, key, principal)); return true;
  }
  if (!['claim', 'progress', 'submit', 'fail'].includes(action)) fail(404, 'NOT_FOUND', 'Supplier endpoint not found.');
  send(200, await store[action === 'fail' ? 'failExecution' : action](principal, id, body, key));
  return true;
}
module.exports = { supplierApi, PREFIX };
