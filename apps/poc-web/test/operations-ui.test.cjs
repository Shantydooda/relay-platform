'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {text}=require('../../../packages/ui/src/components.cjs');
test('operations snapshot labels partial counts and escapes record details',()=>{
 const context=vm.createContext({state:{operationsBacklog:{observedAt:1,partial:true,groups:[{label:'Execution',counts:{failed:2},truncated:true,oldestAgeMs:60000,alerts:[{id:'<img onerror=bad>',state:'failed',action:'Review <script>'}]}]}},escape:text,date:()=> 'Today'});
 vm.runInContext(fs.readFileSync(require.resolve('../public/payments-ui.js'),'utf8')+';globalThis.output=RelayPayments.backlog()',context);
 assert.match(context.output,/Partial counts/);assert.match(context.output,/Review 1 alert/);assert.match(context.output,/&lt;img/);assert.doesNotMatch(context.output,/<script>/);assert.match(context.output,/Use Refresh/);
});
