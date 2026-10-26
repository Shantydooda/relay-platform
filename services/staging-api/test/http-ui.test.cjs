'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {createApp}=require('../../poc-api/src/app.cjs');
const ui=require('../../../packages/ui/src/components.cjs');
test('managed recovery UI keeps verification and reset separate and escapes address text',()=>{
  const state={auth:'email-sent',emailAction:'recover',email:'" autofocus onfocus="bad',confirmation:{type:'email',tokenHash:'must-not-appear'}};
  const context={state,escape:ui.text};
  vm.runInNewContext(readFileSync(resolve(__dirname,'../../../apps/poc-web/public/managed-auth.js'),'utf8'),context);
  let html=context.managedAuthView();
  assert.match(html,/<form id="recover"/);assert.match(html,/Resend reset email/);
  assert.doesNotMatch(html,/value="" autofocus/);
  state.emailAction='resend';html=context.managedAuthView();assert.match(html,/<form id="resend"/);
  state.auth='confirm';html=context.managedAuthView();assert.doesNotMatch(html,/must-not-appear/);assert.match(html,/Verify my email/);
  state.auth='reset';html=context.managedAuthView();assert.match(html,/autocomplete="new-password"/);assert.doesNotMatch(html,/task|workspace-toggle/);
});
test('managed transport requires explicit secure configuration',()=>{
  assert.throws(()=>createApp({origin:'http://127.0.0.1:4181',store:{},mode:'managed-staging'}),/HTTPS/);
  assert.throws(()=>createApp({origin:'https://relay.example',mode:'managed-staging'}),/explicit managed store/);
});
test('HTTP wiring supports verification, recovery, CSRF and async stores without exposing provider token',async t=>{
  let scope='app';
  const store={
    async register(){return {verificationRequired:true,message:'Check email if eligible.'};},
    async login(){return 'opaque-session';},
    async principal(raw){if(!raw)throw Object.assign(new (require('../../poc-api/src/security.cjs').HttpError)(401,'SIGN_IN_REQUIRED','Sign in'));return {user:{id:'user',name:'Member'},memberships:[],csrf:'csrf',access:'DO-NOT-EXPOSE',recoveryRequired:scope==='recovery'};},
    csrf(actor,value){if(value!==actor.csrf)throw new (require('../../poc-api/src/security.cjs').HttpError)(403,'CSRF_FAILED','Refresh');},
    async emailAction(){return {message:'If eligible, check email.'};},
    async verify(){scope='recovery';return {raw:'opaque-session',recoveryRequired:true};},
    async reset(){return {message:'Password changed.'};}
  };
  const server=createApp({origin:'https://relay.example',mode:'managed-staging',store,logger:{error:()=>assert.fail('Unexpected internal error')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  async function request(path,body,cookie,csrf){
    return new Promise((resolve,reject)=>{
      const req=http.request(`http://127.0.0.1:${server.address().port}${path}`,{method:body?'POST':'GET',headers:{Host:'relay.example',Origin:'https://relay.example',...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString()}));
      });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
    });
  }
  const config=await request('/api/config');assert.equal(JSON.parse(config.text).authMode,'managed');
  const signup=await request('/api/auth/register',{name:'Member'});assert.equal(signup.status,200);assert.equal(signup.headers['set-cookie'],undefined);
  const email=await request('/api/auth/recover',{email:'member@example.test'});assert.equal(email.status,200);
  const verified=await request('/api/auth/verify',{tokenHash:'test',type:'recovery'});
  const cookie=verified.headers['set-cookie'][0].split(';')[0];
  assert.match(verified.headers['set-cookie'][0],/Max-Age=3600; Secure/);
  assert.equal(JSON.parse(verified.text).recoveryRequired,true);assert.doesNotMatch(verified.text,/DO-NOT-EXPOSE/);
  const denied=await request('/api/auth/reset',{password:'new pass'},cookie,'wrong');assert.equal(denied.status,403);
  const reset=await request('/api/auth/reset',{password:'new pass'},cookie,'csrf');assert.equal(reset.status,200);assert.match(reset.headers['set-cookie'][0],/Max-Age=0/);
  assert.equal((await request('/auth/confirm')).status,200);
});
