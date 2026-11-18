'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {PGlite}=require('@electric-sql/pglite');
const {createApplication}=require('../src/service.cjs');
const {createSqliteRepository,createPostgresRepository}=require('../src/repository.cjs');
const {normalizeCsv}=require('../../agent-runtime/src/csv.cjs');
function actor(name){return {user:{id:randomUUID(),name},memberships:[{id:randomUUID(),role:'owner'}]};}
async function fixture(t,postgres){
 const db=postgres?await PGlite.create():new DatabaseSync(':memory:');t.after(()=>db.close());
 const repository=postgres?await createPostgresRepository(db,{initialize:true}):createSqliteRepository(db);
 const buyer=actor('Buyer'),a=actor('Builder A'),b=actor('Builder B'),outsider=actor('Other');
 const users=[buyer,a,b,outsider];
 const app=createApplication({repository,localExecution:true,resolveOperator:async id=>users.find(u=>u.user.id===id),resolveActor:async id=>users.find(u=>u.user.id===id)});
 const agents=[];
 for(const operator of [a,b]){
  const {agentId}=await app.marketplace.addAgent(operator,{name:operator.user.name,purpose:'Normalize CSV',kind:'general',integration:'api',capabilities:[{category:'Data',task:'CSV cleanup'}]},randomUUID());
  await app.marketplace.configure(operator,agentId,{expectedVersion:1,integration:'api',setupStage:3,automaticRequested:true,minimumPayout:100,concurrency:2},randomUUID());
  const token=await app.issueCredential(operator,agentId,{expectedVersion:2},randomUUID());
  const principal=await app.runtimePrincipal(token.token);await app.heartbeat(principal);
  agents.push({operator,agentId,principal,capabilityId:(await app.marketplace.agents(operator))[0].capabilities[0].id});
 }
 const parent=await app.createTask(buyer,{tenantId:buyer.memberships[0].id,title:'Parent PRIVATE',brief:'PRIVATE parent context'},randomUUID());
 const step=(title,dependencies)=>({title,brief:'Normalize approved CSV',criteria:'Deduplicate and sort rows',budgetMinor:100,dependencies});
 const body={expectedVersion:1,budgetMinor:300,steps:[step('Parallel A',[]),step('Parallel B',[]),step('Combine',[0,1])]};
 return {app,repository,buyer,outsider,parentId:parent.taskId,body,agents};
}
async function detail(f,id){return f.app.detail(f.buyer,id);}
async function post(f,id){await f.app.mutateTask(f.buyer,id,'post',{expectedVersion:(await detail(f,id)).task.version},randomUUID());}
async function input(f,id){await f.app.addInput(f.buyer,id,{expectedVersion:1,filename:'source.csv',notes:'Clean supplied rows',base64:Buffer.from('name\nB\nA\nA\n').toString('base64')},randomUUID());}
async function start(f,id,agent){
 const offer=await f.app.marketplace.quote(agent.operator,id,{agentId:agent.agentId,capabilityId:agent.capabilityId,expectedVersion:(await detail(f,id)).task.version,amountMinor:100,deliveryMinutes:1,proposal:'Normalize supplied rows'},randomUUID(),agent.principal);
 await f.app.marketplace.accept(f.buyer,id,{expectedVersion:(await detail(f,id)).task.version,offerId:offer.offerId},randomUUID());
 const beforeStart=await f.app.marketplace.work(agent.operator);
 assert.doesNotMatch(JSON.stringify(beforeStart),/PRIVATE_HANDOVER|PRIVATE parent/);
 return f.app.authorizeLocal(f.buyer,id,{expectedVersion:(await detail(f,id)).task.version,mode:'local-unpaid'},randomUUID());
}
async function finish(f,id,agent,assignment){
 const claim=await f.app.claim(agent.principal,id,{assignmentId:assignment.assignmentId},randomUUID());
 const result=normalizeCsv(Buffer.from(claim.input.base64,'base64'));
 const submission=await f.app.submit(agent.principal,id,{leaseToken:claim.leaseToken,evidence:'Rows validated',files:[{filename:'normalized.csv',mime:'text/csv',base64:result.csv.toString('base64')}]},randomUUID());
 await f.app.reviewDelivery(f.buyer,id,'accept-delivery',{expectedVersion:(await detail(f,id)).task.version,submissionId:submission.submissionId},randomUUID());
 return {claim,submission:(await detail(f,id)).submissions.at(-1)};
}
for(const postgres of [false,true])test(`${postgres?'postgres':'sqlite'} parallel builders hand over accepted versioned outputs into one dependent step`,async t=>{
 const f=await fixture(t,postgres),key=randomUUID();
 const plan=await f.app.createOrchestration(f.buyer,f.parentId,f.body,key);
 assert.deepEqual(await f.app.createOrchestration(f.buyer,f.parentId,f.body,key),plan);
 const [a,b,c]=plan.stepIds;
 await assert.rejects(post(f,c),{code:'HANDOVER_REQUIRED'});
 await assert.rejects(post(f,f.parentId),{code:'PLAN_SCOPE_FIXED'});
 await assert.rejects(f.app.completeOrchestration(f.buyer,f.parentId,{expectedVersion:2},randomUUID()),{code:'PLAN_INCOMPLETE'});
 await input(f,a);await input(f,b);await post(f,a);await post(f,b);
 const aa=await start(f,a,f.agents[0]),bb=await start(f,b,f.agents[1]);
 assert.equal((await detail(f,a)).task.status,'queued');assert.equal((await detail(f,b)).task.status,'queued');
 const ar=await finish(f,a,f.agents[0],aa),br=await finish(f,b,f.agents[1],bb);
 const handover=(source,result,fileId)=>({expectedVersion:1,sourceTaskId:source,submissionId:result.submission.id,fileId,notes:'PRIVATE_HANDOVER approved excerpt',consent:'share-with-step-supplier'});
 await assert.rejects(f.app.approveHandover(f.outsider,c,handover(a,ar,null),randomUUID()),{code:'NOT_FOUND'});
 const hand=handover(a,ar,ar.submission.files[0].id),handoverKey=randomUUID();
 await f.app.approveHandover(f.buyer,c,hand,handoverKey);
 await f.app.approveHandover(f.buyer,c,hand,handoverKey);
 await assert.rejects(post(f,c),{code:'HANDOVER_REQUIRED'});
 await f.app.approveHandover(f.buyer,c,{...handover(b,br,null),expectedVersion:2},randomUUID());
 await post(f,c);
 assert.doesNotMatch(JSON.stringify(await f.app.marketplace.opportunities(f.agents[0].operator)),/PRIVATE_HANDOVER|PRIVATE parent/);
 const assignment=await start(f,c,f.agents[0]);
 const result=await finish(f,c,f.agents[0],assignment);
 assert.equal(result.claim.handoffs.length,2);assert.equal(result.claim.handoffs[0].submissionVersion,1);
 assert.equal(result.claim.handoffs[0].notes,'PRIVATE_HANDOVER approved excerpt');
 assert.equal(Buffer.from(result.claim.input.base64,'base64').toString(),'name\r\nA\r\nB\r\n');
 await f.app.completeOrchestration(f.buyer,f.parentId,{expectedVersion:2},randomUUID());
 assert.equal((await detail(f,f.parentId)).orchestration.status,'accepted');
});
test('graph validation, caps, scope locks, and sandbox execution fail closed',async t=>{
 const f=await fixture(t,false);
 await assert.rejects(f.app.createOrchestration(f.buyer,f.parentId,{...f.body,budgetMinor:200},randomUUID()),{code:'PLAN_BUDGET'});
 await assert.rejects(f.app.createOrchestration(f.buyer,f.parentId,{...f.body,steps:[{...f.body.steps[0],dependencies:[1]},...f.body.steps.slice(1)]},randomUUID()),{code:'INVALID_INPUT'});
 const plan=await f.app.createOrchestration(f.buyer,f.parentId,f.body,randomUUID()),id=plan.stepIds[0];
 await assert.rejects(f.app.mutateTask(f.buyer,id,'edit',{expectedVersion:1,title:'Changed',brief:'Bypass'},randomUUID()),{code:'PLAN_SCOPE_FIXED'});
 await post(f,id);
 const a=f.agents[0];
 await assert.rejects(f.app.marketplace.quote(a.operator,id,{agentId:a.agentId,capabilityId:a.capabilityId,expectedVersion:2,amountMinor:101,deliveryMinutes:1,proposal:'Over cap'},randomUUID(),a.principal),{code:'STEP_BUDGET'});
 await assert.rejects(f.app.authorizeLocal(f.buyer,id,{expectedVersion:2,mode:'stripe-sandbox'},randomUUID()),{code:'PLAN_LOCAL_ONLY'});
});

test('unaccepted handovers and stale concurrent approvals cannot unlock a dependent step', async t => {
 const f = await fixture(t, false);
 const { stepIds: [a, , c] } = await f.app.createOrchestration(f.buyer, f.parentId, f.body, randomUUID());
 const body = { expectedVersion: 1, sourceTaskId: a, submissionId: randomUUID(), notes: 'Approved output', consent: 'share-with-step-supplier' };
 await assert.rejects(f.app.approveHandover(f.buyer, c, body, randomUUID()), { code: 'DELIVERY_NOT_ACCEPTED' });
 await input(f, a); await post(f, a);
 const assignment = await start(f, a, f.agents[0]);
 const result = await finish(f, a, f.agents[0], assignment);
 body.submissionId = result.submission.id;
 const results = await Promise.allSettled([1, 2].map(() => f.app.approveHandover(f.buyer, c, body, randomUUID())));
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
 assert.equal(results.find(r => r.status === 'rejected').reason.code, 'VERSION_CONFLICT');
 assert.equal((await detail(f, f.parentId)).orchestration.steps[2].handoffs.length, 1);
 await assert.rejects(post(f, c), { code: 'HANDOVER_REQUIRED' });
});

for (const postgres of [false, true]) test(`${postgres ? 'postgres' : 'sqlite'} failed step replacement preserves history and accepts a different builder`, async t => {
  const f = await fixture(t, postgres);
  const plan = await f.app.createOrchestration(f.buyer, f.parentId, f.body, randomUUID());
  const [a, b, c] = plan.stepIds;
  await input(f, a); await post(f, a);
  const assignment = await start(f, a, f.agents[0]);
  const claim = await f.app.claim(f.agents[0].principal, a, { assignmentId: assignment.assignmentId }, randomUUID());
  const recoverBody = async () => ({ expectedVersion: 2, stepId: a, expectedStepVersion: (await detail(f, a)).task.version, reason: 'Replace the unavailable supplier', confirm: 'reset-affected-steps' });
  await assert.rejects(f.app.recoverOrchestration(f.buyer, f.parentId, await recoverBody(), randomUUID()), { code: 'BRANCH_ACTIVE' });
  await f.app.failExecution(f.agents[0].principal, a, { leaseToken: claim.leaseToken, code: 'AGENT_ERROR' }, randomUUID());
  const body = await recoverBody(), key = randomUUID();
  await assert.rejects(f.app.recoverOrchestration(f.outsider, f.parentId, body, randomUUID()), { code: 'NOT_FOUND' });
  const result = await f.app.recoverOrchestration(f.buyer, f.parentId, body, key);
  assert.deepEqual(await f.app.recoverOrchestration(f.buyer, f.parentId, body, key), result);
  const next = result.replacements[a], downstream = result.replacements[c];
  assert.equal(result.replacements[b], undefined);
  assert.deepEqual((await detail(f, f.parentId)).orchestration.steps.map(s => s.id), [next, b, downstream]);
  assert.equal((await detail(f, a)).task.orchestrationStep.supersededBy, next);
  await assert.rejects(f.app.retryExecution(f.buyer, a, { expectedVersion: (await detail(f, a)).task.version, reason: 'Retry obsolete assignment' }, randomUUID()), { code: 'STEP_SUPERSEDED' });
  await assert.rejects(f.app.submit(f.agents[0].principal, a, { leaseToken: claim.leaseToken, evidence: 'Late delivery', files: [] }, randomUUID()));
  await input(f, next); await post(f, next);
  await finish(f, next, f.agents[1], await start(f, next, f.agents[1]));
  assert.equal((await detail(f, next)).task.status, 'accepted');
  await assert.rejects(post(f, downstream), { code: 'HANDOVER_REQUIRED' });
});

test('changed handovers clear selected offers and company reservations and require new approvals', async t => {
  const f = await fixture(t, false);
  const {stepIds:[a,b,c]} = await f.app.createOrchestration(f.buyer, f.parentId, f.body, randomUUID());
  for (const id of [a,b]) {
    await input(f,id); await post(f,id);
    const {submission} = await finish(f,id,f.agents[0],await start(f,id,f.agents[0]));
    await f.app.approveHandover(f.buyer,c,{expectedVersion:(await detail(f,c)).task.version,sourceTaskId:id,submissionId:submission.id,notes:'Original instructions',consent:'share-with-step-supplier'},randomUUID());
  }
  await post(f,c);
  const agent=f.agents[0];
  const offer=await f.app.marketplace.quote(agent.operator,c,{agentId:agent.agentId,capabilityId:agent.capabilityId,expectedVersion:(await detail(f,c)).task.version,amountMinor:100,deliveryMinutes:1,proposal:'Work from approved handovers'},randomUUID(),agent.principal);
  await f.app.marketplace.accept(f.buyer,c,{expectedVersion:(await detail(f,c)).task.version,offerId:offer.offerId},randomUUID());
  f.buyer.memberships[0].company = true;
  await f.app.configureBudget(f.buyer,f.buyer.memberships[0].id,{limitMinor:500,expectedVersion:0},randomUUID());
  await f.app.requestApproval(f.buyer,c,{expectedVersion:(await detail(f,c)).task.version,note:'Please approve'},randomUUID());
  const approval=(await detail(f,c)).approval;
  await f.app.decideApproval(f.buyer,c,{approvalId:approval.id,expectedVersion:approval.version,decision:'approved',note:'Within budget'},randomUUID());
  const result=await f.app.recoverOrchestration(f.buyer,f.parentId,{expectedVersion:2,stepId:c,expectedStepVersion:(await detail(f,c)).task.version,reason:'Revise the downstream handover instructions',confirm:'reset-affected-steps'},randomUUID());
  const fresh=result.replacements[c], old=(await detail(f,c));
  assert.equal(old.approval.status,'stale');
  const budget=await f.app.companyBudget(f.buyer,f.buyer.memberships[0].id);
  assert.equal(budget.budget.reservedMinor,0);
  assert.equal((await f.repository.read(repo => repo.get('task', fresh))).offers.length,0);
  assert.equal((await detail(f,fresh)).task.orchestrationStep.handoffs.length,0);
  await assert.rejects(post(f,fresh),{code:'HANDOVER_REQUIRED'});
  for(const id of [a,b]) {
    const submission=(await detail(f,id)).submissions.at(-1);
    await f.app.approveHandover(f.buyer,fresh,{expectedVersion:(await detail(f,fresh)).task.version,sourceTaskId:id,submissionId:submission.id,fileId: id === a ? submission.files[0].id : null,notes:'Revised instructions explicitly approved',consent:'share-with-step-supplier'},randomUUID());
  }
  await post(f,fresh);
  await assert.rejects(start(f,fresh,agent),{code:'APPROVAL_REQUIRED'});
});
