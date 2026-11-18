'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
const recovery = source.slice(source.indexOf('async function recoverUnavailableTask('), source.indexOf('async function run('));
function fixture(api) {
  const state = { detail: { task: { id: 'task' } }, offers: [{}], tasks: [{}], team: {}, companyBudget: {}, filePreview: {}, reviewOffer: 'offer', messageDrafts: { task: 'private draft' } };
  const calls = [];
  const context = vm.createContext({ state, api, actionRevision: 1, location: {}, notice: {}, render: () => calls.push('render'), refresh: async id => calls.push(['refresh', id]) });
  vm.runInContext(recovery, context);
  return { state, context, calls, run: error => context.recoverUnavailableTask(error) };
}
test('revoked task clears cached details and draft before refreshing remaining workspace', async () => {
  const f = fixture(async () => { throw { status: 404 }; });
  assert.equal(await f.run({ status: 404 }), true);
  assert.equal(f.state.detail, null);
  assert.equal(f.state.tasks.length, 0);
  assert.equal(f.state.offers.length, 0);
  assert.equal(f.state.filePreview, null);
  assert.equal(f.state.messageDrafts.task, undefined);
  assert.equal(f.context.location.hash, 'tasks');
  assert.deepEqual(f.calls, ['render', ['refresh', null], 'render']);
  assert.match(f.context.notice.textContent, /no longer available/);
});
test('forbidden action on a readable task and transient errors preserve the conversation', async () => {
  const readable = fixture(async () => ({}));
  assert.equal(await readable.run({ status: 403 }), false);
  assert.equal(readable.state.detail.task.id, 'task');
  const transient = fixture(async () => { throw { status: 503 }; });
  await assert.rejects(transient.run({ status: 404 }), { status: 503 });
  assert.equal(transient.state.messageDrafts.task, 'private draft');
  assert.equal(await transient.run({ status: 409 }), false);
});
test('access recheck cannot clear a newer navigation or command', async () => {
  let reject;
  const f = fixture(() => new Promise((_, no) => { reject = no; }));
  const pending = f.run({ status: 404 });
  f.context.actionRevision++;
  f.state.detail = { task: { id: 'new-task' } };
  reject({ status: 404 });
  assert.equal(await pending, false);
  assert.equal(f.state.detail.task.id, 'new-task');
  assert.equal(f.calls.length, 0);
});
