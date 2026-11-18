'use strict';
const {createClient}=require('@supabase/supabase-js');
const {HttpError}=require('../../poc-api/src/security.cjs');

function createProvider(config,{fetchImpl=fetch,clientFactory=createClient}={}) {
  const boundedFetch=(url,options={})=>fetchImpl(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:boundedFetch}};
  const admin=clientFactory(config.supabaseURL,config.secretKey,options);
  const auth=()=>clientFactory(config.supabaseURL,config.publishableKey,options);
  const user=access=>clientFactory(config.supabaseURL,config.publishableKey,{...options,global:{...options.global,headers:{Authorization:`Bearer ${access}`}}});
  function checked(result) {
    if(result.error){
      const error=result.error,code=error.message;
      const known={ACCESS_DENIED:[403,'This account does not have staging access.'],NOT_FOUND:[404,'Task or workspace not found.'],VERSION_CONFLICT:[409,'This task changed. Refresh it before saving.'],IDEMPOTENCY_CONFLICT:[409,'That request key was already used for different content.'],IDEMPOTENCY_REQUIRED:[400,'A valid request key is required.'],INVALID_INPUT:[400,'Check the request fields.'],INVALID_TRANSITION:[409,'This task cannot make that change.'],TASK_CLOSED:[409,'This task is closed.']};
      if(Object.hasOwn(known,code)){const [status,message]=known[code];throw new HttpError(status,code,message);}
      throw new HttpError(503,'PROVIDER_UNAVAILABLE','The staging service is temporarily unavailable. Please try again.');
    }
    return result.data;
  }
  return {
    async ready(){checked(await admin.from('relay_sessions').select('token_hash').limit(0));},
    async eligibleEmail(email){return !!checked(await admin.from('relay_invites').select('email').eq('email',email).eq('active',true).maybeSingle());},
    async limit(keys){if(!checked(await admin.rpc('relay_auth_attempt',{p_keys:keys})))throw new HttpError(429,'AUTH_LIMIT','Too many attempts. Try again in 15 minutes.');},
    async signUp(email,password,name,workspace){return auth().auth.signUp({email,password,options:{emailRedirectTo:`${config.origin}/auth/confirm`,data:{name,workspace}}});},
    async signIn(email,password){return auth().auth.signInWithPassword({email,password});},
    async verify(tokenHash,type){return auth().auth.verifyOtp({token_hash:tokenHash,type});},
    async resend(email){return auth().auth.resend({type:'signup',email,options:{emailRedirectTo:`${config.origin}/auth/confirm`}});},
    async recover(email){return auth().auth.resetPasswordForEmail(email,{redirectTo:`${config.origin}/auth/confirm`});},
    async identity(access){return auth().auth.getUser(access);},
    async updatePassword(access,password){
      // updateUser() normally depends on SDK session state. A stateless BFF has
      // no shared SDK session: use the documented authenticated user endpoint.
      const result=await boundedFetch(`${config.supabaseURL}/auth/v1/user`,{method:'PUT',headers:{apikey:config.publishableKey,Authorization:`Bearer ${access}`,'Content-Type':'application/json'},body:JSON.stringify({password})});
      if(!result.ok)throw new HttpError(400,'RESET_FAILED','Unable to change this password. Request a fresh reset email.');
    },
    async revoke(access,scope='local'){const {error}=await admin.auth.admin.signOut(access,scope);if(error)throw new HttpError(503,'PROVIDER_UNAVAILABLE','Unable to end the provider session. Please retry.');},
    async bootstrap(access,name,workspace){checked(await user(access).rpc('relay_bootstrap',{p_name:name,p_workspace:workspace}));},
    async profile(access,id){return checked(await user(access).from('relay_profiles').select('user_id,name,workspace').eq('user_id',id).single());},
    async memberships(access,id){
      const rows=checked(await user(access).from('relay_memberships').select('tenant_id,role,relay_tenants(id,name)').eq('user_id',id));
      return rows.map(row=>({id:row.tenant_id,name:row.relay_tenants.name,role:row.role}));
    },
    async workspace(access,workspace){checked(await user(access).rpc('relay_set_workspace',{p_workspace:workspace}));},
    async list(access,tenantId){return checked(await user(access).from('relay_tasks').select('*').eq('tenant_id',tenantId).order('updated_at',{ascending:false}).order('id').limit(100));},
    async detail(access,id){
      const client=user(access),task=checked(await client.from('relay_tasks').select('*').eq('id',id).maybeSingle());
      if(!task)throw new HttpError(404,'NOT_FOUND','Task or workspace not found.');
      const messages=checked(await client.from('relay_messages').select('id,body,author_name,created_at').eq('task_id',id).order('sequence').limit(500));
      const events=checked(await client.from('relay_events').select('sequence,type,version,created_at').eq('task_id',id).order('sequence').limit(500));
      return {task,messages,events};
    },
    async command(access,command,key,body){return checked(await user(access).rpc('relay_task_command',{p_command:command,p_key:key,p_body:body}));},
    async session(hash){return checked(await admin.from('relay_sessions').select('*').eq('token_hash',hash).maybeSingle());},
    async saveSession(row){checked(await admin.from('relay_sessions').insert(row));},
    async touchSession(hash,seen){checked(await admin.from('relay_sessions').update({last_seen_at:seen}).eq('token_hash',hash));},
    async deleteSession(hash){checked(await admin.from('relay_sessions').delete().eq('token_hash',hash));},
    async deleteUserSessions(id){checked(await admin.from('relay_sessions').delete().eq('user_id',id));}
  };
}
module.exports={createProvider};
