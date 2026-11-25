'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const appearance = source.slice(source.indexOf('function applyAppearance'), source.indexOf('function createClientState'));

test('appearance restores a saved choice and persists both modes without rendering', () => {
  let saved = 'light';
  const ctx = vm.createContext({
    location: { hostname: "127.0.0.1", search: "" }, URLSearchParams,
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: () => saved, setItem: (key, value) => {
      assert.equal(key, 'relay.theme'); saved = value;
    } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
  vm.runInContext("applyAppearance('dark')", ctx);
  assert.equal(saved, 'dark');
  vm.runInContext("applyAppearance('unexpected')", ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
});

test('blocked browser storage does not prevent switching appearance', () => {
  const ctx = vm.createContext({
    location: { hostname: "127.0.0.1", search: "" }, URLSearchParams,
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light', 'light is the default');
  vm.runInContext("applyAppearance('dark')", ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'dark');
});

test('a first visit is light; dark only when someone chose it', () => {
  let saved = null;
  const ctx = vm.createContext({
    location: { hostname: 'relay-pilot-app.onrender.com', search: '' }, URLSearchParams,
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
  vm.runInContext("applyAppearance('dark')", ctx);
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'dark', 'a saved choice still wins');
});

test('the old automatic dark setting is ignored, and loading the page never saves a choice', () => {
  const store = { 'relay.appearance': 'dark' }, writes = [];
  const ctx = vm.createContext({
    location: { hostname: 'relay-pilot-app.onrender.com', search: '' }, URLSearchParams,
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem: key => store[key] ?? null, setItem: (key, value) => writes.push([key, value]) },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
  assert.deepEqual(writes, []);
});

test('the refreshed look loads after the marketplace styles', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(html.indexOf('/refresh.css') > html.indexOf('/marketplace-ui.css'), 'refresh.css must load last');
});


test('community preview is local-only and leaves the saved theme unchanged', () => {
  for (const hostname of ['127.0.0.1', 'relay-pilot-app.onrender.com']) {
    let saved = 'dark';
    const ctx = vm.createContext({
      location: { hostname, search: '?design=community' }, URLSearchParams,
      document: { documentElement: { dataset: {} } },
      localStorage: { getItem: () => saved, setItem: (_, value) => { saved = value; } },
    });
    vm.runInContext(appearance, ctx);
    assert.equal(saved, 'dark');
    assert.equal(ctx.document.documentElement.dataset.appearance, hostname === '127.0.0.1' ? 'light' : 'dark');
    assert.equal(ctx.document.documentElement.dataset.design, hostname === '127.0.0.1' ? 'community' : undefined);
  }
});
