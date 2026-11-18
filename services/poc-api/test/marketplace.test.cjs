'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {openDatabase}=require('../src/database.cjs');
const {createStore}=require('../src/store.cjs');
const {createApp}=require('../src/app.cjs');
const password='local automated fixture password';
async function fixture(t,file=':memory:'){
 let time=Date.now();const db=openDatabase(file),store=createStore(db,()=>time),m=store.marketplace;
 t.after(()=>{if(db.isOpen)db.close();});
 async function user(name){const raw=await store.register({name,email:`${name}@example.test`,password,workspace:'buyer'},name);return {actor:store.principal(raw),raw};}
 const buyer=await user('buyer'),builder=await user('builder'),other=await user('other');
 const task=store.createTask(buyer.actor,{tenantId:buyer.actor.memberships[0].id,title:'Find companies',brief:'Find 20 UK SaaS companies. CSV and sources.'},randomUUID());
 const post=()=>store.mutateTask(buyer.actor,task.taskId,'post',{expectedVersion:1},randomUUID());
 const agentBody={name:'Researcher',kind:'general',integration:'api',capabilities:[{category:'Research',task:'Find any companies with sources'},{category:'Operations',task:'Transform spreadsheets and reconcile records'}]};
 const {agentId}=m.addAgent(builder.actor,agentBody,randomUUID()),cap=m.agents(builder.actor)[0].capabilities[0];
 const quoteBody={agentId,capabilityId:cap.id,expectedVersion:2,amountMinor:7500,deliveryMinutes:45,proposal:'CSV with 20 companies and a source per row.'};
 return {db,store,m,buyer,builder,other,task,post,agentBody,agentId,cap,quoteBody,advance:ms=>time+=ms};
}
test('connected marketplace persists multiple capabilities, competing offers and one unfunded selection across restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'relay-market-')),file=join(dir,'local.sqlite');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const f=await fixture(t,file);const {m,store,buyer,builder,other,task,quoteBody}=f;
 assert.equal(m.opportunities(builder.actor).length,0);f.post();
 assert.equal(m.agents(builder.actor)[0].capabilities.length,2);assert.equal(m.agents(buyer.actor).length,0);
 assert.equal(m.opportunities(builder.actor)[0].id,task.taskId);
 const first=m.quote(builder.actor,task.taskId,quoteBody,randomUUID());
 const secondAgent=m.addAgent(other.actor,{...f.agentBody,kind:'specialist',name:'Specialist'},randomUUID());
 const secondCap=m.agents(other.actor)[0].capabilities[0];
 const second=m.quote(other.actor,task.taskId,{...quoteBody,agentId:secondAgent.agentId,capabilityId:secondCap.id,amountMinor:9000,deliveryMinutes:30},randomUUID());
 assert.equal(m.offers(buyer.actor,task.taskId).length,2);
 const key=randomUUID(),body={offerId:first.offerId,expectedVersion:2};
 const accepted=m.accept(buyer.actor,task.taskId,body,key);assert.deepEqual(m.accept(buyer.actor,task.taskId,body,key),accepted);
 assert.equal(store.detail(buyer.actor,task.taskId).task.status,'selected');
 assert.equal(accepted.executionAuthorized,false);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n,0);
 assert.equal(m.work(builder.actor)[0].id,task.taskId);assert.equal(m.work(other.actor).length,0);
 assert.equal(m.quotes(other.actor)[0].status,'pending');assert.equal(m.quotes(builder.actor)[0].status,'selected');
 assert.equal(m.opportunities(other.actor).length,0);
 assert.throws(()=>m.quote(other.actor,task.taskId,{...quoteBody,agentId:secondAgent.agentId,capabilityId:secondCap.id,expectedVersion:3},randomUUID()),{code:'TASK_SELECTED'});
 assert.throws(()=>m.accept(buyer.actor,task.taskId,{offerId:second.offerId,expectedVersion:2},randomUUID()),{code:'VERSION_CONFLICT'});
 const before=store.detail(buyer.actor,task.taskId);f.db.close();const restoredDb=openDatabase(file);t.after(()=>restoredDb.close());
 const restored=createStore(restoredDb);assert.deepEqual(restored.detail(restored.principal(buyer.raw),task.taskId),before);
 assert.equal(restored.marketplace.work(restored.principal(builder.raw))[0].offerId,first.offerId);
});
test('ownership, privacy and capabilities are server-owned; workspace switching grants no marketplace privileges',async t=>{
 const f=await fixture(t);const {m,store,buyer,builder,other,task,quoteBody}=f;
 assert.throws(()=>m.quote(builder.actor,task.taskId,quoteBody,randomUUID()),{code:'NOT_FOUND'});f.post();
 assert.equal(m.opportunities(buyer.actor).length,0);
 assert.throws(()=>m.quote(other.actor,task.taskId,quoteBody,randomUUID()),{code:'NOT_FOUND'});
 const own=m.addAgent(buyer.actor,f.agentBody,randomUUID()),ownCap=m.agents(buyer.actor)[0].capabilities[0];
 assert.throws(()=>m.quote(buyer.actor,task.taskId,{...quoteBody,agentId:own.agentId,capabilityId:ownCap.id},randomUUID()),{code:'NOT_FOUND'});
 const o=m.quote(builder.actor,task.taskId,quoteBody,randomUUID());
 assert.throws(()=>m.offers(builder.actor,task.taskId),{code:'NOT_FOUND'});
 assert.throws(()=>store.detail(builder.actor,task.taskId),{code:'NOT_FOUND'});
 store.workspace(builder.actor,{workspace:'buyer'});
 assert.throws(()=>m.accept(builder.actor,task.taskId,{offerId:o.offerId,expectedVersion:2},randomUUID()),{code:'NOT_FOUND'});
 assert.throws(()=>m.addAgent(builder.actor,{...f.agentBody,ownerId:buyer.actor.user.id},randomUUID()),{code:'INVALID_FIELDS'});
 assert.throws(()=>m.addAgent(builder.actor,{...f.agentBody,capabilities:[{category:'Anything',task:'Anything',qualification:'qualified'}]},randomUUID()),{code:'INVALID_FIELDS'});
 assert.equal(m.agents(builder.actor)[0].capabilities[0].qualification,'unverified');
 const publicData=JSON.stringify(m.opportunities(other.actor));assert.ok(!publicData.includes(buyer.actor.user.email));assert.ok(!publicData.includes('tenantId'));
});
test('only confirmed scope changes invalidate offers; conversation questions preserve scope and terms',async t=>{
 const f=await fixture(t);const {m,store,buyer,builder,task,quoteBody}=f;f.post();
 const old=m.quote(builder.actor,task.taskId,quoteBody,randomUUID());
 store.mutateTask(buyer.actor,task.taskId,'messages',{expectedVersion:2,body:'What if I needed 50 companies?'},randomUUID());
 assert.equal(store.detail(buyer.actor,task.taskId).task.scopeVersion,1);
 assert.equal(m.quotes(builder.actor)[0].status,'pending');
 m.accept(buyer.actor,task.taskId,{offerId:old.offerId,expectedVersion:3},randomUUID());
 assert.equal(m.work(builder.actor)[0].status,'selected');
 store.mutateTask(buyer.actor,task.taskId,'scope',{expectedVersion:4,title:'50 companies',brief:'Find 50 companies with sources.'},randomUUID());
 assert.equal(store.detail(buyer.actor,task.taskId).task.status,'posted');
 assert.equal(store.detail(buyer.actor,task.taskId).task.scopeVersion,2);
 assert.equal(m.work(builder.actor).length,0);
 assert.equal(m.quotes(builder.actor)[0].status,'needs_update');
 assert.throws(()=>m.accept(buyer.actor,task.taskId,{offerId:old.offerId,expectedVersion:5},randomUUID()),{code:'VERSION_CONFLICT'});
 assert.equal(m.opportunities(builder.actor)[0].context[0].body,'What if I needed 50 companies?');
 const updated=m.quote(builder.actor,task.taskId,{...quoteBody,expectedVersion:5},randomUUID());f.advance(86400001);
 assert.throws(()=>m.accept(buyer.actor,task.taskId,{offerId:updated.offerId,expectedVersion:5},randomUUID()),{code:'OFFER_EXPIRED'});
 const renewed=m.quote(builder.actor,task.taskId,{...quoteBody,expectedVersion:5},randomUUID());
 m.accept(buyer.actor,task.taskId,{offerId:renewed.offerId,expectedVersion:5},randomUUID());
 assert.equal(m.work(builder.actor)[0].messages.at(-1).body,'What if I needed 50 companies?');
});
test('retries do not duplicate agents or bids; invalid input rolls back without consuming keys',async t=>{
 const f=await fixture(t);const {m,builder,task,quoteBody}=f;f.post();
 const k=randomUUID();const a=m.addAgent(builder.actor,f.agentBody,k);assert.deepEqual(m.addAgent(builder.actor,f.agentBody,k),a);
 assert.equal(m.agents(builder.actor).length,2);
 assert.throws(()=>m.addAgent(builder.actor,{...f.agentBody,name:'Different'},k),{code:'IDEMPOTENCY_CONFLICT'});
 const key=randomUUID();assert.throws(()=>m.quote(builder.actor,task.taskId,{...quoteBody,amountMinor:1.5},key),{code:'INVALID_INPUT'});
 const q=m.quote(builder.actor,task.taskId,quoteBody,key);assert.deepEqual(m.quote(builder.actor,task.taskId,quoteBody,key),q);
 assert.equal(m.quotes(builder.actor).length,1);
 assert.throws(()=>m.quote(builder.actor,task.taskId,quoteBody,randomUUID()),{code:'OFFER_EXISTS'});
 assert.throws(()=>m.quote(builder.actor,task.taskId,{...quoteBody,capabilityId:null},randomUUID()),{code:'INVALID_INPUT'});
 assert.throws(()=>m.accept(f.buyer.actor,task.taskId,{expectedVersion:2},randomUUID()),{code:'INVALID_INPUT'});
});
test('marketplace HTTP routes require sessions, CSRF and correct ownership end to end',async t=>{
 const f=await fixture(t);f.post();const server=createApp({db:f.db,origin:'http://127.0.0.1:4199',logger:{error:()=>assert.fail('Internal failure')}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const http=require('node:http');
 async function request(path,actor,body,csrf=actor?.actor.csrf){return new Promise((resolve,reject)=>{const req=http.request(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{Host:'127.0.0.1:4199',Origin:'http://127.0.0.1:4199',...(actor?{Cookie:`relay_local_session_4199=${actor.raw}`}:{ } ),...(body?{'Content-Type':'application/json','X-CSRF-Token':csrf||'','Idempotency-Key':randomUUID()}:{})}},res=>{let data='';res.on('data',c=>data+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
 assert.equal((await request('/api/agents')).status,401);
 assert.equal((await request('/api/agents',f.builder,f.agentBody,'wrong')).status,403);
 const a=await request('/api/agents',f.builder,{...f.agentBody,name:'HTTP Agent'});assert.equal(a.status,201);
 const cap=(await request('/api/agents',f.builder)).body.agents.find(x=>x.id===a.body.agentId).capabilities[0];
 const q=await request(`/api/tasks/${f.task.taskId}/offers`,f.builder,{...f.quoteBody,agentId:a.body.agentId,capabilityId:cap.id});assert.equal(q.status,201);
 assert.equal((await request(`/api/tasks/${f.task.taskId}/offers`,f.other)).status,404);
 const offers=await request(`/api/tasks/${f.task.taskId}/offers`,f.buyer);assert.equal(offers.body.offers[0].agentName,'HTTP Agent');
 assert.equal((await request(`/api/tasks/${f.task.taskId}/select`,f.buyer,{offerId:q.body.offerId,expectedVersion:2})).status,200);
 assert.equal((await request('/api/work',f.builder)).body.tasks[0].id,f.task.taskId);
});

test('local session cookies are scoped by launcher port rather than shared across local workspaces',async t=>{
 const f=await fixture(t);const server=createApp({db:f.db,origin:'http://127.0.0.1:4199'});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const http=require('node:http');
 function me(cookie){return new Promise((resolve,reject)=>{const req=http.get(`http://127.0.0.1:${server.address().port}/api/me`,{headers:{Host:'127.0.0.1:4199',Cookie:cookie}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});}
 assert.equal(await me(`relay_local_session_4180=${f.buyer.raw}`),401);
 assert.equal(await me(`relay_poc_session=${f.buyer.raw}`),401);
 assert.equal(await me(`relay_local_session_4199=${f.buyer.raw}`),200);
});

test('changing selections before funding replaces only the pending choice; stale requests cannot award work',async t=>{
 const f=await fixture(t);const {m,buyer,builder,task,quoteBody}=f;f.post();
 const first=m.quote(builder.actor,task.taskId,quoteBody,randomUUID());
 const a=m.addAgent(builder.actor,{...f.agentBody,name:'Another agent'},randomUUID());const cap=m.agents(builder.actor).find(x=>x.id===a.agentId).capabilities[0];
 const second=m.quote(builder.actor,task.taskId,{...quoteBody,agentId:a.agentId,capabilityId:cap.id},randomUUID());
 m.accept(buyer.actor,task.taskId,{offerId:first.offerId,expectedVersion:2},randomUUID());
 m.accept(buyer.actor,task.taskId,{offerId:second.offerId,expectedVersion:3},randomUUID());
 assert.equal(m.work(builder.actor).length,1);assert.equal(m.work(builder.actor)[0].offerId,second.offerId);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM assignments').get().n,0);
 assert.equal(m.offers(buyer.actor,task.taskId).filter(o=>o.selected).length,1);
 f.advance(86400001);assert.equal(f.store.detail(buyer.actor,task.taskId).task.status,'posted');assert.equal(m.work(builder.actor).length,0);
});
test('readiness and automatic mode cannot be self-granted; preferences are owned, versioned and durable',async t=>{
 const f=await fixture(t);const {m,builder,other,agentId}=f;const agent=m.agents(builder.actor)[0];
 const body={integration:'mcp',automaticRequested:true,minimumPayout:5000,concurrency:2,expectedVersion:agent.rules.version,setupStage:3};const key=randomUUID();
 assert.throws(()=>m.configure(other.actor,agentId,body,key),{code:'NOT_FOUND'});
 assert.throws(()=>m.configure(builder.actor,agentId,{...body,connection:true},key),{code:'INVALID_FIELDS'});
 const result=m.configure(builder.actor,agentId,body,key);assert.deepEqual(m.configure(builder.actor,agentId,body,key),result);
 const updated=m.agents(builder.actor)[0];assert.equal(updated.integration,'mcp');assert.equal(updated.rules.automaticRequested,true);assert.equal(updated.rules.automaticEnabled,false);
 assert.equal(updated.readiness.canQuoteCommercially,false);assert.equal(updated.readiness.canReceivePaidWork,false);assert.equal(updated.readiness.capability,false);
 assert.throws(()=>m.configure(builder.actor,agentId,body,randomUUID()),{code:'VERSION_CONFLICT'});
});
test('legacy assignments remain blocked from scope rewriting or pre-award selection changes',async t=>{
 const f=await fixture(t);f.post();const o=f.m.quote(f.builder.actor,f.task.taskId,f.quoteBody,randomUUID());
 f.db.prepare('INSERT INTO assignments VALUES (?,?,?,?)').run(f.task.taskId,o.offerId,f.buyer.actor.user.id,Date.now());
 assert.equal(f.store.detail(f.buyer.actor,f.task.taskId).task.status,'assigned');
 assert.throws(()=>f.store.mutateTask(f.buyer.actor,f.task.taskId,'scope',{expectedVersion:2,title:'Changed',brief:'Changed'},randomUUID()),{code:'TASK_ASSIGNED'});
 assert.throws(()=>f.m.accept(f.buyer.actor,f.task.taskId,{expectedVersion:2,offerId:o.offerId},randomUUID()),{code:'TASK_ASSIGNED'});
});
