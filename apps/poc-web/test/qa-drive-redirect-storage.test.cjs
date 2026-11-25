'use strict';
// QA: Drive OAuth redirects are validated, blocked storage degrades, disabled primary buttons look disabled.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const pub = f => path.join(__dirname, '../public', f);
const load = (file, name, ctx) => {
  vm.createContext(Object.assign(ctx, { URL, String }));
  vm.runInContext(`${fs.readFileSync(pub(file), 'utf8')};globalThis.M=${name};`, ctx);
  return ctx.M;
};
const GOOD = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=x';
const BAD = ['http://accounts.google.com/x', 'https://accounts.google.com.evil.test/x', 'https://evil.test/?u=accounts.google.com',
  'https://user@accounts.google.com/x', 'javascript:alert(1)', 'not a url', '', undefined, null, '//accounts.google.com/x'];
const throwingStorage = { setItem() { throw new Error('blocked'); }, getItem() { throw new Error('blocked'); } };

test('googleAuthUrl accepts only https accounts.google.com (both UIs)', () => {
  for (const [file, name] of [['integrations-ui.js', 'RelayIntegrations'], ['workspace-apps-ui.js', 'RelayApps']]) {
    const M = load(file, name, {});
    assert.equal(M.googleAuthUrl(GOOD), GOOD);
    for (const bad of BAD) assert.equal(M.googleAuthUrl(bad), null, `${name}: ${bad}`);
  }
});

const run = async (file, name, button, url) => {
  const calls = [], assigned = [], notice = {};
  const ctx = { state: { integrations: { tenantId: 't1', drive: { version: 1 } }, tenantId: 't1', drive: { version: 1 } }, notice,
    sessionStorage: throwingStorage, location: { assign: u => assigned.push(u) },
    api: async p => { calls.push(p); return { url }; }, render() {}, refresh: async () => {}, escape: String };
  const M = load(file, name, ctx);
  let error = null;
  try { await M.click(button); } catch (e) { error = e; }
  return { assigned, calls, error };
};

test('integrations: blocked storage still reaches Google; hostile URL is not navigated', async () => {
  const btn = { dataset: { action: 'integration-drive', operation: 'connect' } };
  const ok = await run('integrations-ui.js', 'RelayIntegrations', btn, GOOD);
  assert.deepEqual(ok.assigned, [GOOD]); assert.equal(ok.error, null);
  const bad = await run('integrations-ui.js', 'RelayIntegrations', btn, 'https://evil.test/');
  assert.deepEqual(bad.assigned, []); assert.match(bad.error.message, /unexpected sign-in address/);
});

test('workspace apps: blocked storage still reaches Google; hostile URL is not navigated', async () => {
  const btn = { dataset: { action: 'app-drive-connect' } };
  const ok = await run('workspace-apps-ui.js', 'RelayApps', btn, GOOD);
  assert.deepEqual(ok.assigned, [GOOD]);
  const bad = await run('workspace-apps-ui.js', 'RelayApps', btn, 'javascript:alert(1)');
  assert.deepEqual(bad.assigned, []);
});

test('no unguarded sessionStorage access in the Drive UI files', () => {
  for (const f of ['integrations-ui.js', 'workspace-apps-ui.js', 'drive.js']) {
    const lines = fs.readFileSync(pub(f), 'utf8').split('\n');
    lines.forEach((l, i) => { if (/sessionStorage|localStorage/.test(l)) assert.match(lines.slice(Math.max(0, i - 1), i + 1).join('\n'), /try/, `${f}:${i + 1}`); });
  }
});

test('primary hover skips disabled buttons and disabled ones look disabled', () => {
  const css = fs.readFileSync(pub('refresh.css'), 'utf8');
  assert.match(css, /\.mk-buy-packages button\):hover:not\(:disabled\)/);
  assert.match(css, /\.mk-buy-packages button\):disabled \{[^}]*opacity: 0\.45;[^}]*cursor: not-allowed/);
});
