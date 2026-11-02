'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require.resolve('../public/payments-ui.js'), 'utf8');

test('export downloads the exact displayed CSV snapshot without recalculation or refetch', async () => {
  const csv = '\uFEFF"TOTAL","-3.44"\r\n';
  let blob, clicked = false, removed = false, appended = false;
  const link = {click(){clicked=true;},remove(){removed=true;}};
  const context = vm.createContext({
    state:{spendingHistory:{csv,period:{from:'2026-11-01',to:'2026-11-01'}}},
    Blob, URL:{createObjectURL(value){blob=value;return 'blob:local-test';},revokeObjectURL(){}},
    document:{createElement(){return link;},body:{append(){appended=true;}}},
    setTimeout(){}
  });
  vm.runInContext(source+';RelayPayments.exportCsv();',context);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(csv));
  assert.equal(link.download,'relay-spending-2026-11-01-2026-11-01.csv');
  assert.equal(link.href,'blob:local-test');
  assert.ok(clicked && removed && appended);
});

test('an unavailable report cannot silently export empty or stale invented totals',()=>{
  const context=vm.createContext({state:{spendingHistory:null}});
  assert.throws(()=>vm.runInContext(source+';RelayPayments.exportCsv();',context),/Refresh the report/);
});
