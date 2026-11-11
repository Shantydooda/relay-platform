'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {text}=require('../../../packages/ui/src/components.cjs');
function fixture(role='employee') {
 const state={account:{user:{id:'user',name:'Taylor',workspace:'buyer'},memberships:[{id:'personal',name:'Taylor',role:'owner'},{id:'company',company:true,name:'Northstar',role}]},tenantId:'company',tasks:[],buyerTab:'request'};
 const ctx=vm.createContext({state,escape:text,root:{querySelector:()=>null}});
 const buyerSource=fs.readFileSync(path.join(__dirname,'../public/buyer-flow.js'),'utf8');
 vm.runInContext(buyerSource.slice(buyerSource.indexOf('function relayCharacter('),buyerSource.indexOf('function activityCard(')),ctx);
 const source=fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
 vm.runInContext(source.slice(source.indexOf('function navigationIcon('),source.indexOf('function composer(')),ctx);
 return {state,render:name=>vm.runInContext(name+'()',ctx)};
}
test('company identity appears across buyer destinations and reflects actual membership role',()=>{
 for(const role of ['employee','approver','owner']){
 const f=fixture(role);
 for(const tab of ['request','tasks','apps','scheduled','business','tools']){
 f.state.buyerTab=tab;
 assert.match(f.render('header'),/company-identity/);
 assert.match(f.render('companyWorkspaceBanner'),/Northstar/);
 assert.match(f.render('companyWorkspaceBanner'),/You’re a team member/);
 }
 assert.match(f.render('companyWorkspaceBanner'),new RegExp({employee:'Employee',approver:'Budget approver',owner:'Administrator'}[role]));
 }
});
test('personal, builder, signed-out and removed memberships never inherit company indicators',()=>{
 const f=fixture();f.state.tenantId='personal';assert.equal(f.render('companyWorkspaceBanner'),'');assert.doesNotMatch(f.render('header'),/company-identity/);
 f.state.tenantId='company';f.state.account.user.workspace='builder';assert.equal(f.render('companyWorkspaceBanner'),'');
 f.state.account.user.workspace='buyer';f.state.account.memberships=[];assert.equal(f.render('companyWorkspaceBanner'),'');
 f.state.account=null;assert.equal(f.render('companyWorkspaceBanner'),'');
});
test('company names are escaped and identity follows task workspace switches',()=>{
 const f=fixture();f.state.account.memberships[1].name='<img src=x onerror=bad>';
 assert.doesNotMatch(f.render('header'),/<img/);assert.doesNotMatch(f.render('companyWorkspaceBanner'),/<img/);
 f.state.account.memberships.push({id:'second',company:true,name:'Other team',role:'approver'});f.state.tenantId='second';
 assert.match(f.render('companyWorkspaceBanner'),/Other team/);assert.match(f.render('companyWorkspaceBanner'),/Budget approver/);
});
