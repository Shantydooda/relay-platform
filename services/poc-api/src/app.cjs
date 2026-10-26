'use strict';
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const { HttpError, fail } = require('./security.cjs');
const PUBLIC = resolve(__dirname,'../../../apps/poc-web/public');
const TOKENS = resolve(__dirname,'../../../packages/ui/src/tokens.css');
const UI = resolve(__dirname,'../../../packages/ui/src');
const assets = {
  '/':['index.html','text/html; charset=utf-8'],
  '/app.js':['app.js','text/javascript; charset=utf-8'],
  '/managed-auth.js':['managed-auth.js','text/javascript; charset=utf-8'],
  '/styles.css':['styles.css','text/css; charset=utf-8'],
  '/tokens.css':[TOKENS,'text/css; charset=utf-8'],
  '/ui.js':[resolve(UI,'components.cjs'),'text/javascript; charset=utf-8'],
  '/landing.js':[resolve(UI,'public-landing.cjs'),'text/javascript; charset=utf-8'],
  '/landing.css':[resolve(UI,'public-landing.css'),'text/css; charset=utf-8'],
  '/assets/relay-assistants.png':['assets/relay-assistants.png','image/png'],
  '/assets/relay-assistants-wave.png':['assets/relay-assistants-wave.png','image/png']
};

async function jsonBody(req) {
  if ((req.headers['content-type']||'').split(';')[0].trim()!=='application/json') fail(415,'JSON_REQUIRED','Send application/json.');
  if(Number(req.headers['content-length'])>32768) fail(413,'BODY_TOO_LARGE','The request is too large.');
  // Consume excess chunks rather than destroying the socket before the 413 can
  // be sent. Keep at most 32 KiB in memory, including chunked requests.
  const bytes=await new Promise((resolve,reject)=>{
    let size=0,exceeded=false;const chunks=[];
    req.on('data',chunk=>{
      if(exceeded)return;
      size+=chunk.length;
      if(size>32768){exceeded=true;reject(new HttpError(413,'BODY_TOO_LARGE','The request is too large.'));}
      else chunks.push(chunk);
    });
    req.on('end',()=>{if(!exceeded)resolve(Buffer.concat(chunks));});
    req.on('aborted',()=>reject(new HttpError(400,'REQUEST_ABORTED','The request was interrupted.')));
    req.on('error',reject);
  });
  try { return JSON.parse(bytes.toString('utf8')); }
  catch { fail(400,'INVALID_JSON','The request must contain valid JSON.'); }
}
function cookieToken(req,name) {
  return (req.headers.cookie||'').split(';').map(p=>p.trim()).find(p=>p.startsWith(`${name}=`))?.slice(name.length+1);
}
function createApp({db,origin,store:providedStore,mode='local-only',now=Date.now,logger=console}) {
  const expected = new URL(origin);
  if (!['http:','https:'].includes(expected.protocol)||expected.pathname!=='/'||expected.search||expected.hash||expected.username||expected.password) throw new Error('Invalid application origin');
  const managed=mode==='managed-staging';
  if(!['local-only','managed-staging'].includes(mode))throw new Error('Unknown server mode');
  if(managed&&(!providedStore||expected.protocol!=='https:'))throw new Error('Managed staging requires HTTPS and an explicit managed store');
  const store=providedStore||require('./store.cjs').createStore(db,now),secure=expected.protocol==='https:';
  const cookieName=secure?'__Host-relay_poc_session':'relay_poc_session';
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
      if(req.headers['sec-fetch-site']==='cross-site') fail(403,'CROSS_SITE','Cross-site requests are not permitted.');
      const url=new URL(req.url,origin),path=url.pathname,method=req.method;
      if(method==='GET'&&path==='/health') return send(200,{status:'ok',service:'relay-account-task-poc',storage:managed?'postgres':'sqlite',mode});
      if(method==='GET'&&path==='/api/config')return send(200,{authMode:managed?'managed':'local',inviteOnly:managed});
      if(method==='GET'&&(Object.hasOwn(assets,path)||(managed&&path==='/auth/confirm'))) {
        const [file,type]=assets[path==='/auth/confirm'?'/':path];
        const content=await readFile(resolve(PUBLIC,file));
        res.writeHead(200,{'Content-Type':type});return res.end(content);
      }
      if(!path.startsWith('/api/')) fail(404,'NOT_FOUND','Not found.');
      const mutation=!['GET','HEAD','OPTIONS'].includes(method);
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
      if(method==='GET'&&path==='/api/tasks') return send(200,{tasks:await store.list(actor,url.searchParams.get('tenantId'))});
      if(method==='POST'&&path==='/api/tasks') return send(201,await store.createTask(actor,await jsonBody(req),req.headers['idempotency-key']));
      const match=path.match(/^\/api\/tasks\/([0-9a-f-]{36})(?:\/(post|cancel|messages))?$/);
      if(match) {
        const [,id,action]=match;
        if(method==='GET'&&!action) return send(200,await store.detail(actor,id));
        if((method==='PATCH'&&!action)||(method==='POST'&&action)) return send(200,await store.mutateTask(actor,id,action||'edit',await jsonBody(req),req.headers['idempotency-key']));
      }
      fail(404,'NOT_FOUND','Endpoint not found.');
    } catch(error) {
      if(res.headersSent) return res.destroy();
      if(error instanceof HttpError) return send(error.status,{error:{code:error.code,message:error.message,requestId}});
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
