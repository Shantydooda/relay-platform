'use strict';
function loadConfig(env=process.env) {
  const required=name=>{if(!env[name])throw new Error(`Missing ${name}`);return env[name];};
  const origin=new URL(required('RELAY_APP_ORIGIN'));
  const supabase=new URL(required('SUPABASE_URL'));
  if(origin.protocol!=='https:'||origin.pathname!=='/'||origin.search||origin.hash||origin.username||origin.password)throw new Error('RELAY_APP_ORIGIN must be an exact HTTPS origin');
  if(supabase.protocol!=='https:'||!supabase.hostname.endsWith('.supabase.co')||supabase.pathname!=='/'||supabase.search||supabase.hash||supabase.username||supabase.password)throw new Error('SUPABASE_URL must identify a hosted Supabase project');
  const encoded=required('RELAY_SESSION_KEY');
  const key=/^[a-f0-9]{64}$/i.test(encoded)?Buffer.from(encoded,'hex'):/^[A-Za-z0-9+/]{43}=$/.test(encoded)?Buffer.from(encoded,'base64'):null;
  if(!key||key.length!==32)throw new Error('RELAY_SESSION_KEY must encode 32 random bytes as hex or base64');
  return Object.freeze({origin:origin.origin,supabaseURL:supabase.origin,publishableKey:required('SUPABASE_PUBLISHABLE_KEY'),secretKey:required('SUPABASE_SECRET_KEY'),sessionKey:key});
}
module.exports={loadConfig};
