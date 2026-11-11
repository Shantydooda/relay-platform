'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
async function setup(t, adapter) {
  const f = await fixture(t, adapter), tenantId = f.buyer.memberships[0].id;
  f.buyer.memberships[0].company = true;
  const employee = {user:{id:randomUUID(),name:'Employee'},memberships:[{id:tenantId,role:'employee',company:true}]};
  const approver = {user:{id:randomUUID(),name:'Approver'},memberships:[{id:tenantId,role:'approver',company:true}]};
  const actors = [f.buyer, employee, approver, f.builder, f.stranger];
  const app = createApplication({...f.options,resolveOperator:async id=>actors.find(a=>a.user.id===id)});
  await f.repository.transaction('fixture',async repo=>{
    const task=await repo.get('task',f.taskId,true);task.ownerId=employee.user.id;task.companyApprovalRequired=true;await repo.save('task',task);
  });
  await app.configureBudget(f.buyer,tenantId,{limitMinor:750,expectedVersion:0},randomUUID());
  const request = async(id=f.taskId)=>app.requestApproval(employee,id,{expectedVersion:(await f.repository.read(r=>r.get('task',id))).version,note:'Needed for customer research'},randomUUID());
  const decide=async(decision='approved',id=f.taskId,who=approver)=>{
    const task=await f.repository.read(r=>r.get('task',id));
    return app.decideApproval(who,id,{approvalId:task.approval.id,expectedVersion:task.approval.version,decision,note:decision==='approved'?'Within our research allowance':'Reduce the scope and resubmit'},randomUUID());
  };
  const budget=async()=> (await app.companyBudget(f.buyer,tenantId)).budget;
  return {...f,app,tenantId,employee,approver,request,decide,budget};
}
for (const adapter of ['sqlite','postgres']) {
  test(`${adapter}: decline, resubmit and exact offer reservation`,async t=>{
    const f=await setup(t,adapter);
    await f.request();await f.decide('declined');
    assert.equal((await f.budget()).reservedMinor,0);
    assert.equal((await f.app.detail(f.employee,f.taskId)).approval.status,'declined');
    await f.request();await f.decide();
    assert.equal((await f.budget()).availableMinor,250);
    await f.app.mutateTask(f.employee,f.taskId,'messages',{expectedVersion:(await f.get()).version,body:'Thanks for reviewing'},randomUUID());
    assert.equal((await f.app.detail(f.employee,f.taskId)).approval.status,'approved');
    await f.repository.transaction('fixture',async repo=>{
      const task=await repo.get('task',f.taskId,true);task.offers.push({...task.offers[0],id:'second-offer',amountMinor:600});await repo.save('task',task);
    });
    await f.app.marketplace.accept(f.employee,f.taskId,{expectedVersion:(await f.get()).version,offerId:'second-offer'},randomUUID());
    assert.equal((await f.app.detail(f.employee,f.taskId)).approval.status,'stale');
    assert.equal((await f.budget()).reservedMinor,0);
    await assert.rejects(f.app.sandboxPayment(f.employee,f.taskId,'fund',{expectedVersion:(await f.get()).version},randomUUID()),{code:'APPROVAL_REQUIRED'});
    await f.request();await f.decide();assert.equal((await f.budget()).reservedMinor,600);
  });
  test(`${adapter}: competing approvals and role isolation`,async t=>{
    const f=await setup(t,adapter), second=randomUUID();
    await f.repository.transaction('fixture',async repo=>{const task=await repo.get('task',f.taskId);await repo.save('task',{...task,id:second});});
    await f.request();await f.request(second);
    const results=await Promise.allSettled([f.decide(),f.decide('approved',second)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.find(r=>r.status==='rejected').reason.code,'BUDGET_EXCEEDED');
    assert.equal((await f.budget()).reservedMinor,500);
    await assert.rejects(f.decide('declined',f.taskId,f.employee),{code:'FORBIDDEN'});
    await assert.rejects(f.app.companyBudget(f.stranger,f.tenantId),{code:'FORBIDDEN'});
    await assert.rejects(f.app.detail(f.approver,f.taskId),{code:'NOT_FOUND'});
    await assert.rejects(f.app.configureBudget(f.buyer,f.tenantId,{limitMinor:100,expectedVersion:(await f.budget()).version},randomUUID()),{code:'BUDGET_RESERVED'});
  });
}
test('replays, revoked approver and fixture funding/refund remain connected',async t=>{
  const f=await setup(t,'sqlite');await f.request();
  const task=await f.get(),key=randomUUID(),body={approvalId:task.approval.id,expectedVersion:1,decision:'approved',note:'Approved for this research'};
  await f.app.decideApproval(f.approver,f.taskId,body,key);await f.app.decideApproval(f.approver,f.taskId,body,key);
  assert.equal((await f.budget()).reservedMinor,500);
  f.approver.memberships=[];
  await assert.rejects(f.app.sandboxPayment(f.employee,f.taskId,'fund',{expectedVersion:(await f.get()).version},randomUUID()),{code:'FORBIDDEN'});
  f.approver.memberships=[{id:f.tenantId,role:'approver',company:true}];
  await f.app.sandboxPayment(f.employee,f.taskId,'fund',{expectedVersion:(await f.get()).version},randomUUID());
  assert.equal((await f.budget()).committedMinor,500);assert.equal((await f.budget()).reservedMinor,0);
  await f.app.reconcilePayment(f.employee,f.taskId);
  await f.app.sandboxPayment(f.buyer,f.taskId,'refund',{expectedVersion:(await f.get()).version},randomUUID());
  await f.app.reconcilePayment(f.employee,f.taskId);
  assert.equal((await f.budget()).availableMinor,750);
  assert.equal((await f.app.detail(f.employee,f.taskId)).approval.status,'stale');
  await f.request();await f.decide();assert.equal((await f.budget()).reservedMinor,500);
});
test('expiry and scope changes release reservations; stale decisions fail',async t=>{
  const f=await setup(t,'sqlite');await f.request();const old=(await f.get()).approval;await f.decide();
  f.advance(3600001);assert.equal((await f.budget()).reservedMinor,0);
  assert.equal((await f.app.detail(f.employee,f.taskId)).approval.status,'stale');
  await assert.rejects(f.app.decideApproval(f.approver,f.taskId,{approvalId:old.id,expectedVersion:1,decision:'approved',note:'Late decision'},randomUUID()),{code:'APPROVAL_STALE'});
  await f.app.mutateTask(f.employee,f.taskId,'scope',{expectedVersion:(await f.get()).version,title:'New scope',brief:'Different requirements'},randomUUID());
  assert.equal((await f.budget()).reservedMinor,0);
});
