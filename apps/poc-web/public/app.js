'use strict';
const root=document.querySelector('#app');
const notice=document.querySelector('#notice');
function applyAppearance(value) {
  const theme = value === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.appearance = theme;
  try { localStorage.setItem('relay.appearance', theme); } catch {}
  return theme;
}
try { applyAppearance(localStorage.getItem('relay.appearance')); } catch { applyAppearance('dark'); }
function createClientState() {
  return {
    account: null, auth: null, authMode: 'local', confirmation: null,
    email: '', emailAction: 'resend', intent: null, prompt: '',
    features: null, connected: false, motionPaused: false, busy: false,
    tasks: [], detail: null, offers: [], schedules: [], executionQueue: null,
    agents: [], opportunities: [], work: [], quotes: [], agentCatalog: [],
    workspaceApps: null, drive: null, attio: null, attioReview: null, attioReceipts: [], attioSending: false, payments: null, spendingHistory: null,
    companyBudget: null, team: null, teamHistory: null,
    tenantId: null, invitationPreview: null, teamInviteToken: null,
    teamInviteLink: null, teamHistoryBefore: null, teamRemoval: null,
    buyerTab: 'request', builderTab: 'dashboard', editing: false,
    editingTitleTouched: false, addingAgent: false, agentDraft: null,
    agentIntroPart: 'profile', setupAgentId: null, setupStage: 2,
    returnAgentId: null, preferredAgent: null, agentMarketQuery: '',
    agentMarketCategory: 'All agents', agentMarketType: 'All types', taskFilter: 'all',
    agentMarketSaved: false, agentDiscovery: null, storefrontAgent: null, acquisitionReport: null, marketLoading: false, marketError: false,
    reviewOffer: null, reviewStart: false, reviewChatRequest: false,
    recoveryOpen: false, recoveryData: null, recoveryAfter: '',
    operationsBacklog: null, operationsBacklogUser: null,
    notifications: null, notificationUserId: null, notificationError: '',
    notificationsAt: 0, notificationsOpen: false, budgetAfter: '',
    filePreview: null, messageDrafts: {}, sendingRequest: null,
    sendingMessage: false, builderReplyDirty: false, followExecution: false,
    renderedScopingReply: null, renderedSubmissionId: null,
    renderedViewKey: null, scrollTarget: null, scrollToLatest: false,
    spendingFrom: '', spendingTo: '', spendingCurrency: 'USD',
  };
}
const state=createClientState();
function resetClientSession(overrides={}) {
  const {authMode,features,motionPaused}=state;
  Object.assign(state,createClientState(),{authMode,features,motionPaused},overrides);
}
const retries=new Map();
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const examples=['Find 20 UK SaaS companies with websites and source links. Deliver a CSV.','Create a 30-second launch video for my product.','Build a landing page for my new business.'];
const ApiError=RelayRequest.ApiError;
async function api(path,{method='GET',body,key}={}) {
  let waiting=false;
  try {
    return await RelayRequest.request(path,{method,managed:state.authMode==='managed',onSlow(){waiting=true;notice.textContent='Staging is taking a little longer. Free hosting may be waking up. Please keep this tab open.';},credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(state.account?.csrf?{'X-CSRF-Token':state.account.csrf}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  } finally {if(waiting)notice.textContent='';}
}
async function command(path,method,body) {
  const signature=JSON.stringify([path,method,body]);
  if(!retries.has(signature)) retries.set(signature,crypto.randomUUID());
  try {const result=await api(path,{method,body,key:retries.get(signature)});retries.delete(signature);state.notificationsAt=0;return result;}
  catch(error){if(error.status&&error.status<500)retries.delete(signature);throw error;}
}
function navigationIcon(name) {
  // Relay's rounded silhouette, paired dots and soft panels form one icon family.
  const paths = {
    request: '<path class="navigation-icon-surface" d="M20 11.5a8 8 0 0 1-8 8H5l-2 2V11.5a8.5 8.5 0 0 1 17 0Z"/><path d="M8 11h7m-3.5-3.5v7"/>',
    tasks: '<rect class="navigation-icon-surface" x="4" y="4" width="16" height="17" rx="5"/><path d="M9 3h6v4H9zM8 12l1.5 1.5L12 11m2 1h2m-8 5h8"/>',
    apps: '<rect class="navigation-icon-surface" x="3" y="3" width="7" height="7" rx="2.5"/><rect x="14" y="3" width="7" height="7" rx="2.5"/><rect x="3" y="14" width="7" height="7" rx="2.5"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
    market: '<rect class="navigation-icon-surface" x="3" y="6" width="18" height="15" rx="5"/><path d="M7 6V4h10v2M8 12h.01m8 0h.01M9 17h6"/>',
    scheduled: '<rect class="navigation-icon-surface" x="3" y="5" width="18" height="16" rx="5"/><path d="M8 3v4m8-4v4M3 10h18m-9 3v3l2 1"/>',
    business: '<rect class="navigation-icon-surface" x="3" y="7" width="18" height="14" rx="5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13c5 3 13 3 18 0m-9 0v3"/>',
    billing: '<rect class="navigation-icon-surface" x="3" y="5" width="18" height="15" rx="5"/><path d="M3 10h18m-13 5h3m3 0h2"/>',
    tools: '<path class="navigation-icon-surface" d="M9 7H7a4 4 0 0 0-4 4v2a4 4 0 0 0 4 4h2m6-10h2a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-2"/><path d="M8 12h8"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/>',
    dashboard: '<rect class="navigation-icon-surface" x="3" y="3" width="18" height="18" rx="6"/><path d="M3 10h18m-11 0v11"/>',
    agents: '<rect class="navigation-icon-surface" x="3" y="6" width="18" height="15" rx="6"/><path d="M12 3v3"/><rect x="7" y="11" width="2" height="3" rx="1" fill="currentColor" stroke="none"/><rect x="15" y="11" width="2" height="3" rx="1" fill="currentColor" stroke="none"/><path d="M9 17q3 2 6 0"/>',
    opportunities: '<circle class="navigation-icon-surface" cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5m-13-10h5m-2.5-2.5v5"/>',
    work: '<rect class="navigation-icon-surface" x="3" y="5" width="18" height="16" rx="5"/><path d="M8 5V3m8 2V3M8 12l3 3 5-5"/>',
    earnings: '<rect class="navigation-icon-surface" x="3" y="5" width="18" height="16" rx="5"/><path d="M7 16v-3m5 3V9m5 7v-5"/>',
    settings: '<rect class="navigation-icon-surface" x="3" y="3" width="18" height="18" rx="6"/><path d="M7 9h10M7 15h10"/><circle cx="10" cy="9" r="2" fill="var(--relay-surface, white)"/><circle cx="14" cy="15" r="2" fill="var(--relay-surface, white)"/>',
    conversation: '<path class="navigation-icon-surface" d="M20 11.5a8 8 0 0 1-8 8H5l-2 2V11.5a8.5 8.5 0 0 1 17 0Z"/><path d="M8 11h.01m6 0h.01" stroke-width="3"/>'
  };
  return `<svg class="navigation-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.conversation}</svg>`;
}

function activeCompanyMembership() {
  if (!state.account || state.account.user.workspace === 'builder' || state.auth) return null;
  const membership = state.account.memberships?.find(item => item.id === state.tenantId);
  return membership?.company ? membership : null;
}
function workspaceRoleLabel(role) {
  return {owner: 'Administrator', approver: 'Budget approver', employee: 'Employee'}[role] || 'Team member';
}
function companyWorkspaceBanner() {
  const membership = activeCompanyMembership();
  if (!membership) return '';
  return `<section class="company-context-bar" aria-label="Current company workspace"><div><span class="company-context-label">COMPANY WORKSPACE</span><strong>${escape(membership.name)}</strong><span class="company-context-role">You’re a team member · ${escape(workspaceRoleLabel(membership.role))}</span></div><button class="quiet" data-action="buyer-nav" data-tab="business">Workspace & team</button></section>`;
}

function header() {
  const user = state.account?.user;
  if (!user || state.auth) return `<header class="auth-topbar"><button class="brand" data-action="home" aria-label="Relay home">relay</button><div><span>${state.auth === 'signup' ? 'Already have an account?' : 'New to Relay?'}</span><button class="quiet" data-action="${state.auth === 'signup' ? 'login' : 'signup'}">${state.auth === 'signup' ? 'Log in' : 'Create an account'}</button></div></header>`;

  const builderSide = user.workspace === 'builder';
  const company = activeCompanyMembership();
  const active = builderSide
    ? (state.setupAgentId || state.addingAgent ? 'agents' : state.builderTab)
    : (state.detail ? (state.detail.task.status === 'draft' ? 'request' : 'tasks') : state.buyerTab || 'request');
  const nav = builderSide
    ? [['dashboard', 'Dashboard'], ['agents', 'Agents'], ['opportunities', 'Opportunities'], ['work', 'Tasks'], ['earnings', 'Earnings'], ['settings', 'Settings']]
    : [['request', 'Request work'], ['tasks', 'My tasks'], ['market', 'Agent market'], ...(state.features?.workspaceApps ? [['apps', 'Apps']] : []), ...(state.features?.recurring ? [['scheduled', 'Scheduled work']] : []), ['business', 'Business workspace'], ['billing', 'History & spend'], ['tools', 'Connected tools']];
  const navigationOpen = root.querySelector('.workspace-navigation')?.open ?? !globalThis.matchMedia?.('(max-width: 760px)').matches;
  const recent = builderSide ? [] : [...state.tasks].filter(task => !task.orchestrationStep?.supersededBy)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)).slice(0, 5);

  return `<a class="skip-workspace" href="#workspace-main">Skip to workspace</a><aside class="workspace-header" aria-label="Workspace sidebar">
    <div class="workspace-identity"><button class="brand" data-action="home" aria-label="Relay home">relay</button>${company ? `<button class="company-identity" data-action="buyer-nav" data-tab="business" aria-label="Company workspace: ${escape(company.name)}. Your role: ${escape(workspaceRoleLabel(company.role))}"><span class="company-identity-icon">${navigationIcon('business')}</span><span><small>Company workspace</small><strong>${escape(company.name)}</strong><small>${escape(workspaceRoleLabel(company.role))}</small></span></button>` : builderSide ? `<span class="workspace-caption">Builder workspace</span>` : relayCharacter('face')}</div>
    <details class="workspace-navigation" ${navigationOpen ? 'open' : ''}>
      <summary>Workspace menu</summary>
      <nav aria-label="${builderSide ? 'Builder' : 'Buyer'} navigation">
        ${nav.map(([id, label]) => `<button class="${active === id ? 'active' : ''}" ${active === id ? 'aria-current="page"' : ''} data-action="${builderSide ? 'builder-tab' : 'buyer-nav'}" data-tab="${id}">${navigationIcon(id)}<span>${label}</span></button>`).join('')}
      </nav>
      ${recent.length ? `<section class="recent-conversations" aria-label="Recent conversations"><h2>Recent conversations</h2>${recent.map(task => `<button data-action="task" data-id="${escape(task.id)}" ${state.detail?.task.id === task.id ? 'aria-current="page"' : ''}>${navigationIcon('conversation')}<span>${escape(task.title || 'Untitled task')}</span></button>`).join('')}</section>` : ''}
    </details>
    <div class="account-actions">
      <button class="appearance-switch" data-action="toggle-appearance" aria-label="Dark mode" title="Toggle light / dark appearance" aria-pressed="${globalThis.document?.documentElement?.dataset.appearance !== 'light'}"><svg class="appearance-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 13.1A8.5 8.5 0 0 1 10.9 3.5a8.5 8.5 0 1 0 9.6 9.6Z"/></svg><svg class="appearance-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button>
      <button class="workspace-switch" data-action="switch">Switch to ${builderSide ? 'buyer' : 'builder'} workspace</button>
      <details class="account-menu"><summary><span class="account-avatar">${escape(user.name.slice(0, 1).toUpperCase())}</span><span>${escape(user.name)}</span></summary><div class="account-popover"><small>${escape(user.email)}</small><small>Local development · saved on this machine</small>${state.payments?.recoveryAccess ? '<button data-action="recovery-open">Payment recovery</button>' : ''}<button data-action="logout">Sign out</button></div></details>
    </div>
  </aside>`;
}
function composer(id,placeholder,button,value='',hint='Your task stays in this conversation.') {if(id==='message')return RelayUI.composer({context:'task',value,label:'Message about this task',placeholder,hint,submitLabel:button}).replace('data-relay-composer="task"','id="message" data-relay-composer="task"').replace('for="chat-answer"','for="message-text"').replace('id="chat-answer"','id="message-text" name="brief" required').replace('maxlength="3000"','maxlength="10000"');return `<form class="composer ${id==='message'?'thread-composer':''}" id="${id}"><label class="eyebrow" for="${id}-text">${id==='message'?'Message about this task':'What do you need done?'}</label><textarea id="${id}-text" name="brief" placeholder="${placeholder}" maxlength="10000" required>${escape(value)}</textarea><div class="composer-foot"><small>${hint}</small><button class="primary" type="submit">${button}</button></div><div class="form-error" role="alert"></div></form>`;}
function exampleButtons(){return `<div class="examples">${examples.map((_,i)=>`<button data-action="example" data-example="${i}">${['Find qualified leads','Create a launch video','Build a website'][i]}</button>`).join('')}</div>`;}
function landing(){return RelayLanding.render({prompt:state.prompt,paused:state.motionPaused,managed:state.authMode==='managed',localExecution:!!state.features?.localExecution});}
function authView(){
 if(['email-sent','recover','confirm','reset'].includes(state.auth))return managedAuthView();
 const signup=state.auth==='signup',intent=state.intent;
 return `<main class="auth-layout"><section class="auth-story"><span class="eyebrow">WORK, DELIVERED.</span><h1>${intent==='builder'?'Your agent.<br>Its next opportunity.':signup?'Good ideas.<br>Great outcomes.':'Your work.<br>Right where you left it.'}</h1><p>One Relay account. Your buyer and builder workspaces, together.</p><ul><li>Pick up your saved work</li><li>Switch workspaces without signing in again</li><li>Manage your profile in one place</li></ul><button class="quiet" data-action="home">Back to Relay</button></section><section class="auth-card"><span class="eyebrow">${signup?'MAKE ROOM FOR MORE':'WELCOME BACK'}</span><h2>${signup?'Create your Relay account':'Log in to Relay'}</h2><p>${state.prompt?'Your request is saved here while you sign in.':signup?'Start buying work or bringing your agent to Relay.':'One login for your tasks, agents and earnings. We’ll return you to where you left off.'}</p><form id="auth">${signup?'<label for="name">Your name</label><input id="name" name="name" autocomplete="name" maxlength="80" required>':''}<label for="email">Email address</label><input id="email" type="email" name="email" autocomplete="email" maxlength="254" required><label for="password">Password</label><input id="password" type="password" name="password" autocomplete="${signup?'new-password':'current-password'}" ${signup?'minlength="15" maxlength="128"':''} required>${signup?'<p class="hint">15–128 characters. A few memorable words work well.</p>':''}${signup&&!intent?'<fieldset><legend>What brings you to Relay?</legend><div class="roles"><label><input type="radio" name="workspace" value="buyer" required>Get work done</label><label><input type="radio" name="workspace" value="builder" required>Connect agents</label></div></fieldset>':''}${!signup&&state.authMode==='managed'?'<button class="quiet" type="button" data-action="recover">Forgot password?</button>':''}<div class="form-error" role="alert"></div><button class="primary" type="submit">${signup?'Create account':'Log in'}</button></form><p class="switch-auth">${signup?'Already have an account?':'New to Relay?'} <button class="quiet" data-action="${signup?'login':'signup'}">${signup?'Log in':'Create an account'}</button></p><p class="auth-note">${state.authMode==='managed'?'Private staging. Invitation and verified email required.':'Local accounts use a real password. Email verification, password recovery and Google login are not connected locally.'}</p></section></main>`;
}
function newTask() {
  const welcome = state.sendingRequest
    ? `<div class="request-pending"><article class="thread-message buyer message-enter"><span class="thread-speaker">You · sending</span><p class="offer-details">${escape(state.sendingRequest)}</p></article>${activityCard('Sending your message', 'Starting your private conversation.', true)}</div>`
    : `<div class="request-welcome">${relayCharacter('large')}<h1>${state.preferredAgent ? `What should ${escape(state.preferredAgent.preferenceMode === 'builder' ? state.preferredAgent.operatorName || 'this builder' : state.preferredAgent.name)} do?` : 'What would you like done?'}</h1><p>${state.preferredAgent ? `This request will go directly to ${escape(state.preferredAgent.preferenceMode === 'builder' ? `${state.preferredAgent.operatorName || 'This builder'}’s qualified agents` : state.preferredAgent.name)} for a quote. You still approve the price and scope.` : 'Start a conversation. We’ll work out the details together.'}</p></div>`;
  return `<section class="request-work">${welcome}${state.preferredAgent?.repeatFromTaskId ? `<p class="hint">New request · add any files and tool access again. <a href="#task=${escape(state.preferredAgent.repeatFromTaskId)}">Back to completed task</a></p>` : ''}<div class="request-dock">${!state.sendingRequest ? exampleButtons() : ''}${composer('request', 'Tell Relay what you need…', state.sendingRequest ? 'Sending…' : 'Send', state.sendingRequest ? '' : state.prompt, 'Enter to send · Shift + Enter for a new line') .replace('<textarea', state.sendingRequest ? '<textarea disabled' : '<textarea').replace('type="submit"', state.sendingRequest ? 'type="submit" disabled' : 'type="submit"')}</div></section>`;
}

function taskList() { return taskDashboard(); }
function buyerPage(){if(state.buyerTab==='market'&&!state.detail)return RelayAgentMarket.page();if(state.features?.workspaceApps&&!state.detail&&['apps','tools'].includes(state.buyerTab))return state.buyerTab==='apps'?RelayApps.page():RelayApps.toolsPage();if(state.buyerTab==='scheduled'&&!state.detail)return RelayRecurring.page();if(state.buyerTab==='business'&&!state.detail&&state.authMode==='local'&&typeof RelayTeams==='object')return RelayTeams.page();if(state.buyerTab==='billing'&&!state.detail&&typeof RelayPayments==='object')return RelayPayments.billing();if(state.detail?.task.orchestrationPlan)return RelayOrchestration.page();if(state.detail)return state.detail.task.status==='draft'&&!state.detail.task.orchestrationStep&&!state.editing?draftConversation():taskView();if(state.buyerTab==='tasks')return taskList();if(['business','billing','tools'].includes(state.buyerTab)){const copy={business:['Business workspace','Team memberships and budget approvals are not connected in this local build. Your current requests belong to your personal workspace.'],billing:['Billing','Payment collection is not connected locally. No card details or wallet access are collected here.'],tools:['Connected tools','Tool authorization and delivery destinations are not connected yet. A file delivery will not silently send work into another service.']}[state.buyerTab];return `<section class="market-workspace"><header class="builder-page-title"><div><h1>${copy[0]}</h1></div></header><section class="panel"><p>${copy[1]}</p><button data-action="buyer-nav" data-tab="tasks">Back to my tasks</button></section></section>`;}return newTask();}
function focusOfferReview(offerId, reviewing) {
 const action = reviewing ? 'accept-offer' : 'review-offer';
 const target = [...root.querySelectorAll('[data-action]')].find(button =>
   button.dataset.action === action && button.dataset.id === offerId);
 target?.focus({ preventScroll: true });
}
function settleWorkspaceNavigation(changedView) {
 if (!changedView) return;
 if (globalThis.matchMedia?.('(max-width: 760px)').matches) {
   const navigation = root.querySelector('.workspace-navigation');
   if (navigation) navigation.open = false;
 }
 root.querySelector('#workspace-main')?.focus({ preventScroll: true });
}
function render(){
 const activeReply=document.activeElement?.id==='message-text'?document.activeElement:null;
 const replySelection=activeReply?{start:activeReply.selectionStart,end:activeReply.selectionEnd}:null;
 const viewKey=JSON.stringify([state.account?.user.id,state.tenantId,state.auth,state.account?.user.workspace,state.detail?.task.id,state.buyerTab,state.builderTab,state.setupAgentId,state.addingAgent,state.setupStage,state.agentIntroPart,state.recoveryOpen]);
 const changedView=state.renderedViewKey!==viewKey;state.renderedViewKey=viewKey;
 const disclosureKey = item => item.dataset.disclosureKey || [item.closest('[data-app-id]')?.dataset.appId || '', item.closest('[data-run-id]')?.dataset.runId || '', item.querySelector('summary')?.textContent].join(':');
 const expanded = !changedView ? [...root.querySelectorAll('.canvas details')].filter(item => item.open).map(disclosureKey) : [];
 const history=root.querySelector('.thread-history'),wasNearBottom=!history||history.scrollHeight-history.scrollTop-history.clientHeight<80,oldId=root.querySelector('.buyer-conversation')?.dataset.taskId,scrollTop=history?.scrollTop||0;
 document.body.classList.toggle('workspace-open',!!state.account&&!state.auth);
 root.innerHTML=!state.account&&!state.auth?landing():header()+(state.auth?authView():`<div class="workspace-content ${activeCompanyMembership()?'company-workspace-active':''}"><div id="notification-slot">${typeof RelayNotifications === 'object' ? RelayNotifications.view() : ''}</div>${companyWorkspaceBanner()}<main id="workspace-main" class="canvas" tabindex="-1">${state.teamInviteToken&&state.authMode==='local'?RelayTeams.page():state.recoveryOpen&&state.payments?.recoveryAccess?RelayPayments.recovery():state.account.user.workspace==='builder'?builder():buyerPage()}</main></div>`);
 if (!changedView) root.querySelectorAll('.canvas details').forEach(item => {
   if (expanded.includes(disclosureKey(item))) item.open = true;
 });
 if (changedView && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
   root.querySelector('.canvas')?.animate?.(
     [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }],
     { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }
   );
 }
 settleWorkspaceNavigation(changedView);
 if(changedView&&typeof window!=='undefined')window.scrollTo?.(0,0);
 const next=root.querySelector('.thread-history');if(next)next.scrollTop=state.scrollToLatest||oldId!==state.detail?.task.id?next.scrollHeight:scrollTop;state.scrollToLatest=false;
 const submissionId=state.detail?.submissions?.at(-1)?.id;
 if(next&&submissionId&&state.renderedSubmissionId!==submissionId&&((oldId===state.detail?.task.id&&wasNearBottom)||state.followExecution)&&!state.scrollTarget){state.scrollTarget='.delivery-submission:last-of-type';state.followExecution=false;}
 state.renderedSubmissionId=submissionId;
 const scopeReply=state.detail?.task.scoping;
 if(scopeReply?.status==='completed'&&state.renderedScopingReply!==scopeReply.id){
   if(next&&wasNearBottom&&!state.scrollTarget){const message=state.detail.messages?.filter(item=>item.role==='assistant').at(-1);if(message)state.scrollTarget=`#scope-reply-${message.id}`;}
   state.renderedScopingReply=scopeReply.id;
   notice.textContent=state.detail?.task.status==='draft'?'Relay has replied.':'Relay has replied. Your agreed brief has not changed.';
 }
 resizeChatComposer(root.querySelector('#message-text'));
 if(replySelection&&!changedView){const input=root.querySelector('#message-text');input?.focus({preventScroll:true});input?.setSelectionRange(replySelection.start,replySelection.end);}
 if(state.scrollTarget){const target=root.querySelector(state.scrollTarget);if(next&&target&&next.contains(target))next.scrollTop+=target.getBoundingClientRect().top-next.getBoundingClientRect().top-12;else target?.scrollIntoView({block:'nearest'});state.scrollTarget=null;}
}
function showError(error,form){
  if(error.status===401&&state.account){if(typeof RelaySupplier==='object')RelaySupplier.clear();resetClientSession({auth:'login'});retries.clear();render();}
  const target=form?.isConnected?form.querySelector('.form-error,.error,[role=alert]'):null;
  if (target) {
    target.textContent = error.message;
    target.classList.add('error');
    target.tabIndex = -1;
    target.focus();
  } else {
    notice.textContent = error.message;
  }
}
async function refresh(id=state.detail?.task.id, nextState=state, background=false){
  const state=nextState;
  state.filePreview=null;
  state.account=await api('/api/me');
  if(typeof RelayAgentMarket === 'object' && RelayAgentMarket.storefrontId() && state.account.user.workspace === 'buyer') state.buyerTab='market';
  if(state.account.recoveryRequired){state.auth='reset';state.tasks=[];state.detail=null;return;}
  if(state.features?.notifications&&!background)try{await RelayNotifications.load();}catch{state.notificationError='Updates could not load. Try Refresh.';}
  if(state.features?.unifiedBackend)state.payments=await api('/api/payments/status');
  if(state.recoveryOpen&&state.payments?.recoveryAccess){state.recoveryData=await api('/api/payments/recovery?after='+encodeURIComponent(state.recoveryAfter||''));if(state.operationsBacklogUser!==state.account.user.id||!state.operationsBacklog){state.operationsBacklog=await api('/api/operations/backlog');state.operationsBacklogUser=state.account.user.id;}}
  const tenant=state.account.memberships.find(m=>m.id===state.tenantId)||state.account.memberships[0];
  state.tenantId=tenant?.id;
  if (!background) state.spendingHistory = state.features?.unifiedBackend && state.buyerTab === 'billing' && tenant ? await api('/api/payments/history?tenantId='+encodeURIComponent(tenant.id)+'&from='+encodeURIComponent(state.spendingFrom||'')+'&to='+encodeURIComponent(state.spendingTo||'')+'&currency='+encodeURIComponent(state.spendingCurrency||'USD')) : null;
  if(state.features?.recurring){state.schedules=tenant?(await api('/api/schedules?tenantId='+encodeURIComponent(tenant.id))).schedules:[];state.executionQueue=await api('/api/execution-queue');}
  if(state.features?.workspaceApps)state.workspaceApps=tenant?await api('/api/workspace-apps?tenantId='+encodeURIComponent(tenant.id)):null;
  if(state.buyerTab==='market'&&state.account.user.workspace!=='builder'){
    clearTimeout(RelayAgentMarket.searchTimer);
    const revision=RelayAgentMarket.searchRevision=(RelayAgentMarket.searchRevision||0)+1;
    const query=RelayAgentMarket.query(), owner=state.account.user.id;
    const discovery=await api(query);
    if(revision===RelayAgentMarket.searchRevision&&state.account?.user.id===owner&&query===RelayAgentMarket.query()){
      state.agentDiscovery=discovery;state.agentCatalog=discovery.agents;state.marketLoading=false;state.marketError=false;
    }
  }
  if (!background) state.acquisitionReport = state.account.user.workspace === 'builder' && state.setupAgentId ? await api('/api/agents/'+state.setupAgentId+'/acquisition') : null;
  state.storefrontAgent = null;
  const profileId = typeof RelayAgentMarket === 'object' ? RelayAgentMarket.storefrontId() : null;
  if (profileId) {
    try { state.storefrontAgent = (await api('/api/agent-market/' + profileId)).agent; }
    catch (error) { if (error.status !== 404) throw error; }
  }

  state.attio = state.features?.attioDelivery && tenant?.role === 'owner' ? await api('/api/attio/status?tenantId='+encodeURIComponent(tenant.id)) : null;
  state.drive=state.features?.driveConnections && tenant?.role==='owner' ? await api('/api/drive/status?tenantId='+encodeURIComponent(tenant.id)) : null;
  state.team=tenant?.company&&state.buyerTab==='business'?await api('/api/teams/'+tenant.id):null;
  state.teamHistory=state.team?.role==='owner'?await api('/api/teams/'+tenant.id+'/history?before='+encodeURIComponent(state.teamHistoryBefore||'')):null;
  state.companyBudget=state.team?await api('/api/teams/'+tenant.id+'/budget?after='+encodeURIComponent(state.budgetAfter||'')):null;
  state.tasks=tenant?(await api(`/api/tasks?tenantId=${encodeURIComponent(tenant.id)}`)).tasks:[];
  if(state.account.user.workspace==='builder'&&state.authMode==='local'){
    const [a,o,w,q]=await Promise.all([api('/api/agents'),api('/api/opportunities'),api('/api/work'),api('/api/quotes')]);
    state.agents=a.agents;state.opportunities=o.tasks;state.work=w.tasks;state.quotes=q.offers;state.detail=null;state.offers=[];
  }else{
    if(id){state.detail=await api(`/api/tasks/${id}`);if(state.tenantId!==state.detail.task.tenantId){state.tenantId=state.detail.task.tenantId;if(state.features?.workspaceApps)state.workspaceApps=await api('/api/workspace-apps?tenantId='+encodeURIComponent(state.tenantId));state.tasks=(await api('/api/tasks?tenantId='+encodeURIComponent(state.tenantId))).tasks;}}else state.detail=null;
    const taskMember = state.account.memberships.find(member => member.id === state.tenantId);
    state.attioReceipts = id && state.features?.attioDelivery && taskMember?.role === 'owner'
      ? (await api(`/api/tasks/${id}/delivery-destinations`)).receipts : [];
    // A task deep link may switch workspace after the initial tool-status fetch.
    if (id && tenant?.id !== state.tenantId) {
      state.attio = state.features?.attioDelivery && taskMember?.role === 'owner' ? await api('/api/attio/status?tenantId='+encodeURIComponent(state.tenantId)) : null;
      state.drive = state.features?.driveConnections && taskMember?.role === 'owner' ? await api('/api/drive/status?tenantId='+encodeURIComponent(state.tenantId)) : null;
    }
    state.offers=id&&state.authMode==='local'?(await api(`/api/tasks/${id}/offers`)).offers:[];
  }
}
async function savePrompt() {
  const brief = state.prompt.trim();
  if (!brief) return;
  state.sendingRequest = brief;
  render();
  try {
    const result = await command('/api/tasks', 'POST', {
      tenantId: state.tenantId || state.account.memberships[0].id,
      title: brief.slice(0, 120), brief, ...(state.preferredAgent?.repeatFromTaskId ? {repeatFromTaskId:state.preferredAgent.repeatFromTaskId,expectedSourceVersion:state.preferredAgent.expectedSourceVersion} : {}), ...(state.preferredAgent?{preferredAgentId:state.preferredAgent.id,preferenceMode:state.preferredAgent.preferenceMode || 'agent',discoverySource:state.preferredAgent.discoverySource || 'unspecified'}:{})
    });
    state.prompt = '';
    state.preferredAgent = null;
    location.hash = `chat=${result.taskId}`;
    await refresh(result.taskId);
    state.sendingRequest = null;
    render();
    if (state.features?.scoping) {
      try {
        await command(`/api/tasks/${result.taskId}/assist`, 'POST', {expectedVersion: state.detail.task.version});
      } finally { await refresh(result.taskId); }
    }
  } finally {
    state.sendingRequest = null;
    render();
  }
}

let actionRevision = 0;
async function recoverUnavailableTask(error) {
  if (![403, 404].includes(error.status) || !state.detail?.task.id) return false;
  const taskId = state.detail.task.id;
  const revision = actionRevision;
  try {
    await api(`/api/tasks/${taskId}`);
    return false; // An action can be forbidden while the task remains readable.
  } catch (readError) {
    if (![403, 404].includes(readError.status)) throw readError;
  }
  if (actionRevision !== revision || state.detail?.task.id !== taskId) return false;
  state.detail = null;
  state.offers = [];
  state.tasks = [];
  state.team = null;
  state.teamHistory = null;
  state.companyBudget = null;
  state.spendingHistory = null;
  state.reviewOffer = null;
  state.reviewStart = false;
  state.editing = false;
  state.filePreview = null;
  delete state.messageDrafts[taskId];
  state.buyerTab = 'tasks';
  location.hash = 'tasks';
  // Clear the unavailable content even if reloading the remaining workspace fails.
  render();
  await refresh(null);
  render();
  notice.textContent = 'This task is no longer available to your account. Ask your workspace administrator to check its status before retrying an action.';
  return true;
}
async function run(operation,source){
  if(state.busy)return;actionRevision++;state.busy=true;notice.textContent='';
  source?.querySelectorAll('.form-error,.error').forEach(element=>{element.textContent='';element.classList.remove('error');});
  const buttons=[...root.querySelectorAll('button')].map(button=>({button,disabled:button.disabled}));
  buttons.forEach(({button})=>button.disabled=true);
  try {await operation();}
  catch(error){
    try { if (!await recoverUnavailableTask(error)) showError(error,source); }
    catch (refreshError) { showError(refreshError); }
  }
  finally {state.busy=false;buttons.forEach(({button,disabled})=>{if(button.isConnected)button.disabled=disabled;});}
}
root.addEventListener('submit',event=>{
  event.preventDefault();const form=event.target,data=new FormData(form);
  run(async()=>{
    if(typeof RelaySupplier==='object'&&form.id!=='supplier-credential')RelaySupplier.clear();
    if(form.id==='orchestration-create'){
      const steps=[...form.querySelectorAll('[data-plan-step]')].map((_,i)=>({
        title:data.get('title-'+i),brief:data.get('brief-'+i),criteria:data.get('criteria-'+i),budgetMinor:Math.round(Number(data.get('budget-'+i))*100),
        dependencies:String(data.get('dependencies-'+i)).trim()?String(data.get('dependencies-'+i)).split(',').map(n=>Number(n.trim())-1):[]
      }));
      await command('/api/tasks/'+form.dataset.id+'/orchestrate','POST',{expectedVersion:Number(form.dataset.version),budgetMinor:Math.round(Number(data.get('total'))*100),steps});
      await refresh(form.dataset.id);render();notice.textContent='Plan created. Review and start each step separately.';
    }else if(form.dataset.planRecovery){
      await command('/api/tasks/'+state.detail.task.id+'/recover-plan','POST',{expectedVersion:state.detail.task.version,stepId:form.dataset.planRecovery,expectedStepVersion:Number(form.dataset.version),reason:data.get('reason'),confirm:data.get('confirm')?'reset-affected-steps':''});
      await refresh();render();notice.textContent='Fresh steps created. Review inputs, handovers and offers again.';
    }else if(form.dataset.handover){
      await command('/api/tasks/'+form.dataset.handover+'/handover','POST',{expectedVersion:Number(form.dataset.version),sourceTaskId:form.dataset.source,submissionId:form.dataset.submission,notes:data.get('notes'),fileId:data.get('fileId')||null,consent:data.get('consent')?'share-with-step-supplier':''});
      await refresh();render();notice.textContent='Handover saved for this downstream step.';
    }else if(form.id==='portfolio-add'){
      const source=data.get('source');
      await command('/api/agents/'+form.dataset.id+'/portfolio','POST',{
        expectedVersion:Number(form.dataset.version),kind:source==='owned'?'owned':'relay-task',
        taskId:source==='owned'?null:source,title:data.get('title'),summary:data.get('summary'),sample:data.get('sample'),
        consent:data.get('consent')?'redacted-sharing-rights':''});
      await refresh();render();notice.textContent=source==='owned'?'Example saved. It appears when your listing is published.':'Permission requested. The example stays private until the customer approves.';
    }else if(form.id==='agent-listing'){
      await command('/api/agents/'+form.dataset.id+'/listing','PATCH',{expectedVersion:Number(form.dataset.version),status:data.get('status')});
      await refresh();render();notice.textContent='Listing visibility saved. Existing work and bidding rules are unchanged.';
    }else if(form.id==='spending-filter'){
      const from=data.get('from')||'',to=data.get('to')||'',currency=data.get('currency')||'USD';
      const report=await api('/api/payments/history?tenantId='+encodeURIComponent(state.tenantId)+'&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+'&currency='+encodeURIComponent(currency));
      state.spendingFrom=from;state.spendingTo=to;state.spendingCurrency=currency;state.spendingHistory=report;render();
    }else if(form.dataset.supplierMessage || form.dataset.changePropose) {
      const id=form.dataset.supplierMessage || form.dataset.changePropose;
      const work=state.work.find(item=>item.id===id);
      if(!work)throw new Error('Refresh the assigned task before replying.');
      const body=form.dataset.supplierMessage ? {expectedVersion:work.version,body:data.get('body')} : {
        expectedVersion:work.version,kind:data.get('kind'),title:data.get('title'),brief:data.get('brief'),reason:data.get('reason'),
        amountMinor:Math.round(Number(data.get('total'))*100),retainedMinor:Math.round(Number(data.get('retained'))*100),deliveryMinutes:Number(data.get('minutes'))};
      await command(`/api/tasks/${id}/${form.dataset.supplierMessage?'supplier-message':'change-proposals'}`,'POST',body);
      state.builderReplyDirty=false;await refresh();render();
    }else if(form.dataset.changeReview) {
      await command(`/api/tasks/${state.detail.task.id}/review-change`,'POST',{expectedVersion:state.detail.task.version,proposalId:form.dataset.changeReview,decision:event.submitter?.value});
      state.reviewStart=false;await refresh();render();
    }else if(form.id==='task-context'){
      await command('/api/tasks/'+state.detail.task.id+'/context','POST',{expectedVersion:state.detail.task.version,sourceId:data.get('sourceId'),mode:data.get('mode'),remove:event.submitter?.value==='remove'});
      await refresh();render();
    }else if(form.dataset.permissionRequest){
      const approve=event.submitter?.value==='approve';
      await command('/api/tasks/'+state.detail.task.id+(approve?'/tool-grant':'/permission-decline'),'POST',{
        expectedVersion:state.detail.task.version,requestId:form.dataset.permissionRequest,
        ...(approve?{sourceId:data.get('sourceId'),expiresDays:1,consent:'local-source-read'}:{})
      });
      await refresh();render();
    }else if(form.id.startsWith('app-')||form.id==='task-tool-grant'){await RelayApps.submit(form,data);}
    else if(form.id==='schedule-create'){
      if(!data.has('consent'))throw new Error('Confirm permission for automatic local runs before enabling.');
      await command('/api/tasks/'+state.detail.task.id+'/schedule','POST',{expectedVersion:state.detail.task.version,calendar:{cadence:data.get('cadence'),time:data.get('time'),timezone:data.get('timezone'),day:data.get('cadence')==='weekly'?Number(data.get('weekDay')):data.get('cadence')==='monthly'?Number(data.get('monthDay')):1},perRunLimitMinor:Math.round(Number(data.get('perRun'))*100),monthlyLimitMinor:Math.round(Number(data.get('monthly'))*100),consent:'local-unpaid-recurring'});
      await refresh();render();
    }else if(form.id==='execution-retry'){
      await command('/api/tasks/'+state.detail.task.id+'/retry-execution','POST',{expectedVersion:state.detail.task.version,reason:data.get('reason')});await refresh();render();
    }else if(form.id==='company-budget'){
      await command('/api/teams/'+state.tenantId+'/budget','POST',{limitMinor:Math.round(Number(data.get('limit'))*100),expectedVersion:state.companyBudget?.budget?.version||0});await refresh(null);render();
    }else if(form.id==='approval-request'){
      await command('/api/tasks/'+state.detail.task.id+'/approval','POST',{expectedVersion:state.detail.task.version,note:data.get('note')});await refresh();render();
    }else if(form.dataset.approvalTask){
      await command('/api/tasks/'+form.dataset.approvalTask+'/approval/decide','POST',{approvalId:form.dataset.approvalId,expectedVersion:Number(form.dataset.version),decision:data.get('decision'),note:data.get('note')});await refresh(null);render();
    }else if(form.id==='team-create'){
      const result=await command('/api/teams','POST',{name:data.get('name')});state.tenantId=result.tenantId;state.teamInviteLink=null;await refresh(null);render();
    }else if(form.id.startsWith('team-role-')){
      await api('/api/teams/'+state.tenantId+'/role',{method:'POST',body:{memberId:data.get('memberId'),role:data.get('role'),expectedRole:data.get('expectedRole')}});
      state.teamHistoryBefore='';await refresh(null);render();
    }else if(form.id==='team-invite'){
      const result=await api('/api/teams/'+state.tenantId+'/invite',{method:'POST',body:{email:data.get('email'),role:data.get('role')}});
      state.teamInviteLink=location.origin+'/#team-invite='+result.token;await refresh(null);render();
    }else if(form.id==='team-preview'){
      state.invitationPreview=await api('/api/teams/preview',{method:'POST',body:{token:data.get('token')}});state.teamInviteToken=data.get('token');render();
    }else if(form.id==='team-accept'){
      const result=await api('/api/teams/accept',{method:'POST',body:{token:data.get('token')}});state.tenantId=result.tenantId;state.teamInviteToken=null;state.invitationPreview=null;location.hash='';await api('/api/me/workspace',{method:'PATCH',body:{workspace:'buyer'}});await refresh(null);render();
    }else if(form.dataset.recovery){
      const result=await command('/api/payments/recovery/retry','POST',{id:form.dataset.recovery,snapshot:form.dataset.snapshot,reason:data.get('reason')});
      await refresh();render();notice.textContent=result.message;
    }else if(form.id==='request'||form.dataset.relayComposer==='landing'){
      state.prompt=String(data.get('brief')).trim();
      if(!state.prompt)return;
      if(!state.account){state.auth='signup';state.intent='buyer';render();return;}
      await savePrompt();render();
    }else if(form.id==='sandbox-operator'){
      const result=await command('/api/payments/operator','POST',{country:data.get('country')});
      const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='connect.stripe.com')throw new Error('Unexpected onboarding destination.');location.assign(url.href);
    }else if(form.id==='auth'){
      const body={email:data.get('email'),password:data.get('password')};
      if(state.auth==='signup')Object.assign(body,{name:data.get('name'),workspace:state.intent||data.get('workspace')});
      const result=await api(`/api/auth/${state.auth==='signup'?'register':'login'}`,{method:'POST',body});
      if(result.verificationRequired){state.email=String(data.get('email'));state.emailAction='resend';state.auth='email-sent';render();return;}
      state.account=result;
      state.auth=null;state.intent=null;
      if(state.prompt){await api('/api/me/workspace',{method:'PATCH',body:{workspace:'buyer'}});await savePrompt();}
      else await refresh(location.hash.match(/^#(?:task|chat)=([0-9a-f-]{36})$/)?.[1]);
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
    }else if(form.id==='task-input'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/input`,'POST',{expectedVersion:task.version,filename:data.get('file').name,base64:await csvFileBase64(data.get('file')),notes:data.get('notes')});
      await refresh();render();notice.textContent=task.status==='draft'?'CSV attached. Review your updated brief before requesting work.':'CSV saved with the new scope. Prior offers need updating.';
    }else if(form.id==='supplier-credential'){
      await RelaySupplier.issue(form,data);
    }else if(form.id==='execution-cancel'){
      await command(`/api/tasks/${state.detail.task.id}/cancel-execution`,'POST',{expectedVersion:state.detail.task.version,reason:data.get('reason')});
      await refresh();render();
    }else if(form.id==='delivery-revision'){
      await RelayExecution.requestRevision(form, data.get('notes'));
    }else if(form.id==='agent'){
      if(state.agentIntroPart!=='capabilities'){captureAgentDraft(form);state.agentIntroPart='capabilities';state.agentDraft.part='capabilities';sessionStorage.setItem(agentDraftKey(),JSON.stringify(state.agentDraft));render();return;}
      const rows=[...form.querySelectorAll('.capability-row')];
      const result=await command('/api/agents','POST',{name:data.get('name'),purpose:data.get('purpose'),domain:data.get('domain'),kind:data.get('kind'),integration:'api',capabilities:rows.map(r=>({category:r.querySelector('[name=category]').value,task:r.querySelector('[name=capability]').value}))});
      state.addingAgent=false;state.agentDraft=null;sessionStorage.removeItem(agentDraftKey());state.setupAgentId=result.agentId;state.setupStage=2;location.hash=`agent=${result.agentId}&step=2`;await refresh();render();notice.textContent='Profile saved. Choose how your runtime will connect.';
    }else if(['agent-connection','agent-rules','agent-profile'].includes(form.id)){
      const agent = state.agents.find(item => item.id === form.dataset.id);
      const configuration = RelaySupplier.configuration(agent, form, data);
      await command(`/api/agents/${agent.id}`, 'PATCH', configuration);
      state.setupStage = configuration.setupStage;
      location.hash = `agent=${agent.id}&step=${state.setupStage}`;
      await refresh();
      render();
      notice.textContent = form.id === 'agent-connection'
        ? 'Method saved. Connect your runtime below, then continue to Demonstrate.'
        : state.agents.find(item => item.id === agent.id)?.rules.automaticEnabled
          ? 'Local automatic bidding is active. Commercial readiness is still incomplete.'
          : 'Operating preferences saved. Review the connection and bidding status above.';
    }else if(form.dataset.quote){
      const capabilityId=data.get('capabilityId');if(!capabilityId)throw new Error('Choose the capability supporting this offer.');const agent=state.agents.find(a=>a.capabilities.some(c=>c.id===capabilityId));
      await command(`/api/tasks/${form.dataset.quote}/offers`,'POST',{agentId:agent.id,capabilityId,expectedVersion:Number(form.dataset.version),amountMinor:Math.round(Number(data.get('price'))*100),currency:data.get('currency')||'USD',deliveryMinutes:Number(data.get('minutes')),proposal:data.get('proposal')});
      state.builderTab='quotes';await refresh();render();notice.textContent='Offer sent to the buyer.';
    }else if(form.id==='message'){
      const task=state.detail.task;
      const scoping=state.features?.scoping&&!task.orchestrationStep&&!task.orchestrationPlan&&['draft','posted','selected'].includes(task.status);
      state.sendingMessage = String(data.get('brief'));
      state.messageDrafts[task.id] = state.sendingMessage;
      state.scrollToLatest = true;
      render();
      try {
        await command(`/api/tasks/${task.id}/${scoping?'assist':'messages'}`,'POST',{expectedVersion:task.version,...(scoping?{message:data.get('brief')}:{body:data.get('brief')})});
        delete state.messageDrafts[task.id];
        await refresh();
      } finally { state.sendingMessage = null; render(); }
    }else if(form.id==='edit'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/scope`,'POST',{expectedVersion:task.version,title:data.get('title'),brief:data.get('brief')});
      state.editing=false;state.reviewStart=false;await refresh();render();
    }
  },form);
});
root.addEventListener('click',event=>{
  const button=event.target.closest('[data-action]');if(!button)return;
  const action=button.dataset.action;
  if(action==='plan-add-step'){
    const container=root.querySelector('[data-plan-steps]');const count=container?.children.length||0;
    if(container&&count<8)container.insertAdjacentHTML('beforeend',RelayOrchestration.row(count));
    if(count>=7)button.disabled=true;
    return;
  }
  if(action==='plan-complete'){
    run(async()=>{await command('/api/tasks/'+button.dataset.id+'/complete-plan','POST',{expectedVersion:Number(button.dataset.version)});await refresh();render();});return;
  }
  if (action === 'portfolio-decision') {
    run(async()=>{
      await command('/api/portfolio/'+button.dataset.id,'PATCH',{expectedVersion:Number(button.dataset.version),action:button.dataset.decision});
      await refresh();render();notice.textContent='Sharing permission updated.';
    });
    return;
  }
  if (action === 'toggle-appearance') {
    const light = applyAppearance(document.documentElement.dataset.appearance === 'light' ? 'dark' : 'light') === 'light';
    button.setAttribute('aria-pressed', String(!light));
    return;
  }
  if(action==='task-filter'){state.taskFilter=button.dataset.filter;render();root.querySelector('.task-filters [aria-pressed="true"]')?.focus({preventScroll:true});return;}
  if(action==='schedule-example'){
    state.prompt=RelayRecurring.examples[Number(button.dataset.example)] || '';
    render();
    const field=root.querySelector('#request-text');
    field?.focus({preventScroll:true});
    field?.setSelectionRange(state.prompt.length,state.prompt.length);
    return;
  }
  if(action==='market-saved'){state.agentMarketSaved=!state.agentMarketSaved;render();RelayAgentMarket.search(root);return;}
  if(action==='market-more'){RelayAgentMarket.load(root,true);return;}
  if(action==='market-retry'){RelayAgentMarket.search(root);return;}
  if(action==='market-category'){RelayAgentMarket.selectCategory(root,button.dataset.category);return;}
  if(action==='market-request-agent'||action==='market-request-builder'){RelayAgentMarket.choose(button.dataset.id,action.endsWith('builder')?'builder':'agent');return;}
  if(action==='review-chat-request'){state.reviewChatRequest=true;render();return;}
  if(action==='keep-chatting'){state.reviewChatRequest=false;render();return;}
  if(['buyer-nav','builder-tab','switch','home','logout'].includes(action))state.recoveryOpen=false;
  run(async()=>{
    if(typeof RelaySupplier==='object'&&!['download-supplier-config','hide-supplier-key','refresh'].includes(action))RelaySupplier.clear();
    if(action==='repeat-hire'){
      const sourceId=state.detail?.task.id;
      if(!sourceId)return;
      await refresh(sourceId);
      const repeat=state.detail.repeatHire, source=state.detail.task;
      if(!repeat?.available){render();return;}
      state.tenantId=source.tenantId;
      state.preferredAgent={id:repeat.agentId,name:repeat.name,preferenceMode:'agent',discoverySource:'repeat-hire',repeatFromTaskId:source.id,expectedSourceVersion:source.version};
      state.prompt='';state.detail=null;state.buyerTab='request';location.hash='';render();
      document.querySelector('#request-text')?.focus();
    }
    else if(action==='market-save'){
      try {
        await command('/api/agent-market/'+button.dataset.id+'/saved','PATCH',{saved:button.dataset.saved!=='true',expectedVersion:Number(button.dataset.version)});
      } finally { await refresh();render(); }
    }
    else if(action.startsWith('notification-')){await RelayNotifications.click(button);}
    else if(action.startsWith('app-')){await RelayApps.click(button);}
    else if(action==='approval-next'||action==='approval-first'){state.budgetAfter=action==='approval-next'?state.companyBudget.nextCursor:'';await refresh(null);render();}
    else if(action==='scan-file'){
      await command('/api/tasks/'+button.dataset.task+'/submissions/'+button.dataset.submission+'/files/'+button.dataset.file+'/scan','POST',{});
      await refresh();render();
    }else if(action==='preview-file'){
      const key=button.dataset.fileKey;
      state.filePreview=null;
      const file=await api('/api/tasks/'+button.dataset.task+'/submissions/'+button.dataset.submission+'/files/'+button.dataset.file+'/preview');
      state.filePreview={key,...file};state.scrollTarget='#delivery-preview-'+button.dataset.file;render();
    }else if(action==='close-file-preview'){
      state.filePreview=null;render();
    }else if(action==='team-remove-cancel'){
      state.teamRemoval=null;render();
    }else if(action==='team-history'){
      state.teamHistoryBefore=button.dataset.before||'';await refresh(null);render();
    }else if(action==='team-remove'||action==='team-revoke'){
      const target=button.dataset.member||button.dataset.invite;
      if(state.teamRemoval!==target){state.teamRemoval=target;render();return;}
      state.teamRemoval=null;
      await api('/api/teams/'+state.tenantId+'/remove',{method:'POST',body:action==='team-remove'?{memberId:button.dataset.member}:{inviteId:button.dataset.invite}});state.teamInviteLink=null;await refresh(null);render();
    }
    else if(action==='schedule-control'){
      await command('/api/schedules/'+button.dataset.id,'POST',{expectedVersion:Number(button.dataset.version),action:button.dataset.operation});await refresh(null);render();
    }
    else if(action==='builder-task'){
      state.setupAgentId=null;
      state.addingAgent=false;
      state.builderTab='work';
      location.hash='';
      await refresh();
      if (/^[0-9a-f-]{36}$/.test(button.dataset.id)) {
        state.scrollTarget='[data-notification-task="'+button.dataset.id+'"]';
      }
      render();
    }
    else if(action==='builder-payment-review'){
      state.recoveryOpen=false;state.builderTab='earnings';state.setupAgentId=null;state.addingAgent=false;
      if(/^[0-9a-f-]{36}$/.test(button.dataset.id))state.scrollTarget='[data-payment-task="'+button.dataset.id+'"]';
      await refresh();render();
    }
    else if(action.startsWith('recovery-')){
      state.recoveryOpen=action!=='recovery-close';
      location.hash=state.recoveryOpen?'payment-recovery':'';
      if(action==='recovery-open'||action==='recovery-refresh')state.operationsBacklog=null;
      if(action==='recovery-open'||action==='recovery-first')state.recoveryAfter='';
      if(action==='recovery-next')state.recoveryAfter=button.dataset.after;
      await refresh();render();
    }
    else if(action==='sandbox-operator-refresh'){
      await api('/api/payments/operator/refresh',{method:'POST',body:{}});await refresh();render();
    }
    else if(action==='sandbox-payment'){
      const operation=button.dataset.operation;
      const result=await command(`/api/tasks/${button.dataset.id}/payments/${operation}`,'POST',['reconcile','checkout'].includes(operation)?{}:{expectedVersion:Number(button.dataset.version)});
      if(result.url){const url=new URL(result.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Unexpected checkout destination.');location.assign(url.href);return;}
      await refresh();render();
    }
    else if(action==='authorize-sandbox'){
      await command(`/api/tasks/${state.detail.task.id}/authorize-local`,'POST',{expectedVersion:state.detail.task.version,mode:'stripe-sandbox'});await refresh();render();
    }
    else if(action==='cancel-reply'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/cancel-reply`,'POST',{expectedVersion:task.version,jobId:task.scoping.id});
      await refresh();render();
    }
    else if(action==='analyze-brief'||action==='confirm-scope'||action==='read-chat-context'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/${action==='confirm-scope'?'confirm-scope':'assist'}`,'POST',{expectedVersion:task.version,...(action==='confirm-scope'?{proposalId:task.scoping.id}:action==='read-chat-context'?{useContext:true}:{})});
      await refresh();render();
    }
    else if(action==='start-qualification'){
      const agent=state.agents.find(item=>item.id===button.dataset.id);
      await command(`/api/agents/${agent.id}/qualifications`,'POST',{expectedVersion:agent.version,capabilityId:button.dataset.capability,rubric:button.dataset.rubric||'csv-normalize-v1'});
      await refresh();render();notice.textContent='Test job sent to your connected runtime. A pass requires both the test and its revision.';
    }
    else if(action==='download-supplier-config'){RelaySupplier.download(button.dataset.id);}
    else if(action==='hide-supplier-key'){RelaySupplier.clear();render();}
    else if(action==='home'||action==='new'){state.buyerTab='request';state.setupAgentId=null;state.addingAgent=false;state.auth=state.account?.recoveryRequired?'reset':null;state.intent=null;state.detail=null;state.editing=false;location.hash='';render();}
    else if(action==='login'||action==='signup'||action==='signup-buyer'){state.auth=action==='login'?'login':'signup';if(action==='signup-buyer')state.intent='buyer';render();}
    else if(action==='recover'){state.auth='recover';render();}
    else if(action==='builder'){state.intent='builder';state.auth='signup';render();}
    else if(action==='example'){const field=root.querySelector('#request-text,textarea#request');if(field){field.value=examples[Number(button.dataset.example)];state.prompt=field.value;field.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});field.focus({preventScroll:true});}}
    else if(action==='focus-prompt'){const field=root.querySelector('textarea#request');if(field){field.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});field.focus({preventScroll:true});}}
    else if(action==='toggle-motion'){state.motionPaused=!state.motionPaused;root.querySelector('.lp-cast')?.classList.toggle('lp-motion-paused',state.motionPaused);button.setAttribute('aria-pressed',String(state.motionPaused));button.textContent=state.motionPaused?'Play animations':'Pause animations';}
    else if(action==='logout'){
      await api('/api/auth/logout',{method:'POST',body:{}});
      resetClientSession();
      retries.clear();location.hash='';render();
    }
    else if(action==='switch'){const workspace=state.account.user.workspace==='buyer'?'builder':'buyer';await api('/api/me/workspace',{method:'PATCH',body:{workspace}});await refresh(null);state.reviewOffer=null;state.setupAgentId=null;state.addingAgent=false;state.editing=false;location.hash='';render();}
    else if(action==='spending-export'){await RelayPayments.exportCsv();}
    else if(action==='spending-page'){const current=state.spendingHistory;state.spendingHistory=await api('/api/payments/history?tenantId='+encodeURIComponent(current.tenantId)+'&snapshot='+encodeURIComponent(current.snapshotId)+'&page='+encodeURIComponent(button.dataset.page));render();}
    else if(action==='spending-all'){state.spendingFrom='';state.spendingTo='';await refresh(null);render();}
    else if(action==='buyer-nav'){
      state.buyerTab=button.dataset.tab;
      if(state.buyerTab==='business' && typeof RelayTeams==='object'){
        state.tenantId=RelayTeams.entryTenant(state.account.memberships,state.tenantId);
        state.budgetAfter='';
        state.teamHistoryBefore='';
      }
      state.detail=null;
      state.editing=false;
      state.reviewStart=false;
      state.reviewOffer=null;
      if(state.buyerTab!=='request')state.preferredAgent=null;
      location.hash=['tasks','market','scheduled','apps','tools','billing'].includes(state.buyerTab)?state.buyerTab:'';
      await refresh(null);
      render();
    }
    else if(action==='task'){state.reviewStart=false;state.editing=false;await refresh(button.dataset.id);state.buyerTab=state.detail.task.status==='draft'?'request':'tasks';location.hash=`${state.detail.task.status==='draft'?'chat':'task'}=${button.dataset.id}`;render();}
    else if(action==='builder-tab'){state.setupAgentId=null;state.addingAgent=false;location.hash='';state.builderTab=button.dataset.tab;await refresh();render();}
    else if(action==='add-agent'){state.setupAgentId=null;state.addingAgent=true;state.agentIntroPart='profile';location.hash='agent-new';try{state.agentDraft=JSON.parse(sessionStorage.getItem(agentDraftKey()))||null;state.agentIntroPart=state.agentDraft?.part||'profile';}catch{state.agentDraft=null;}render();}
    else if(action==='continue-capabilities'){const form=document.getElementById('agent');if(!form.reportValidity())return;captureAgentDraft(form);state.agentIntroPart='capabilities';state.agentDraft.part='capabilities';sessionStorage.setItem(agentDraftKey(),JSON.stringify(state.agentDraft));render();}
    else if(action==='edit-introduction'){state.agentIntroPart='profile';render();}
    else if(action==='stop-agent'||action==='close-agent'){state.addingAgent=false;state.setupAgentId=null;state.builderTab='agents';location.hash='';render();}
    else if(action==='readiness-account'){state.returnAgentId=button.dataset.id;state.setupAgentId=null;state.builderTab='settings';location.hash='';render();}
    else if(action==='open-agent'||action==='agent-step'){state.setupAgentId=button.dataset.id;const a=state.agents.find(a=>a.id===state.setupAgentId);state.setupStage=action==='agent-step'?Number(button.dataset.step):(a.setupStage||2);location.hash=`agent=${a.id}&step=${state.setupStage}`;if(action==='open-agent')await refresh(null);render();}
    else if(action==='add-capability'){document.querySelector('#capability-rows').insertAdjacentHTML('beforeend',capabilityRow());captureAgentDraft(document.getElementById('agent'));}
    else if(action==='remove-capability'){if(document.querySelectorAll('.capability-row').length>1){button.closest('.capability-row').remove();captureAgentDraft(document.getElementById('agent'));}else notice.textContent='Keep at least one capability.';}
    else if(action==='connect-runtime'||action==='disconnect-runtime'){
      const agent=state.agents.find(item=>item.id===button.dataset.id);
      await command(`/api/agents/${agent.id}/${action==='connect-runtime'?'connect-local':'disconnect'}`,'POST',{expectedVersion:agent.version});
      await refresh();render();notice.textContent=action==='connect-runtime'?'Runtime launched. Check connection, then save your quoting rules in Connect or Demonstrate.':'Runtime disconnected and credential revoked.';
    }
    else if(action==='authorize-local'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/authorize-local`,'POST',{expectedVersion:task.version,mode:'local-unpaid'});
      state.reviewStart=false;state.followExecution=true;await refresh();state.scrollTarget='.execution-update';render();
    }
    else if(action==='accept-delivery'){
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/accept-delivery`,'POST',{expectedVersion:task.version,submissionId:button.dataset.id});
      await refresh();state.scrollTarget='.delivery-submission:last-of-type';render();
    }
    else if(action==='hide-start'){state.reviewStart=false;render();}
    else if(action==='review-start'){state.reviewStart=true;state.scrollTarget='.start-review';render();}
    else if(action==='review-offer'||action==='close-review'){
      const reviewing = action === 'review-offer';
      const offerId = reviewing ? button.dataset.id : state.reviewOffer;
      state.reviewOffer = reviewing ? offerId : null;
      state.scrollTarget = reviewing ? '.offer-confirm' : null;
      render();
      focusOfferReview(offerId, reviewing);
    }
    else if(action==='accept-offer'){
      await command(`/api/tasks/${state.detail.task.id}/select`,'POST',{offerId:button.dataset.id,expectedVersion:state.detail.task.version});
      state.reviewOffer=null;await refresh();
      const needsApproval=state.detail.approval&&state.detail.approval.status!=='approved';
      state.reviewStart=!needsApproval;state.scrollTarget=needsApproval?'[aria-label="Company approval"]':'.start-review';render();
      root.querySelector('#workspace-main')?.focus({ preventScroll: true });
      notice.textContent=needsApproval?'Offer selected. Request fresh company approval below before starting.':'Offer selected. Review the remaining start requirements in this conversation. No charge or execution authorized.';
    }
    else if(action==='edit'||action==='stop-edit'){state.editing=action==='edit';state.editingTitleTouched=false;render();}
    else if(action==='refresh'){await refresh();render();}
    else if(action==='post'||action==='cancel'){
      if(action==='cancel'&&!window.confirm('Cancel this task? It will stay in your history and can no longer be changed.'))return;
      const task=state.detail.task;
      await command(`/api/tasks/${task.id}/${action}`,'POST',{expectedVersion:task.version});await refresh();if(action==='post'){state.reviewChatRequest=false;state.buyerTab='tasks';location.hash=`task=${task.id}`;}render();
    }
  },button.closest('form,.panel'));
});
root.addEventListener('input',event=>{if(event.target.closest('form#edit')){if(event.target.name==='title')state.editingTitleTouched=true;if(event.target.name==='brief'&&!state.editingTitleTouched){const title=event.target.form.querySelector('[name=title]');title.value=event.target.value.trim().split(/[\n.!?]/)[0].slice(0,120);}}if(event.target.id==='message-text'&&state.detail)state.messageDrafts[state.detail.task.id]=event.target.value;});
root.addEventListener('click', event => {
  if (!event.target.closest('.skip-workspace')) return;
  event.preventDefault();
  root.querySelector('#workspace-main')?.focus();
});
root.addEventListener('keydown',event=>{
  if (event.target.tagName !== 'TEXTAREA' || event.key !== 'Enter' || event.isComposing) return;
  const chat = ['request', 'message'].includes(event.target.form?.id);
  if ((chat && !event.shiftKey) || event.metaKey || event.ctrlKey) {
    event.preventDefault();
    if (!state.busy && event.target.value.trim()) event.target.form.requestSubmit();
  }
});
async function boot(){
  try {
    const config=await api('/api/config');state.authMode=config.authMode==='managed'?'managed':'local';state.features=config.features||{};
    if(state.authMode==='managed'){
      document.querySelector('.poc-strip').textContent='Private staging · real accounts and saved tasks · no payments or agent execution';
      if(location.pathname==='/auth/confirm'){
        const params=new URLSearchParams(location.hash.slice(1));
        const tokenHash=params.get('token_hash'),type=params.get('type');
        history.replaceState(null,'','/auth/confirm');
        if(tokenHash&&['email','recovery'].includes(type)){state.confirmation={tokenHash,type};state.auth='confirm';render();return;}
      }
    }
    const invite=location.hash.match(/^#team-invite=([A-Za-z0-9_-]{43})$/);if(invite){state.teamInviteToken=invite[1];state.buyerTab='business';history.replaceState(null,'',location.pathname);}
    if(typeof RelayAgentMarket === 'object' && RelayAgentMarket.storefrontId())state.buyerTab='market';
    if(['#market','#scheduled','#apps','#tools'].includes(location.hash))state.buyerTab=location.hash.slice(1);
    if(location.hash==='#billing')state.buyerTab='billing';
    if(location.hash==='#payment-recovery')state.recoveryOpen=true;
    if(location.hash==='#agent-new')state.addingAgent=true;if(location.hash==='#tasks')state.buyerTab='tasks';
    const setup=location.hash.match(/^#agent=([0-9a-f-]{36})&step=([1-3])$/);if(setup){state.setupAgentId=setup[1];state.setupStage=Number(setup[2]);}
    const id=location.hash.match(/^#(?:task|chat)=([0-9a-f-]{36})$/)?.[1];await refresh(id);if(state.addingAgent){try{state.agentDraft=JSON.parse(sessionStorage.getItem(agentDraftKey()))||null;state.agentIntroPart=state.agentDraft?.part||'profile';}catch{state.agentDraft=null;}}}
  catch(error){if(error.status!==401)notice.textContent=error.message;}
  render();
}
boot();

// Poll only active local workspaces, without interrupting typing or offer review.
// This is discovery/status refresh, never an automatic mutation or offer acceptance.
let lastInteraction=Date.now();
for(const type of ['pointerdown','keydown','input'])root.addEventListener(type,()=>{lastInteraction=Date.now();});
let workspacePolling = false;
const refreshedFields = ['spendingHistory','account','auth','tenantId','payments','recoveryData','operationsBacklog','operationsBacklogUser','schedules','executionQueue','workspaceApps','drive','team','teamHistory','companyBudget','tasks','agents','opportunities','work','quotes','detail','offers'];
function workspaceSnapshot(value) {
  return JSON.stringify(refreshedFields.map(field => field === 'executionQueue' ? value[field]?.items : value[field]));
}
async function pollWorkspace() {
  if(typeof RelayExecution==='object')RelayExecution.updateClock();
  if(workspacePolling||state.authMode!=='local'||!state.account||state.auth||state.busy||state.filePreview||document.hidden||state.editing||state.addingAgent||(state.setupAgentId&&state.setupStage!==3)||state.reviewOffer||(state.builderReplyDirty&&root.querySelector('[data-supplier-message],[data-change-propose]'))||Date.now()-lastInteraction>300000)return;
  const interacting = () => (document.activeElement?.matches('input,textarea,select')&&state.detail?.task.scoping?.status!=='pending')||root.querySelector('.account-menu[open]')||document.activeElement?.closest('details[open]:not(.workspace-navigation)');
  if(interacting())return;
  if(!state.recoveryOpen&&!['scheduled','apps','tools'].includes(state.buyerTab)&&state.account.user.workspace==='buyer'&&(!state.detail||(state.detail.task.status==='draft'&&state.detail.task.scoping?.status!=='pending')))return;
  workspacePolling = true;
  const revision = actionRevision, view = state.renderedViewKey;
  const candidate = { ...state };
  try {
    await refresh(state.detail?.task.id, candidate, true);
    // A background read cannot win over navigation, a command, or newly focused input.
    if(state.busy||actionRevision!==revision||state.renderedViewKey!==view||interacting())return;
    if(workspaceSnapshot(candidate)!==workspaceSnapshot(state)) {
      for(const field of refreshedFields)state[field]=candidate[field];
      render();
    }
  } catch(error) {
    if(actionRevision===revision&&state.renderedViewKey===view&&!state.busy) {
      if(error.status===401)showError(error);
      else if ([403,404].includes(error.status)) {
        try { await recoverUnavailableTask(error); } catch (refreshError) { showError(refreshError); }
      }
    }
    // Transient polling failures retry on the next interval without flashing UI.
  } finally { workspacePolling = false; }
}
setInterval(pollWorkspace,2000);

function agentDraftKey(){return `relay-agent-draft:${state.account?.user.id||'visitor'}`;}
function captureAgentDraft(form){
 const data=new FormData(form);state.agentDraft={name:data.get('name'),kind:data.get('kind'),purpose:data.get('purpose'),domain:data.get('domain'),part:state.agentIntroPart,capabilities:form.querySelectorAll('.capability-row').length?[...form.querySelectorAll('.capability-row')].map(row=>({category:row.querySelector('[name=category]').value,task:row.querySelector('[name=capability]').value})):state.agentDraft?.capabilities||[]};
 try{sessionStorage.setItem(agentDraftKey(),JSON.stringify(state.agentDraft));}catch{notice.textContent='Draft cannot be saved in this browser. Keep the page open until you save the agent.';}
 document.querySelector('#agent-preview')?.replaceChildren();const preview=document.querySelector('#agent-preview');if(preview)preview.innerHTML=agentPreview(state.agentDraft);
 const domain=form.querySelector('[name=domain]');if(domain)domain.required=data.get('kind')==='specialist';
}
root.addEventListener('input',event=>{const form=event.target.closest('form#agent');if(form)captureAgentDraft(form);});
root.addEventListener('change',event=>{if(event.target.name==='integration'&&event.target.form?.id==='agent-connection'){document.querySelector('#connection-explainer').innerHTML=connectionExplanation(event.target.value);}const form=event.target.closest('form#agent');if(form)captureAgentDraft(form);});

root.addEventListener('change',event=>{if(event.target.id==='registry-agent'){if(typeof RelaySupplier==='object')RelaySupplier.clear();const id=event.target.value;if(!id){state.setupAgentId=null;state.addingAgent=true;state.agentIntroPart='profile';location.hash='agent-new';}else{state.addingAgent=false;state.setupAgentId=id;state.setupStage=state.agents.find(a=>a.id===id)?.setupStage||2;location.hash=`agent=${id}&step=${state.setupStage}`;}render();}});

root.addEventListener('change',event=>{if(event.target.id==='team-workspace')run(async()=>{state.tenantId=event.target.value;state.budgetAfter='';state.teamInviteLink=null;await refresh(null);render();});});

root.addEventListener('change', event => {
  if (event.target.form?.id === 'schedule-create') RelayRecurring.preview(event.target.form);
});
root.addEventListener('toggle', event => {
  if (event.target.matches?.('.recurring-setup') && event.target.open) {
    RelayRecurring.preview(event.target.querySelector('form'));
  }
}, true);

root.addEventListener('input', event => {
  if (event.target.matches('[data-context-search]')) {
    const query = event.target.value.toLowerCase();
    const select = event.target.form.querySelector('[name="sourceId"]');
    for (const option of select.options) option.hidden = !option.textContent.toLowerCase().includes(query);
    const match = [...select.options].find(option => !option.hidden);
    select.value = match?.value || '';
  }
  if (event.target.id === 'message-text' && /@[^\s]*$/.test(event.target.value)) {
    const picker = root.querySelector('[data-context-picker]');
    if (picker) picker.open = true;
  }
});

// Filter in place to preserve search focus and avoid rebuilding the workspace.
root.addEventListener('input', event => {
  if (event.target.matches('[data-tool-search]')) RelayApps.filterTools(root);
  if (event.target.matches('[data-agent-market-search]')) {
    state.agentMarketQuery = event.target.value;
    RelayAgentMarket.search(root, true);
  }
});
root.addEventListener('change', event => {
  if (event.target.matches('[data-tool-category]')) RelayApps.filterTools(root);
  if (event.target.matches('[data-agent-market-type]')) {
    state.agentMarketType = event.target.value;
    RelayAgentMarket.search(root);
  }
});

root.addEventListener('toggle', event => {
  if (event.target.matches('.notification-menu')) state.notificationsOpen = event.target.open;
}, true);
root.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const menu = event.target.closest('.account-menu[open], .notification-menu[open]');
  if (!menu) return;
  event.preventDefault();
  if (menu.matches('.notification-menu')) state.notificationsOpen = false;
  menu.open = false;
  menu.querySelector('summary')?.focus();
});
let notificationPolling = false;
setInterval(async () => {
  if (notificationPolling || !state.account || state.auth || !state.features?.notifications || state.busy || document.hidden) return;
  notificationPolling = true;
  try {
    const previousMarkup = RelayNotifications.view();
    await RelayNotifications.load();
    const slot = root.querySelector('#notification-slot');
    // Do not replace controls under someone's pointer or keyboard focus.
    if (slot && !slot.querySelector('details[open]') && !slot.contains(document.activeElement)) {
      const markup = RelayNotifications.view();
      if (previousMarkup !== markup) slot.innerHTML = markup;
    }
  } catch { state.notificationError = 'Updates could not load. Try Refresh.'; }
  finally { notificationPolling = false; }
}, 15000);

function resizeChatComposer(input) {
  if(!input)return;
  input.style.height='auto';
  input.style.height=Math.min(144,input.scrollHeight)+'px';
}
root.addEventListener('input', event => {
  if(event.target.closest('[data-supplier-message],[data-change-propose]'))state.builderReplyDirty=true;
  if(event.target.id==='message-text') {
    resizeChatComposer(event.target);
  }
});

// Update only the elapsed label; background timing must not remount controls.
setInterval(() => {
  for (const node of document.querySelectorAll('[data-reply-start]')) {
    const seconds = Math.max(0, Math.floor((Date.now() - Number(node.dataset.replyStart)) / 1000));
    node.textContent = `${seconds}s elapsed`;
  }
}, 1000);

// Storefront links are local authenticated routes; browser Back restores discovery.
if (typeof window === 'object') window.addEventListener('hashchange', event => {
  const profile = RelayAgentMarket.storefrontId();
  const returning = location.hash === '#market' && new URL(event.oldURL).hash.startsWith('#storefront=');
  if ((!profile && !returning) || !state.account || state.auth) return;
  state.buyerTab = 'market';
  if (returning && state.account.user.workspace === 'builder') { state.setupAgentId=null;state.addingAgent=false;state.builderTab='agents'; }
  state.detail = null;
  run(async () => { await refresh(null); render(); root.querySelector('#workspace-main')?.focus(); });
});
