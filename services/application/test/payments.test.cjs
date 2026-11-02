'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { createApplication } = require('../src/service.cjs');
const { createStripeSandbox } = require('../../payments/src/stripe-sandbox.cjs');

const { fixture } = require('./fixtures/payment-fixture.cjs');
for(const adapter of ['sqlite','postgres']) {
  test(`${adapter}: funding, accepted delivery, transfer and payout survive restart without duplicate settlement`,async t=>{
    const f=await fixture(t,adapter);
    const body={expectedVersion:(await f.get()).version},key=randomUUID();
    await Promise.all([f.app.sandboxPayment(f.buyer,f.taskId,'fund',body,key),f.app.sandboxPayment(f.buyer,f.taskId,'fund',body,key)]);
    assert.equal(f.unique.size,1);
    const restart=createApplication(f.options);
    await restart.reconcilePayment(f.buyer,f.taskId);
    assert.equal((await f.get()).settlement.status,'funded');
    await assert.rejects(f.begin('transfer',f.builder),{code:'DELIVERY_NOT_ACCEPTED'});
    await assert.rejects(f.begin('payout',f.builder),{code:'PAYOUT_UNAVAILABLE'});
    await f.accept();
    await f.begin('transfer',f.builder);
    await assert.rejects(f.begin('refund'),{code:'REFUND_UNAVAILABLE'});
    await f.begin('payout',f.builder);
    assert.equal((await f.get()).settlement.status,'payout_pending');
    await Promise.all([restart.reconcilePayment(f.builder,f.taskId),restart.reconcilePayment(f.builder,f.taskId)]);
    const p=(await f.get()).settlement;
    assert.equal(p.status,'paid');assert.equal(p.ledger.length,3);
    assert.deepEqual(p.ledger.map(e=>e.amountMinor),[500,500,500]);
    assert.equal(f.calls.filter(c=>c[0]==='transfer').length,1);
  });
}
test('lost provider response reuses durable key; old uncertain operations stop before provider call',async t=>{
  const f=await fixture(t);f.lose();
  await assert.rejects(f.begin('fund'),/Lost response/);
  const restart=createApplication(f.options);
  await restart.reconcilePayment(f.buyer,f.taskId);
  assert.equal(f.unique.size,1);
  const g=await fixture(t);g.lose();await assert.rejects(g.begin('fund'));
  g.advance(24*3600000);
  await assert.rejects(g.app.reconcilePayment(g.buyer,g.taskId),{code:'RECONCILIATION_REQUIRED'});
  assert.equal(g.calls.filter(c=>c[0]==='checkout').length,1);
});
test('refund stays pending until confirmed and cannot race transfer; agreement cannot change or run unpaid',async t=>{
  const f=await fixture(t);await f.begin('fund');await f.app.reconcilePayment(f.buyer,f.taskId);
  const task=await f.get();
  await assert.rejects(f.app.marketplace.accept(f.buyer,f.taskId,{offerId:'other',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await assert.rejects(f.app.mutateTask(f.buyer,f.taskId,'scope',{title:'Changed',brief:'Changed scope',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await assert.rejects(f.app.authorizeLocal(f.buyer,f.taskId,{mode:'local-unpaid',expectedVersion:task.version},randomUUID()),{code:'FUNDING_LOCKED'});
  await f.begin('refund');assert.equal((await f.get()).settlement.status,'refund_pending');
  await assert.rejects(f.begin('transfer',f.builder),{code:'DELIVERY_NOT_ACCEPTED'});
  await f.app.reconcilePayment(f.buyer,f.taskId);
  assert.equal((await f.get()).settlement.status,'refunded');
  assert.equal((await f.get()).settlement.ledger.length,2);
});
test('foreign users, employees and stale operator readiness cannot fund; live mode stays off',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.app.taskPayment(f.stranger,f.taskId),{code:'NOT_FOUND'});
  const employee={...f.buyer,memberships:[{...f.buyer.memberships[0],role:'employee'}]};
  await assert.rejects(f.begin('fund',employee),{code:'APPROVAL_REQUIRED'});
  f.advance(300001);await assert.rejects(f.begin('fund'),{code:'OPERATOR_NOT_READY'});
  const disconnected=createApplication({...f.options,paymentProvider:undefined});
  assert.equal((await disconnected.paymentStatus(f.builder)).livePayments,false);
  await assert.rejects(disconnected.sandboxPayment(f.buyer,f.taskId,'fund',{expectedVersion:1},randomUUID()),{code:'SANDBOX_NOT_CONNECTED'});
  assert.throws(()=>createStripeSandbox({secretKey:'sk_live_forbidden',origin:'http://127.0.0.1:4180'}),/live keys/);
  assert.throws(()=>createStripeSandbox({secretKey:'sk_test_fixture',origin:'https://relay.example.com'}),/localhost/);
});
test('late funding response cannot regress refund state; failed payout never reports paid',async t=>{
  const f=await fixture(t);await f.begin('fund');
  let release,entered;
  const wait=new Promise(resolve=>entered=resolve);
  f.provider.funding=async()=>{entered();await new Promise(resolve=>release=resolve);return{status:'awaiting_payment'};};
  const late=f.app.reconcilePayment(f.buyer,f.taskId);await wait;
  f.provider.funding=async()=>({status:'funded',intentId:'pi_fixture',chargeId:'ch_fixture'});
  await f.app.reconcilePayment(f.buyer,f.taskId);await f.begin('refund');release();await late;
  assert.equal((await f.get()).settlement.status,'refund_pending');
  const g=await fixture(t);await g.begin('fund');await g.app.reconcilePayment(g.buyer,g.taskId);await g.accept();await g.begin('transfer',g.builder);await g.begin('payout',g.builder);
  g.provider.payoutStatus=async()=>({status:'failed'});await g.app.reconcilePayment(g.builder,g.taskId);
  assert.equal((await g.get()).settlement.status,'payout_failed');assert.equal((await g.get()).settlement.ledger.length,2);
  await assert.rejects(g.begin('payout',g.builder),{code:'RECONCILIATION_REQUIRED'});
});
test('Stripe adapter verifies refund intent without nonexistent livemode field and blocks mismatched amounts',async()=>{
  let bad=false;
  const adapter=createStripeSandbox({secretKey:'sk_test_fixture',origin:'http://127.0.0.1:4180',fetchImpl:async(url,options)=>{
    assert.ok(url.startsWith('https://api.stripe.com/v1/refunds'));
    assert.equal(options.headers.Authorization,'Bearer sk_test_fixture');
    return{ok:true,json:async()=>({id:'re_fixture',amount:bad?999:500,currency:'usd',payment_intent:'pi_fixture',status:'succeeded'})};
  }});
  assert.equal((await adapter.refund({id:'operation',amountMinor:500,intentId:'pi_fixture'})).status,'succeeded');
  bad=true;await assert.rejects(adapter.refundStatus({refundId:'re_fixture',amountMinor:500,intentId:'pi_fixture'}),{code:'REFUND_MISMATCH'});
});

for (const adapter of ['sqlite', 'postgres']) test(`${adapter}: spending history counts confirmed funding once, includes archived refunds, and isolates workspaces`, async t => {
  const f = await fixture(t, adapter);
  const tenant = f.buyer.memberships[0].id;
  let history = await f.app.spendingHistory(f.buyer, tenant);
  assert.equal(history.items.length, 1);
  assert.equal(history.totals.netMinor, 0);
  await f.begin('fund');
  assert.equal((await f.app.spendingHistory(f.buyer, tenant)).totals.netMinor, 0);
  await f.app.reconcilePayment(f.buyer, f.taskId);
  await f.begin('refund');
  assert.equal((await f.app.spendingHistory(f.buyer, tenant)).totals.netMinor, 500);
  await f.app.reconcilePayment(f.buyer, f.taskId);
  f.provider.checkout = async () => ({sessionId:'cs_test_second',url:'https://checkout.stripe.com/fixture'});
  f.provider.funding = async () => ({status:'funded',intentId:'pi_second',chargeId:'ch_second'});
  await f.begin('fund');
  await f.app.reconcilePayment(f.buyer, f.taskId);
  history = await f.app.spendingHistory(f.buyer, tenant);
  assert.equal(history.totals.fundedMinor,1000);
  assert.equal(history.totals.refundedMinor,500);
  assert.equal(history.totals.heldMinor,500);
  assert.equal(history.totals.releasedMinor,0);
  assert.equal(history.items[0].transactions.length, 3);
  await f.accept(); await f.begin('transfer',f.builder); await f.begin('payout',f.builder);
  await f.app.reconcilePayment(f.builder,f.taskId);
  const paid = (await f.app.spendingHistory(f.buyer,tenant)).totals;
  assert.equal(paid.netMinor,500);
  assert.equal(paid.releasedMinor,500);
  assert.equal(paid.heldMinor,0);
  await assert.rejects(f.app.spendingHistory(f.stranger,tenant), {code:'NOT_FOUND'});
  const colleague = {...f.buyer,user:{...f.buyer.user,id:'colleague'},memberships:[{id:tenant,role:'employee'}]};
  assert.equal((await f.app.spendingHistory(colleague,tenant)).items.length,0);
});
