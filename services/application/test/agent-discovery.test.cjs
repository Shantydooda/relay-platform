'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const { createApplication } = require('../src/service.cjs');
const { createSqliteRepository, createPostgresRepository } = require('../src/repository.cjs');
const { discoveryOptions } = require('../src/agent-discovery.cjs');
for (const postgres of [false, true]) test(`${postgres ? 'postgres' : 'sqlite'} discovery filters the complete published catalog and pages without overlap`, async t => {
  const db = postgres ? await PGlite.create() : new DatabaseSync(':memory:');
  t.after(()=>db.close());
  const repository = postgres ? await createPostgresRepository(db,{initialize:true}) : createSqliteRepository(db);
  const actor = {user:{id:'buyer'},memberships:[]};
  const app = createApplication({repository});
  await repository.transaction('seed',async repo=>{
    for(let n=0;n<310;n++)await repo.save('agent',{
      id:`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,ownerId:n===309?'buyer':'supplier',status:'listed',version:1,
      name:`Agent ${n}`,operatorName:'Builder',purpose:n>=250?'Property reports with cited sources':'General work',
      kind:n%2?'specialist':'general',domain:'Research',listingStatus:n===308?'paused':n===307?'draft':'published',
      capabilities:[{id:'cap',category:n>=250?'Real estate':'Research',task:'Market report'}]
    });
  });
  const page = await app.marketplace.discover(actor,{q:'PROPERTY',category:'Real estate',type:'specialist',limit:7});
  assert.equal(page.total,28); // 251..305 odd; 307 draft and 309 self excluded
  assert.equal(page.agents.length,7);
  assert.ok(page.categories.includes('Real estate'));
  const ids = page.agents.map(a=>a.id);
  let cursor=page.nextCursor;
  while(cursor){const next=await app.marketplace.discover(actor,{q:'PROPERTY',category:'Real estate',type:'specialist',limit:7,after:cursor});ids.push(...next.agents.map(a=>a.id));cursor=next.nextCursor;}
  assert.equal(ids.length,28);assert.equal(new Set(ids).size,28);
  await assert.rejects(app.marketplace.discover(actor,{q:'different',after:page.nextCursor}),{code:'INVALID_DISCOVERY_CURSOR'});
  await assert.rejects(app.marketplace.discover({user:{id:'other'}},{q:'PROPERTY',category:'Real estate',type:'specialist',after:page.nextCursor}),{code:'INVALID_DISCOVERY_CURSOR'});
  const noMatch=await app.marketplace.discover(actor,{q:'no such output'});
  assert.equal(noMatch.total,0);assert.equal(noMatch.nextCursor,'');
  assert.equal((await app.marketplace.discover(actor,{category:'Available'})).total,0);
  assert.equal((await app.marketplace.discover(actor,{q:'%_'})).total,0,'wildcards are literal text');
  const first=await app.marketplace.discover(actor,{limit:1});
  await repository.transaction('pause',async repo=>{const a=await repo.get('agent',first.agents[0].id);a.listingStatus='paused';await repo.save('agent',a);});
  assert.notEqual((await app.marketplace.discover(actor,{limit:1})).agents[0].id,first.agents[0].id);
  assert.equal((await app.marketplace.discover(actor,{limit:1})).total,306);
});
test('discovery validates page bounds, input types and malformed cursors',()=>{
  for(const input of [{limit:0},{limit:51},{limit:NaN},{q:'x'.repeat(201)},{q:[]},{category:'x'.repeat(101)},{type:'invalid'},{after:'bad'}])assert.throws(()=>discoveryOptions(input,'buyer'));
});
