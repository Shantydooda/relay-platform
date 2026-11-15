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
 assert.match(result[0].recommendation.blockedReason,/not available/);
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
