'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes,randomUUID}=require('node:crypto');
const {createManagedStore}=require('../src/store.cjs');
const {createVault}=require('../src/token-vault.cjs');
const {loadConfig}=require('../src/config.cjs');
const {createProvider}=require('../src/provider.cjs');
const {digest}=require('../../poc-api/src/security.cjs');
const password='a long test-only passphrase';
function fixture(){
  let time=Date.now();const rows=new Map(),calls=[],key=randomBytes(32),userId=randomUUID(),tenantId=randomUUID();
  const identity={id:userId,email:'invited@example.test',email_confirmed_at:new Date(time).toISOString(),user_metadata:{name:'Invited member',workspace:'builder'}};
  const authResult=()=>({data:{session:{access_token:'provider-access-token',refresh_token:'MUST-NOT-BE-STORED',expires_at:Math.floor(time/1000)+3600},user:identity},error:null});
  const provider={
    async limit(keys){calls.push(['limit',keys]);},
    async eligibleEmail(email){return email==='invited@example.test';},
    async signUp(...args){calls.push(['signup',...args]);return authResult();},
    async signIn(...args){calls.push(['signin',...args]);return authResult();},
    async verify(...args){calls.push(['verify',...args]);return authResult();},
    async identity(access){calls.push(['identity',access]);return {data:{user:identity},error:null};},
    async bootstrap(...args){calls.push(['bootstrap',...args]);},
    async profile(){return {name:'Invited member',workspace:'builder'};},
    async memberships(){return [{id:tenantId,name:'Personal workspace',role:'owner'}];},
    async saveSession(row){rows.set(row.token_hash,{...row});},
    async session(hash){return rows.get(hash)||null;},
    async touchSession(hash,last_seen_at){rows.get(hash).last_seen_at=last_seen_at;},
    async deleteSession(hash){calls.push(['delete-session',hash]);rows.delete(hash);},
    async deleteUserSessions(id){calls.push(['delete-user-sessions',id]);for(const [hash,row]of rows)if(row.user_id===id)rows.delete(hash);},
    async resend(email){calls.push(['resend',email]);return {error:null};},
    async recover(email){calls.push(['recover',email]);return {error:null};},
    async updatePassword(...args){calls.push(['update-password',...args]);},
    async revoke(...args){calls.push(['revoke',...args]);},
    async command(...args){calls.push(['command',...args]);return {taskId:randomUUID(),version:1};}
  };
  const store=createManagedStore({provider,sessionKey:key,now:()=>time});
  return {store,provider,rows,calls,key,identity,tenantId,advance:ms=>{time+=ms;}};
}
test('config requires explicit HTTPS provider settings and valid encryption key',()=>{
  const env={RELAY_APP_ORIGIN:'https://relay-staging.onrender.com',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test-publishable',SUPABASE_SECRET_KEY:'test-secret',RELAY_SESSION_KEY:randomBytes(32).toString('base64')};
  assert.equal(loadConfig(env).sessionKey.length,32);
  assert.throws(()=>loadConfig({...env,RELAY_APP_ORIGIN:'http://relay.example'}),/HTTPS/);
  assert.throws(()=>loadConfig({...env,SUPABASE_URL:'https://example.supabase.co.evil.test'}),/hosted Supabase/);
  assert.throws(()=>loadConfig({...env,RELAY_SESSION_KEY:'short'}),/32 random bytes/);
  assert.throws(()=>loadConfig({...env,SUPABASE_SECRET_KEY:''}),/Missing SUPABASE_SECRET_KEY/);
});
test('AES-GCM vault rejects altered ciphertext, wrong key and swapping session records',()=>{
  const vault=createVault(randomBytes(32)),sealed=vault.seal('access-token','session-a');
  assert.equal(vault.open(sealed,'session-a'),'access-token');
  assert.throws(()=>vault.open(sealed,'session-b'));
  assert.throws(()=>createVault(randomBytes(32)).open(sealed,'session-a'));
  const parts=sealed.split('.');parts[2]=randomBytes(16).toString('base64url');
  assert.throws(()=>vault.open(parts.join('.'),'session-a'));
});
test('register and recovery give generic notices; registration never grants an unverified session',async()=>{
  const {store,provider,rows,calls}=fixture();
  const a=await store.register({name:'Member',email:'invited@example.test',password,workspace:'buyer'},'ip');
  const b=await store.register({name:'Other',email:'unknown@example.test',password,workspace:'buyer'},'ip');
  assert.deepEqual(a,b);assert.equal(a.verificationRequired,true);assert.equal(rows.size,0);
  assert.equal(calls.filter(call=>call[0]==='signup').length,1);
  assert.deepEqual(await store.emailAction('recover',{email:'invited@example.test'},'ip'),await store.emailAction('recover',{email:'unknown@example.test'},'ip'));
  provider.signUp=async()=>({error:{status:503}});
  await assert.rejects(store.register({name:'Member',email:'invited@example.test',password,workspace:'buyer'},'ip'),{code:'PROVIDER_UNAVAILABLE'});
});
test('managed login verifies provider identity and stores only encrypted access token + opaque verifier',async()=>{
  const {store,rows,calls,identity}=fixture();
  const raw=await store.login({email:'invited@example.test',password},'ip'),row=rows.get(digest(raw));
  assert.equal(row.user_id,identity.id);
  assert.equal(row.scope,'app');
  assert.doesNotMatch(JSON.stringify([...rows.values()]),/provider-access-token|MUST-NOT-BE-STORED/);
  assert.equal(JSON.stringify([...rows.values()]).includes(raw),false);
  const actor=await store.principal(raw);
  assert.equal(actor.user.emailVerified,true);
  assert.equal(actor.user.workspace,'builder');
  assert.ok(calls.some(call=>call[0]==='identity'));
  assert.throws(()=>store.csrf(actor,'wrong'),{code:'CSRF_FAILED'});
  store.csrf(actor,actor.csrf);
});
test('unverified, revoked-invite and wrong-subject identities cannot acquire or use app sessions',async()=>{
  const {store,provider,identity,rows}=fixture();
  identity.email_confirmed_at=null;
  await assert.rejects(store.login({email:'invited@example.test',password},'ip'),{code:'VERIFICATION_REQUIRED'});
  assert.equal(rows.size,0);
  identity.email_confirmed_at=new Date().toISOString();
  const raw=await store.login({email:'invited@example.test',password},'ip');
  provider.eligibleEmail=async()=>false;
  await assert.rejects(store.principal(raw),{code:'ACCESS_DENIED'});
  provider.eligibleEmail=async()=>true;
  identity.id=randomUUID();
  await assert.rejects(store.principal(raw),{code:'SIGN_IN_REQUIRED'});
});
test('server enforces managed idle/absolute expiry and rejects damaged encrypted records',async()=>{
  const {store,rows,advance}=fixture();
  const raw=await store.login({email:'invited@example.test',password},'ip');
  advance(30*60*1000);await assert.rejects(store.principal(raw),{code:'SIGN_IN_REQUIRED'});
  const fresh=await store.login({email:'invited@example.test',password},'ip');
  rows.get(digest(fresh)).encrypted_access_token='broken';
  await assert.rejects(store.principal(fresh),{code:'SIGN_IN_REQUIRED'});
  const next=await store.login({email:'invited@example.test',password},'ip');
  advance(25*60*1000);await store.principal(next);
  advance(25*60*1000);await store.principal(next);
  advance(11*60*1000);await assert.rejects(store.principal(next),{code:'SIGN_IN_REQUIRED'});
});
test('recovery grants a restricted session, not tasks; reset revokes every app session',async()=>{
  const {store,rows,calls}=fixture();
  const normal=await store.login({email:'invited@example.test',password},'ip');
  const {raw}=await store.verify({tokenHash:'a'.repeat(64),type:'recovery'},'ip');
  await assert.rejects(store.principal(raw),{code:'RECOVERY_ONLY'});
  const actor=await store.principal(raw,{allowRecovery:true});
  assert.deepEqual(actor.memberships,[]);
  await assert.rejects(store.createTask(actor,{tenantId:randomUUID(),title:'Task',brief:'Brief'},randomUUID()),{code:'RECOVERY_ONLY'});
  await store.reset(actor,{password:'a completely new test-only passphrase'});
  assert.equal(rows.size,0);
  assert.ok(calls.some(call=>call[0]==='revoke'&&call[2]==='global'));
  await assert.rejects(store.principal(normal),{code:'SIGN_IN_REQUIRED'});
});
test('invalid verification type and ordinary sessions cannot change passwords through recovery endpoint',async()=>{
  const {store}=fixture();
  await assert.rejects(store.verify({tokenHash:'a'.repeat(64),type:'admin'},'ip'),{code:'INVALID_LINK'});
  const raw=await store.login({email:'invited@example.test',password},'ip'),actor=await store.principal(raw);
  await assert.rejects(store.reset(actor,{password}),{code:'RECOVERY_REQUIRED'});
});
test('logout revokes the opaque session even when provider logout is unavailable',async()=>{
  const {store,provider,rows}=fixture();
  const raw=await store.login({email:'invited@example.test',password},'ip'),actor=await store.principal(raw);
  provider.revoke=async()=>{throw new Error('Provider unavailable');};
  await assert.rejects(store.logout(actor));assert.equal(rows.size,0);
  await assert.rejects(store.principal(raw),{code:'SIGN_IN_REQUIRED'});
});
test('provider data client uses user JWT for task/profile access, never the admin secret',async()=>{
  const requests=[];
  const provider=createProvider({supabaseURL:'https://example.supabase.co',publishableKey:'sb_publishable_test',secretKey:'sb_secret_test',origin:'https://relay.example'},{fetchImpl:async(url,options)=>{
    requests.push({url:String(url),headers:new Headers(options.headers)});
    return new Response(JSON.stringify(String(url).includes('relay_profiles')?{user_id:'user-a',name:'Member',workspace:'buyer'}:{email:'invited@example.test'}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  await provider.profile('verified-user-access-token','user-a');
  await provider.eligibleEmail('invited@example.test');
  assert.equal(requests[0].headers.get('authorization'),'Bearer verified-user-access-token');
  assert.equal(requests[0].headers.get('apikey'),'sb_publishable_test');
  assert.equal(requests[1].headers.get('apikey'),'sb_secret_test');
});
