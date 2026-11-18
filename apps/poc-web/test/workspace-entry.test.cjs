'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('business navigation opens a sole joined company and preserves an explicit company choice',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../public/teams-ui.js'),'utf8'),ctx);
  const choose=vm.runInContext('(members,id)=>RelayTeams.entryTenant(members,id)',ctx);
  const personal={id:'personal'},company={id:'company',company:true},other={id:'other',company:true};
  assert.equal(choose([personal,company],'personal'),'company');
  assert.equal(choose([personal,company,other],'other'),'other');
  assert.equal(choose([personal,company,other],'personal'),'personal');
  assert.equal(choose([personal],'personal'),'personal');
});

test('route changes close mobile navigation and focus content without stealing draft focus on refresh',()=>{
  const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
  const body=source.slice(source.indexOf('function settleWorkspaceNavigation('),source.indexOf('function render(){'));
  for(const mobile of [true,false]){
    const navigation={open:true};let focused=0;
    const root={querySelector:selector=>selector==='.workspace-navigation'?navigation:{focus:()=>focused++}};
    const ctx=vm.createContext({root,matchMedia:()=>({matches:mobile})});
    vm.runInContext(body,ctx);
    vm.runInContext('settleWorkspaceNavigation(false)',ctx);
    assert.equal(navigation.open,true);assert.equal(focused,0);
    vm.runInContext('settleWorkspaceNavigation(true)',ctx);
    assert.equal(navigation.open,!mobile);assert.equal(focused,1);
  }
});

test('offer confirmation and dismissal focus the matching offer, not another card',()=>{
 const source=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
 const body=source.slice(source.indexOf('function focusOfferReview('),source.indexOf('function settleWorkspaceNavigation('));
 let focused;
 const buttons=['first','second'].flatMap(id=>['review-offer','accept-offer'].map(action=>({dataset:{id,action},focus:()=>{focused=id+action;}})));
 const ctx=vm.createContext({root:{querySelectorAll:()=>buttons}});
 vm.runInContext(body,ctx);
 vm.runInContext("focusOfferReview('second',true)",ctx);assert.equal(focused,'secondaccept-offer');
 vm.runInContext("focusOfferReview('second',false)",ctx);assert.equal(focused,'secondreview-offer');
});
