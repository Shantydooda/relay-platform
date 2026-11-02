'use strict';
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../../src/repository.cjs');
const { createApplication } = require('../../src/service.cjs');
// Provider double exists ONLY in isolated test databases. It cannot be selected
// by the application launcher or an HTTP request.
async function fixture(t, adapter='sqlite') {
  const db = adapter==='sqlite'?new DatabaseSync(':memory:'):await PGlite.create();
  t.after(()=>db.close());
  const repository = adapter==='sqlite'?createSqliteRepository(db):await createPostgresRepository(db,{initialize:true});
  const actor = name=>({user:{id:randomUUID(),name},memberships:[{id:randomUUID(),role:'owner'}]});
  const buyer=actor('Buyer'), builder=actor('Builder'), stranger=actor('Stranger');
  let time=Date.now(), loseCheckout=false;
  const calls=[], unique=new Set();
  const provider={kind:'fixture',
    async createOperator(op){calls.push(['operator',op.id]);return{accountId:'acct_fixture'};},
    async onboarding(){return{url:'https://connect.stripe.com/fixture'};},
    async operator(){return{accountId:'acct_fixture',ready:true,manualPayouts:true,requirements:[]};},
    async checkout(op){calls.push(['checkout',op.id]);unique.add(op.id);if(loseCheckout){loseCheckout=false;throw new Error('Lost response after provider creation');}return{sessionId:'cs_test_fixture',url:'https://checkout.stripe.com/fixture'};},
    async funding(){return{status:'funded',intentId:'pi_fixture',chargeId:'ch_fixture'};},
    async refund(op){calls.push(['refund',op.id]);return{refundId:'re_fixture',status:'pending'};},
    async refundStatus(){return{status:'succeeded'};},
    async transfer(op){calls.push(['transfer',op.id]);return{transferId:'tr_fixture'};},
    async payout(op){calls.push(['payout',op.id]);return{payoutId:'po_fixture',status:'pending'};},
    async payoutStatus(){return{status:'paid'};}
  };
  const options={repository,localExecution:true,now:()=>time,paymentProvider:provider};
  const app=createApplication(options);
  await app.onboardOperator(builder,{country:'US'},randomUUID());await app.refreshOperator(builder);
  const {taskId}=await app.createTask(buyer,{tenantId:buyer.memberships[0].id,title:'CSV cleanup',brief:'Clean source data'},randomUUID());
  await repository.transaction('fixture',async repo=>{
    const task=await repo.get('task',taskId,true);
    task.status='posted';task.selectedOfferId='offer-fixture';
    task.offers=[{id:'offer-fixture',agentId:'agent-fixture',operatorId:builder.user.id,amountMinor:500,currency:'USD',scopeVersion:1,expiresAt:time+3600000}];
    await repo.save('task',task);
  });
  const get=()=>repository.read(repo=>repo.get('task',taskId));
  const begin=async(action,who=buyer,key=randomUUID())=>app.sandboxPayment(who,taskId,action,{expectedVersion:(await get()).version},key);
  const accept=()=>repository.transaction('fixture',async repo=>{
    const task=await repo.get('task',taskId,true);
    task.assignment={id:'assignment-fixture',agentId:'agent-fixture',operatorId:builder.user.id,mode:'stripe-sandbox',status:'accepted',offerId:task.selectedOfferId};
    await repo.save('agent',{id:'agent-fixture',ownerId:builder.user.id});
    task.submissions=[{id:'submission-fixture',status:'accepted',files:[]}];await repo.save('task',task);
  });
  return{app,options,repository,buyer,builder,stranger,taskId,provider,get,begin,accept,calls,unique,advance:n=>time+=n,lose:()=>loseCheckout=true};
}

module.exports = { fixture };
