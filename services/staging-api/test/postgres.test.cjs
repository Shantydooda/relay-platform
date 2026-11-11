'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const SA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function fixture(t){
  const db=await PGlite.create();t.after(()=>db.close());
  // Test-only stand-ins for provider-owned auth tables/functions. The actual
  // migration below is executed unmodified, including real Postgres RLS/grants.
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create role supabase_auth_admin;
    create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    grant usage on schema auth to authenticated;grant execute on function auth.uid(),auth.jwt() to authenticated;`);
  await db.exec(readFileSync(resolve(__dirname,'../../../supabase/migrations/202610270001_accounts_tasks.sql'),'utf8'));
  await db.exec(readFileSync(resolve(__dirname,'../../../supabase/migrations/202611010001_membership_changes.sql'),'utf8'));
  await db.query('insert into auth.users values ($1,$2,now()),($3,$4,now())',[A,'a@example.test',B,'b@example.test']);
  await db.query('insert into auth.sessions values ($1,$2),($3,$4)',[SA,A,SB,B]);
  await db.query('insert into public.relay_invites(email) values ($1),($2)',['a@example.test','b@example.test']);
  async function asUser(id=A,session=id===A?SA:SB){
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,session_id:session})]);
    await db.exec('set role authenticated');
  }
  async function bootstrap(id=A){await asUser(id);await db.query('select public.relay_bootstrap($1,$2)',['Test member','buyer']);return (await db.query('select id from public.relay_tenants')).rows[0].id;}
  async function command(kind,body,key=randomUUID()){return (await db.query('select public.relay_task_command($1,$2,$3) as result',[kind,key,body])).rows[0].result;}
  return {db,asUser,bootstrap,command};
}
test('migration denies anonymous reads, direct writes and hook execution',async t=>{
  const {db}=await fixture(t);await db.exec('set role anon');
  for(const table of ['relay_profiles','relay_tasks','relay_sessions','relay_invites','relay_idempotency'])await assert.rejects(db.query(`select * from public.${table}`),{code:'42501'});
  await assert.rejects(db.query("select public.relay_before_user_created('{}')"),{code:'42501'});
  await assert.rejects(db.query("select public.relay_bootstrap('Anon','buyer')"),{code:'42501'});
});
test('verified active identity bootstraps once; clients cannot self-assign membership',async t=>{
  const {db,bootstrap}=await fixture(t);const tenant=await bootstrap();
  await db.query("select public.relay_bootstrap('Changed name','builder')");
  assert.equal((await db.query('select count(*)::int as n from public.relay_tenants')).rows[0].n,1);
  assert.equal((await db.query('select workspace from public.relay_profiles')).rows[0].workspace,'buyer');
  assert.equal((await db.query('select role from public.relay_memberships')).rows[0].role,'owner');
  await assert.rejects(db.query('insert into public.relay_memberships values ($1,$2,$3)',[B,tenant,'owner']),{code:'42501'});
  await assert.rejects(db.query("update public.relay_profiles set workspace='builder'"),{code:'42501'});
  await assert.rejects(db.query("select public.relay_set_workspace('admin')"),/INVALID_INPUT/);
});
test('database RLS hides foreign tasks/messages/events and RPC cannot act on foreign IDs',async t=>{
  const {db,asUser,bootstrap,command}=await fixture(t),tenantA=await bootstrap();
  const task=await command('create',{tenantId:tenantA,title:'Private task',brief:'Private context'});
  await bootstrap(B);
  assert.equal((await db.query('select count(*)::int as n from public.relay_tasks')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.relay_messages')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int as n from public.relay_events')).rows[0].n,0);
  await assert.rejects(command('create',{tenantId:tenantA,title:'Forged tenant',brief:'Not allowed'}),/ACCESS_DENIED/);
  await assert.rejects(command('post',{taskId:task.taskId,expectedVersion:1}),/NOT_FOUND/);
  await assert.rejects(command('message',{taskId:task.taskId,expectedVersion:1,body:'Not allowed'}),/NOT_FOUND/);
  await asUser(A);assert.equal((await db.query('select title from public.relay_tasks')).rows[0].title,'Private task');
});
test('invitation revocation, unverified email and provider-session logout immediately block data',async t=>{
  const {db,bootstrap,asUser,command}=await fixture(t),tenant=await bootstrap();
  await command('create',{tenantId:tenant,title:'Task',brief:'Brief'});
  await db.exec("reset role;update public.relay_invites set active=false where email='a@example.test'");
  await asUser();assert.equal((await db.query('select public.relay_eligible() as yes')).rows[0].yes,false);
  assert.equal((await db.query('select count(*)::int as n from public.relay_tasks')).rows[0].n,0);
  await assert.rejects(command('create',{tenantId:tenant,title:'Task',brief:'Brief'}),/ACCESS_DENIED/);
  await db.exec("reset role;update public.relay_invites set active=true;update auth.users set email_confirmed_at=null");
  await asUser();assert.equal((await db.query('select public.relay_eligible() as yes')).rows[0].yes,false);
  await db.exec('reset role;update auth.users set email_confirmed_at=now();delete from auth.sessions');
  await asUser();assert.equal((await db.query('select public.relay_eligible() as yes')).rows[0].yes,false);
});
test('task RPC binds idempotency to actor and canonical request, enforces versions and preserves audit',async t=>{
  const {db,bootstrap,command}=await fixture(t),tenant=await bootstrap(),key=randomUUID();
  const body={tenantId:tenant,title:'Task',brief:'Brief'},task=await command('create',body,key);
  assert.deepEqual(await command('create',{brief:'Brief',title:'Task',tenantId:tenant},key),task);
  await assert.rejects(command('create',{...body,title:'Changed'},key),/IDEMPOTENCY_CONFLICT/);
  const noteKey=randomUUID(),note={taskId:task.taskId,expectedVersion:1,body:'Context'};
  assert.equal((await command('message',note,noteKey)).version,2);
  assert.equal((await command('message',note,noteKey)).version,2);
  await assert.rejects(command('post',{taskId:task.taskId,expectedVersion:1}),/VERSION_CONFLICT/);
  assert.equal((await command('post',{taskId:task.taskId,expectedVersion:2})).version,3);
  await assert.rejects(command('edit',{taskId:task.taskId,expectedVersion:3,title:'Changed',brief:'Changed'}),/INVALID_TRANSITION/);
  assert.equal((await command('cancel',{taskId:task.taskId,expectedVersion:3})).version,4);
  await assert.rejects(command('message',{taskId:task.taskId,expectedVersion:4,body:'Closed'}),/TASK_CLOSED/);
  assert.equal((await db.query('select count(*)::int as n from public.relay_messages')).rows[0].n,2);
  assert.deepEqual((await db.query('select type from public.relay_events order by sequence')).rows.map(row=>row.type),['task.created','message.added','task.posted','task.cancelled']);
});
test('SQL rejects forged status, null commands and bad messages without consuming retry keys',async t=>{
  const {db,bootstrap,command}=await fixture(t),tenant=await bootstrap();
  await assert.rejects(command('create',{tenantId:tenant,title:'Task',brief:'Brief',status:'paid'}),/INVALID_INPUT/);
  const task=await command('create',{tenantId:tenant,title:'Task',brief:'Brief'}),key=randomUUID();
  await assert.rejects(command(null,{taskId:task.taskId,expectedVersion:1}),/INVALID_INPUT/);
  await assert.rejects(command('message',{taskId:task.taskId,expectedVersion:1,body:' '},key),/INVALID_INPUT/);
  assert.equal((await db.query('select version from public.relay_tasks')).rows[0].version,1);
  assert.equal((await command('message',{taskId:task.taskId,expectedVersion:1,body:'Valid context'},key)).version,2);
  await db.exec("reset role;update public.relay_memberships set role='approver'");
  await db.exec('set role authenticated');
  await assert.rejects(command('post',{taskId:task.taskId,expectedVersion:2}),/ACCESS_DENIED/);
});
test('provider signup hook enforces the same invitation list with no public execute grant',async t=>{
  const {db}=await fixture(t);await db.exec('set role supabase_auth_admin');
  const run=email=>db.query('select public.relay_before_user_created($1) as result',[{user:{email}}]);
  assert.deepEqual((await run('a@example.test')).rows[0].result,{});
  assert.equal((await run('uninvited@example.test')).rows[0].result.error.http_code,403);
});
