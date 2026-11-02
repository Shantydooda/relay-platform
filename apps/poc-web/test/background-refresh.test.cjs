const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
test('client state is complete and each reset receives fresh mutable collections', () => {
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  const start = source.indexOf('function createClientState');
  const end = source.indexOf('const retries');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(source.slice(start, end), ctx);
  const first = vm.runInContext('createClientState()', ctx);
  const second = vm.runInContext('createClientState()', ctx);
  for (const key of [
    'notifications', 'recoveryData', 'filePreview', 'team', 'workspaceApps',
    'spendingHistory', 'agentMarketCategory', 'taskFilter', 'sendingRequest',
  ]) assert.ok(Object.hasOwn(first, key), `missing state key: ${key}`);
  first.tasks.push({ id: 'private-task' });
  first.messageDrafts.private = 'private draft';
  assert.equal(second.tasks.length, 0);
  assert.equal(Object.keys(second.messageDrafts).length, 0);
  assert.equal(second.notifications, null);
  assert.equal(second.tenantId, null);
  vm.runInContext("state.authMode='managed'; state.features={recurring:true}; state.notifications=[{id:'private'}]; resetClientSession({auth:'login'})", ctx);
  assert.equal(vm.runInContext('state.auth', ctx), 'login');
  assert.equal(vm.runInContext('state.authMode', ctx), 'managed');
  assert.equal(vm.runInContext('state.features.recurring', ctx), true);
  assert.equal(vm.runInContext('state.notifications', ctx), null);
});
function fixture() {
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  let renders = 0;
  const ctx = {
    state: { authMode: 'local', account: { user: { workspace: 'buyer' } }, detail: { task: { id: 'one', status: 'posted' } }, renderedViewKey: 'one', offers: [] },
    actionRevision: 0, lastInteraction: Date.now(),
    document: { hidden: false, activeElement: null },
    root: { querySelector: () => null },
    refresh: async () => {},
    render: () => renders++,
    showError: () => assert.fail('Unexpected error'),
    setInterval: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('let workspacePolling'), source.indexOf('function agentDraftKey')), ctx);
  return { ctx, renders: () => renders };
}
test('unchanged background reads never disable controls or redraw; queue clock is not a change', async () => {
  const { ctx, renders } = fixture();
  ctx.state.executionQueue = { items: [], checkedAt: 1 };
  ctx.refresh = async (id, candidate, background) => {
    assert.equal(background, true);
    assert.equal(ctx.state.busy, undefined);
    candidate.executionQueue = { items: [], checkedAt: 2 };
  };
  await ctx.pollWorkspace();
  await ctx.pollWorkspace();
  assert.equal(renders(), 0);
});
test('real updates render once, but a concurrent action discards stale results', async () => {
  const { ctx, renders } = fixture();
  ctx.refresh = async (id, candidate) => { candidate.offers = [{ id: 'new' }]; };
  await ctx.pollWorkspace();
  assert.equal(renders(), 1);
  ctx.refresh = async (id, candidate) => {
    candidate.offers = [{ id: 'stale' }];
    ctx.actionRevision++;
    ctx.state.offers = [{ id: 'chosen' }];
  };
  await ctx.pollWorkspace();
  assert.equal(ctx.state.offers[0].id, 'chosen');
  assert.equal(renders(), 1);
});
test('overlapping polls are skipped and focusing input during a read prevents redraw', async () => {
  const { ctx, renders } = fixture();
  let release, calls = 0;
  ctx.refresh = async (id, candidate) => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    candidate.offers = [{ id: 'new' }];
  };
  const first = ctx.pollWorkspace();
  await ctx.pollWorkspace();
  assert.equal(calls, 1);
  ctx.document.activeElement = { matches: () => true, closest: () => null };
  release();
  await first;
  assert.equal(renders(), 0);
  assert.equal(ctx.state.offers.length, 0);
});
