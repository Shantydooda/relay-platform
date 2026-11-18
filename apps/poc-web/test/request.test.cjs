'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {request}=require('../public/request.js');
function timers(){const pending=new Map();let id=0;return {pending,schedule(fn,ms){pending.set(++id,{fn,ms});return id;},cancel(id){pending.delete(id);}};}
test('managed email request survives a free-host wakeup and is never replayed',async()=>{
  const clock=timers();let finish,signal,calls=0,slow=0;
  const result=request('/api/auth/resend',{method:'POST',managed:true,onSlow(){slow++;}},{...clock,fetchImpl:async(_,options)=>{calls++;signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  assert.equal([...clock.pending.values()].find(t=>t.ms===75000).ms,75000);
  [...clock.pending.values()].find(t=>t.ms===5000).fn();
  assert.equal(slow,1);assert.equal(signal.aborted,false);
  finish({ok:true,json:async()=>({message:'Check your email'})});
  assert.deepEqual(await result,{message:'Check your email'});assert.equal(calls,1);assert.equal(clock.pending.size,0);
});
test('timeout reports uncertainty for email rather than promising a safe replay',async()=>{
  const clock=timers();let calls=0;
  const result=request('/api/auth/register',{method:'POST',managed:true},{...clock,fetchImpl:(_,options)=>{calls++;return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));}});
  const rejection=assert.rejects(result,error=>error.code==='CONNECTION_INTERRUPTED'&&error.message.includes('Check your inbox')&&!error.message.includes('duplicate'));
  [...clock.pending.values()].find(t=>t.ms===75000).fn();await rejection;
  assert.equal(calls,1);assert.equal(clock.pending.size,0);
});
test('host HTML errors are sanitized and JSON rate limits remain actionable',async()=>{
  const clock=timers();
  await assert.rejects(request('/api/auth/recover',{managed:true},{...clock,fetchImpl:async()=>({ok:false,status:503,json:async()=>{throw new Error('private proxy HTML');}})}),error=>error.code==='INCOMPLETE_RESPONSE'&&error.message.includes('Check your inbox')&&!error.message.includes('private'));
  await assert.rejects(request('/api/auth/resend',{managed:true},{...clock,fetchImpl:async()=>({ok:false,status:429,json:async()=>({error:{code:'AUTH_LIMIT',message:'Try again in 15 minutes.'}})})}),{status:429,code:'AUTH_LIMIT',message:'Try again in 15 minutes.'});
  assert.equal(clock.pending.size,0);
});
