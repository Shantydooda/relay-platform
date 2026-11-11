'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const { fixture } = require('./fixtures/payment-fixture.cjs');
const { createApplication } = require('../src/service.cjs');
const { createWebhookVerifier } = require('../../payments/src/webhook.cjs');
const { createApp } = require('../../poc-api/src/app.cjs');
const SECRET = 'whsec_isolated_fixture_signing_secret';
const NOW = 1800000000000;
function payload(type='checkout.session.completed',objectId='cs_test_fixture',extra={}) {
  return {id:`evt_${randomUUID().replaceAll('-','')}`,object:'event',livemode:false,type,data:{object:{id:objectId}},...extra};
}
function sign(event,now=NOW,secret=SECRET) {
  const bytes=Buffer.from(JSON.stringify(event)),timestamp=String(Math.floor(now/1000));
  return {bytes,signature:`t=${timestamp},v1=${createHmac('sha256',secret).update(timestamp+'.').update(bytes).digest('hex')}`};
}
function verified(event) {const s=sign(event);return createWebhookVerifier({secret:SECRET,now:()=>NOW})(s.bytes,s.signature);}

test('raw webhook verification rejects tampering, replay, future timestamp, live mode and wrong secret',()=>{
  const verify=createWebhookVerifier({secret:SECRET,now:()=>NOW});
  const event=payload(),s=sign(event);
  assert.equal(verify(s.bytes,s.signature).id,event.id);
  assert.throws(()=>verify(Buffer.concat([s.bytes,Buffer.from(' ')]),s.signature),{code:'INVALID_SIGNATURE'});
  for(const delta of [-301000,301000]){const old=sign(event,NOW+delta);assert.throws(()=>verify(old.bytes,old.signature),{code:'STALE_SIGNATURE'});}
  const wrong=sign(event,NOW,'whsec_wrong_fixture');assert.throws(()=>verify(wrong.bytes,wrong.signature),{code:'INVALID_SIGNATURE'});
  const live=sign({...event,livemode:true});assert.throws(()=>verify(live.bytes,live.signature),{code:'LIVE_MODE_FORBIDDEN'});
  assert.throws(()=>verify(s.bytes,`t=1800000000,${s.signature}`),{code:'INVALID_SIGNATURE'});
  const rotation=s.signature.replace(',v1=',`,v1=${'0'.repeat(64)},v1=`);assert.equal(verify(s.bytes,rotation).id,event.id);
  assert.throws(()=>verify(Buffer.alloc(262145),s.signature),{code:'BODY_TOO_LARGE'});
});
for(const adapter of ['sqlite','postgres']) {
  test(`${adapter}: signed hints dedupe, persist minimal data, and canonical polling confirms funding without trusting payload`,async t=>{
    const f=await fixture(t,adapter);await f.begin('fund');
    f.provider.funding=async()=>({status:'awaiting_payment'});
    const event=verified(payload('checkout.session.completed','cs_test_fixture',{data:{object:{id:'cs_test_fixture',payment_status:'paid',customer_email:'private@example.test'}}}));
    await Promise.all([f.app.receivePaymentEvent(event),createApplication(f.options).receivePaymentEvent(event)]);
    await f.app.reconcilePayments();assert.equal((await f.get()).settlement.status,'awaiting_payment');
    const inbox=await f.repository.read(repo=>repo.scan('payment-event'));
    assert.equal(inbox.length,1);assert.equal(inbox[0].status,'scheduled');assert.ok(!JSON.stringify(inbox).includes('private@'));
    f.provider.funding=async()=>({status:'funded',intentId:'pi_fixture',chargeId:'ch_fixture'});
    f.advance(15001);await createApplication(f.options).reconcilePayments();
    assert.equal((await f.get()).settlement.ledger.length,1);
    await f.app.receivePaymentEvent(verified(payload('checkout.session.expired')));await f.app.reconcilePayments();
    assert.equal((await f.get()).settlement.status,'funded');assert.equal((await f.get()).settlement.ledger.length,1);
  });
}
test('webhook before reference persistence retries later; unknown account cannot route a payout',async t=>{
  const f=await fixture(t);const early=verified(payload());await f.app.receivePaymentEvent(early);await f.app.reconcilePayments();
  assert.equal((await f.repository.read(r=>r.get('payment-event',early.id))).status,'pending');
  await f.begin('fund');f.advance(10001);await f.app.reconcilePayments();
  assert.equal((await f.repository.read(r=>r.get('payment-event',early.id))).status,'scheduled');
  const foreign=verified(payload('payout.paid','po_fixture',{account:'acct_foreign'}));await f.app.receivePaymentEvent(foreign);await f.app.reconcilePayments();
  assert.equal((await f.repository.read(r=>r.get('payment-event',foreign.id))).status,'pending');
});
test('automatic recovery reuses an uncertain mutation key, observes backoff and never invents a payout',async t=>{
  const f=await fixture(t);f.lose();await assert.rejects(f.begin('fund'));
  await createApplication(f.options).reconcilePayments();assert.equal(f.unique.size,1);
  f.advance(15001);await f.app.reconcilePayments();assert.equal((await f.get()).settlement.status,'funded');
  await f.accept();f.advance(300001);await f.app.reconcilePayments();
  assert.equal(f.calls.filter(([type])=>['transfer','payout'].includes(type)).length,0);
  await f.begin('transfer',f.builder);await f.begin('payout',f.builder);
  let calls=0;f.provider.payoutStatus=async()=>{calls++;throw new Error('Private provider message must not persist');};
  f.advance(300001);await f.app.reconcilePayments();await f.app.reconcilePayments();assert.equal(calls,1);
  const job=await f.repository.read(r=>r.get('payment-job',`task:${f.taskId}`));assert.equal(job.failures,1);assert.equal(job.errorCode,'PROVIDER_CHECK_FAILED');
  assert.ok(!JSON.stringify(job).includes('Private'));
  f.advance(10001);f.provider.payoutStatus=async()=>({status:'paid'});await createApplication(f.options).reconcilePayments();
  assert.equal((await f.get()).settlement.status,'paid');assert.equal((await f.get()).settlement.ledger.length,3);
});
test('durable lease excludes competing workers and recovers after restart; old unknown operation stops for review',async t=>{
  const f=await fixture(t);await f.begin('fund');
  let release,enter;const entered=new Promise(r=>enter=r);let calls=0;
  f.provider.funding=async()=>{calls++;enter();await new Promise(r=>release=r);return{status:'funded',intentId:'pi_fixture',chargeId:'ch_fixture'};};
  const running=f.app.reconcilePayments();await entered;await createApplication(f.options).reconcilePayments();assert.equal(calls,1);release();await running;
  const g=await fixture(t);g.lose();await assert.rejects(g.begin('fund'));g.advance(24*3600000);
  await g.app.reconcilePayments();const payment=await g.app.taskPayment(g.buyer,g.taskId);
  assert.equal(payment.reconciliation.status,'needs_review');assert.equal(g.unique.size,1);
  await g.app.reconcilePayments();assert.equal(g.calls.filter(c=>c[0]==='checkout').length,1);
});
test('late payout failure is flagged for review without erasing confirmed settlement history',async t=>{
  const f=await fixture(t);await f.begin('fund');await f.app.reconcilePayments();await f.accept();await f.begin('transfer',f.builder);await f.begin('payout',f.builder);
  f.advance(15001);await f.app.reconcilePayments();assert.equal((await f.get()).settlement.status,'paid');
  f.provider.payoutStatus=async()=>({status:'failed'});
  await f.app.receivePaymentEvent(verified(payload('payout.failed','po_fixture',{account:'acct_fixture'})));await f.app.reconcilePayments();
  const p=await f.app.taskPayment(f.builder,f.taskId);assert.equal(p.reconciliation.status,'needs_review');assert.equal(p.ledger.length,3);
});
test('HTTP webhook accepts only signed raw JSON without weakening ordinary CSRF routes',async t=>{
  const f=await fixture(t);await f.begin('fund');
  const net=require('node:net'),reservation=net.createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
  const origin=`http://127.0.0.1:${port}`;
  const server=createApp({origin,store:f.app,paymentWebhookVerifier:createWebhookVerifier({secret:SECRET,now:()=>NOW}),logger:{error(){assert.fail('Unexpected HTTP error');}}});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
  const event=sign(payload());
  const send=(body,signature)=>fetch(origin+'/api/webhooks/stripe',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':signature},body});
  assert.equal((await send(event.bytes,event.signature)).status,200);
  assert.equal((await send(event.bytes,event.signature)).status,200);
  assert.equal((await send(event.bytes,'bad')).status,400);
  assert.equal((await fetch(origin+'/api/tasks',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await f.repository.read(r=>r.scan('payment-event'))).length,1);
});

test('abandoned job lease expires after restart and repeated provider failures stop at the bounded retry limit',async t=>{
  const f=await fixture(t);await f.begin('fund');
  const jobId=`task:${f.taskId}`;
  await f.repository.transaction('abandon',async repo=>{const j=await repo.get('payment-job',jobId);j.leaseToken='abandoned';j.leaseUntil=f.options.now()+60000;await repo.save('payment-job',j);});
  const restart=createApplication(f.options);await restart.reconcilePayments();assert.equal((await f.get()).settlement.status,'awaiting_payment');
  f.advance(60001);await restart.reconcilePayments();assert.equal((await f.get()).settlement.status,'funded');
  const g=await fixture(t);await g.begin('fund');let calls=0;
  g.provider.funding=async()=>{calls++;throw new Error('Offline');};
  for(let i=0;i<12;i++){await g.app.reconcilePayments();g.advance(900001);}
  assert.equal(calls,12);await g.app.reconcilePayments();assert.equal(calls,12);
  assert.equal((await g.app.taskPayment(g.buyer,g.taskId)).reconciliation.status,'needs_review');
});

test('durable pagination reaches work beyond the first page and conflicting event identities are rejected',async t=>{
  const f=await fixture(t);await f.begin('fund');
  await f.repository.transaction('fixtures',async repo=>{
    for(let i=0;i<15;i++)await repo.save('payment-job',{id:`operator:000${i}`,ownerId:'system',type:'operator',targetId:'unused',status:'pending',nextAt:f.options.now()+3600000,failures:0});
  });
  for(let i=0;i<5;i++)await createApplication(f.options).reconcilePayments();
  assert.equal((await f.get()).settlement.status,'funded');
  const original=payload();await f.app.receivePaymentEvent(verified(original));
  await assert.rejects(f.app.receivePaymentEvent(verified({...original,type:'checkout.session.expired'})),{code:'EVENT_CONFLICT'});
});
