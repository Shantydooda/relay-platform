'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const vm=require('node:vm');const {text}=require('../../../packages/ui/src/components.cjs');
function ui(){const state={authMode:'local',detail:{task:{status:'posted',version:2,scopeVersion:1}},offers:[],agents:[],work:[],quotes:[],opportunities:[],builderTab:'agents'};const ctx=vm.createContext({state,escape:text,date:()=> 'Date',Intl,Date});for(const file of ['supplier-ui.js','marketplace.js','buyer-flow.js'])vm.runInContext(readFileSync(resolve(__dirname,'../public',file),'utf8'),ctx);return {state,ctx};}
test('offer review escapes supplier content, requires explicit selection and does not authorize work',()=>{
 const {state,ctx}=ui();state.offers=[{id:'offer',agentName:'<img onerror=bad>',agentType:'specialist',operatorName:'A',amountMinor:7500,deliveryMinutes:45,proposal:'</article><script>bad</script>',capability:'Custom task',taskVersion:2,scopeVersion:1,expiresAt:Date.now()+100000}];
 let html=vm.runInContext('offerCards()',ctx);assert.doesNotMatch(html,/<img onerror|<script>/);assert.match(html,/Not currently assessed/);assert.match(html,/Review offer/);assert.doesNotMatch(html,/data-action="accept-offer"/);
 state.reviewOffer='offer';html=vm.runInContext('offerCards()',ctx);assert.match(html,/Confirm selection/);assert.match(html,/no execution is authorized/);
 state.detail.task.version=3;html=vm.runInContext('offerCards()',ctx);assert.match(html,/Confirm selection/);
 state.detail.task.scopeVersion=2;html=vm.runInContext('offerCards()',ctx);assert.doesNotMatch(html,/data-action="accept-offer"/);assert.match(html,/new offer is required/);
});
test('builder introduction supports both types and unrestricted capability wording, without pretending to connect',()=>{
 const {state,ctx}=ui();const profile=vm.runInContext('agentForm()',ctx);assert.match(profile,/Continue to capabilities/);state.agentIntroPart='capabilities';const html=profile+vm.runInContext('agentForm()',ctx);assert.match(html,/General-purpose/);assert.match(html,/Domain-specialist/);assert.match(html,/name="category"/);assert.match(html,/name="capability"/);assert.match(html,/Add another capability/);assert.match(html,/Continue to connection/);assert.doesNotMatch(html,/value="qualified"/);
});
test('builder tasks distinguish selection from execution; delivery is an empty state rather than fictional files',()=>{
 const {state,ctx}=ui();state.builderTab='work';state.work=[{id:'same-task',status:'selected',title:'Research',brief:'Find companies',agentName:'Researcher',amountMinor:7500,deliveryMinutes:45,acceptedAt:Date.now(),proposal:'CSV',messages:[{authorName:'Buyer',body:'<script>bad</script>'}]}];
 const html=vm.runInContext('builder()',ctx);assert.match(html,/same-task/);assert.match(html,/Selected · awaiting start requirements/);assert.doesNotMatch(html,/<script>/);assert.match(html,/No work has started automatically/);assert.match(html,/No submission has been received/);
});
test('already quoted agents are excluded by scope version, not by informational chat version',()=>{
 const {state,ctx}=ui();state.agents=[{id:'one'},{id:'two'}];ctx.task={version:3,scopeVersion:1,myOffers:[{agentId:'one',taskVersion:2,scopeVersion:1,expiresAt:Date.now()+100000}]};
 assert.equal(vm.runInContext('availableAgents(task).map(a=>a.id).join()',ctx),'two');ctx.task.scopeVersion=2;assert.equal(vm.runInContext('availableAgents(task).length',ctx),2);
});
test('three-stage setup separates connection preference, assessments and operator readiness',()=>{
 const {state,ctx}=ui();const a={id:'agent',name:'Agent',kind:'general',purpose:'Research',integration:'api',setupStage:2,capabilities:[{task:'Any task',category:'Any category'}],readiness:{profile:true},rules:{automaticRequested:true,minimumPayout:1000,concurrency:1}};state.agents=[a];state.setupAgentId=a.id;state.setupStage=2;
 let html=vm.runInContext('builder()',ctx);assert.match(html,/01<\/small> Introduce/);assert.match(html,/02<\/small> Connect/);assert.match(html,/03<\/small> Demonstrate/);assert.match(html,/HTTP API/);assert.match(html,/SDK/);assert.match(html,/MCP/);assert.match(html,/Optional connection diagnostic/);assert.match(html,/Not ready for paid work/);
 state.setupStage=3;html=vm.runInContext('builder()',ctx);assert.match(html,/Automatic bidding inactive/);assert.match(html,/Test CSV normalization/);assert.match(html,/Connect your runtime in step 2/);assert.doesNotMatch(html,/Mark as passed|data-action="start"/);
});
test('start review preserves approval, funding, inputs and authorization as separate blockers',()=>{
 const {state,ctx}=ui();state.detail.task.status='selected';const html=vm.runInContext('startReview(state.detail.task)',ctx);assert.match(html,/Company approval/);assert.match(html,/Funding/);assert.match(html,/Required inputs/);assert.match(html,/Work has not started/);assert.doesNotMatch(html,/data-action="start"|data-action="pay"/);
});
test('local guidance distinguishes price questions and hypothetical changes from confirmed scope',()=>{
 const {ctx}=ui();ctx.task={status:'posted'};ctx.messages=[{body:'Find 20 companies.'},{body:'What if we needed 50 instead?'}];assert.match(vm.runInContext('conversationGuidance(task,messages)',ctx),/not a confirmed change/);
 ctx.messages[1].body='How much will this cost?';assert.match(vm.runInContext('conversationGuidance(task,messages)',ctx),/planning estimate is not a confirmed quote/);
 ctx.messages[1].body='When does the agent start?';assert.match(vm.runInContext('conversationGuidance(task,messages)',ctx),/Time to start and time to deliver are different/);
});
test('new-agent refresh restores only the authenticated account draft after identity is loaded',async()=>{
 const app={innerHTML:'',addEventListener(){},querySelector(){return null;}},notice={textContent:''},seen=[];
 const draft={part:'capabilities',name:'Restored agent',purpose:'Research',kind:'general',domain:'',capabilities:[{category:'Custom',task:'Open-ended task'}]};
 const document={body:{classList:{toggle(){}}},querySelector(selector){return selector==='#app'?app:notice;}};
 const payloads={'/api/config':{authMode:'local'},'/api/me':{user:{id:'account-one',name:'A',email:'a@example.test',workspace:'builder'},memberships:[]},'/api/agents':{agents:[]},'/api/opportunities':{tasks:[]},'/api/work':{tasks:[]},'/api/quotes':{offers:[]}};
 const ctx=vm.createContext({document,Intl,Date,location:{hash:'#agent-new',pathname:'/'},sessionStorage:{getItem(key){seen.push(key);return key==='relay-agent-draft:account-one'?JSON.stringify(draft):null;}},RelayRequest:{request:async path=>payloads[path]},setInterval(){},URLSearchParams,console});
 for(const file of ['marketplace.js','buyer-flow.js','app.js'])vm.runInContext(readFileSync(resolve(__dirname,'../public',file),'utf8'),ctx);
 await new Promise(setImmediate);assert.deepEqual(seen,['relay-agent-draft:account-one']);assert.match(app.innerHTML,/Restored agent/);assert.match(app.innerHTML,/Open-ended task/);
});
test('runtime UI distinguishes local permission from paid readiness and escapes delivered evidence',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/execution-ui.js'),'utf8'),ctx);
 state.features={localExecution:true};state.detail.task.status='selected';state.offers=[{selected:true,runtimeBid:true}];
 assert.match(vm.runInContext('RelayExecution.start(state.detail.task)',ctx),/Run locally · no payment/);
 state.detail.execution={status:'buyer_review',startedAt:Date.now()-1000,completedAt:Date.now(),progress:'Files delivered',attempt:1};state.detail.task.id='task';
 state.detail.submissions=[{id:'submission',version:1,status:'ready',evidence:'<script>bad</script>',files:[{id:'file',filename:'clean.csv',size:20}]}];
 const html=vm.runInContext('RelayExecution.delivery(state.detail.task)',ctx);assert.doesNotMatch(html,/<script>/);assert.match(html,/accept-delivery/);assert.match(html,/submissions\/submission\/files\/file/);assert.match(html,/No payout is triggered/);
 state.detail.execution.status='accepted';assert.doesNotMatch(vm.runInContext('RelayExecution.delivery(state.detail.task)',ctx),/data-action="accept-delivery"/);
});
test('local clock reports finished delivery duration rather than a forever-running timer',()=>{
 const {ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/execution-ui.js'),'utf8'),ctx);
 assert.equal(vm.runInContext('RelayExecution.clock(1000,1100)',ctx),'delivered under 1s after starting');
 assert.equal(vm.runInContext('RelayExecution.clock(1000,62000)',ctx),'delivered 1m 1s after starting');
});

test('supplier setup keeps the one-time key out of rendered content and separates local connection from qualification',()=>{
 const {state,ctx}=ui();
 state.features={localExecution:true};ctx.agent={id:'agent',integration:'api',runtime:{transport:'supplier-api',connected:true,expiresAt:Date.now()+3600000}};
 vm.runInContext("RelaySupplier.issued={agentId:'agent',token:'DO_NOT_RENDER_THIS_KEY'}",ctx);
 const html=vm.runInContext('RelaySupplier.connection(agent)',ctx);
 assert.match(html,/Save connection file/);assert.match(html,/supplier heartbeat received/);assert.doesNotMatch(html,/DO_NOT_RENDER_THIS_KEY/);assert.match(html,/not qualification/);
 vm.runInContext('RelaySupplier.clear()',ctx);assert.doesNotMatch(vm.runInContext('RelaySupplier.connection(agent)',ctx),/Save connection file/);
});

test('local scope proposals stay escaped, explicit and separate from posting or recurring execution',()=>{
 const {state,ctx}=ui();state.features={scoping:true};
 state.detail.task={status:'draft',id:'task',version:3,scopeVersion:1,brief:'Original',scoping:{id:'proposal',status:'completed',proposal:{title:'<script>bad</script>',brief:'Every Monday find 50 companies',intent:'request',cadence:'weekly',questions:['Timezone?'],assumptions:['<img onerror=bad>'],schedule:'Monday',timezone:null,perRunBudget:null,monthlyCap:null}}};
 let html=vm.runInContext('scopingReview(state.detail.task)',ctx);
 assert.match(html,/Save recurring draft/);assert.match(html,/does not schedule runs or authorize charges/);assert.doesNotMatch(html,/<script>|<img|data-action="post"/);
 state.detail.task.scoping.proposal.intent='hypothetical';html=vm.runInContext('scopingReview(state.detail.task)',ctx);assert.match(html,/did not change/);assert.doesNotMatch(html,/confirm-scope/);
 state.detail.task.scoping={status:'failed',error:'Local reply unavailable'};html=vm.runInContext('scopingReview(state.detail.task)',ctx);assert.match(html,/Retry reply/);
});

test('qualification evidence escapes supplier strings and never presents a partial test as a pass',()=>{
 const {ctx}=ui();ctx.test={rubric:'csv-normalize-v1',limitation:'CSV only',runtimeName:'<script>bad</script>',runtimeVersion:'1',input:'<img onerror=bad>',submissions:[{round:1,passed:false,csv:'<script>bad</script>',report:{sort:'ascending'},sha256:'abc',checks:[{name:'Output',passed:false}]}]};
 const html=vm.runInContext('RelaySupplier.evidence(test)',ctx);assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/Initial delivery.*Failed/);assert.match(html,/not a human review/);
});


test('sandbox UI distinguishes disconnected readiness, pending payout and confirmed payout without leaking supplier markup',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/payments-ui.js'),'utf8'),ctx);
 state.payments={configured:false,operator:{status:'not_started'}};
 let html=vm.runInContext('RelayPayments.settings()',ctx);
 assert.match(html,/not marked verified/);assert.doesNotMatch(html,/id="sandbox-operator"/);
 state.payments={configured:true,operator:{status:'sandbox_ready'}};
 html=vm.runInContext('RelayPayments.settings()',ctx);assert.match(html,/id="sandbox-operator"/);assert.match(html,/not production identity verification/);
 ctx.task={id:'fixture',version:7};ctx.payment={status:'payout_pending',amountMinor:200};
 html=vm.runInContext('RelayPayments.task(task,payment,true,{status:"accepted"})',ctx);
 assert.match(html,/Payout pending/);assert.doesNotMatch(html,/Sandbox payout confirmed|data-operation="payout"/);
 ctx.payment.status='paid';html=vm.runInContext('RelayPayments.task(task,payment,true,{status:"accepted"})',ctx);assert.match(html,/Sandbox payout confirmed/);
 ctx.payment.status='<script>bad</script>';html=vm.runInContext('RelayPayments.task(task,payment,true)',ctx);assert.doesNotMatch(html,/<script>/);
});


test('automatic payment checks show retries and review without exposing provider errors or offering another payout',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/payments-ui.js'),'utf8'),ctx);
 state.payments={configured:true};ctx.task={id:'fixture',version:9};ctx.payment={status:'payout_pending',amountMinor:200,reconciliation:{status:'retrying'}};
 let html=vm.runInContext('RelayPayments.task(task,payment,true)',ctx);assert.match(html,/retry automatically/);
 ctx.payment={status:'paid',amountMinor:200,reconciliation:{status:'needs_review',errorCode:'<script>private</script>'}};
 html=vm.runInContext('RelayPayments.task(task,payment,true)',ctx);assert.match(html,/Payment needs review/);assert.doesNotMatch(html,/Sandbox payout confirmed|data-operation=|<script>/);
});
test('recovery dashboard escapes audit notes and offers retries only for eligible checks',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/payments-ui.js'),'utf8'),ctx);
 state.recoveryData={configured:true,items:[{id:'task:test',type:'task',title:'<script>bad</script>',status:'needs_review',amountMinor:null,failures:12,canRetry:false,blockedReason:'Review discrepancy',history:[{reason:'<img src=x>',createdAt:1}]}]};
 let html=vm.runInContext('RelayPayments.recovery()',ctx);assert.doesNotMatch(html,/<script>|<img|Queue safe retry/);assert.match(html,/Review discrepancy/);
 state.recoveryData.items[0].canRetry=true;html=vm.runInContext('RelayPayments.recovery()',ctx);assert.match(html,/Queue safe retry/);assert.match(html,/minlength="10"/);
});
test('failed refund and payout labels remain specific and remove financial actions',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/payments-ui.js'),'utf8'),ctx);state.payments={configured:true};
 for(const status of ['refund_failed','payout_failed']){
  ctx.payment={status,amountMinor:200,reconciliation:{status:'needs_review'}};
  const html=vm.runInContext("RelayPayments.task({id:'task',version:1},payment,true)",ctx);
  assert.match(html,new RegExp(status==='refund_failed'?'Refund needs review':'Payout needs review'));
  assert.doesNotMatch(html,/data-operation=/);assert.match(html,/operations review/);
 }
});
test('team workspace escapes names and limits invitation controls to administrators',()=>{
 const {state,ctx}=ui();state.account={memberships:[{id:'t',name:'<script>x</script>',role:'employee'}]};state.tenantId='t';state.team={name:'Orbit',role:'employee'};
 vm.runInContext(readFileSync(resolve(__dirname,'../public/teams-ui.js'),'utf8'),ctx);
 const html=vm.runInContext('RelayTeams.page()',ctx);assert.doesNotMatch(html,/<script>|id="team-invite"|Remove access/);assert.match(html,/administrator manages/);assert.match(html,/Review invitation/);
});
test('approval cards escape notes, show resubmission, and restrict reviewer controls',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/approvals-ui.js'),'utf8'),ctx);
 state.detail.task.selectedOfferId='offer';state.detail.approval={status:'declined',decisionNote:'<script>bad</script>'};
 let html=vm.runInContext('RelayApprovals.task(state.detail.task,state.detail.approval)',ctx);
 assert.match(html,/Resubmit for approval/);assert.doesNotMatch(html,/<script>/);
 state.team={role:'employee'};state.companyBudget={budget:null,requests:[{id:'a',taskId:'t',version:1,status:'pending',note:'<img src=x>',agreement:{title:'Research',brief:'Scope',agentName:'Agent',amountMinor:500,scopeVersion:1,offerId:'offer',expiresAt:Date.now()+10000}}]};
 html=vm.runInContext('RelayApprovals.workspace()',ctx);assert.doesNotMatch(html,/Send decision|Save allowance|<img/);
 state.team.role='approver';html=vm.runInContext('RelayApprovals.workspace()',ctx);assert.match(html,/Send decision/);assert.doesNotMatch(html,/Save allowance/);
 state.detail.task.status='selected';state.detail.task.approvalStatus='pending';assert.equal(vm.runInContext('taskLabel(state.detail.task)',ctx),'Waiting for approval');
});
test('changing approved offer keeps comparison open and explains fresh approval',()=>{
 const {state,ctx}=ui();state.detail.task.status='selected';state.detail.approval={status:'approved'};
 const offer={id:'old',selected:true,agentName:'First',agentType:'general',operatorName:'Supplier',amountMinor:3500,deliveryMinutes:1,proposal:'CSV',capability:'CSV',scopeVersion:1,expiresAt:Date.now()+100000};
 state.offers=[offer,{...offer,id:'new',selected:false,agentName:'Replacement',amountMinor:4500}];state.reviewOffer='new';
 const html=vm.runInContext('offerCards()',ctx);assert.match(html,/<details class="thread-alternatives" open>/);assert.match(html,/requires fresh company approval/);assert.match(html,/Confirm selection/);
});
test('invalidated approval distinguishes current terms from prior decision and completed unpaid work releases allowance',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/approvals-ui.js'),'utf8'),ctx);
 state.detail.task.selectedOfferId='new';state.offers=[{id:'new',agentName:'Replacement',amountMinor:4500}];
 state.detail.approval={status:'stale',agreement:{agentName:'First',amountMinor:3500,scopeVersion:1},decisionNote:'Old decision'};
 let html=vm.runInContext('RelayApprovals.task(state.detail.task,state.detail.approval)',ctx);assert.match(html,/Now selected:/);assert.match(html,/Previous request: First/);assert.match(html,/Previous reviewer’s note/);
 state.detail.approval.status='approved';state.detail.execution={status:'accepted',paymentStatus:'not_applicable_local_unpaid'};
 html=vm.runInContext('RelayApprovals.task(state.detail.task,state.detail.approval)',ctx);assert.match(html,/allowance released/);assert.doesNotMatch(html,/Resubmit for approval/);
});
test('team administration escapes history and provides explicit removal review only to owners', () => {
 const {state,ctx}=ui();
 vm.runInContext(readFileSync(resolve(__dirname,'../public/teams-ui.js'),'utf8'),ctx);
 state.account={memberships:[{id:'team',name:'Company',role:'owner'}]};state.tenantId='team';
 state.team={name:'Company',role:'owner',members:[{id:'person',name:'<script>bad</script>',email:'person@example.test',role:'employee'}],invites:[]};
 state.teamHistory={entries:[{action:'member.role_changed',subjectName:'<script>bad</script>',actorName:'Owner',createdAt:1,details:{from:'employee',to:'approver'}}]};
 let html=vm.runInContext('RelayTeams.page()',ctx);
 assert.doesNotMatch(html,/<script>/);assert.match(html,/Save role/);assert.match(html,/Access history/);assert.doesNotMatch(html,/Confirm removal/);
 state.teamRemoval='person';html=vm.runInContext('RelayTeams.page()',ctx);assert.match(html,/Confirm removal/);assert.match(html,/Keep access/);
 state.team.role='employee';html=vm.runInContext('RelayTeams.page()',ctx);assert.doesNotMatch(html,/Save role|Access history|Confirm removal/);
});
test('delivery preview stays in the task, escapes file text and marks truncated output', () => {
 const {state,ctx}=ui();
 vm.runInContext(readFileSync(resolve(__dirname,'../public/execution-ui.js'),'utf8'),ctx);
 const file={id:'file',filename:'result.txt',mime:'text/plain',size:30000};ctx.file=file;
 state.filePreview={key:'task:submission:file',text:'<script>bad</script>',notice:'Integrity only',sha256:'abc',truncated:true,limit:16000};
 const html=vm.runInContext("RelayExecution.file('task','submission',file)",ctx);
 assert.doesNotMatch(html,/<script>/);assert.match(html,/&lt;script&gt;/);
 assert.match(html,/first 16,000 characters/);assert.match(html,/Close preview/);assert.match(html,/\/api\/tasks\/task\/submissions\/submission\/files\/file/);
});

test('quarantine hides preview, download and cached content until scanning passes', () => {
 const {state,ctx}=ui();
 vm.runInContext(readFileSync(resolve(__dirname,'../public/execution-ui.js'),'utf8'),ctx);
 ctx.file={id:'file',filename:'result.txt',mime:'text/plain',size:100,scan:{status:'scan_error',reason:'Scanner unavailable'}};
 state.filePreview={key:'task:submission:file',text:'cached secret'};
 let html=vm.runInContext("RelayExecution.file('task','submission',file)",ctx);
 assert.match(html,/Scan incomplete/);assert.match(html,/Retry file scan/);
 assert.doesNotMatch(html,/file-download|preview-file|cached secret/);
 ctx.file.scan={status:'clean',reason:'No threats reported'};
 html=vm.runInContext("RelayExecution.file('task','submission',file)",ctx);
 assert.match(html,/file-download/);assert.match(html,/preview-file/);
});
test('busy action preserves existing disabled buttons and newly rendered policy controls', async () => {
 const source=readFileSync(resolve(__dirname,'../public/app.js'),'utf8');
 const runSource=source.slice(source.indexOf('async function run('),source.indexOf("root.addEventListener('submit'"));
 const original={disabled:false,isConnected:true}, blocked={disabled:true,isConnected:true}, replacement={disabled:true,isConnected:true};
 let buttons=[original,blocked];
 const ctx=vm.createContext({actionRevision:0,state:{},notice:{textContent:''},root:{querySelectorAll:()=>buttons},showError:error=>{throw error;}});
 vm.runInContext(runSource,ctx);
 await ctx.run(async()=>{assert.equal(original.disabled,true);buttons=[replacement];original.isConnected=false;});
 assert.equal(blocked.disabled,true);assert.equal(replacement.disabled,true);
});

test('SDK setup exposes a real local connection while MCP remains explicitly unavailable', () => {
  const { state, ctx } = ui();
  state.features = { localExecution: true };
  ctx.agent = { id: 'agent', integration: 'sdk', runtime: {} };
  const html = vm.runInContext('RelaySupplier.connection(agent)', ctx);
  assert.match(html, /Connect with the JavaScript SDK/);
  assert.match(html, /Create supplier API key/);
  assert.match(html, /not a published npm package/);
  assert.doesNotMatch(html, /SDK and MCP adapters are not implemented/);
  ctx.agent.integration = 'mcp';
  const unavailable = vm.runInContext('RelaySupplier.connection(agent)', ctx);
  assert.match(unavailable, /MCP is planned and cannot connect yet/);
  assert.doesNotMatch(unavailable, /id="supplier-credential"/);
});

test('link offers show their own rubric and escaped evidence instead of a CSV qualification', () => {
  const { state, ctx } = ui();
  state.offers = [{ id: 'link-offer', agentName: 'Linksmith', agentType: 'specialist', operatorName: 'Builder', amountMinor: 100, deliveryMinutes: 1, proposal: 'Extract links offline', capability: 'Link extraction', scopeVersion: 1, expiresAt: Date.now() + 100000, qualification: 'qualified', qualificationCurrent: true,
    qualificationEvidence: { rubric: 'link-inventory-v1', limitation: 'No websites fetched.', runtimeName: 'Offline reference', runtimeVersion: '1', input: '<script>source</script>', submissions: [{ round: 1, links: ['<script>bad</script>'], report: {}, checks: [], passed: true, sha256: 'hash' }] } }];
  const html = vm.runInContext('offerCards()', ctx);
  assert.match(html, /Offline link inventory passed/);
  assert.match(html, /No websites fetched/);
  assert.doesNotMatch(html, /CSV assessment passed|<script>/);
});

test('buyer next step prioritizes approval, quarantined files and actual execution over offer actions', () => {
  const { ctx } = ui();
  ctx.detail = { task: { status: 'selected', selectedOfferId: 'offer' }, approval: { status: 'pending' } };
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'Waiting for company approval');
  ctx.detail.approval.status = 'stale';
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'Send for company approval');
  ctx.detail.execution = { status: 'queued' };
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'Your agent is getting ready');
  ctx.detail.execution.status = 'buyer_review';
  ctx.detail.submissions = [{ files: [{ scan: { status: 'quarantined' } }] }];
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'Checking your files');
  ctx.detail.submissions[0].files[0].scan.status = 'blocked';
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'A file needs replacing');
  ctx.detail.submissions[0].files[0].scan.status = 'clean';
  assert.equal(vm.runInContext('taskNextStep(detail)[0]', ctx), 'Review your delivery');
});

test('buyer offer guidance does not invite selection of expired or stale-scope offers', () => {
  const { ctx } = ui();
  ctx.detail = { task: { status: 'posted', scopeVersion: 2 } };
  ctx.offers = [{ scopeVersion: 1, expiresAt: Date.now() + 100000 }, { scopeVersion: 2, expiresAt: Date.now() - 1000 }];
  assert.equal(vm.runInContext('taskNextStep(detail,offers)[0]', ctx), 'Finding your agent');
  ctx.offers.push({ scopeVersion: 2, expiresAt: Date.now() + 100000 });
  assert.equal(vm.runInContext('taskNextStep(detail,offers)[0]', ctx), 'Choose an offer');
});

test('delivery prioritizes the latest files and preserves revision history and scan gates', () => {
  const { state, ctx } = ui();
  vm.runInContext(readFileSync(resolve(__dirname, '../public/execution-ui.js'), 'utf8'), ctx);
  state.detail = { task: { id: 'task', status: 'buyer_review' }, execution: { status: 'buyer_review', runtimeKind: 'supplier-hosted' }, submissions: [
    { id: 'old', version: 1, status: 'revision_requested', evidence: 'Old result', files: [] },
    { id: 'latest', version: 2, status: 'ready', evidence: '<script>bad</script>', files: [{ id: 'file', filename: 'result.json', mime: 'application/json', size: 50, scan: { status: 'quarantined', reason: 'Awaiting scan' } }] }
  ] };
  const html = vm.runInContext('RelayExecution.delivery(state.detail.task)', ctx);
  assert.ok(html.indexOf('Delivery 2') < html.indexOf('Delivery 1'));
  assert.match(html, /Earlier deliveries \(1\)/);
  assert.match(html, /<details class="revision-request"><summary>Request changes/);
  assert.match(html, /disabled.*data-action="accept-delivery"/);
  assert.doesNotMatch(html, /<script>|href=.*\/files\//);
});

test('recurring context is escaped and scheduling requires consent with clear local limits',()=>{
 const {state,ctx}=ui();vm.runInContext(readFileSync(resolve(__dirname,'../public/recurring-ui.js'),'utf8'),ctx);
 state.features={recurring:true};ctx.task={id:'trial',status:'selected',workPlan:{cadence:'weekly'},brief:'<script>private context</script>'};
 const html=vm.runInContext('RelayRecurring.setup(task)',ctx);
 assert.doesNotMatch(html,/<script>/);assert.match(html,/name="consent" required/);assert.match(html,/no live Drive sync/);assert.match(html,/Company runs need fresh approval/);assert.match(html,/daylight-saving gaps/);
 ctx.task.status='accepted';assert.equal(vm.runInContext('RelayRecurring.setup(task)',ctx),'');
 ctx.task.status='selected';ctx.task.scheduleId='schedule';assert.equal(vm.runInContext('RelayRecurring.setup(task)',ctx),'');
 state.detail={task:{status:'selected',scheduleId:'schedule'},schedule:{status:'paused',reason:'Monthly limit reached'}};
 assert.equal(vm.runInContext('taskNextStep(state.detail,[])[0]',ctx),'Schedule paused');
 const offerHtml=vm.runInContext('offerCards()',ctx);assert.doesNotMatch(offerHtml,/data-action="review-start"|data-action="accept-offer"/);assert.match(offerHtml,/View schedule/);
});

test('schedule card extracts explicit timing and leaves ambiguous details for review', () => {
 const {state,ctx}=ui();
 vm.runInContext(readFileSync(resolve(__dirname,'../public/recurring-ui.js'),'utf8'),ctx);
 ctx.plan={schedule:'Every Tuesday at 2:30 pm'};
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).time',ctx),'14:30');
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).weekDay',ctx),2);
 ctx.plan={schedule:'Every morning'};
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).time',ctx),'');
 ctx.plan={schedule:'Monday and Friday at 09:00'};
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).weekDay',ctx),'');
 ctx.plan={schedule:'On the 31st at 12 am'};
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).monthDay',ctx),31);
 assert.equal(vm.runInContext('RelayRecurring.suggestedTiming(plan).time',ctx),'00:00');
 state.features={recurring:true};
 ctx.task={status:'selected',brief:'Weekly links',workPlan:{cadence:'weekly',schedule:'Every Tuesday at 14:30',timezone:'UTC'}};
 const html=vm.runInContext('RelayRecurring.setup(task)',ctx);
 assert.match(html,/value="2" selected/);
 assert.match(html,/value="14:30"/);
 assert.match(html,/data-schedule-preview aria-live="polite"/);
 assert.match(html,/until paused/);
 assert.doesNotMatch(html,/name="monthDay"/);
});

test('scheduled work page uses a focused composer, compact status summary and safe run rows', () => {
 const {state,ctx}=ui();
 ctx.money=value=>`$${(value/100).toFixed(2)}`;
 vm.runInContext(readFileSync(resolve(__dirname,'../public/recurring-ui.js'),'utf8'),ctx);
 state.prompt='<script>weekly request</script>';
 state.schedules=[{id:'schedule',version:3,title:'<img onerror=bad>Weekly leads',status:'active',agentName:'Scout',calendar:{cadence:'weekly',time:'09:00',timezone:'UTC'},nextAt:Date.now()+10000,perRunLimitMinor:5000,monthlyLimitMinor:20000,reservedMinor:0,month:'2026-11',context:{brief:'Find leads',input:null},companyApprovalRequired:false,runs:[{taskId:'task',status:'buyer_review',scheduledFor:Date.now()}]}];
 const html=vm.runInContext('RelayRecurring.page()',ctx);
 assert.match(html,/scheduled-composer/);
 assert.match(html,/Nothing runs from this message alone/);
 assert.match(html,/Total schedules/);
 assert.match(html,/Review delivery/);
 assert.match(html,/Run history · 1/);
 assert.doesNotMatch(html,/<script>|<img onerror/);
 state.schedules=[];
 assert.match(vm.runInContext('RelayRecurring.page()',ctx),/No scheduled work yet/);
});

test('reply progress distinguishes waiting and working and offers stop without posting',()=>{
 const {state,ctx}=ui();state.features={scoping:true};
 state.detail.task.scoping={status:'pending',phase:'waiting',requestedAt:Date.now()-5000};
 let html=vm.runInContext('scopingReview(state.detail.task)',ctx);
 assert.match(html,/Waiting for capacity/);assert.match(html,/data-reply-start/);assert.match(html,/data-action="cancel-reply"/);assert.doesNotMatch(html,/data-action="post"/);
 state.detail.task.scoping.phase='working';html=vm.runInContext('scopingReview(state.detail.task)',ctx);assert.match(html,/Working on your reply/);
 state.detail.task.scoping={status:'cancelled',error:'Saved'};html=vm.runInContext('scopingReview(state.detail.task)',ctx);assert.match(html,/Retry reply/);assert.doesNotMatch(html,/cancel-reply/);
});
