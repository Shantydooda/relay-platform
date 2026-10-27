'use strict';
const {createVault}=require('./token-vault.cjs');
const {fail,digest,token,text,passwordInput,emailInput,exactKeys,equal}=require('../../poc-api/src/security.cjs');
const IDLE=30*60*1000,MAX_LIFETIME=60*60*1000;
const emailNotice=Object.freeze({verificationRequired:true,message:'If this address is eligible, check your email to continue. Already registered? Log in or request a password reset.'});
const recoveryNotice=Object.freeze({message:'If this address is eligible, you’ll receive an email with the next step.'});
function createManagedStore({provider,sessionKey,now=Date.now}) {
  const vault=createVault(sessionKey);
  async function limit(ip,email){await provider.limit([digest(`ip:${ip}`),digest(`email:${email}`)]);}
  async function eligible(email){if(!await provider.eligibleEmail(email))fail(403,'ACCESS_DENIED','This account does not have staging access.');}
  async function verifiedIdentity(access) {
    const result=await provider.identity(access);
    if(result.error){
      if([401,403].includes(result.error.status))fail(401,'SIGN_IN_REQUIRED','Please sign in again.');
      fail(503,'PROVIDER_UNAVAILABLE','Sign-in is temporarily unavailable. Please try again.');
    }
    const identity=result.data?.user;
    if(!identity?.id||!identity.email||!identity.email_confirmed_at)fail(401,'VERIFICATION_REQUIRED','Verify your email before continuing.');
    await eligible(identity.email.toLowerCase());
    return identity;
  }
  async function issue(result,scope,previousToken) {
    if(result.error||!result.data?.session?.access_token)fail(401,'INVALID_CREDENTIALS','Unable to sign in. Verify your email and check your credentials.');
    const session=result.data.session,identity=await verifiedIdentity(session.access_token);
    const expires=Math.min(now()+MAX_LIFETIME,Number(session.expires_at)*1000);
    if(!Number.isFinite(expires)||expires<=now()+30000)fail(401,'SIGN_IN_REQUIRED','Please sign in again.');
    if(scope==='app'){
      const metadata=identity.user_metadata||{};
      const name=typeof metadata.name==='string'&&metadata.name.trim()?metadata.name.trim().slice(0,80):'Relay member';
      await provider.bootstrap(session.access_token,name,metadata.workspace==='builder'?'builder':'buyer');
    }
    const raw=token(),hash=digest(raw);
    await provider.saveSession({token_hash:hash,user_id:identity.id,csrf:token(),encrypted_access_token:vault.seal(session.access_token,hash),scope,expires_at:new Date(expires).toISOString(),last_seen_at:new Date(now()).toISOString()});
    if(previousToken&&/^[A-Za-z0-9_-]{43}$/.test(previousToken))await provider.deleteSession(digest(previousToken));
    // Refresh tokens are deliberately discarded: staging sessions are bounded
    // to one access-token lifetime and require a fresh login afterward.
    return raw;
  }
  async function principal(raw,{allowRecovery=false}={}) {
    if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))fail(401,'SIGN_IN_REQUIRED','Please sign in to continue.');
    const hash=digest(raw),row=await provider.session(hash);
    if(!row||!Number.isFinite(Date.parse(row.expires_at))||!Number.isFinite(Date.parse(row.last_seen_at))||Date.parse(row.expires_at)<=now()||Date.parse(row.last_seen_at)<=now()-IDLE){
      if(row)await provider.deleteSession(hash);
      fail(401,'SIGN_IN_REQUIRED','Your session ended. Please sign in again.');
    }
    if(row.scope!=='app'&&row.scope!=='recovery')fail(401,'SIGN_IN_REQUIRED','Please sign in again.');
    if(row.scope==='recovery'&&!allowRecovery)fail(403,'RECOVERY_ONLY','Finish resetting your password before continuing.');
    let access;
    try{access=vault.open(row.encrypted_access_token,hash);}catch{await provider.deleteSession(hash);fail(401,'SIGN_IN_REQUIRED','Please sign in again.');}
    const identity=await verifiedIdentity(access);
    if(identity.id!==row.user_id)fail(401,'SIGN_IN_REQUIRED','Please sign in again.');
    let profile={name:'Relay member',workspace:'buyer'},memberships=[];
    if(row.scope==='app'){
      profile=await provider.profile(access,identity.id);
      memberships=await provider.memberships(access,identity.id);
      if(!memberships.length)fail(403,'ACCESS_DENIED','This account does not have an active workspace.');
    }
    await provider.touchSession(hash,new Date(now()).toISOString());
    return {user:{id:identity.id,email:identity.email,name:profile.name,emailVerified:true,workspace:profile.workspace},memberships,csrf:row.csrf,tokenHash:hash,access,scope:row.scope,recoveryRequired:row.scope==='recovery'};
  }
  function requireApp(actor){if(actor.scope!=='app')fail(403,'RECOVERY_ONLY','Finish resetting your password before continuing.');}
  function tenant(actor,id,writable=false){requireApp(actor);const membership=actor.memberships.find(m=>m.id===id);if(!membership)fail(404,'NOT_FOUND','Task or workspace not found.');if(writable&&!['owner','employee'].includes(membership.role))fail(403,'FORBIDDEN','Your role cannot change tasks.');}
  function taskView(row){return {id:row.id,tenantId:row.tenant_id,title:row.title,brief:row.brief,status:row.status,version:row.version,createdAt:Date.parse(row.created_at),updatedAt:Date.parse(row.updated_at)};}
  function keyInput(key){if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,128}$/.test(key))fail(400,'IDEMPOTENCY_REQUIRED','A valid request key is required.');return key;}
  return {
    principal,
    csrf(actor,value){if(!equal(actor.csrf,value))fail(403,'CSRF_FAILED','Refresh the page before trying again.');},
    async register(body,ip){
      exactKeys(body,['name','email','password','workspace']);
      const name=text(body.name,'Name',1,80),email=emailInput(body.email),password=passwordInput(body.password);
      if(!['buyer','builder'].includes(body.workspace))fail(400,'INVALID_INPUT','Choose a workspace.');
      await limit(ip,email);
      if(await provider.eligibleEmail(email)){
        const result=await provider.signUp(email,password,name,body.workspace);
        if(result.error&&result.error.status>=500)fail(503,'PROVIDER_UNAVAILABLE','Sign-up is temporarily unavailable. Please try again.');
      }
      return emailNotice;
    },
    async login(body,ip,previousToken){
      exactKeys(body,['email','password']);const email=emailInput(body.email);
      if(typeof body.password!=='string'||Buffer.byteLength(body.password)>1024)fail(400,'INVALID_INPUT','Check your credentials.');
      await limit(ip,email);
      // Do not reveal invitation membership as a public error at login.
      if(!await provider.eligibleEmail(email))fail(401,'INVALID_CREDENTIALS','Unable to sign in. Verify your email and check your credentials.');
      return issue(await provider.signIn(email,body.password),'app',previousToken);
    },
    async emailAction(action,body,ip){
      exactKeys(body,['email']);const email=emailInput(body.email);await limit(ip,email);
      if(await provider.eligibleEmail(email)){
        const result=action==='recover'?await provider.recover(email):await provider.resend(email);
        if(result.error&&result.error.status>=500)fail(503,'PROVIDER_UNAVAILABLE','Email is temporarily unavailable. Please try again.');
      }
      return recoveryNotice;
    },
    async verify(body,ip,previousToken){
      exactKeys(body,['tokenHash','type']);
      if(typeof body.tokenHash!=='string'||!/^[A-Za-z0-9_-]{20,512}$/.test(body.tokenHash)||!['email','recovery'].includes(body.type))fail(400,'INVALID_LINK','This email link is invalid. Request a new one.');
      await limit(ip,`verify:${digest(body.tokenHash)}`);
      return {raw:await issue(await provider.verify(body.tokenHash,body.type),body.type==='recovery'?'recovery':'app',previousToken),recoveryRequired:body.type==='recovery'};
    },
    async reset(actor,body){
      if(actor.scope!=='recovery')fail(403,'RECOVERY_REQUIRED','Open a valid password-reset email first.');
      exactKeys(body,['password']);const password=passwordInput(body.password);
      await provider.updatePassword(actor.access,password);
      await provider.deleteUserSessions(actor.user.id);
      await provider.revoke(actor.access,'global');
      return {message:'Password changed. Sign in with your new password.'};
    },
    async logout(actor){try{await provider.revoke(actor.access,'local');}finally{await provider.deleteSession(actor.tokenHash);}},
    async workspace(actor,body){requireApp(actor);exactKeys(body,['workspace']);if(!['buyer','builder'].includes(body.workspace))fail(400,'INVALID_INPUT','Choose a workspace.');await provider.workspace(actor.access,body.workspace);},
    async list(actor,tenantId){tenant(actor,tenantId);return (await provider.list(actor.access,tenantId)).map(taskView);},
    async detail(actor,id){requireApp(actor);const detail=await provider.detail(actor.access,id);tenant(actor,detail.task.tenant_id);return {task:taskView(detail.task),messages:detail.messages.map(row=>({id:row.id,body:row.body,authorName:row.author_name,createdAt:Date.parse(row.created_at)})),events:detail.events.map(row=>({sequence:row.sequence,type:row.type,version:row.version,createdAt:Date.parse(row.created_at)}))};},
    async createTask(actor,body,key){
      exactKeys(body,['tenantId','title','brief']);tenant(actor,body.tenantId,true);keyInput(key);
      return provider.command(actor.access,'create',key,{tenantId:body.tenantId,title:text(body.title,'Title',1,120),brief:text(body.brief,'Brief',1,10000)});
    },
    async mutateTask(actor,id,action,body,key){
      requireApp(actor);keyInput(key);
      const allowed=action==='edit'?['expectedVersion','title','brief']:action==='messages'?['expectedVersion','body']:['expectedVersion'];exactKeys(body,allowed);
      if(!Number.isSafeInteger(body.expectedVersion)||body.expectedVersion<1)fail(400,'VERSION_REQUIRED','The current task version is required.');
      if(!['edit','messages','post','cancel'].includes(action))fail(404,'NOT_FOUND','Action not found.');
      return provider.command(actor.access,action==='messages'?'message':action,key,{...body,taskId:id});
    }
  };
}
module.exports={createManagedStore};
