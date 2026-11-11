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
  await vm.runInContext(source+';RelayPayments.exportCsv();',context);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()),Buffer.from(csv));
  assert.equal(link.download,'relay-spending-USD-2026-11-01-2026-11-01.csv');
  assert.equal(link.href,'blob:local-test');
  assert.ok(clicked && removed && appended);
});

test('an unavailable report cannot silently export empty or stale invented totals',async()=>{
  const context=vm.createContext({state:{spendingHistory:null}});
  await assert.rejects(vm.runInContext(source+';RelayPayments.exportCsv();',context),/Refresh the report/);
});

for (const failure of [false, true]) test(`paged export ${failure ? 'never downloads a partial failed report' : 'joins every saved page exactly'}`, async () => {
  const totals = {fundedMinor: 123};
  const report = {snapshotId:'saved',tenantId:'workspace',pageCount:3,csv:'current page',totals,period:{from:'',to:''}};
  const requested=[];
  let blob, downloads=0;
  const context=vm.createContext({state:{spendingHistory:report},Blob,
    api:async url=>{const page=Number(new URL(url,'http://localhost').searchParams.get('page'));requested.push(page);if(failure && page===2) throw new Error('Report expired');return {snapshotId:'saved',page,totals,csv:['HEADER\r\n','ROW\r\n','TOTAL\r\n'][page]};},
    URL:{createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(){}},
    document:{createElement(){return {click(){downloads++;},remove(){}};},body:{append(){}}},setTimeout(){}
  });
  const result=vm.runInContext(source+';RelayPayments.exportCsv();',context);
  if(failure) {await assert.rejects(result,/expired/);assert.equal(downloads,0);assert.equal(blob,undefined);}
  else {await result;assert.equal(await blob.text(),'HEADER\r\nROW\r\nTOTAL\r\n');assert.equal(downloads,1);}
  assert.deepEqual(requested,[0,1,2]);
});

test('export rejects a page in another currency instead of combining totals', async () => {
  const totals = { fundedMinor: 100 };
  const report = { snapshotId: 'eur-report', tenantId: 'workspace', currency: 'EUR', pageCount: 1, totals, period: {} };
  const context = vm.createContext({
    state: { spendingHistory: report },
    api: async () => ({ snapshotId: 'eur-report', page: 0, currency: 'USD', totals, csv: 'incorrect currency' })
  });
  await assert.rejects(vm.runInContext(source + ';RelayPayments.exportCsv();', context));
});
