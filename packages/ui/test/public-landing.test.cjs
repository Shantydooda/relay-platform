'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const landing=require('../src/public-landing.cjs');

test('approved landing keeps characters and live composer without prototype behavior',()=>{
  const html=landing.render();
  assert.match(html,/Find the right AI agent/);
  assert.match(html,/lp-character-rig/);
  assert.match(html,/data-relay-composer="landing"/);
  assert.match(html,/<textarea name="brief" id="request"/);
  assert.match(html,/data-action="builder"/);
  assert.match(html,/data-action="signup"/);
  assert.doesNotMatch(html,/\bon[a-z]+=|\bstyle=|beginAuth|demoSession|localStorage|sessionStorage/);
  assert.match(html,/accounts.*stored locally/i);
  assert.match(html,/agent work and payments not connected/);
});
test('landing prompt is escaped and character pause remains accessible',()=>{
  const prompt='</textarea><script>alert("unsafe")</script>';
  const html=landing.render({prompt,paused:true});
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;\/textarea&gt;/);
  assert.match(html,/lp-motion-paused/);
  assert.match(html,/aria-pressed="true"/);
  assert.match(html,/Play animations/);
});
test('all character images are local and CSS supports reduced motion and CSP-safe eye joints',()=>{
  const html=landing.render();
  const imageURLs=[...html.matchAll(/<image href="([^"]+)"/g)].map(match=>match[1]);
  assert.ok(imageURLs.length>4);
  assert.ok(imageURLs.every(url=>['/assets/relay-assistants.png','/assets/relay-assistants-wave.png'].includes(url)));
  const css=readFileSync(resolve(__dirname,'../src/public-landing.css'),'utf8');
  assert.match(css,/prefers-reduced-motion:reduce/);
  for(const name of ['lavender','blue','sage','orange'])for(let i=0;i<2;i++)assert.match(css,new RegExp(`\\.lp-eye-${name}-${i}\\{transform-origin:`));
});

test('local landing accurately describes available company approvals without promising payments',()=>{
  const html=landing.render({localExecution:true});
  assert.match(html,/Team invitations, roles and budget approvals are available locally/);
  assert.match(html,/Commercial payments and payouts remain disconnected/);
  assert.doesNotMatch(html,/Planned team workspace. Not available in this POC/);
  assert.match(landing.render(),/Planned team workspace. Not available in this POC/);
});

test('repeated decorative character rigs have unique IDs and resolve local references',()=>{
  const html=landing.render();
  const ids=[...html.matchAll(/\bid="([^\"]+)"/g)].map(match=>match[1]);
  assert.equal(ids.length,new Set(ids).size,'SVG IDs must not collide across feature panels');
  const references=[...html.matchAll(/(?:href="#|url\(#)([^"\)]+)/g)].map(match=>match[1]);
  for(const id of references)assert.ok(ids.includes(id),`Missing reference ${id}`);
});
