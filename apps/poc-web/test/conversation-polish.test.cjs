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
    source.indexOf('async function savePrompt()'),
    source.indexOf('\nasync function run'),
  );
  const seen = [];
  const ctx = {
    state: { prompt: 'Keep my brief', tenantId: 'tenant' },
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
