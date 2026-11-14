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
