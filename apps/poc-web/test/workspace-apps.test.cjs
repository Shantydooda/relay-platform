'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const vm = require('node:vm');
const { text } = require('../../../packages/ui/src/components.cjs');
function fixture() {
  const state = {
    features: { workspaceApps: true },
    tenantId: 'tenant',
    account: { memberships: [{ id: 'tenant', role: 'owner' }] },
    workspaceApps: {
      sources: [
        {
          id: 'source',
          name: '<script>source</script>',
          content: '</textarea><script>bad</script>',
          status: 'active',
          version: 1,
        },
      ],
      apps: [
        {
          id: 'app',
          title: '<img src=x onerror=bad>',
          recipe: 'link-inventory-v1',
          recipeVersion: 1,
          sourceId: 'source',
          grantId: 'grant',
          sourceTaskId: 'task',
          status: 'active',
        },
      ],
      grants: [
        {
          id: 'grant',
          sourceId: 'source',
          subjectKind: 'app',
          subjectId: 'app',
          status: 'revoked',
          expiresAt: Date.now() + 60000,
        },
      ],
      runs: [
        {
          id: 'run',
          appId: 'app',
          grantId: 'grant',
          status: 'needs_review',
          output: '</pre><script>bad</script>',
          sourceVersion: 1,
          createdAt: Date.now(),
        },
      ],
      audit: [],
    },
  };
  const ctx = vm.createContext({
    state,
    escape: text,
    date: () => 'Date',
    Intl,
    Date,
  });
  vm.runInContext(
    readFileSync(resolve(__dirname, '../public/workspace-apps-ui.js'), 'utf8'),
    ctx,
  );
  return { state, render: (expression) => vm.runInContext(expression, ctx) };
}
test('app outputs and source content remain escaped; revoked permission disables run and save but preserves discard', () => {
  const f = fixture(),
    html = f.render('RelayApps.page()');
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /Needs permission/);
  assert.match(html, /disabled>Run now/);
  assert.match(html, /disabled>Approve &amp;|disabled>Approve & save/);
  assert.match(html, /data-review="discard"/);
  assert.doesNotMatch(f.render('RelayApps.toolsPage()'), /<script>/);
});
test('employee cannot install or grant access; accepted installed trial links to its existing automation', () => {
  const f = fixture();
  assert.match(
    f.render("RelayApps.taskControls({id:'task',status:'accepted'})"),
    /Open installed automation/,
  );
  f.state.account.memberships[0].role = 'employee';
  assert.equal(
    f.render("RelayApps.taskControls({id:'task',status:'accepted'})"),
    '',
  );
  assert.doesNotMatch(f.render('RelayApps.toolsPage()'), /Add a local source/);
});

test('context selection and permission review escape source text and require owner decisions', () => {
  const f = fixture();
  const draft = f.render(
    "RelayApps.contextPicker({status:'draft',brief:'Use source',contextReferences:[]})",
  );
  assert.match(draft, /Add context · @/);
  assert.match(draft, /Save this version/);
  assert.doesNotMatch(draft, /<script>/);
  const pending =
    "RelayApps.contextPicker({status:'queued',brief:'Use source',contextReferences:[{sourceId:'source',name:'<script>bad</script>',mode:'latest'}],permissionRequests:[{id:'request',sourceId:'source',status:'pending',reason:'<script>bad</script>'}]})";
  assert.match(f.render(pending), /Allow read access/);
  assert.doesNotMatch(f.render(pending), /<script>/);
  f.state.account.memberships[0].role = 'employee';
  assert.doesNotMatch(f.render(pending), /Allow read access/);
});

test('Drive setup stays honest about configuration and imported snapshots', () => {
  const f = fixture();
  f.state.features.driveConnections = true;
  let html = f.render('RelayApps.toolsPage()');
  assert.match(html, /Google OAuth setup is required/);
  assert.doesNotMatch(html, /data-action="app-drive-connect"/);
  f.state.drive = { configured: true, connected: false };
  html = f.render('RelayApps.toolsPage()');
  assert.match(html, /app-drive-connect/);
  assert.match(html, /selected-file permission allows managing/);
  f.state.drive.connected = true;
  f.state.workspaceApps.sources[0].provenance = {
    provider: 'google-drive',
    importedAt: 1,
  };
  html = f.render('RelayApps.toolsPage()');
  assert.match(html, /Drive snapshot/);
  assert.match(html, /Disconnect Google Drive/);
  assert.doesNotMatch(html, /id="app-source-edit"/);
  assert.doesNotMatch(html, /<script>/);
  f.state.account.memberships[0].role = 'employee';
  assert.equal(f.render('RelayApps.driveCard()'), '');
});

test('live Drive labels and read history distinguish freshness without rendering source markup', () => {
  const f = fixture();
  f.state.workspaceApps.sources[0].provenance = {
    provider: 'google-drive',
    mode: 'live-file',
    checkedAt: 1,
  };
  const tools = f.render('RelayApps.toolsPage()');
  assert.match(tools, /Live Drive file/);
  assert.doesNotMatch(tools, /<script>/);
  const history = f.render(
    "RelayApps.contextPicker({status:'submitted',brief:'Use source',contextReferences:[{sourceId:'source',name:'Document',mode:'latest',provenance:{provider:'google-drive',mode:'live-file'}}],contextReads:[{name:'<script>bad</script>',version:2,readAt:1,mode:'live-file'}]})",
  );
  assert.match(history, /Sources read by your agent/);
  assert.match(history, /Relay version 2/);
  assert.match(history, /Checked against Drive before use/);
  assert.doesNotMatch(history, /<script>/);
});

test('Apps separates reusable tools from recurring work and explains blocked runs', () => {
  const f = fixture();
  let html = f.render('RelayApps.page()');
  assert.match(html, /A tool you run/);
  assert.match(html, /A job that repeats/);
  assert.match(html, /Read permission needs attention/);
  f.state.workspaceApps.grants[0].status = 'active';
  html = f.render('RelayApps.page()');
  assert.match(html, /Review or discard it below/);
  assert.match(html, /disabled>Run now/);
  f.state.workspaceApps.apps = [];
  html = f.render('RelayApps.page()');
  assert.match(html, /Ordinary files stay in the task/);
  assert.match(html, /arbitrary supplier code/);
});

test('requesting an app prepares an editable brief without posting or running work', async () => {
  const f = fixture();
  f.render(
    "globalThis.render=()=>{};globalThis.document={querySelector:()=>null};globalThis.location={hash:'apps'};globalThis.command=()=>{throw new Error('Unexpected command')}",
  );
  await f.render(
    "RelayApps.click({dataset:{action:'app-request',kind:'links'}})",
  );
  assert.equal(f.state.buyerTab, 'request');
  assert.match(f.state.prompt, /review a sample result before installing/);
  assert.equal(f.state.detail, null);
});

test('custom delivered package enables explicit installation independent of qualification category', () => {
  const f = fixture();
  f.state.offers = [
    { selected: true, qualificationEvidence: { rubric: 'other-capability' } },
  ];
  f.state.detail = {
    task: { id: 'custom' },
    submissions: [{ files: [{ filename: 'relay-app.json' }] }],
  };
  const html = f.render(
    "RelayApps.taskControls({id:'custom',status:'accepted'})",
  );
  assert.match(html, /Install the data app/);
  assert.match(html, /Scheduling is off/);
  assert.match(html, /id="app-install"/);
  f.state.detail.submissions = [];
  assert.equal(
    f.render("RelayApps.taskControls({id:'custom',status:'accepted'})"),
    '',
  );
});
test('installed package steps and run evidence escape builder content', () => {
  const f = fixture();
  const app = f.state.workspaceApps.apps[0];
  app.appPackage = {
    description: '<script>bad</script>',
    steps: [{ op: 'select', fields: ['<img>'] }],
  };
  app.packageHash = 'abc';
  f.state.workspaceApps.runs[0].stepEvidence = [
    { operation: '<script>bad</script>', inputRows: 3, outputRows: 1 },
  ];
  const html = f.render('RelayApps.page()');
  assert.match(html, /What this app does/);
  assert.match(html, /Run details/);
  assert.doesNotMatch(html, /<script>|<img>/);
});
