'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('Attio UI uses authenticated POST contracts and continues only the reviewed batch', async () => {
  const calls = [],
    state = {
      tenantId: 'tenant',
      account: { memberships: [{ id: 'tenant', role: 'owner' }] },
      features: { attioDelivery: true },
      attio: { connected: true, destination: 'Fixture' },
      detail: { task: { id: 'task' } },
    };
  let sent = 0;
  const ctx = vm.createContext({
    state,
    escape: String,
    render() {},
    refresh: async () => {},
    api: async (path, options) => {
      assert.equal(options.method, 'POST');
      calls.push([path, options.body]);
      if (path.endsWith('/prepare'))
        return { id: 'review', taskId: 'task', status: 'review' };
      return {
        id: 'review',
        taskId: 'task',
        status: ++sent === 2 ? 'sent' : 'sending',
      };
    },
  });
  vm.runInContext(
    fs.readFileSync(
      require('node:path').join(__dirname, '../public/workspace-apps-ui.js'),
      'utf8',
    ) + '\nthis.ui = RelayApps;',
    ctx,
  );
  await ctx.ui.click({
    dataset: {
      action: 'app-attio-prepare',
      id: 'file',
      submission: 'submission',
    },
  });
  await ctx.ui.click({ dataset: { action: 'app-attio-send', id: 'review' } });
  assert.equal(state.attioReview.status, 'sent');
  assert.equal(state.attioSending, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[1][1].consent, 'upsert-reviewed-companies');
  assert.equal(ctx.ui.attioDelivery({ id: 'task' }, { status: 'ready' }), '');
  state.account.memberships[0].role = 'employee';
  assert.equal(ctx.ui.attioCard(), '');
});

test('persisted receipts render without a connected provider and never offer an unauthorized retry', () => {
  const state = {
    features: { attioDelivery: true },
    tenantId: 'tenant',
    account: { memberships: [{ id: 'tenant', role: 'owner' }] },
    attio: { connected: false },
    attioReceipts: [
      {
        id: 'receipt',
        taskId: 'task',
        fileId: 'csv',
        filename: 'companies.csv',
        destination: 'Fixture',
        status: 'sent',
        completed: 2,
        total: 2,
        rows: [],
        results: [],
      },
    ],
  };
  const ctx = vm.createContext({ state, escape: String });
  vm.runInContext(
    fs.readFileSync(
      require('node:path').join(__dirname, '../public/workspace-apps-ui.js'),
      'utf8',
    ) + '\nthis.ui = RelayApps;',
    ctx,
  );
  const html = ctx.ui.attioDelivery(
    { id: 'task' },
    { status: 'accepted', files: [{ id: 'csv', filename: 'companies.csv' }] },
  );
  assert.match(html, /2 of 2 companies confirmed/);
  assert.match(html, /Delivery complete/);
  assert.doesNotMatch(html, /data-action="app-attio-send"/);
  state.attioReceipts[0].status = 'failed';
  state.attioReceipts[0].canContinue = true;
  assert.doesNotMatch(
    ctx.ui.attioReceipt(state.attioReceipts[0]),
    /data-action="app-attio-send"/,
  );
});
