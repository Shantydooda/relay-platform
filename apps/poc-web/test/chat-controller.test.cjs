'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../public/chat-controller.js');
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function fixture(){
 const state={account:{user:{id:'buyer',workspace:'buyer'},memberships:[{id:'team'}]},tenantId:'team',authMode:'local',prompt:'Find companies',preferredAgent:null,messageDrafts:{},detail:{task:{id:'old',version:1,status:'posted'}},features:{scoping:true}};
 const location={hash:'#chat=old'}, calls=[], pending=deferred();
 const dependencies={state,location,revision:()=>0,render(){},refreshedFields:['account','detail'],
  command:async(...args)=>{calls.push(args);return pending.promise;},
  refresh:async(id,candidate)=>{candidate.account={...state.account};candidate.detail={task:{id,version:2,status:'draft'}};}};
 return {state,location,calls,pending,dependencies,controller:()=>create(dependencies)};
}
for(const kind of ['request','message'])for(const change of ['task','workspace','session','route'])test(`${kind}: late success cannot overwrite changed ${change}`,async()=>{
 const f=fixture(), op=f.controller()[kind]('Hello');
 if(change==='task')f.state.detail={task:{id:'another',version:1}};
 if(change==='workspace')f.state.tenantId='another-team';
 if(change==='session')f.state.account={user:{id:'other',workspace:'buyer'}};
 if(change==='route')f.location.hash='#tasks';
 const expected=f.location.hash, detail=f.state.detail;
 f.pending.resolve({taskId:'new'});await op;
 assert.equal(f.location.hash,expected);assert.equal(f.state.detail,detail);
 assert.equal(f.calls.length,1,'no follow-up assist after navigation');
});
test('request success follows the created conversation and scopes only that task',async()=>{
 const f=fixture();f.dependencies.command=async(...args)=>{f.calls.push(args);return {taskId:'new'};};
 await f.controller().request();
 assert.equal(f.location.hash,'chat=new');assert.equal(f.state.detail.task.id,'new');assert.equal(f.state.prompt,'');
 assert.equal(f.calls[1][0],'/api/tasks/new/assist');assert.equal(f.state.sendingRequest,null);
});
for(const phase of ['command','refresh'])test(`newer request draft survives ${phase}`,async()=>{
 const f=fixture();
 if(phase==='refresh')f.dependencies.refresh=async(id,candidate)=>{f.state.prompt='New draft';candidate.detail={task:{id}};};
 const op=f.controller().request();
 if(phase==='command')f.state.prompt='New draft';
 f.pending.resolve({taskId:'new'});await op;
 assert.equal(f.state.prompt,'New draft');assert.equal(f.location.hash,'#chat=old');assert.equal(f.state.detail.task.id,'old');
});
test('message refresh is isolated and keeps newer typing',async()=>{
 const f=fixture();const op=f.controller().message('Sent message');f.state.messageDrafts.old='Next message';
 f.pending.resolve({});await op;
 assert.equal(f.state.messageDrafts.old,'Next message');assert.equal(f.state.detail.task.id,'old');assert.equal(f.state.sendingMessage,null);
});
test('navigation during message refresh discards the fetched conversation',async()=>{
 const f=fixture(), gate=deferred();f.dependencies.command=async()=>({});
 f.dependencies.refresh=async(id,candidate)=>{await gate.promise;candidate.detail={task:{id:'old'}};};
 const op=f.controller().message('Hello');await Promise.resolve();
 f.state.detail={task:{id:'other'}};f.location.hash='#chat=other';gate.resolve();await op;
 assert.equal(f.state.detail.task.id,'other');
});
for(const kind of ['request','message'])test(`${kind}: connection uncertainty preserves draft and never retries automatically`,async()=>{
 const f=fixture();const op=f.controller()[kind]('Hello');f.pending.reject(new Error('Disconnected'));
 await assert.rejects(op,/Disconnected/);assert.equal(f.calls.length,1);
 assert.equal(kind==='request'?f.state.prompt:f.state.messageDrafts.old,kind==='request'?'Find companies':'Hello');
});
test('late authentication error is ignored after account replacement',async()=>{
 const f=fixture();const op=f.controller().message('Hello');f.state.account={user:{id:'replacement'}};
 f.pending.reject(Object.assign(new Error('Old auth'),{status:401}));await op;
 assert.equal(f.state.account.user.id,'replacement');
});

for (const [action,path,extra] of [
 ['analyze-brief','assist',{}],
 ['read-chat-context','assist',{useContext:true}],
 ['confirm-scope','confirm-scope',{proposalId:'proposal'}],
 ['cancel-reply','cancel-reply',{jobId:'proposal'}]
]) {
 test(`${action}: binds the exact task, version and proposal`,async()=>{
  const f=fixture();f.state.detail.task.scoping={id:'proposal'};
  const op=f.controller().scope(action);f.pending.resolve({});await op;
  assert.deepEqual(f.calls,[['/api/tasks/old/'+path,'POST',{expectedVersion:1,...extra}]]);
  assert.equal(f.state.detail.task.id,'old');assert.equal(f.state.sendingScope,null);
 });
 test(`${action}: late response cannot refresh the newly opened task`,async()=>{
  const f=fixture();f.state.detail.task.scoping={id:'proposal'};
  const op=f.controller().scope(action);f.state.detail={task:{id:'second',version:9}};f.location.hash='#chat=second';
  f.pending.resolve({});await op;
  assert.equal(f.state.detail.task.id,'second');assert.equal(f.state.detail.task.version,9);
  assert.equal(f.calls.length,1);assert.equal(f.state.sendingScope,null);
 });
}
test('scope uncertainty stays visible in the same conversation without a second command',async()=>{
 const f=fixture();const op=f.controller().scope('analyze-brief');f.pending.reject(new Error('Unknown outcome'));
 await assert.rejects(op,/Unknown outcome/);assert.equal(f.calls.length,1);assert.equal(f.state.sendingScope,null);
});
test('old scope cleanup cannot clear a replacement operation',async()=>{
 const f=fixture();const op=f.controller().scope('analyze-brief');
 f.state.sendingScopeToken={};f.state.sendingScope='read-chat-context';
 f.pending.resolve({});await op;assert.equal(f.state.sendingScope,'read-chat-context');
});

for(const kind of ['edit','upload']) {
 test(`${kind}: preserves the mounted form on uncertainty`,async()=>{
  const f=fixture();let renders=0;f.dependencies.render=()=>renders++;f.state.editing=true;
  const op=kind==='edit'?f.controller().edit({title:'New title',brief:'New brief'}):f.controller().upload({name:'source.csv'},'Notes',async()=> 'YQ==');
  await Promise.resolve();f.pending.reject(new Error('Unknown outcome'));
  await assert.rejects(op,/Unknown outcome/);
  assert.equal(renders,0);assert.equal(f.state.editing,true);assert.equal(f.calls.length,1);
 });
 test(`${kind}: success refreshes only the original task`,async()=>{
  const f=fixture();f.state.editing=true;
  const op=kind==='edit'?f.controller().edit({title:'New title',brief:'New brief'}):f.controller().upload({name:'source.csv'},'Notes',async()=> 'YQ==');
  await Promise.resolve();f.pending.resolve({});assert.equal(await op,true);
  assert.equal(f.calls[0][0],`/api/tasks/old/${kind==='edit'?'scope':'input'}`);
  assert.equal(f.calls[0][2].expectedVersion,1);
  assert.equal(f.state.detail.task.id,'old');
  if(kind==='edit')assert.equal(f.state.editing,false);
 });
 test(`${kind}: changed form during refresh is not overwritten`,async()=>{
  const f=fixture();let same=true,renders=0;f.state.editing=true;
  f.dependencies.render=()=>renders++;
  f.dependencies.refresh=async(id,candidate)=>{same=false;candidate.detail={task:{id:'old',version:999}};};
  const op=kind==='edit'?f.controller().edit({title:'New title',brief:'New brief'},()=>same):f.controller().upload({name:'source.csv'},'Notes',async()=> 'YQ==',()=>same);
  await Promise.resolve();f.pending.resolve({});assert.equal(await op,false);
  assert.equal(f.state.detail.task.version,1);assert.equal(f.state.editing,true);assert.equal(renders,0);
 });
 test(`${kind}: navigation during command cannot affect the new task`,async()=>{
  const f=fixture();const op=kind==='edit'?f.controller().edit({title:'New',brief:'Brief'}):f.controller().upload({name:'source.csv'},'Notes',async()=> 'YQ==');
  await Promise.resolve();f.state.detail={task:{id:'second',version:7}};f.location.hash='#task=second';
  f.pending.resolve({});assert.equal(await op,false);assert.equal(f.state.detail.task.id,'second');
 });
}
for(const change of ['file','task','account'])test(`upload does not start after ${change} changes during local file reading`,async()=>{
 const f=fixture(), read=deferred();let same=true;
 const op=f.controller().upload({name:'source.csv'},'Original notes',()=>read.promise,()=>same);
 if(change==='file')same=false;
 if(change==='task')f.state.detail={task:{id:'second'}};
 if(change==='account')f.state.account={user:{id:'second'}};
 read.resolve('YQ==');assert.equal(await op,false);assert.equal(f.calls.length,0);
});
test('file read failure leaves the form available and makes no upload request',async()=>{
 const f=fixture();let renders=0;f.dependencies.render=()=>renders++;
 await assert.rejects(f.controller().upload({name:'source.csv'},'Notes',async()=>{throw new Error('Unreadable');}),/Unreadable/);
 assert.equal(f.calls.length,0);assert.equal(renders,0);assert.equal(f.state.uploadingInput,null);
});
