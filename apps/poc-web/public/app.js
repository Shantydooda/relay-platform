'use strict';
const root=document.querySelector('#app');
const notice=document.querySelector('#notice');
const state={account:null,tasks:[],detail:null,auth:null,intent:null,prompt:'',editing:false,busy:false,motionPaused:false,authMode:'local',confirmation:null,email:'',emailAction:'resend'};
const retries=new Map();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const examples=['Find 20 UK SaaS companies with websites and source links. Deliver a CSV.','Create a 30-second launch video for my product.','Build a landing page for my new business.'];
class ApiError extends Error { constructor(message,status,code){super(message);this.status=status;this.code=code;} }
async function api(path,{method='GET',body,key}={}) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try {
    const res=await fetch(path,{method,credentials:'same-origin',signal:controller.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(state.account?.csrf?{'X-CSRF-Token':state.account.csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await res.json();
    if(!res.ok)throw new ApiError(data.error?.message||'The request failed.',res.status,data.error?.code);
    return data;
  } catch(error) {
    if(error instanceof ApiError)throw error;
    throw new Error('Connection interrupted. Your text is still here. Try again; the same request will not create a duplicate.');
  } finally {clearTimeout(timeout);}
}
async function command(path,method,body) {
  const signature=JSON.stringify([path,method,body]);
  if(!retries.has(signature)) retries.set(signature,crypto.randomUUID());
  try {const result=await api(path,{method,body,key:retries.get(signature)});retries.delete(signature);return result;}
  catch(error){if(error.status&&error.status<500)retries.delete(signature);throw error;}
}
function header(){return `<header class="topbar"><button class="brand" data-action="home" aria-label="Relay home">relay</button><div class="top-actions">${state.account?`<span class="identity">${escape(state.account.user.name)}</span>${state.account.recoveryRequired?'':`<button class="workspace-toggle" data-action="switch">Switch to ${state.account.user.workspace==='buyer'?'builder':'buyer'}</button>`}<button class="quiet" data-action="logout">Sign out</button>`:`<button class="quiet" data-action="builder">For builders</button><button class="quiet" data-action="login">Log in</button><button class="primary" data-action="signup">Get started</button>`}</div></header>`;}
function composer(id,placeholder,button,value='',hint='Your task stays in this conversation.') {return `<form class="composer" id="${id}"><label class="eyebrow" for="${id}-text">${id==='message'?'Add context':'What do you need done?'}</label><textarea id="${id}-text" name="brief" placeholder="${placeholder}" maxlength="10000" required>${escape(value)}</textarea><div class="composer-foot"><small>${hint}</small><button class="primary" type="submit">${button}</button></div><div class="form-error" role="alert"></div></form>`;}
function exampleButtons(){return `<div class="examples">${examples.map((_,i)=>`<button data-action="example" data-example="${i}">${['Find company leads','Create a launch video','Build a website'][i]}</button>`).join('')}</div>`;}
function landing(){return RelayLanding.render({prompt:state.prompt,paused:state.motionPaused});}
function authView(){if(['email-sent','recover','confirm','reset'].includes(state.auth))return managedAuthView();const signup=state.auth==='signup',intent=state.intent;return `<main class="auth-wrap"><div class="auth-card"><span class="eyebrow">${intent==='builder'?'Builder workspace':intent==='buyer'?'Buyer workspace':'One Relay account'}</span><h1>${signup?'Make room for more.':'Welcome back.'}</h1><p class="muted">${state.prompt?'Your request is ready. Sign in to save it as a draft.':signup?'Create your account to start using Relay.':'Your workspace and saved tasks are waiting.'}</p><form id="auth">${signup?'<label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="80" required>':''}<label for="email">Email</label><input id="email" type="email" name="email" autocomplete="email" maxlength="254" required><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="${signup?'new-password':'current-password'}" ${signup?'minlength="15" maxlength="128"':''} required>${signup?'<p class="hint">15–128 characters. A few memorable words work well.</p>':''}${signup&&!intent?'<fieldset><legend>What brings you to Relay?</legend><div class="roles"><label><input type="radio" name="workspace" value="buyer" required>Get work done</label><label><input type="radio" name="workspace" value="builder" required>Connect agents</label></div></fieldset>':''}${!signup&&state.authMode==='managed'?'<button class="quiet" type="button" data-action="recover">Forgot password?</button>':''}<div class="form-error" role="alert"></div><button class="primary" type="submit">${signup?'Create account':'Log in'}</button></form><p class="switch-auth">${signup?'Already have an account?':'New to Relay?'} <button class="quiet" data-action="${signup?'login':'signup'}">${signup?'Log in':'Create account'}</button></p><p class="auth-note">${state.authMode==='managed'?'Private staging. Registration requires an invitation and a verified email address. Use test information only.':'Local POC. Passwords and tasks are real and stay on this machine. Email verification and password recovery are not connected yet. Use test information only.'}</p></div><button class="quiet" data-action="home">Back to Relay</button></main>`;}
function sidebar(){return `<aside class="sidebar"><div class="workspace-name">${state.account.user.workspace==='buyer'?'Buyer workspace':'Builder workspace'}</div>${state.account.user.workspace==='buyer'?`<button class="primary" data-action="new">New task</button><p class="side-heading">Your tasks · ${state.tasks.length}</p><nav id="task-list" aria-label="Your tasks">${state.tasks.map(task=>`<button class="task-item ${state.detail?.task.id===task.id?'active':''}" data-action="task" data-id="${task.id}">${escape(task.title)}<small>${escape(task.status)} · ${date(task.updatedAt)}</small></button>`).join('')}</nav>${!state.tasks.length?'<p class="sidebar-note">Your first task will appear here.</p>':''}`:'<p class="sidebar-note">Agent setup and supplier connections are next. Buyer tasks stay in the buyer workspace.</p>'}<p class="sidebar-note">${escape(state.account.user.email)}<br>${state.account.user.emailVerified?'Email verified':'Email not yet verified'}</p></aside>`;}
function newTask(){return `<div class="canvas-center"><span class="eyebrow">Your next task</span><h1>What can we take<br>off your plate?</h1><p class="muted">Start with the result you want. We’ll save your brief as a draft so you can review it before posting.</p>${composer('request','I need…','Save draft',state.prompt,'Saved privately in your workspace. Nothing runs yet.')}${exampleButtons()}<div class="connection-note"><span class="live-dot"></span>Connected to your ${state.authMode==='managed'?'staging':'local'} task database</div></div>`;}
function taskView(){const {task,messages,events}=state.detail;
  const labels={'task.created':'Draft saved','task.edited':'Brief updated','task.posted':'Task posted','task.cancelled':'Task cancelled','message.added':'Context added'};
  return `<section><div class="section-heading"><div><span class="eyebrow">Your task</span><h1>${escape(task.title)}</h1><p>Saved ${date(task.updatedAt)} · Version ${task.version}</p></div><span class="tag ${task.status}">${task.status==='posted'?'Posted':task.status==='draft'?'Draft':'Cancelled'}</span></div><div class="task-grid"><div class="thread">${state.editing?`<form id="edit" class="panel editor"><h3>Edit your brief</h3><label for="title">Task title</label><input id="title" name="title" value="${escape(task.title)}" maxlength="120" required><label for="brief">What do you need?</label><textarea id="brief" name="brief" maxlength="10000" required>${escape(task.brief)}</textarea><div class="form-error" role="alert"></div><div class="inline-actions"><button class="primary" type="submit">Save changes</button><button type="button" data-action="stop-edit">Cancel edit</button></div></form>`:`<article class="message"><div class="message-meta"><strong>Task brief</strong><span>${date(task.createdAt)}</span></div><p>${escape(task.brief)}</p></article>${messages.filter((m,i)=>i>0).map(m=>`<article class="message"><div class="message-meta"><strong>${escape(m.authorName)}</strong><span>${date(m.createdAt)}</span></div><p>${escape(m.body)}</p></article>`).join('')}`}${task.status!=='cancelled'&&!state.editing?composer('message','Add details, links or instructions…','Send','','Saved context only. An agent is not connected yet.') : ''}</div><aside class="task-context"><div class="panel"><h3>${task.status==='draft'?'Ready to post?':task.status==='posted'?'Your request is saved.':'Task closed.'}</h3><p>${task.status==='draft'?'Review your brief, then post it. Agent bidding is not connected in this release.':task.status==='posted'?'Posting is real, but no supplier receives this task yet. We’ll connect the supplier lifecycle in the next slice.':'Your brief, context and activity remain available for reference.'}</p>${task.status==='draft'?'<button class="primary" data-action="post">Post task</button><button class="quiet" data-action="edit">Edit brief</button>':''}${task.status!=='cancelled'?'<button class="quiet danger" data-action="cancel">Cancel task</button>':''}<div class="form-error" role="alert"></div></div><div class="panel"><h3>Task activity</h3><ol class="steps">${events.map(event=>`<li>${labels[event.type]||escape(event.type)}<small>${date(event.createdAt)}</small></li>`).join('')}</ol><button class="quiet" data-action="refresh">Refresh task</button></div></aside></div></section>`;}
function builder(){return `<div class="canvas-center"><span class="eyebrow">Builder workspace</span><h1>A home for your agents.</h1><p class="muted">Your builder account is ready. Supplier onboarding will connect here once the real task lifecycle is in place.</p><div class="builder-cards"><div class="panel"><h3>Agents</h3><p class="number">0</p><p>Registration and connection testing are not available in this release.</p></div><div class="panel"><h3>Active work</h3><p class="number">0</p><p>No agent execution or simulated assignments.</p></div><div class="panel"><h3>Payouts</h3><p class="number">—</p><p>Payment and payout providers are not connected.</p></div></div><div class="empty-box"><h3>One account. Separate workspaces.</h3><p class="muted">You can request a task from your buyer workspace. Your account and session stay the same.</p><button data-action="switch">Go to buyer workspace</button></div></div>`;}
function render(){root.innerHTML=!state.account&&!state.auth?landing():header()+(state.auth?authView():`<div class="layout">${sidebar()}<main class="canvas">${state.account.user.workspace==='builder'?builder():state.detail?taskView():newTask()}</main></div>`);}
function showError(error,form){
  if(error.status===401&&state.account){state.account=null;state.tasks=[];state.detail=null;state.auth='login';render();}
  const target=form?.isConnected?form.querySelector('.form-error,.error'):null;
  if(target){target.textContent=error.message;target.classList.add('error');}else{notice.textContent=error.message;}
}
async function refresh(id=state.detail?.task.id){
  state.account=await api('/api/me');
  if(state.account.recoveryRequired){state.auth='reset';state.tasks=[];state.detail=null;return;}
  const tenant=state.account.memberships[0];
  state.tasks=tenant?(await api(`/api/tasks?tenantId=${encodeURIComponent(tenant.id)}`)).tasks:[];
  if(id)state.detail=await api(`/api/tasks/${id}`);else state.detail=null;
}
async function savePrompt(){
  const brief=state.prompt.trim();if(!brief)return;
  const result=await command('/api/tasks','POST',{tenantId:state.account.memberships[0].id,title:brief.slice(0,120),brief});
  state.prompt='';location.hash=`task=${result.taskId}`;await refresh(result.taskId);
}
async function run(operation,source){
  if(state.busy)return;state.busy=true;notice.textContent='';
  const buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
  try {await operation();}
  catch(error){showError(error,source);}
  finally {state.busy=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}
}
root.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target,data=new FormData(form);
  run(async()=>{
    if(form.id==='request'||form.dataset.relayComposer==='landing'){
      state.prompt=String(data.get('brief')).trim();
      if(!state.prompt)return;
      if(!state.account){state.auth='signup';state.intent='buyer';render();return;}
      await savePrompt();render();
    }else if(form.id==='auth'){
      const body={email:data.get('email'),password:data.get('password')};
      if(state.auth==='signup')Object.assign(body,{name:data.get('name'),workspace:state.intent||data.get('workspace')});
      const result=await api(`/api/auth/${state.auth==='signup'?'register':'login'}`,{method:'POST',body});
      if(result.verificationRequired){state.email=String(data.get('email'));state.emailAction='resend';state.auth='email-sent';render();return;}
      state.account=result;
      state.auth=null;state.intent=null;
      if(state.prompt){await api('/api/me/workspace',{method:'PATCH',body:{workspace:'buyer'}});await savePrompt();}
      else await refresh();
      render();
    }else if(form.id==='recover'||form.id==='resend'){
      const email=String(data.get('email'));state.email=email;
      const result=await api(`/api/auth/${form.id==='recover'?'recover':'resend'}`,{method:'POST',body:{email}});
      state.emailAction=form.id==='recover'?'recover':'resend';state.auth='email-sent';render();notice.textContent=result.message;
    }else if(form.id==='confirm'){
      const result=await api('/api/auth/verify',{method:'POST',body:state.confirmation});
      state.confirmation=null;state.account=result;state.auth=result.recoveryRequired?'reset':null;
      if(!result.recoveryRequired){await refresh();if(state.prompt)await savePrompt();}
      render();
    }else if(form.id==='reset'){
      const result=await api('/api/auth/reset',{method:'POST',body:{password:data.get('password')}});
      state.account=null;state.auth='login';state.tasks=[];state.detail=null;render();notice.textContent=result.message;
    }else if(form.id==='message'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/messages`,'POST',{expectedVersion:task.version,body:data.get('brief')});
      await refresh();render();
    }else if(form.id==='edit'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}`,'PATCH',{expectedVersion:task.version,title:data.get('title'),brief:data.get('brief')});
      state.editing=false;await refresh();render();
    }
  },form);
});
root.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  run(async()=>{
    if(action==='home'||action==='new'){state.auth=state.account?.recoveryRequired?'reset':null;state.intent=null;state.detail=null;state.editing=false;location.hash='';render();}
    else if(action==='login'||action==='signup'||action==='signup-buyer'){state.auth=action==='login'?'login':'signup';if(action==='signup-buyer')state.intent='buyer';render();}
    else if(action==='recover'){state.auth='recover';render();}
    else if(action==='builder'){state.intent='builder';state.auth='signup';render();}
    else if(action==='example'){const field=root.querySelector('#request-text,textarea#request');if(field){field.value=examples[Number(button.dataset.example)];state.prompt=field.value;field.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});field.focus({preventScroll:true});}}
    else if(action==='focus-prompt'){const field=root.querySelector('textarea#request');if(field){field.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});field.focus({preventScroll:true});}}
    else if(action==='toggle-motion'){state.motionPaused=!state.motionPaused;root.querySelector('.lp-cast')?.classList.toggle('lp-motion-paused',state.motionPaused);button.setAttribute('aria-pressed',String(state.motionPaused));button.textContent=state.motionPaused?'Play characters':'Pause characters';}
    else if(action==='logout'){await api('/api/auth/logout',{method:'POST',body:{}});Object.assign(state,{account:null,tasks:[],detail:null,auth:null,intent:null,prompt:'',editing:false});retries.clear();location.hash='';render();}
    else if(action==='switch'){const workspace=state.account.user.workspace==='buyer'?'builder':'buyer';await api('/api/me/workspace',{method:'PATCH',body:{workspace}});await refresh();state.editing=false;location.hash='';render();}
    else if(action==='task'){state.editing=false;await refresh(button.dataset.id);location.hash=`task=${button.dataset.id}`;render();}
    else if(action==='edit'||action==='stop-edit'){state.editing=action==='edit';render();}
    else if(action==='refresh'){await refresh();render();}
    else if(action==='post'||action==='cancel'){
      if(action==='cancel'&&!window.confirm('Cancel this task? It will stay in your history and can no longer be changed.'))return;
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/${action}`,'POST',{expectedVersion:task.version});await refresh();render();
    }
  },button.closest('form,.panel'));
});
root.addEventListener('keydown',event=>{
  if(event.target.tagName==='TEXTAREA'&&(event.metaKey||event.ctrlKey)&&event.key==='Enter'&&!event.isComposing){event.preventDefault();event.target.form.requestSubmit();}
});
async function boot(){
  try {
    const config=await api('/api/config');state.authMode=config.authMode==='managed'?'managed':'local';
    if(state.authMode==='managed'){
      document.querySelector('.poc-strip').textContent='Private staging · real accounts and saved tasks · no payments or agent execution';
      if(location.pathname==='/auth/confirm'){
        const params=new URLSearchParams(location.hash.slice(1));
        const tokenHash=params.get('token_hash'),type=params.get('type');
        history.replaceState(null,'','/auth/confirm');
        if(tokenHash&&['email','recovery'].includes(type)){state.confirmation={tokenHash,type};state.auth='confirm';render();return;}
      }
    }
    const id=location.hash.match(/^#task=([0-9a-f-]{36})$/)?.[1];await refresh(id);}
  catch(error){if(error.status!==401)notice.textContent=error.message;}
  render();
}
boot();
