'use strict';
// Delivered CSV files preview as a table, never as markup.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { text } = require('../../../packages/ui/src/components.cjs');

function execution() {
  const context = vm.createContext({ state: {}, escape: text, Intl, Date });
  vm.runInContext(fs.readFileSync(require.resolve('../public/execution-ui.js'), 'utf8'), context);
  return vm.runInContext('RelayExecution', context);
}

test('a CSV preview becomes a table with quoted cells kept intact and markup escaped', () => {
  const html = execution().csvTable('vendor,city,note\n"Acme, Inc",Paris,"said ""hi"""\n<img src=x onerror=bad>,Rome,\n', false);
  assert.match(html, /<th scope="col">vendor<\/th><th scope="col">city<\/th><th scope="col">note<\/th>/);
  assert.match(html, /<td>Acme, Inc<\/td><td>Paris<\/td><td>said (&quot;|&#34;|&#x22;)hi(&quot;|&#34;|&#x22;)<\/td>/);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /2 rows · 3 columns/);
});

test('a cut-off preview drops the partial last row and says so; non-tables fall back to text', () => {
  const ex = execution();
  const html = ex.csvTable('a,b\n1,2\n3,4\n5,', true);
  assert.doesNotMatch(html, /<td>5<\/td>/);
  assert.match(html, /first 2 rows/);
  assert.equal(ex.csvTable('just one line of text', false), '');
  assert.equal(ex.csvTable('a,"unclosed\n1,2', false), '');
});
