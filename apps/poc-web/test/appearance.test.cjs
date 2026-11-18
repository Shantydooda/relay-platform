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
      assert.equal(key, 'relay.appearance'); saved = value;
    } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
  vm.runInContext("applyAppearance('dark')", ctx);
  assert.equal(saved, 'dark');
  vm.runInContext("applyAppearance('unexpected')", ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'dark');
});

test('blocked browser storage does not prevent switching appearance', () => {
  const ctx = vm.createContext({
    location: { hostname: "127.0.0.1", search: "" }, URLSearchParams,
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'dark');
  vm.runInContext("applyAppearance('light')", ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
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
