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
    document: { documentElement: { dataset: {} } },
    localStorage: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } },
  });
  vm.runInContext(appearance, ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'dark');
  vm.runInContext("applyAppearance('light')", ctx);
  assert.equal(ctx.document.documentElement.dataset.appearance, 'light');
});
