'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const {DatabaseSync} = require('node:sqlite');
const {PGlite} = require('@electric-sql/pglite');
const {createSqliteRepository,createPostgresRepository} = require('../src/repository.cjs');
const {fixture} = require('./helpers/supplier-workflow.cjs');

for (const adapter of ['sqlite','postgres']) test(`${adapter}: fair exposure is stable, qualified, operator-balanced and observable without awarding work`, async t => {
 const db = adapter==='sqlite' ? new DatabaseSync(':memory:') : await PGlite.create();
 t.after(()=>db.close());
 const repo = adapter==='sqlite' ? createSqliteRepository(db) : await createPostgresRepository(db,{initialize:true});
 const f = await fixture(repo), now=Date.now();
 const {taskId} = await f.app.createTask(f.buyer,{tenantId:f.buyer.memberships[0].id,title:'Release notes',brief:'Write release notes from my source brief.'},randomUUID());
 await f.app.mutateTask(f.buyer,taskId,'post',{expectedVersion:1},randomUUID());
 const ids=[];
 await repo.transaction('seed-qualified-offers', async r => {
  const template = await r.get('agent',f.agentId), task=await r.get('task',taskId);
  for(let i=0;i<8;i++) {
   const agentId=i===0?f.agentId:randomUUID(), ownerId=i===0?f.builder.user.id:randomUUID(), capId=randomUUID(), assessmentId=randomUUID();
   const agent={...structuredClone(template),id:agentId,ownerId,name:`Research ${i}`,listingStatus:i===6?'paused':'published',createdAt:now+i,
    capabilities:[{id:capId,category:'Writing',task:'Release notes',assessmentId}],
    assessments:[{id:assessmentId,capabilityId:capId,status:i===7?'failed':'passed',expiresAt:now+3600000,credentialHash:template.credentialHash,runtimeName:template.runtimeName,runtimeVersion:template.runtimeVersion}]};
   await r.save('agent',agent);
   const offer={id:randomUUID(),agentId,operatorId:ownerId,agentName:agent.name,capabilityId:capId,scopeVersion:task.scopeVersion,expiresAt:now+300000,amountMinor:100,deliveryMinutes:2,currency:'USD',runtimeBid:true,qualification:'qualified',qualificationEvidence:{id:assessmentId}};
   task.offers.push(offer);ids.push({agentId,ownerId,offerId:offer.id});
   await r.save('offer-index',{id:offer.id,ownerId,taskId,offerId:offer.id});
  }
  await r.save('task',task);
 });
 // A builder cannot regain newcomer eligibility through a fresh listing.
 await repo.transaction('established-history',async r=>{
  for(let n=0;n<3;n++) {
   const id=randomUUID(), offerId=randomUUID();
   await r.save('task',{id,ownerId:f.buyer.user.id,tenantId:f.buyer.memberships[0].id,offers:[{id:offerId,operatorId:ids[4].ownerId,agentId:'older-agent',capabilityId:'old-cap'}],events:[],assignment:{offerId,operatorId:ids[4].ownerId,agentId:'older-agent',status:'accepted'}});
   await r.save('offer-index',{id:offerId,ownerId:ids[4].ownerId,taskId:id,offerId});
  }
 });
 const before=await repo.read(r=>r.get('task',taskId));
 let offers=await f.app.marketplace.offers(f.buyer,taskId);
 assert.equal(offers.find(o=>o.agentId===ids[4].agentId).exposure.newcomer,false);
 assert.equal(offers.find(o=>o.agentId===ids[4].agentId).trackRecord.capabilityAccepted,0);
 assert.equal(offers.length,8,'no offer is hidden');
 assert.equal(offers.filter(o=>o.exposure.shortlisted).length,4);
 assert.equal(offers.filter(o=>o.exposure.featured).length,1);
 assert.ok(!offers.find(o=>o.agentId===ids[6].agentId).exposure.eligible);
 assert.ok(!offers.find(o=>o.agentId===ids[7].agentId).exposure.eligible);
 assert.deepEqual(await f.app.marketplace.offers(f.buyer,taskId),offers,'refresh does not reroll');
 assert.deepEqual(await repo.read(r=>r.get('task',taskId)),before,'reads do not mutate agreements or assign work');
 const featured=offers.find(o=>o.exposure.featured);
 await repo.transaction('duplicate-listing',async r=>{
  const agent=await r.get('agent',featured.agentId), task=await r.get('task',taskId), agentId=randomUUID();
  await r.save('agent',{...agent,id:agentId,createdAt:now+100});
  task.offers.push({...featured,id:randomUUID(),agentId});await r.save('task',task);
 });
 offers=await f.app.marketplace.offers(f.buyer,taskId);
 assert.equal(offers.find(o=>o.exposure.featured).agentId,featured.agentId,'another listing gives no extra operator ticket');
 const shortlisted=offers.filter(o=>o.exposure.shortlisted);
 assert.equal(new Set(shortlisted.map(o=>o.operatorId)).size,4);
 await f.app.marketplace.recordExposure(f.buyer,taskId,{offerIds:[ids[0].offerId],stage:'reviewed'},randomUUID());
 await f.app.marketplace.recordExposure(f.buyer,taskId,{offerIds:[ids[0].offerId],stage:'reviewed'},randomUUID());
 await f.app.marketplace.recordExposure(f.buyer,taskId,{offerIds:shortlisted.map(o=>o.id),stage:'shortlisted'},randomUUID());
 const report=await f.app.marketplace.acquisition(f.builder,f.agentId);
 assert.equal(report.funnel.quoted,1);assert.equal(report.funnel.reviewed,1);assert.equal(report.funnel.selected,0);
 assert.equal(report.funnel.eligible,null);assert.equal(report.funnel.invited,null);
 assert.equal(report.totals.requests,0,'open-market metrics do not contaminate direct attribution');
 await assert.rejects(f.app.marketplace.recordExposure(f.other,taskId,{offerIds:[ids[0].offerId],stage:'reviewed'},randomUUID()),{code:'NOT_FOUND'});
 await assert.rejects(f.app.marketplace.acquisition(f.other,f.agentId),{code:'NOT_FOUND'});
 await assert.rejects(f.app.marketplace.recordExposure(f.buyer,taskId,{offerIds:[ids[6].offerId],stage:'shortlisted'},randomUUID()),{code:'EXPOSURE_STALE'});
 await f.app.marketplace.accept(f.buyer,taskId,{offerId:ids[0].offerId,expectedVersion:2},randomUUID());
 assert.equal((await f.app.marketplace.acquisition(f.builder,f.agentId)).funnel.selected,1);
 assert.ok((await f.app.marketplace.offers(f.buyer,taskId)).every(o=>!o.exposure.featured),'selection stops reshuffling');
 await assert.rejects(f.app.marketplace.recordExposure(f.buyer,taskId,{offerIds:[shortlisted[0].id],stage:'shortlisted'},randomUUID()),{code:'EXPOSURE_STALE'});
});

test('rotation distributes task opportunities across operators, not listing counts',async()=>{
 const {offersWithExposure}=require('../src/fair-exposure.cjs'), now=1000000;
 const agents=new Map(), offers=[];
 for(let i=0;i<6;i++) {
  const id=`agent-${i}`, ownerId=`builder-${i}`;
  agents.set(id,{id,ownerId,listingStatus:'published',createdAt:i,credentialHash:'fixture',credentialExpiresAt:now+1000,connectedAt:now,
   runtimeName:'fixture',runtimeVersion:'1',capabilities:[{id:'cap',assessmentId:'test'}],
   assessments:[{id:'test',status:'passed',expiresAt:now+1000,credentialHash:'fixture',runtimeName:'fixture',runtimeVersion:'1'}]});
  offers.push({id:`offer-${i}`,agentId:id,operatorId:ownerId,capabilityId:'cap',qualification:'qualified',qualificationEvidence:{id:'test'},scopeVersion:1,expiresAt:now+1000,runtimeBid:true});
 }
 const repo={get:async(kind,id)=>agents.get(id),page:async()=>[]}, winners=new Set();
 for(let n=0;n<120;n++) {
  const result=await offersWithExposure(repo,{id:`task-${n}`,status:'posted',scopeVersion:1,offers},now);
  winners.add(result.find(o=>o.exposure.featured).operatorId);
 }
 assert.equal(winners.size,6,'all qualifying operators receive opportunities across this deterministic sample');
 agents.get('agent-0').assessments[0].expiresAt=now;
 const expired=await offersWithExposure(repo,{id:'task-expired',status:'posted',scopeVersion:1,offers},now);
 assert.equal(expired.find(o=>o.agentId==='agent-0').exposure.eligible,false);
});
