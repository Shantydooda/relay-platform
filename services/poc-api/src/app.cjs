'use strict';
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { readdirSync }=require('node:fs');
const { resolve } = require('node:path');
const { supplierApi } = require('./supplier-api.cjs');
const { HttpError, fail, exactKeys } = require('./security.cjs');
const PUBLIC = resolve(__dirname,'../../../apps/poc-web/public');
const TOKENS = resolve(__dirname,'../../../packages/ui/src/tokens.css');
const UI = resolve(__dirname,'../../../packages/ui/src');
const assets = {
  '/assets/attio.ico':['assets/attio.ico','image/x-icon'],
  '/drive/callback':['drive.html','text/html; charset=utf-8'],
  '/drive/picker':['drive.html','text/html; charset=utf-8'],
  '/drive.js':['drive.js','text/javascript; charset=utf-8'],
  '/':['index.html','text/html; charset=utf-8'],
  '/notifications-ui.js':['notifications-ui.js','text/javascript; charset=utf-8'],
  '/workspace-apps-ui.js':['workspace-apps-ui.js','text/javascript; charset=utf-8'],
  '/orchestration-ui.js':['orchestration-ui.js','text/javascript; charset=utf-8'],
  '/portfolio-ui.js':['portfolio-ui.js','text/javascript; charset=utf-8'],
  '/agent-market-ui.js':['agent-market-ui.js','text/javascript; charset=utf-8'],
  '/recurring-ui.js':['recurring-ui.js','text/javascript; charset=utf-8'],
  '/buyer-flow.js':['buyer-flow.js','text/javascript; charset=utf-8'],
  '/marketplace.js':['marketplace.js','text/javascript; charset=utf-8'],
  '/execution-ui.js':['execution-ui.js','text/javascript; charset=utf-8'],
  '/approvals-ui.js':['approvals-ui.js','text/javascript; charset=utf-8'],
  '/teams-ui.js':['teams-ui.js','text/javascript; charset=utf-8'],
  '/payments-ui.js':['payments-ui.js','text/javascript; charset=utf-8'],
  '/supplier-ui.js':['supplier-ui.js','text/javascript; charset=utf-8'],
  '/supplier-openapi.json':[resolve(__dirname,'../../../packages/contracts/supplier-openapi.json'),'application/json; charset=utf-8'],
  '/execution-ui.css':['execution-ui.css','text/css; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/managed-auth.js':['managed-auth.js','text/javascript; charset=utf-8'],
  '/request.js':['request.js','text/javascript; charset=utf-8'],
  '/fonts.css':['fonts.css','text/css; charset=utf-8'],
  '/business-ui.css':['business-ui.css','text/css; charset=utf-8'],
  '/workspace-theme.css':['workspace-theme.css','text/css; charset=utf-8'],
  '/prototype-ui.css':['prototype-ui.css','text/css; charset=utf-8'],
  '/styles.css':['styles.css','text/css; charset=utf-8'],
  '/tokens.css':[TOKENS,'text/css; charset=utf-8'],
  '/ui.js':[resolve(UI,'components.cjs'),'text/javascript; charset=utf-8'],
  '/landing.js':[resolve(UI,'public-landing.cjs'),'text/javascript; charset=utf-8'],
  '/landing.css':[resolve(UI,'public-landing.css'),'text/css; charset=utf-8'],
  '/assets/relay-assistants.png':['assets/relay-assistants.png','image/png'],
  '/assets/relay-assistants-wave.png':['assets/relay-assistants-wave.png','image/png']
};

// Fixed local font assets only; no user-controlled filesystem lookup.
for(const file of readdirSync(resolve(PUBLIC,'assets/fonts')).filter(name=>/^[a-z0-9-]+\.ttf$/.test(name)))assets[`/assets/fonts/${file}`]=[`assets/fonts/${file}`,'font/ttf'];

async function rawBody(req, maximumBytes = 32768) {
  if ((req.headers['content-type']||'').split(';')[0].trim()!=='application/json') fail(415,'JSON_REQUIRED','Send application/json.');
  if(Number(req.headers['content-length'])>maximumBytes) fail(413,'BODY_TOO_LARGE','The request is too large.');
  // Consume excess chunks rather than destroying the socket before the 413 can
  // be sent. Keep at most the endpoint limit in memory, including chunked requests.
  const bytes=await new Promise((resolve,reject)=>{
    let size=0,exceeded=false;const chunks=[];
    req.on('data',chunk=>{
      if(exceeded)return;
      size+=chunk.length;
      if(size>maximumBytes){exceeded=true;reject(new HttpError(413,'BODY_TOO_LARGE','The request is too large.'));}
      else chunks.push(chunk);
    });
    req.on('end',()=>{if(!exceeded)resolve(Buffer.concat(chunks));});
    req.on('aborted',()=>reject(new HttpError(400,'REQUEST_ABORTED','The request was interrupted.')));
    req.on('error',reject);
  });
  return bytes;
}
async function jsonBody(req, maximumBytes = 32768) {
  const bytes = await rawBody(req, maximumBytes);
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(400,'INVALID_JSON','The request must contain valid JSON.'); }
}
function cookieToken(req,name) {
  return (req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(`${name}=`))?.slice(name.length+1);
}
function createApp({db,origin,store:providedStore,mode='local-only',now=Date.now,logger=console,runtimeManager,paymentWebhookVerifier,getWorkerHealth}) {
  const expected = new URL(origin);
  if (!['http:','https:'].includes(expected.protocol)||expected.pathname!=='/'||expected.search||expected.hash||expected.username||expected.password) throw new Error('Invalid application origin');
  const managed=mode==='managed-staging';
  if(!['local-only','managed-staging'].includes(mode))throw new Error('Unknown server mode');
  if(managed&&(!providedStore||expected.protocol!=='https:'))throw new Error('Managed staging requires HTTPS and an explicit managed store');
  const store=providedStore||require('./store.cjs').createStore(db,now),secure=expected.protocol==='https:';
  // Browsers share cookies across ports: keep independent local launchers isolated.
  if (providedStore?.features?.localExecution && (managed || expected.protocol !== 'http:' || expected.hostname !== '127.0.0.1')) throw new Error('Local execution requires an explicit loopback server');
  const cookieName=secure?'__Host-relay_poc_session':`relay_local_session_${expected.port||'80'}`;
  function sessionCookie(value,clear=false) {
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:managed?3600:43200}${secure?'; Secure':''}`;
  }
  const server=http.createServer(async(req,res)=>{
    const requestId=randomUUID();
    res.setHeader('X-Request-Id',requestId);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if(secure) res.setHeader('Strict-Transport-Security','max-age=31536000');
    const send=(status,body)=>{ res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body)); };
    try {
      if(req.headers.host!==expected.host) fail(403,'INVALID_HOST','This host is not permitted.');
      const url=new URL(req.url,origin),path=url.pathname,method=req.method;
      if (path === '/api/webhooks/stripe' && method === 'POST') {
        if (managed || !store.features?.localExecution || !paymentWebhookVerifier) fail(503, 'WEBHOOK_DISABLED', 'Sandbox webhooks are not configured.');
        // This one signed server-to-server route is independent of cookies and
        // CSRF. Verify the exact bytes before parsing; all browser routes retain their guards.
        const event = paymentWebhookVerifier(await rawBody(req, 262144), req.headers['stripe-signature']);
        return send(200, await store.receivePaymentEvent(event));
      }
      // Email links and external entry may render a public page, but never
      // consume a token or read account data. Verification remains a same-origin POST.
      const publicNavigation=method==='GET'&&(path==='/'||(!managed&&path==='/drive/callback')||(managed&&path==='/auth/confirm'))
        &&req.headers['sec-fetch-mode']==='navigate'&&req.headers['sec-fetch-dest']==='document';
      if(req.headers['sec-fetch-site']==='cross-site'&&!publicNavigation) fail(403,'CROSS_SITE','Cross-site requests are not permitted.');
      if(method==='GET'&&path==='/health/workers'&&!managed&&getWorkerHealth) {
        const health = getWorkerHealth();
        return send(health.status === 'healthy' ? 200 : 503, health);
      }
      if(method==='GET'&&path==='/health/live') return send(200,{status:'alive'});
      if(method==='GET'&&path==='/health') {
        await store.health?.();
        return send(200,{status:'ok',service:'relay-account-task-poc',storage:store.storage||(managed?'postgres':'sqlite'),mode});
      }
      if(method==='GET'&&path==='/api/config')return send(200,{authMode:managed?'managed':'local',inviteOnly:managed,features:store.features||{}});
      if (!managed && method === 'GET' && ['/drive/callback','/drive/picker'].includes(path)) res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' https://*.google.com https://*.googleusercontent.com; connect-src 'self' https://*.googleapis.com; frame-src https://docs.google.com; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      if(method==='GET'&&(Object.hasOwn(assets,path)||(managed&&path==='/auth/confirm'))) {
        const [file,type]=assets[path==='/auth/confirm'?'/':path];
        const content=await readFile(resolve(PUBLIC,file));
        res.writeHead(200,{'Content-Type':type});return res.end(content);
      }
      if (await supplierApi({ req, url, store, jsonBody, send, origin: expected.origin })) return;
      if(!path.startsWith('/api/')) fail(404,'NOT_FOUND','Not found.');
      const mutation=!['GET','HEAD','OPTIONS'].includes(method);
      // Runtime credentials are agent-scoped bearer credentials, never browser
      // sessions. Do not accept cookies as runtime authorization or enable CORS.
      if (path.startsWith('/api/runtime/') && store.runtimePrincipal) {
        if (req.headers.origin && req.headers.origin !== expected.origin) fail(403, 'ORIGIN_REQUIRED', 'Runtime origin is not permitted.');
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization || '');
        const principal = await store.runtimePrincipal(match?.[1], { kind: 'local-csv' });
        if (req.headers['x-relay-protocol'] !== '1') fail(400, 'PROTOCOL_REQUIRED', 'Use Relay runtime protocol version 1.');
        const key = req.headers['idempotency-key'];
        if (path === '/api/runtime/heartbeat' && method === 'POST') { exactKeys(await jsonBody(req), []); return send(200, await store.heartbeat(principal)); }
        if (path === '/api/runtime/qualifications' && method === 'GET') return send(200, { jobs: await store.qualificationJobs(principal) });
        const assessment = path.match(/^\/api\/runtime\/qualifications\/([0-9a-f-]{36})$/);
        if (assessment && method === 'POST') return send(200, await store.submitQualification(principal, assessment[1], await jsonBody(req), key));
        if (path === '/api/runtime/opportunities' && method === 'GET') return send(200, { tasks: await store.marketplace.opportunities(principal.actor) });
        if (path === '/api/runtime/assignments' && method === 'GET') return send(200, { assignments: await store.assignments(principal) });
        const runtimePath = path.match(/^\/api\/runtime\/tasks\/([0-9a-f-]{36})\/(offers|claim|progress|submit|fail)$/);
        if (runtimePath && method === 'POST') {
          const [, id, action] = runtimePath;
          const body = await jsonBody(req, action === 'submit' ? 23000000 : 32768);
          if (action === 'offers') {
            if (body.agentId !== principal.agentId) fail(403, 'FORBIDDEN', 'Credential cannot act for another agent.');
            return send(201, await store.marketplace.quote(principal.actor, id, body, key, principal));
          }
          return send(200, await store[action === 'fail' ? 'failExecution' : action](principal, id, body, key));
        }
        fail(404, 'NOT_FOUND', 'Runtime endpoint not found.');
      }
      if(mutation&&req.headers.origin!==expected.origin) fail(403,'ORIGIN_REQUIRED','This request must come from the Relay POC.');
      const raw=cookieToken(req,cookieName), ip=req.socket.remoteAddress||'unknown';
      if(method==='POST'&&(path==='/api/auth/register'||path==='/api/auth/login')) {
        const body=await jsonBody(req);
        const token=path.endsWith('register')?await store.register(body,ip,raw):await store.login(body,ip,raw);
        if(token&&typeof token==='object'&&token.verificationRequired)return send(200,token);
        res.setHeader('Set-Cookie',sessionCookie(token));
        const actor=await store.principal(token);
        return send(path.endsWith('register')?201:200,{user:actor.user,memberships:actor.memberships,csrf:actor.csrf});
      }
      if(managed&&method==='POST'&&['/api/auth/recover','/api/auth/resend'].includes(path))return send(200,await store.emailAction(path.endsWith('recover')?'recover':'resend',await jsonBody(req),ip));
      if(managed&&method==='POST'&&path==='/api/auth/verify'){
        const result=await store.verify(await jsonBody(req),ip,raw);
        res.setHeader('Set-Cookie',sessionCookie(result.raw));
        const actor=await store.principal(result.raw,{allowRecovery:true});
        return send(200,{user:actor.user,memberships:actor.memberships,csrf:actor.csrf,recoveryRequired:result.recoveryRequired});
      }
      const actor=await store.principal(raw,{allowRecovery:['/api/me','/api/auth/reset','/api/auth/logout'].includes(path)});
      if(method==='GET'&&path==='/api/me') return send(200,{user:actor.user,memberships:actor.memberships,csrf:actor.csrf,recoveryRequired:!!actor.recoveryRequired});
      if(mutation) store.csrf(actor,req.headers['x-csrf-token']);
      if(method==='POST'&&path==='/api/auth/logout') {
        await jsonBody(req);await store.logout(actor);res.setHeader('Set-Cookie',sessionCookie('',true));return send(200,{ok:true});
      }
      if(managed&&method==='POST'&&path==='/api/auth/reset'){
        const result=await store.reset(actor,await jsonBody(req));res.setHeader('Set-Cookie',sessionCookie('',true));return send(200,result);
      }
      if(method==='PATCH'&&path==='/api/me/workspace') {
        await store.workspace(actor,await jsonBody(req));return send(200,{ok:true});
      }
      if (store.features?.unifiedBackend) {
        const key = req.headers['idempotency-key'];
        if (path === '/api/notifications' && method === 'GET') return send(200, await store.notifications(actor));
        if (path === '/api/notifications/read' && method === 'POST') return send(200, await store.readNotifications(actor, await jsonBody(req)));

        const attioReceipts = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/delivery-destinations$/);
        if (attioReceipts && method === 'GET') return send(200, await store.attioDeliveries(actor, attioReceipts[1]));
        if (path === '/api/attio/status' && method === 'GET') return send(200, await store.attioStatus(actor, url.searchParams.get('tenantId')));
        const attioActions = { control: 'controlAttio', prepare: 'prepareAttio', send: 'sendAttio' };
        const attioRoute = path.match(/^\/api\/attio\/([a-z]+)$/);
        if (attioRoute && method === 'POST' && Object.hasOwn(attioActions, attioRoute[1])) return send(200, await store[attioActions[attioRoute[1]]](actor, await jsonBody(req)));
        if (path === '/api/drive/status'  && method === 'GET') return send(200, await store.driveStatus(actor, url.searchParams.get('tenantId')));
        const driveActions = {begin:'beginDrive',complete:'completeDrive',picker:'drivePicker',import:'importDriveFile',disconnect:'disconnectDrive'};
        const driveRoute = path.match(/^\/api\/drive\/([a-z]+)$/);
        if (driveRoute && method === 'POST' && Object.hasOwn(driveActions, driveRoute[1])) return send(200, await store[driveActions[driveRoute[1]]](actor, await jsonBody(req)));
        if (path === '/api/workspace-apps' && method === 'GET') return send(200, await store.workspaceApps(actor, url.searchParams.get('tenantId')));
        if (path === '/api/tool-sources' && method === 'POST') return send(200, await store.saveToolSource(actor, await jsonBody(req), key));
        const appDownload = path.match(/^\/api\/app-runs\/([^/]+)\/download$/);
        if (appDownload && method === 'GET') {
          const output = await store.downloadAppOutput(actor, decodeURIComponent(appDownload[1]));
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${output.filename}"`, 'Content-Length': output.bytes.length });
          return res.end(output.bytes);
        }
        const appRoute = path.match(/^\/api\/(workspace-apps|tool-grants|app-runs)\/([^/]+)$/);
        if (appRoute && method === 'POST') return send(200, await store[{ 'workspace-apps': 'controlApp', 'tool-grants': 'revokeToolGrant', 'app-runs': 'reviewAppRun' }[appRoute[1]]](actor, decodeURIComponent(appRoute[2]), await jsonBody(req), key));
        const appHostRoute = path.match(/^\/api\/workspace-apps\/([^/]+)\/host$/);
        if (appHostRoute && method === 'POST') return send(200, await store.controlAppHost(actor, decodeURIComponent(appHostRoute[1]), await jsonBody(req), key));
        const installRoute = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(install-app|tool-grant|context|permission-decline)$/);
        if (installRoute && method === 'POST') return send(200, await store[{'install-app':'installApp','tool-grant':'grantTaskTool','context':'attachTaskContext','permission-decline':'declineToolPermission'}[installRoute[2]]](actor, installRoute[1], await jsonBody(req), key));

        if (path === '/api/schedules/preview' && method === 'GET') {
          const { validateCalendar, nextOccurrence } = require('../../application/src/calendar.cjs');
          const calendar = validateCalendar({ cadence: url.searchParams.get('cadence'), time: url.searchParams.get('time'), timezone: url.searchParams.get('timezone'), day: Number(url.searchParams.get('day')) });
          const occurrences = [];
          let after = Date.now();
          for (let index = 0; index < 3; index++) {
            after = nextOccurrence(calendar, after);
            occurrences.push(after);
          }
          return send(200, { calendar, occurrences });
        }
        if (path === '/api/schedules' && method === 'GET') return send(200, await store.listSchedules(actor, url.searchParams.get('tenantId')));
        if (path === '/api/operations/backlog' && method === 'GET') return send(200, await store.operationsBacklog(actor));
        if (path === '/api/execution-queue' && method === 'GET') return send(200, await store.executionQueue(actor));
        const scheduleRoute = path.match(/^\/api\/schedules\/([0-9a-f-]{36})$/);
        if (scheduleRoute && method === 'POST') return send(200, await store.updateSchedule(actor, scheduleRoute[1], await jsonBody(req), key));
        const orchestrationRoute = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(orchestrate|handover|complete-plan|recover-plan)$/);
        if (orchestrationRoute && method === 'POST') {
          const [,id,action] = orchestrationRoute;
          const handlers = {'recover-plan':store.recoverOrchestration,orchestrate:store.createOrchestration,handover:store.approveHandover,'complete-plan':store.completeOrchestration};
          return send(200, await handlers[action](actor,id,await jsonBody(req),req.headers['idempotency-key']));
        }
        const recurringRoute = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(schedule|retry-execution)$/);
        if (recurringRoute && method === 'POST') return send(200, await store[recurringRoute[2] === 'schedule' ? 'createSchedule' : 'retryExecution'](actor, recurringRoute[1], await jsonBody(req), key));
        if (store.createTeam) {
          if (path === '/api/teams' && method === 'POST') return send(201, store.createTeam(actor, await jsonBody(req), key));
          if (path === '/api/teams/preview' && method === 'POST') return send(200, store.previewTeamInvite(actor, await jsonBody(req)));
          if (path === '/api/teams/accept' && method === 'POST') return send(200, await store.acceptTeamInvite(actor, await jsonBody(req)));
          const teamRoute = path.match(/^\/api\/teams\/([0-9a-f-]{36})(?:\/(invite|remove|role|history))?$/);
          if (teamRoute) {
            const [, id, action] = teamRoute;
            if (!action && method === 'GET') return send(200, store.team(actor, id));
            if (action === 'history' && method === 'GET') return send(200, store.teamHistory(actor, id, url.searchParams.get('before') || ''));
            if (action === 'role' && method === 'POST') return send(200, await store.changeTeamRole(actor, id, await jsonBody(req)));
            if (action === 'invite' && method === 'POST') return send(201, store.inviteTeamMember(actor, id, await jsonBody(req)));
            if (action === 'remove' && method === 'POST') return send(200, await store.removeTeamAccess(actor, id, await jsonBody(req)));
          }
        }
        const budgetRoute = path.match(/^\/api\/teams\/([0-9a-f-]{36})\/budget$/);
        if (budgetRoute && method === 'GET') return send(200, await store.companyBudget(actor, budgetRoute[1], url.searchParams.get('after') || ''));
        if (budgetRoute && method === 'POST') return send(200, await store.configureBudget(actor, budgetRoute[1], await jsonBody(req), key));
        const approvalRoute = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/approval(?:\/(decide))?$/);
        if (approvalRoute && method === 'POST') return send(200, await store[approvalRoute[2] ? 'decideApproval' : 'requestApproval'](actor, approvalRoute[1], await jsonBody(req), key));
        if (path === '/api/payments/recovery' && method === 'GET') return send(200, await store.paymentRecovery(actor, url.searchParams.get('after') || ''));
        if (path === '/api/payments/recovery/retry' && method === 'POST') { const body = await jsonBody(req); const { id, ...input } = body; return send(200, await store.retryPaymentRecovery(actor, id, input, key)); }
        if (path === '/api/payments/history' && method === 'GET') return send(200, await store.spendingHistory(actor, url.searchParams.get('tenantId'), {currency:url.searchParams.get('currency') || 'USD',from:url.searchParams.get('from') || '',to:url.searchParams.get('to') || '',snapshot:url.searchParams.get('snapshot') || '',page:url.searchParams.get('page') || 0}));
        if (path === '/api/payments/status' && method === 'GET') return send(200, await store.paymentStatus(actor));
        if (path === '/api/payments/operator' && method === 'POST') return send(200, await store.onboardOperator(actor, await jsonBody(req), key));
        if (path === '/api/payments/operator/refresh' && method === 'POST') { await jsonBody(req); return send(200, await store.refreshOperator(actor)); }
        const payment = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/payments(?:\/(fund|refund|transfer|payout|reconcile|checkout))?$/);
        if (payment) {
          const [, id, action] = payment;
          if (!action && method === 'GET') return send(200, { payment: await store.taskPayment(actor, id) });
          if (action === 'checkout' && method === 'POST') { await jsonBody(req); return send(200, await store.checkoutLink(actor, id)); }
          if (action === 'reconcile' && method === 'POST') { await jsonBody(req); return send(200, await store.reconcilePayment(actor, id)); }
          if (action && method === 'POST') return send(200, await store.sandboxPayment(actor, id, action, await jsonBody(req), key));
        }
        const assessment = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/qualifications$/);
        if (assessment && method === 'POST') return send(201, await store.startQualification(actor, assessment[1], await jsonBody(req), key));
        const scoping = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(assist|confirm-scope|cancel-reply)$/);
        if (scoping && method === 'POST') {
          const result = await store[scoping[2] === 'assist' ? 'assist' : scoping[2] === 'cancel-reply' ? 'cancelScoping' : 'confirmScope'](actor, scoping[1], await jsonBody(req), key);
          return send(scoping[2] === 'assist' ? 202 : 200, result);
        }
        const supplierCredential = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/supplier-credentials$/);
        if (supplierCredential && method === 'POST') {
          const result = await store.issueSupplierCredential(actor, supplierCredential[1], await jsonBody(req), key);
          if (result.token) runtimeManager?.stop(supplierCredential[1]);
          return send(200, result);
        }
        const cancelExecution = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/cancel-execution$/);
        if (cancelExecution && method === 'POST') return send(200, await store.cancelExecution(actor, cancelExecution[1], await jsonBody(req), key));
        const connection = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/(connect-local|disconnect)$/);
        if (connection && method === 'POST') {
          const [, id, action] = connection, body = await jsonBody(req);
          if (action === 'disconnect') {
            const result = await store.revokeCredential(actor, id, body, key);
            runtimeManager?.stop(id);
            return send(200, result);
          }
          if (!runtimeManager) fail(403, 'LOCAL_EXECUTION_DISABLED', 'Local runtime is unavailable.');
          runtimeManager.assertCapacity(id);
          const credential = await store.issueCredential(actor, id, body, key);
          if (credential.token) runtimeManager.start(id, credential.token);
          return send(200, { agentId: id, version: credential.version, started: !!credential.token });
        }
        const input = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/input$/);
        if (input && method === 'POST') return send(200, await store.addInput(actor, input[1], await jsonBody(req, 400000), key));
        const execution = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(authorize-local|accept-delivery|request-revision)$/);
        if (execution && method === 'POST') {
          const [, id, action] = execution, body = await jsonBody(req);
          return send(200, action === 'authorize-local' ? await store.authorizeLocal(actor, id, body, key) : await store.reviewDelivery(actor, id, action, body, key));
        }
        const scan = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/submissions\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})\/scan$/);
        if (scan && method === 'POST') return send(200, await store.scanFile(actor, scan[1], scan[2], scan[3], await jsonBody(req), key));
        const preview = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/submissions\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})\/preview$/);
        if (preview && method === 'GET') return send(200, await store.previewFile(actor, preview[1], preview[2], preview[3]));
        const file = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/submissions\/([0-9a-f-]{36})\/files\/([0-9a-f-]{36})$/);
        if (file && method === 'GET') {
          const result = await store.download(actor, file[1], file[2], file[3]);
          res.writeHead(200, { 'Content-Type': result.mime, 'Content-Disposition': `attachment; filename="${result.filename}"`, 'Content-Length': result.bytes.length });
          return res.end(result.bytes);
        }
      }
      // The managed adapter is deliberately unchanged by this local-only slice.
      if(store.marketplace){
        const market=store.marketplace,key=req.headers['idempotency-key'];
        if(path==='/api/agents'&&method==='GET')return send(200,{agents:await market.agents(actor)});
        if(path==='/api/agent-market'&&method==='GET')return send(200,await market.discover(actor,{savedOnly:url.searchParams.has('saved') ? ({true:true,false:false}[url.searchParams.get('saved')] ?? null) : false,q:url.searchParams.get('q')||'',category:url.searchParams.get('category')||'All agents',type:url.searchParams.get('type')||'All types',after:url.searchParams.get('after')||'',limit:Number(url.searchParams.get('limit')||25)}));
        const savedAgentPath = path.match(/^\/api\/agent-market\/([0-9a-f-]{36})\/saved$/);
        if (savedAgentPath && method === 'PATCH') return send(200, await market.saveAgent(actor, savedAgentPath[1], await jsonBody(req), key));
        const listingPath=path.match(/^\/api\/agent-market\/([0-9a-f-]{36})$/);
        if(listingPath&&method==='GET')return send(200,{agent:await market.listing(actor,listingPath[1])});
        const acquisitionPath = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/acquisition$/);
        if (acquisitionPath && method === 'GET') return send(200, await market.acquisition(actor, acquisitionPath[1]));
        const portfolioAdd = path.match(/^\/api\/agents\/([0-9a-f-]{36})\/portfolio$/);
        if (portfolioAdd && method === 'POST') return send(201, await market.addPortfolio(actor, portfolioAdd[1], await jsonBody(req), key));
        const portfolioDecision = path.match(/^\/api\/portfolio\/([0-9a-f-]{36})$/);
        if (portfolioDecision && method === 'PATCH') return send(200, await market.decidePortfolio(actor, portfolioDecision[1], await jsonBody(req), key));
        const listingUpdate=path.match(/^\/api\/agents\/([0-9a-f-]{36})\/listing$/);
        if(listingUpdate&&method==='PATCH')return send(200,await market.updateListing(actor,listingUpdate[1],await jsonBody(req),key));
        if(path==='/api/agents'&&method==='POST')return send(201,await market.addAgent(actor,await jsonBody(req),key));
        if(path==='/api/opportunities'&&method==='GET')return send(200,{tasks:await market.opportunities(actor)});
        if(path==='/api/quotes'&&method==='GET')return send(200,{offers:await market.quotes(actor)});
        if(path==='/api/work'&&method==='GET')return send(200,{tasks:await market.work(actor)});
        const agentPath=path.match(/^\/api\/agents\/([0-9a-f-]{36})$/);
        if(agentPath&&method==='PATCH')return send(200,await market.configure(actor,agentPath[1],await jsonBody(req),key));
        const offerPath=path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(offers|accept|select)$/);
        if(offerPath){const [,id,action]=offerPath;
          if(action==='offers'&&method==='GET')return send(200,{offers:await market.offers(actor,id)});
          if(action==='offers'&&method==='POST')return send(201,await market.quote(actor,id,await jsonBody(req),key));
          if(['select','accept'].includes(action)&&method==='POST')return send(200,await market.accept(actor,id,await jsonBody(req),key));
        }
      }
      if(method==='GET'&&path==='/api/tasks') return send(200,{tasks:await store.list(actor,url.searchParams.get('tenantId'))});
      if(method==='POST'&&path==='/api/tasks') return send(201,await store.createTask(actor,await jsonBody(req),req.headers['idempotency-key']));
      const changePath = path.match(/^\/api\/tasks\/([0-9a-f-]{36})\/(supplier-message|change-proposals|review-change)$/);
      if(changePath && method==='POST' && store.proposeChange) {
        const methodName = {'supplier-message':'supplierMessage','change-proposals':'proposeChange','review-change':'reviewChange'}[changePath[2]];
        return send(200,await store[methodName](actor,changePath[1],await jsonBody(req),req.headers['idempotency-key']));
      }
      const match=path.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(post|cancel|messages|scope))?$/);
      if(match) {
        const [,id,action]=match;
        if(method==='GET'&&!action) return send(200,await store.detail(actor,id));
        if((method==='PATCH'&&!action)||(method==='POST'&&action)) return send(200,await store.mutateTask(actor,id,action||'edit',await jsonBody(req),req.headers['idempotency-key']));
      }
      fail(404,'NOT_FOUND','Endpoint not found.');
    } catch(error) {
      if(res.headersSent) return res.destroy();
      if(error instanceof HttpError) return send(error.status,{error:{code:error.code,message:error.message,requestId}});
      if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03', '53300', '55P03', '57014', '40P01', '40001'].includes(error.code)) {
        logger.error(JSON.stringify({event:'database.unavailable',requestId,code:error.code}));
        return send(503,{error:{code:'DATABASE_UNAVAILABLE',message:'Storage is temporarily unavailable. Your saved work is unchanged. Retry the same request shortly.',requestId}});
      }
      // No bodies, passwords, cookies, database details or email addresses in logs.
      logger.error(JSON.stringify({event:'request.failed',requestId,code:'INTERNAL_ERROR'}));
      return send(500,{error:{code:'INTERNAL_ERROR',message:'Something went wrong. Please try again.',requestId}});
    }
  });
  server.requestTimeout=10000;
  server.headersTimeout=10000;
  server.keepAliveTimeout=5000;
  return server;
}
module.exports={createApp};
