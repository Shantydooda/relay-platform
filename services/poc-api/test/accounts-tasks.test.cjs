'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const {tmpdir}=require('node:os');
const {randomUUID}=require('node:crypto');
const http=require('node:http');
const {openDatabase}=require('../src/database.cjs');
const {createStore}=require('../src/store.cjs');
const {createApp}=require('../src/app.cjs');
const password='a distinct test-only passphrase';
function httpRequest(url,{method='GET',headers={},body}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method,headers},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({response:{status:res.statusCode,headers:{get:name=>{const value=res.headers[name.toLowerCase()];return Array.isArray(value)?value.join(', '):value;}}},data:JSON.parse(Buffer.concat(chunks).toString())}));
    });
    req.on('error',reject);
    req.end(body);
  });
}

async function fixture(t,{file=':memory:',clock=Date.now}={}){
  const db=openDatabase(file),store=createStore(db,clock);
  t.after(()=>{if(db.isOpen)db.close();});
  const raw=await store.register({name:'Alex Buyer',email:'alex@example.test',password,workspace:'buyer'},'alice');
  const actor=store.principal(raw);
  const create=()=>store.createTask(actor,{tenantId:actor.memberships[0].id,title:'Company research',brief:'Find 20 companies with evidence.'},randomUUID());
  return {db,store,raw,actor,create};
}

test('registration hashes passwords, persists a membership and rotates/revokes sessions',async t=>{
  const {db,store,raw,actor}=await fixture(t);
  const user=db.prepare('SELECT * FROM users').get();
  assert.match(user.password_hash,/^scrypt\$131072\$8\$1\$/);
  assert.equal(user.password_hash.includes(password),false);
  assert.equal(actor.user.emailVerified,false);
  assert.equal(actor.memberships[0].role,'owner');
  assert.equal(db.prepare('SELECT token_hash FROM sessions').get().token_hash.includes(raw),false);
  const fresh=await store.login({email:'ALEX@example.test',password},'alice',raw);
  assert.notEqual(fresh,raw);
  assert.throws(()=>store.principal(raw),{code:'SIGN_IN_REQUIRED'});
  store.logout(store.principal(fresh));
  assert.throws(()=>store.principal(fresh),{code:'SIGN_IN_REQUIRED'});
});
test('no passwords silently truncated; invalid fields and wrong credentials are rejected',async t=>{
  const {store}=await fixture(t);
  await assert.rejects(store.register({name:'A',email:'b@example.test',password:'too short',workspace:'buyer'},'bob'),{code:'INVALID_PASSWORD'});
  await assert.rejects(store.register({name:'A',email:'b@example.test',password,workspace:'buyer',role:'admin'},'bob'),{code:'INVALID_FIELDS'});
  await assert.rejects(store.login({email:'alex@example.test',password:'incorrect'},'alice'),{code:'INVALID_CREDENTIALS'});
  await assert.rejects(store.login({email:'nobody@example.test',password:'incorrect'},'alice'),{code:'INVALID_CREDENTIALS'});
});
test('session idle and absolute expiration are enforced on the server',async t=>{
  let time=100000000;
  const {store,raw}=await fixture(t,{clock:()=>time});
  time+=30*60*1000;
  assert.throws(()=>store.principal(raw),{code:'SIGN_IN_REQUIRED'});
  const next=await store.login({email:'alex@example.test',password},'alice');
  for(let i=0;i<24;i++){time+=29*60*1000;store.principal(next);}
  time+=25*60*1000;
  assert.throws(()=>store.principal(next),{code:'SIGN_IN_REQUIRED'});
});
test('auth attempt limits survive creating a new store and reset with time',async t=>{
  let time=100000000;
  const {store,db}=await fixture(t,{clock:()=>time});
  for(let i=0;i<7;i++)await assert.rejects(store.login({email:'alex@example.test',password:'wrong'},'ip'),{code:'INVALID_CREDENTIALS'});
  await assert.rejects(createStore(db,()=>time).login({email:'alex@example.test',password},'ip'),{code:'AUTH_LIMIT'});
  time+=15*60*1000;
  assert.ok(await store.login({email:'alex@example.test',password},'ip'));
});
test('different accounts cannot list, read, change or message each other’s tasks',async t=>{
  const {store,actor,create}=await fixture(t);
  const id=create().taskId;
  const token=await store.register({name:'Blair Builder',email:'blair@example.test',password,workspace:'builder'},'blair');
  const other=store.principal(token);
  assert.deepEqual(store.list(other,other.memberships[0].id),[]);
  for(const operation of [()=>store.list(other,actor.memberships[0].id),()=>store.detail(other,id),()=>store.mutateTask(other,id,'messages',{expectedVersion:1,body:'unauthorized'},randomUUID()),()=>store.mutateTask(other,id,'post',{expectedVersion:1},randomUUID()),()=>store.createTask(other,{tenantId:actor.memberships[0].id,title:'forged',brief:'forged'},randomUUID())])assert.throws(operation,{code:'NOT_FOUND'});
});
test('task creation and message retries are durable and idempotent; keys cannot change meaning',async t=>{
  const {store,actor,db}=await fixture(t);
  const body={tenantId:actor.memberships[0].id,title:'Task',brief:'A useful brief'},key=randomUUID();
  const first=store.createTask(actor,body,key);
  assert.deepEqual(createStore(db).createTask(actor,body,key),first);
  assert.equal(store.list(actor,body.tenantId).length,1);
  assert.throws(()=>store.createTask(actor,{...body,title:'Changed'},key),{code:'IDEMPOTENCY_CONFLICT'});
  const message={expectedVersion:1,body:'Include websites.'},messageKey=randomUUID();
  const result=store.mutateTask(actor,first.taskId,'messages',message,messageKey);
  assert.deepEqual(store.mutateTask(actor,first.taskId,'messages',message,messageKey),result);
  assert.equal(store.detail(actor,first.taskId).messages.length,2);
  assert.equal(store.detail(actor,first.taskId).events.length,2);
});
test('task transitions are explicit; stale sessions cannot overwrite newer changes',async t=>{
  const {store,actor,create}=await fixture(t),id=create().taskId;
  store.mutateTask(actor,id,'edit',{expectedVersion:1,title:'Updated task',brief:'Updated brief'},randomUUID());
  assert.throws(()=>store.mutateTask(actor,id,'post',{expectedVersion:1},randomUUID()),{code:'VERSION_CONFLICT'});
  store.mutateTask(actor,id,'post',{expectedVersion:2},randomUUID());
  assert.throws(()=>store.mutateTask(actor,id,'edit',{expectedVersion:3,title:'Changed',brief:'Changed'},randomUUID()),{code:'INVALID_TRANSITION'});
  assert.throws(()=>store.mutateTask(actor,id,'post',{expectedVersion:3},randomUUID()),{code:'INVALID_TRANSITION'});
  store.mutateTask(actor,id,'cancel',{expectedVersion:3},randomUUID());
  assert.throws(()=>store.mutateTask(actor,id,'messages',{expectedVersion:4,body:'after close'},randomUUID()),{code:'TASK_CLOSED'});
  assert.deepEqual(store.detail(actor,id).events.map(e=>e.type),['task.created','task.edited','task.posted','task.cancelled']);
});
test('bad task input rolls back all writes and does not consume the retry key',async t=>{
  const {store,actor,create}=await fixture(t),id=create().taskId,key=randomUUID();
  assert.throws(()=>store.mutateTask(actor,id,'messages',{expectedVersion:1,body:'  '},key),{code:'INVALID_INPUT'});
  assert.equal(store.detail(actor,id).task.version,1);
  assert.equal(store.detail(actor,id).messages.length,1);
  assert.ok(store.mutateTask(actor,id,'messages',{expectedVersion:1,body:'Valid context'},key));
});
test('workspace switching changes preference, never task ownership or account identity',async t=>{
  const {store,actor,raw,create}=await fixture(t),id=create().taskId;
  store.workspace(actor,{workspace:'builder'});
  const fresh=store.principal(raw);
  assert.equal(fresh.user.id,actor.user.id);
  assert.equal(fresh.user.workspace,'builder');
  assert.equal(store.detail(fresh,id).task.id,id);
  assert.throws(()=>store.workspace(actor,{workspace:'admin'}),{code:'INVALID_WORKSPACE'});
});
test('disk storage restores account, session, task, message, event and retry record after restart',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'relay-poc-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'test.sqlite');
  const {db,store,raw,actor}=await fixture(t,{file});
  const body={tenantId:actor.memberships[0].id,title:'Persistent task',brief:'Retain after restart'},key=randomUUID();
  const original=store.createTask(actor,body,key);
  store.mutateTask(actor,original.taskId,'messages',{expectedVersion:1,body:'Also keep this note.'},randomUUID());
  db.close();
  const restored=openDatabase(file);t.after(()=>restored.close());
  const next=createStore(restored),session=next.principal(raw);
  assert.equal(next.detail(session,original.taskId).messages.length,2);
  assert.equal(next.detail(session,original.taskId).events.length,2);
  assert.equal(next.detail(session,original.taskId).task.version,2);
  assert.deepEqual(next.createTask(session,body,key),original);
});

test('HTTP integration: registration, session cookie, CSRF, scope checks and input controls',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  // A dynamically assigned loopback port keeps tests isolated from the running POC.
  const server=createApp({db,origin:'http://127.0.0.1:4180',logger:{error:()=>assert.fail('Unexpected server error')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base=`http://127.0.0.1:${server.address().port}`;
  let cookie,csrf;
  const request=async(path,{method='GET',body,headers={}}={})=>{
    return httpRequest(base+path,{method,headers:{Host:'127.0.0.1:4180',...(method!=='GET'?{Origin:'http://127.0.0.1:4180'}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...headers},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})});
  };
  assert.equal((await request('/api/tasks')).response.status,401);
  const registered=await request('/api/auth/register',{method:'POST',body:{name:'Casey',email:'casey@example.test',password,workspace:'buyer'}});
  assert.equal(registered.response.status,201);
  assert.match(registered.response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  cookie=registered.response.headers.get('set-cookie').split(';')[0];csrf=registered.data.csrf;
  const tenantId=registered.data.memberships[0].id;
  assert.equal(registered.response.headers.get('cache-control'),'no-store');
  assert.match(registered.response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const body={tenantId,title:'HTTP task',brief:'This is stored by the real API.'};
  assert.equal((await request('/api/tasks',{method:'POST',body,headers:{'X-CSRF-Token':'wrong'}})).response.status,403);
  assert.equal((await request('/api/tasks',{method:'POST',body,headers:{Origin:'https://evil.example'}})).response.status,403);
  assert.equal((await request('/api/me',{headers:{Host:'evil.example'}})).response.status,403);
  assert.equal((await request('/api/tasks',{method:'POST',body})).data.error.code,'IDEMPOTENCY_REQUIRED');
  assert.equal((await request('/api/tasks',{method:'POST',body:'{'})).response.status,400);
  assert.equal((await request('/api/tasks',{method:'POST',body:{brief:'x'.repeat(33000)}})).response.status,413);
  assert.equal((await request('/api/tasks',{method:'POST',body,headers:{'Content-Type':'text/plain'}})).response.status,415);
  assert.equal((await request('/api/tasks',{method:'POST',body:{...body,created_by:'forged'},headers:{'Idempotency-Key':randomUUID()}})).response.status,400);
  const created=await request('/api/tasks',{method:'POST',body,headers:{'Idempotency-Key':randomUUID()}});
  assert.equal(created.response.status,201);
  assert.equal((await request(`/api/tasks/${created.data.taskId}`)).data.task.title,'HTTP task');
  const raced=await Promise.all(['First','Second'].map(context=>request(`/api/tasks/${created.data.taskId}/messages`,{method:'POST',body:{expectedVersion:1,body:context},headers:{'Idempotency-Key':randomUUID()}})));
  assert.deepEqual(raced.map(result=>result.response.status).sort(),[200,409]);
  assert.equal((await request(`/api/tasks/${created.data.taskId}`)).data.messages.length,2);
  await request('/api/auth/logout',{method:'POST',body:{}});
  assert.equal((await request('/api/me')).response.status,401);
});

test('roles are server-owned and approvers cannot mutate task storage',async t=>{
  const {db,store,actor,raw,create}=await fixture(t),id=create().taskId;
  db.prepare("UPDATE memberships SET role='approver' WHERE user_id=?").run(actor.user.id);
  const approver=store.principal(raw);
  assert.equal(store.detail(approver,id).task.id,id);
  assert.throws(()=>store.mutateTask(approver,id,'post',{expectedVersion:1},randomUUID()),{code:'FORBIDDEN'});
  assert.throws(()=>store.createTask(approver,{tenantId:actor.memberships[0].id,title:'Forged role',brief:'Cannot create'},randomUUID()),{code:'FORBIDDEN'});
  assert.equal(store.detail(approver,id).task.status,'draft');
});

test('user text is data and cannot mass-assign state',async t=>{
  const {store,actor,create}=await fixture(t);
  const result=store.createTask(actor,{tenantId:actor.memberships[0].id,title:'<script>alert(1)</script>',brief:'<img src=x onerror=alert(1)>'},randomUUID());
  assert.equal(store.detail(actor,result.taskId).task.title,'<script>alert(1)</script>');
  assert.throws(()=>store.createTask(actor,{tenantId:actor.memberships[0].id,title:'Task',brief:'Brief',status:'paid'},randomUUID()),{code:'INVALID_FIELDS'});
  const id=create().taskId;
  assert.throws(()=>store.mutateTask(actor,id,'post',{expectedVersion:1,tenantId:'forged'},randomUUID()),{code:'INVALID_FIELDS'});
});

test('HTTPS configuration sets Secure cookie and HSTS headers',async t=>{
  const db=openDatabase(':memory:');t.after(()=>db.close());
  const server=createApp({db,origin:'https://relay.example'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const result=await httpRequest(`http://127.0.0.1:${server.address().port}/api/auth/register`,{method:'POST',headers:{Host:'relay.example',Origin:'https://relay.example','Content-Type':'application/json'},body:JSON.stringify({name:'Casey',email:'casey@example.test',password,workspace:'buyer'})});
  assert.equal(result.response.status,201);
  assert.match(result.response.headers.get('set-cookie'),/; Secure/);
  assert.match(result.response.headers.get('set-cookie'),/^__Host-/);
  assert.equal(result.response.headers.get('strict-transport-security'),'max-age=31536000');
});
