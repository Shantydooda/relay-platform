'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
async function setup(t, adapter) {
  const f = await fixture(t, adapter);
  const app = createApplication({ ...f.options, paymentRecoveryUserIds: [f.buyer.user.id] });
  await f.begin('fund');
  const id = `task:${f.taskId}`;
  await f.repository.transaction('fixture', async repo => {
    const job = await repo.get('payment-job', id, true);
    job.status = 'review'; job.failures = 12; job.errorCode = 'PROVIDER_CHECK_FAILED';
    await repo.save('payment-job', job);
  });
  const item = async () => (await app.paymentRecovery(f.buyer)).items.find(row=>row.id===id);
  return { ...f, app, id, item };
}
for (const adapter of ['sqlite','pglite']) test(`${adapter}: guarded recovery is audited, deduplicated and reconciles without replacement payment`,async t=>{
  const f=await setup(t,adapter); const before=await f.item(); assert.equal(before.canRetry,true);
  const body={snapshot:before.snapshot,reason:'Provider connectivity has recovered.'},key=randomUUID();
  const results=await Promise.all([f.app.retryPaymentRecovery(f.buyer,f.id,body,key),f.app.retryPaymentRecovery(f.buyer,f.id,body,key)]);
  assert.deepEqual(results[0],results[1]); assert.equal((await f.item()).history.length,1);
  await assert.rejects(f.app.retryPaymentRecovery(f.buyer,f.id,body,randomUUID()),{code:'RECOVERY_STALE'});
  const queued=await f.item();assert.equal(queued.canRetry,false);
  await f.app.reconcilePayments();assert.equal((await f.get()).settlement.status,'funded');
  assert.equal(f.calls.filter(c=>c[0]==='checkout').length,1);
});
test('operations permission is separate from ownership and revalidated on duplicate retries',async t=>{
  const f=await setup(t);await assert.rejects(f.app.paymentRecovery(f.builder),{code:'FORBIDDEN'});
  await assert.rejects(f.app.paymentRecovery({...f.buyer,recoveryRequired:true}),{code:'FORBIDDEN'});
  const body={snapshot:(await f.item()).snapshot,reason:'Reviewed provider connection.'},key=randomUUID();
  await f.app.retryPaymentRecovery(f.buyer,f.id,body,key);
  const revoked=createApplication(f.options);
  await assert.rejects(revoked.retryPaymentRecovery(f.buyer,f.id,body,key),{code:'FORBIDDEN'});
});
test('discrepancies, active leases and disconnected providers cannot be reset',async t=>{
  const f=await setup(t);
  for(const change of [{errorCode:'PAYMENT_STATE_REVIEW'},{errorCode:'RECONCILIATION_REQUIRED'},{errorCode:'PROVIDER_CHECK_FAILED',leaseUntil:Date.now()+3600000}]){
    await f.repository.transaction('fixture',async repo=>{const job=await repo.get('payment-job',f.id,true);Object.assign(job,change);await repo.save('payment-job',job);});
    const item=await f.item();assert.equal(item.canRetry,false);
    await assert.rejects(f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:item.snapshot,reason:'Reviewed this payment safely.'},randomUUID()),{code:'RECOVERY_BLOCKED'});
  }
  const off=createApplication({...f.options,paymentProvider:null,paymentRecoveryUserIds:[f.buyer.user.id]});
  assert.equal((await off.paymentRecovery(f.buyer)).configured,false);
});
test('concurrent independent retries have one winner, require a reason and reject receipt conflicts',async t=>{
  const f=await setup(t), row=await f.item();
  await assert.rejects(f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:row.snapshot,reason:'x'},randomUUID()),{code:'INVALID_RECOVERY'});
  const body={snapshot:row.snapshot,reason:'Provider issue resolved and checked.'};
  const result=await Promise.allSettled([f.app.retryPaymentRecovery(f.buyer,f.id,body,randomUUID()),f.app.retryPaymentRecovery(f.buyer,f.id,body,randomUUID())]);
  assert.equal(result.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await f.item()).history.length,1);
});
for (const phase of ['funding','refund','payout']) test(`${phase} recovery stays connected to both participants without new operations`,async t=>{
  const f=await setup(t);
  // Clear the initial failure fixture and reach the desired operation normally.
  await f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:(await f.item()).snapshot,reason:'Initial connectivity issue resolved.'},randomUUID());
  await f.app.reconcilePayments();
  if(phase==='refund')await f.begin('refund');
  if(phase==='payout'){await f.accept();await f.begin('transfer',f.builder);await f.begin('payout',f.builder);}
  if(phase==='funding')await f.repository.transaction('fixture',async repo=>{const task=await repo.get('task',f.taskId,true);task.settlement.status='awaiting_payment';await repo.save('task',task);});
  f.advance(60001);
  await f.repository.transaction('fixture',async repo=>{const job=await repo.get('payment-job',f.id,true);Object.assign(job,{status:'review',errorCode:'PROVIDER_CHECK_FAILED',failures:12});await repo.save('payment-job',job);});
  assert.equal((await f.app.taskPayment(f.buyer,f.taskId)).reconciliation.status,'needs_review');
  assert.equal((await f.app.taskPayment(f.builder,f.taskId)).reconciliation.status,'needs_review');
  const calls=f.calls.length;
  await f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:(await f.item()).snapshot,reason:'Reviewed provider connectivity and task references.'},randomUUID());
  await f.app.reconcilePayments();
  const buyer=await f.app.taskPayment(f.buyer,f.taskId),builder=await f.app.taskPayment(f.builder,f.taskId);
  assert.deepEqual(buyer,builder);assert.equal(buyer.status,{funding:'funded',refund:'refunded',payout:'paid'}[phase]);
  assert.equal(buyer.reconciliation.status,'automatic');assert.equal(f.calls.length,calls);
});
for (const phase of ['refund','payout']) test(`provider-declared ${phase} failure is blocked consistently, never shown as scheduled`,async t=>{
  const f=await setup(t);
  await f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:(await f.item()).snapshot,reason:'Initial provider outage resolved.'},randomUUID());await f.app.reconcilePayments();
  if(phase==='refund'){await f.begin('refund');f.provider.refundStatus=async()=>({status:'failed'});}
  else{await f.accept();await f.begin('transfer',f.builder);await f.begin('payout',f.builder);f.provider.payoutStatus=async()=>({status:'failed'});}
  await f.app.reconcilePayments();
  const row=await f.item();assert.equal(row.status,'needs_review');assert.equal(row.canRetry,false);
  for(const who of [f.buyer,f.builder]){const payment=await f.app.taskPayment(who,f.taskId);assert.equal(payment.status,phase+'_failed');assert.equal(payment.reconciliation.status,'needs_review');}
  await assert.rejects(f.app.retryPaymentRecovery(f.buyer,f.id,{snapshot:row.snapshot,reason:'Attempt to reset a terminal failure.'},randomUUID()),{code:'RECOVERY_BLOCKED'});
});
