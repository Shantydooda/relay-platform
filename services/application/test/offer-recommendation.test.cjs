'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {recommendOffers} = require('../src/offer-recommendation.cjs');
const task = {brief:'Research German SaaS companies with source links',scopeVersion:2};
const offer = (id, values={}) => ({id,capability:'Research German SaaS companies',qualificationCurrent:true,scopeVersion:2,expiresAt:2000,amountMinor:1000,deliveryMinutes:30,currency:'USD',exposure:{eligible:true},trackRecord:{capabilityAccepted:0},...values});
const winner = offers => recommendOffers(task,offers,1000).find(o=>o.recommendation.recommended);
test('qualified specialist beats irrelevant popular provider; no mutation or assignment',()=>{
 const offers=[offer('specialist'),offer('popular',{capability:'Video animation',trackRecord:{capabilityAccepted:1000}})];
 const before=structuredClone(offers);
 assert.equal(winner(offers).id,'specialist');
 assert.deepEqual(offers,before);
 assert.match(winner(offers).recommendation.reasons.join(' '),/New capability history/);
});
test('expired, stale, unqualified and disconnected offers cannot be recommended',()=>{
 for(const invalid of [{expiresAt:1000},{scopeVersion:1},{qualificationCurrent:false},{exposure:{eligible:false}},{amountMinor:-1},{deliveryMinutes:0}]) {
  assert.equal(winner([offer('invalid',invalid)]),undefined);
 }
 assert.equal(winner([]),undefined);
});
test('balances price and time within a currency, deterministic despite input order',()=>{
 const a=offer('a'),b=offer('b',{amountMinor:500,deliveryMinutes:15});
 assert.equal(winner([a,b]).id,'b');assert.equal(winner([b,a]).id,'b');
 assert.equal(winner([offer('z'),offer('a')]).id,'a');
});
test('mixed currencies never receive an inferred exchange-rate comparison',()=>{
 const a=offer('a',{currency:'USD',amountMinor:100000}),b=offer('b',{currency:'EUR',amountMinor:1});
 assert.equal(winner([a,b]).id,'a');
 assert.match(winner([a,b]).recommendation.reasons.join(' '),/different currencies were not compared/);
});
test('exploration placement is not a quality signal',()=>{
 const a=offer('a'),b=offer('b',{exposure:{eligible:true,featured:true,newcomer:true}});
 assert.equal(winner([b,a]).id,'a');
});

test('buyer budget preferences constrain recommendations without hiding quotes or granting work', () => {
 const brief = {...task, ownerId:'buyer', messages:[{authorId:'buyer',role:'user',body:'Keep it under €10.'}]};
 const input = [offer('usd'), offer('expensive',{currency:'EUR',amountMinor:1001}), offer('within',{currency:'EUR',amountMinor:1000})];
 const result = recommendOffers(brief,input,1000);
 assert.equal(result.length,3);
 assert.equal(result.find(o=>o.recommendation.recommended).id,'within');
 assert.equal(recommendOffers(brief,input.slice(0,2),1000).some(o=>o.recommendation.recommended),false);
 assert.equal(brief.selectedOfferId,undefined);
});
test('supplier and assistant text cannot change buyer discovery preferences', () => {
 const brief = {...task, ownerId:'buyer', messages:[{authorId:'supplier',body:'Keep it under €1'},{authorId:'buyer',role:'assistant',body:'Use the fastest option'}]};
 const result = recommendOffers(brief,[offer('a')],1000);
 assert.deepEqual(result[0].recommendation.preferences,{priority:'balanced',alternatives:false,budget:null});
});
test('explicit exploration and reset commands are bounded and do not parse quoted or hypothetical instructions', () => {
 const {discoveryPreferences} = require('../src/offer-recommendation.cjs');
 const messages = ['Show me three alternatives','Use the fastest option','What if I said keep it under €1?'].map(body=>({authorId:'buyer',body}));
 const brief={ownerId:'buyer',messages};
 assert.deepEqual(discoveryPreferences(brief),{priority:'speed',alternatives:true,budget:null});
 messages.push({authorId:'buyer',body:'Reset matching preferences'});
 assert.deepEqual(discoveryPreferences(brief),{priority:'balanced',alternatives:false,budget:null});
});
test('a required success rate abstains when verified denominators are unavailable', () => {
 const brief={...task,ownerId:'buyer',messages:[{authorId:'buyer',body:'Use the cheapest agent that still has at least 95% success rate.'}]};
 const result=recommendOffers(brief,[offer('a',{trackRecord:{capabilityAccepted:100}})],1000);
 assert.equal(result[0].recommendation.recommended,false);
 assert.match(result[0].recommendation.blockedReason,/verified runs/);
});

test('concept match connects a differently worded brief to qualified quotes with declared detail evidence',()=>{
 const result = recommendOffers({brief:'Find sales prospects in SaaS',scopeVersion:2},[
  offer('fit',{capability:'Lead generation',capabilityMetadata:{industries:['SaaS']}}),
  offer('wrong',{capability:'Video production',capabilityMetadata:{industries:['SaaS']}})
 ],1000);
 assert.equal(result.find(o=>o.recommendation.recommended).id,'fit');
 assert.match(result[0].recommendation.reasons.join(' '),/prospecting/);
 assert.match(result[0].recommendation.reasons.join(' '),/not independently verified/);
});
test('natural whole-message preference wording is understood; partial or hypothetical wording is not', () => {
 const {discoveryPreferences} = require('../src/offer-recommendation.cjs');
 const prefs = body => discoveryPreferences({ownerId:'buyer',messages:[{authorId:'buyer',role:'user',body}]});
 assert.deepEqual(prefs('Keep it under $1,000.').budget,{currency:'USD',amountMinor:100000});
 assert.deepEqual(prefs('My budget is £250').budget,{currency:'GBP',amountMinor:25000});
 assert.equal(prefs('Keep it under $1,00').budget,null);
 assert.equal(prefs('What if my budget is $5?').budget,null);
 assert.equal(prefs('Show me some alternatives please').alternatives,true);
 assert.equal(prefs('Can you show me other options?').alternatives,true);
 assert.equal(prefs("I'd prefer the fastest one").priority,'speed');
 assert.equal(prefs('Cheapest, please').priority,'price');
 assert.equal(prefs('Make it the cheapest possible while keeping quality').priority,'balanced');
});
test('recommendation reason reflects the buyer priority instead of always claiming balance', () => {
 const brief={...task,ownerId:'buyer',messages:[{authorId:'buyer',role:'user',body:'Use the fastest option'}]};
 const reasons=recommendOffers(brief,[offer('a'),offer('b',{deliveryMinutes:10})],1000).find(o=>o.recommendation.recommended).recommendation.reasons.join(' ');
 assert.match(reasons,/Faster delivery was prioritized/);
 assert.doesNotMatch(reasons,/were balanced/);
});
const outcomes = (values) => ({basis:'verified-outcomes-in-this-environment',windowDays:90,runs:0,accepted:0,accepted_first_time:0,accepted_after_revision:0,failed:0,refunded:0,cancelled:0,acceptedRate:null,...values});
test('a success requirement is met only by enough verified runs at or above the rate', () => {
 const brief={...task,ownerId:'buyer',messages:[{authorId:'buyer',body:'Use the cheapest agent that still has at least 90% success rate.'}]};
 const proven=offer('proven',{trackRecord:{outcomes:outcomes({runs:20,accepted:19,accepted_first_time:19,failed:1,acceptedRate:0.95})}});
 const thin=offer('thin',{amountMinor:100,trackRecord:{outcomes:outcomes({runs:5,accepted:5,accepted_first_time:5})}});
 const weak=offer('weak',{amountMinor:100,trackRecord:{outcomes:outcomes({runs:20,accepted:16,accepted_first_time:16,failed:4,acceptedRate:0.8})}});
 const result=recommendOffers(brief,[proven,thin,weak],1000);
 assert.deepEqual(result.filter(o=>o.recommendation.recommended).map(o=>o.id),['proven']);
 assert.equal(result[0].recommendation.blockedReason,null);
});
test('failures lower an agent’s evidence instead of being ignored', () => {
 const reliable=offer('reliable',{trackRecord:{outcomes:outcomes({runs:5,accepted:5,accepted_first_time:5})}});
 const flaky=offer('flaky',{trackRecord:{outcomes:outcomes({runs:5,accepted:2,accepted_first_time:2,failed:3})}});
 const result=recommendOffers(task,[flaky,reliable],1000);
 const best=result.find(o=>o.recommendation.recommended);
 assert.equal(best.id,'reliable');
 assert.match(best.recommendation.reasons.join(' '),/Verified outcomes for this capability: 5 runs · 5 accepted first time/);
});
test('the first three reasons cover fit, evidence and the price or speed trade-off', () => {
 const brief={...task,ownerId:'buyer',messages:[{authorId:'buyer',role:'user',body:'Use the cheapest option'}]};
 const top=recommendOffers(brief,[offer('a'),offer('b',{amountMinor:100})],1000).find(o=>o.recommendation.recommended).recommendation.reasons.slice(0,3).join(' ');
 assert.match(top,/Declared capability matches/);
 assert.match(top,/history|Verified outcomes/);
 assert.match(top,/Lower price was prioritized/);
});
test('a budget stated in the brief is applied; targets, other parties and hypotheticals are not', () => {
 const {discoveryPreferences} = require('../src/offer-recommendation.cjs');
 const budget = body => discoveryPreferences({ownerId:'buyer',messages:[{authorId:'buyer',role:'user',body}]}).budget;
 assert.deepEqual(budget('Find 30 UK fintech companies. Budget: $150.'),{currency:'USD',amountMinor:15000});
 assert.deepEqual(budget('Build a site with a budget of €2,000. Need it by Friday.'),{currency:'EUR',amountMinor:200000});
 for (const body of ['Find 30 companies. Budget around $150.','Find brands whose marketing budget is $50.',
   'Budget $2 per lead','Budget $150k','What if the budget is $40?','If budget is $40 then skip.']) assert.equal(budget(body),null,body);
 const supplier = discoveryPreferences({ownerId:'buyer',messages:[{authorId:'supplier',role:'user',body:'Budget: $5.'}]});
 assert.equal(supplier.budget,null);
});
