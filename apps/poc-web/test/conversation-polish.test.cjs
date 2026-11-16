const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function context(tasks = []) {
  const ctx = {
    state: { tasks },
    escape: (value) =>
      String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('"', '&quot;'),
    date: () => 'Today',
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync(
      require('node:path').join(__dirname, '../public/buyer-flow.js'),
      'utf8',
    ),
    ctx,
  );
  return ctx;
}
test('current server permission state overrides historical requests after agent replacement', () => {
  const ctx = context();
  ctx.task = { status: 'queued', waitingForPermission: false, permissionRequests: [{ assignmentId: 'old', status: 'declined' }] };
  assert.equal(vm.runInContext('taskLabel(task)', ctx), 'Agent getting ready');
  ctx.task.waitingForPermission = true;
  assert.equal(vm.runInContext('taskLabel(task)', ctx), 'Permission needed');
  // An older server still gets its existing presentation behavior.
  delete ctx.task.waitingForPermission;
  assert.equal(vm.runInContext('taskLabel(task)', ctx), 'Permission needed');
});
test('dashboard separates review, active work and completed delivery without exposing IDs in copy', () => {
  const ctx = context([
    { id: 'secret-id-1', title: 'Review me', status: 'buyer_review' },
    { id: 'secret-id-2', title: 'Running', status: 'running' },
    { id: 'secret-id-3', title: 'Finished', status: 'accepted' },
  ]);
  const html = vm.runInContext('taskDashboard()', ctx);
  assert.match(html, /Needs you/);
  assert.match(html, /Review delivery/);
  assert.match(html, /Under way/);
  assert.match(html, /Completed/);
  assert.doesNotMatch(html.replaceAll(/data-id="[^"]*"/g, ''), /secret-id/);
});
test('task cards and progress text escape user and supplier content', () => {
  const ctx = context([
    {
      id: 'x',
      title: '<img src=x>',
      brief: '<script>unsafe</script>',
      status: 'draft',
    },
  ]);
  assert.doesNotMatch(
    vm.runInContext('taskDashboard()', ctx),
    /<script>|<img src=x>/,
  );
  assert.match(
    vm.runInContext("activityCard('Waiting', '<script>', false)", ctx),
    /&lt;script>/,
  );
  assert.doesNotMatch(
    vm.runInContext("activityCard('Permission needed', 'Paused', false)", ctx),
    /activity-spinner/,
  );
});
test('pending model scope uses live activity, failed scope remains actionable', () => {
  const ctx = context();
  ctx.state.features = { scoping: true };
  assert.match(
    vm.runInContext(
      "scopingReview({status:'draft',scoping:{status:'pending'}})",
      ctx,
    ),
    /activity-spinner/,
  );
  assert.match(
    vm.runInContext(
      "scopingReview({status:'draft',scoping:{status:'failed',error:'Unavailable'}})",
      ctx,
    ),
    /Retry reply/,
  );
});

test('permission waits belong to needs-you rather than active work', () => {
  const ctx = context([
    {
      id: 'permission',
      title: 'Permission task',
      status: 'running',
      permissionRequests: [{ status: 'pending' }],
    },
  ]);
  const html = vm.runInContext('taskDashboard()', ctx);
  assert.match(html, /Review permission/);
  assert.doesNotMatch(html, /<h2>Under way/);
});
test('request displays pending feedback before storage and keeps the brief on failure', async () => {
  const source = fs.readFileSync(
    require('node:path').join(__dirname, '../public/app.js'),
    'utf8',
  );
  const fn = source.slice(
    source.indexOf('function chatController()'),
    source.indexOf('\nlet actionRevision'),
  );
  const seen = [];
  const ctx = {
    state: { prompt: 'Keep my brief', tenantId: 'tenant' },
    RelayChat: require('../public/chat-controller.js'),
    refresh: async()=>{}, location:{hash:''}, actionRevision:0, refreshedFields:[],
    render() {
      seen.push(ctx.state.sendingRequest);
    },
    command: async () => {
      assert.equal(ctx.state.sendingRequest, 'Keep my brief');
      throw new Error('Offline');
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fn, ctx);
  await assert.rejects(vm.runInContext('savePrompt()', ctx), /Offline/);
  assert.equal(ctx.state.prompt, 'Keep my brief');
  assert.equal(ctx.state.sendingRequest, null);
  assert.equal(seen[0], 'Keep my brief');
});

test('new conversation keeps the composer after the welcome and disables it while sending', () => {
  const source = fs.readFileSync(
    require('node:path').join(__dirname, '../public/app.js'),
    'utf8',
  );
  const ctx = context();
  ctx.state.prompt = 'Draft';
  ctx.composer = () =>
    '<form><textarea>Draft</textarea><button type="submit">Send</button></form>';
  ctx.exampleButtons = () => '<div>Examples</div>';
  vm.runInContext(
    source.slice(
      source.indexOf('function newTask()'),
      source.indexOf('\nfunction taskList'),
    ),
    ctx,
  );
  const initial = vm.runInContext('newTask()', ctx);
  assert.ok(
    initial.indexOf('request-welcome') < initial.indexOf('request-dock'),
  );
  ctx.state.sendingRequest = 'A request';
  const pending = vm.runInContext('newTask()', ctx);
  assert.match(pending, /textarea disabled/);
  assert.match(pending, /type="submit" disabled/);
  assert.doesNotMatch(pending, /request-welcome/);
});

test('private conversations do not appear in My tasks until requested', () => {
  const ctx = context([
    { id: 'draft-id', title: 'Private idea', status: 'draft' },
    { id: 'posted-id', title: 'Requested work', status: 'posted' },
  ]);
  const html = vm.runInContext('taskDashboard()', ctx);
  assert.doesNotMatch(html, /Private idea|draft-id/);
  assert.match(html, /Requested work/);
});

test('task filters show the selected group and retain access to all work', () => {
  const ctx = context([
    { id: 'active', title: 'In flight', status: 'running' },
    { id: 'done', title: 'Delivered result', status: 'accepted' },
  ]);
  ctx.state.taskFilter = 'Completed';
  const html = vm.runInContext('taskDashboard()', ctx);
  assert.match(html, /Delivered result/);
  assert.doesNotMatch(html, /In flight/);
  ctx.state.taskFilter = 'Needs you';
  const empty = vm.runInContext('taskDashboard()', ctx);
  assert.match(empty, /all caught up/);
  assert.match(empty, /View all tasks/);
});

test('follow-up draft retains its identity and keeps review explicit beside the conversation', () => {
  const ctx = context();
  ctx.state.detail = {
    task: { id: 'chat-id', title: '<Private brief>', status: 'draft' },
    messages: [],
  };
  ctx.state.messageDrafts = { 'chat-id': 'Unsent reply' };
  ctx.state.features = { scoping: true };
  ctx.composer = (id, placeholder, button, value) =>
    `<form id="message">${value}</form>`;
  const html = vm.runInContext('draftConversation()', ctx);
  assert.match(html, /data-task-id="chat-id"/);
  assert.match(html, /&lt;Private brief>/);
  assert.match(html, /Review task request/);
  assert.match(html, /Unsent reply/);
  assert.match(html, /data-disclosure-key="conversation-details"/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test('post-request follow-ups appear after delivery cards so new messages stay near the composer', () => {
  const ctx = context();
  ctx.state.detail = {
    task: {
      id: 'task-id',
      title: 'Links',
      brief: 'Extract links',
      status: 'accepted',
      scopeVersion: 1,
    },
    messages: [
      { id: 'initial', body: 'Initial request', createdAt: 1 },
      { id: 'follow-up', body: 'Explain the result', createdAt: 3 },
    ],
    events: [{ type: 'task.posted', createdAt: 2 }],
  };
  ctx.state.features = {};
  ctx.state.messageDrafts = {};
  ctx.taskNextStep = () => ['Done', 'Saved'];
  ctx.taskLabel = () => 'Accepted';
  ctx.composer = () => '<form id="message"></form>';
  ctx.RelayExecution = {
    input: () => '',
    delivery: () => '<div>Delivery fixture</div>',
  };
  const html = vm.runInContext('taskView()', ctx);
  assert.ok(html.indexOf('Initial request') < html.indexOf('Delivery fixture'));
  assert.ok(
    html.indexOf('Delivery fixture') < html.indexOf('Explain the result'),
  );
  assert.ok(
    html.indexOf('Explain the result') < html.indexOf('<form id="message">'),
  );
});
test('change review escapes supplier content and only offers current proposals for explicit acceptance', () => {
  const ctx=context();ctx.money=n=>'$'+(n/100).toFixed(2);
  ctx.task={id:'task',selectedOfferId:'offer',companyApprovalRequired:true};
  ctx.proposals=[{id:'change',baseOfferId:'offer',status:'pending',expiresAt:Date.now()+60000,title:'<script>bad</script>',brief:'<img src=x>',reason:'Extra summary',amountMinor:700,previousAmountMinor:500,retainedMinor:100,deliveryMinutes:15}];
  let html=vm.runInContext('changeProposalCards(task,proposals)',ctx);
  assert.match(html,/Accept revised terms/);assert.match(html,/Fresh company approval/);
  assert.doesNotMatch(html,/<script>|<img src=x>/);assert.match(html,/\+\$2.00/);
  ctx.proposals[0].expiresAt=0;
  html=vm.runInContext('changeProposalCards(task,proposals)',ctx);
  assert.doesNotMatch(html,/Accept revised terms/);assert.match(html,/no longer current/);
});

test('request review exposes source attachment before posting without creating another task', () => {
  const ctx = context();
  ctx.state.detail = {task:{id:'draft',title:'CSV cleanup',brief:'Clean data',status:'draft'},messages:[]};
  ctx.state.messageDrafts = {};
  ctx.state.features = {};
  ctx.state.reviewChatRequest = true;
  ctx.composer = () => '<form id="message"></form>';
  ctx.RelayExecution = {input: task => `<form id="task-input" data-task="${task.id}"></form>`};
  ctx.scopeRecap = () => '<button>Review scope</button>';
  const html = vm.runInContext('draftConversation()',ctx);
  assert.match(html, /id="task-input" data-task="draft"/);
  assert.equal((html.match(/id="task-input"/g)||[]).length,1);
  assert.match(html,/Keep chatting/);
});

test('repeat-hire prompt is explicit about fresh agreement and access, with no unavailable action', () => {
  const ctx = context();
  ctx.state.detail = { repeatHire: { available: true, name: '<Research>' } };
  const html = vm.runInContext('repeatHireCard()', ctx);
  assert.match(html, /Work with &lt;Research>/);
  assert.match(html, /fresh quote/);
  assert.match(html, /Previous approvals and payments do not carry over/);
  assert.match(html, /data-action="repeat-hire"/);
  ctx.state.detail.repeatHire = { available: false };
  assert.doesNotMatch(vm.runInContext('repeatHireCard()', ctx), /data-action="repeat-hire"/);
  ctx.state.detail.repeatHire = null;
  assert.equal(vm.runInContext('repeatHireCard()', ctx), '');
});

test('ready draft proposal is inline, while missing details cannot be approved', () => {
  const ctx = context();
  ctx.state.features = {scoping:true};
  ctx.state.detail = {events:[]};
  ctx.task = {status:'draft', scoping:{status:'completed', proposal:{intent:'request', title:'Research', brief:'Find companies', cadence:'once', questions:[], assumptions:[]}}};
  let html = vm.runInContext('draftProposal(task)',ctx);
  assert.match(html,/Find the best match/);
  assert.doesNotMatch(html,/review-chat-request|data-action="post"/);
  ctx.task.scoping.proposal.questions = ['Which <market>?'];
  html = vm.runInContext('draftProposal(task)',ctx);
  assert.match(html,/Which &lt;market>/);
  assert.doesNotMatch(html,/confirm-scope|data-action="post"/);
  ctx.task.scoping.proposal.intent = 'hypothetical';
  assert.equal(vm.runInContext('draftProposal(task)',ctx),'');
});

test('confirmed scope exposes posting in the same draft without opening another review', () => {
  const ctx = context();
  ctx.state.detail = {events:[{type:'scope.reviewed'}]};
  ctx.task = {status:'draft', brief:'Reviewed work', scopeVersion:2};
  const html = vm.runInContext('draftProposal(task)',ctx);
  assert.match(html,/data-action="post"/);
  assert.doesNotMatch(html,/review-chat-request|confirm-scope/);
});


test('assistant availability stays outside transcript and does not hide user content', () => {
  const ctx = context();
  const notice = 'Your message is saved. Conversational replies need the local model to be connected. You can keep notes here or review a request yourself.';
  ctx.state.detail = { task: { id: 'draft', title: 'Research', status: 'draft' }, messages: [
    {id:'system', role:'assistant', body:notice},
    {id:'user', role:'user', body:notice},
  ]};
  ctx.state.features = {};
  ctx.state.messageDrafts = {};
  ctx.composer = () => '<form id="message"></form>';
  const html = vm.runInContext('draftConversation()', ctx);
  assert.doesNotMatch(html, /id="scope-reply-system"|Not requested yet/);
  assert.match(html, /id="scope-reply-user"/);
  assert.match(html, /role="status">Draft/);
  assert.ok(html.indexOf('conversation-system-state') > html.indexOf('chat-request-action'));
  assert.ok(html.indexOf('conversation-system-state') < html.indexOf('<form id="message">'));
  assert.doesNotMatch(html, /data-action="post"|data-action="confirm-scope"/);
});

test('conversation never mounts manual workflow forms, including in the inspector', () => {
  const ctx = context();
  ctx.state.detail = {task:{id:'draft',status:'draft'},messages:[]};
  ctx.state.features = {scoping:true};
  ctx.state.messageDrafts = {};
  ctx.composer = () => '<form id="message"></form>';
  ctx.RelayOrchestration = {setup: () => '<form id="orchestration-create">Manual plan</form>'};
  const html = vm.runInContext('draftConversation()',ctx);
  assert.doesNotMatch(html, /orchestration-create|advanced-planning|Supplier brief|quote ceiling/);
  assert.match(html, /data-action="close-inspector"/);
  assert.doesNotMatch(html, /<details[^>]* open|Files & execution options/);
});

test('composer keeps unsent text escaped with an explicit source control', () => {
  const ctx = context();
  ctx.state.messageDrafts = {task:'<script>keep my draft</script>'};
  ctx.composer = (id, placeholder, label, value) => `<form><div class="replybox"><textarea>${ctx.escape(value)}</textarea></div></form>`;
  const html = vm.runInContext("conversationComposer({id:'task'})",ctx);
  assert.match(html, /data-action="conversation-context"/);
  assert.match(html, /&lt;script>/);
  assert.doesNotMatch(html, /<script>/);
});
test('touch-first devices are told to tap Send, because on-screen keyboards have no Shift + Enter', () => {
  const ctx = context();
  ctx.matchMedia = (query) => ({ matches: query === '(hover: none) and (pointer: coarse)' });
  assert.equal(vm.runInContext('touchFirst()', ctx), true);
  assert.match(vm.runInContext('sendHint()', ctx), /Tap Send/);
  ctx.matchMedia = () => ({ matches: false });
  assert.match(vm.runInContext('sendHint()', ctx), /Shift \+ Enter for a new line/);
  delete ctx.matchMedia;
  assert.equal(vm.runInContext('touchFirst()', ctx), false);
});
test('the activity page shows this workspace’s updates escaped, with who acted and a link to the task', () => {
  const ctx = context();
  ctx.state.tenantId = 'ws';
  ctx.state.activity = { truncated: true, items: [
    { taskId: 't1', taskTitle: 'Leads <script>', tenantId: 'ws', label: 'Work paused', actor: 'you', createdAt: 1700000000000 },
    { taskId: 't2', taskTitle: 'Other workspace', tenantId: 'other', label: 'Brief saved', actor: 'you', createdAt: 1700000000001 },
  ] };
  const html = vm.runInContext('activityPage()', ctx);
  assert.match(html, /Work paused/);
  assert.match(html, /href="#task=t1"/);
  assert.match(html, /Leads &lt;script>/);
  assert.doesNotMatch(html, /Other workspace/);
  assert.match(html, /latest 100 updates/);
  ctx.state.activity = { items: [] };
  assert.match(vm.runInContext('activityPage()', ctx), /No activity yet/);
});
