'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

test('foundation pauses on selection, honors visibility/reduced motion and disposes on navigation', () => {
 const handlers = {}, visibility = {}, preferences = {}, timers = new Map();
 let observe, disconnected = 0, nextTimer = 0;
 const copies = Array.from({length:5}, () => ({hidden:true}));
 const buttons = copies.map((_, i) => ({dataset:{foundationStep:String(i)}, attrs:{}, setAttribute(k,v){this.attrs[k]=v}, querySelector(){return {textContent:''}}}));
 const pause = {attrs:{}, setAttribute(k,v){this.attrs[k]=v}};
 const title = {}, subtitle = {};
 const panel = {dataset:{}, querySelectorAll:()=>buttons,
  querySelector(selector){return selector==='[data-foundation-pause]' ? pause : selector==='[data-foundation-title]' ? title : selector==='[data-foundation-subtitle]' ? subtitle : copies[Number(selector.split('-').at(-1))]},
  addEventListener(k,v){handlers[k]=v}, removeEventListener(k){delete handlers[k]}};
 const media = {matches:false, addEventListener(k,v){preferences[k]=v}, removeEventListener(k){delete preferences[k]}};
 const document = {hidden:false, addEventListener(k,v){visibility[k]=v}, removeEventListener(k){delete visibility[k]}};
 const context = vm.createContext({module:{exports:{}}, require:()=>({}), window:{matchMedia:()=>media}, document,
  IntersectionObserver:class{constructor(callback){observe=callback}observe(){}disconnect(){disconnected++}},
  setInterval(fn){timers.set(++nextTimer,fn);return nextTimer},clearInterval(id){timers.delete(id)}});
 vm.runInContext(readFileSync(resolve(__dirname,'../src/public-landing.cjs'),'utf8'),context);
 const landing = context.module.exports;
 landing.mount({querySelector:()=>panel});
 assert.equal(timers.size,0,'offscreen sections do not animate');
 observe([{isIntersecting:true}]);
 [...timers.values()][0]();
 assert.equal(panel.dataset.step,'1');
 handlers.click({target:{closest:selector=>selector==='[data-foundation-step]'?buttons[3]:null}});
 assert.equal(panel.dataset.step,'3');
 assert.equal(copies[3].hidden,false);
 assert.equal(buttons[3].attrs['aria-expanded'],'true');
 assert.equal(timers.size,0,'manual selection stops auto rotation');
 handlers.click({target:{closest:selector=>selector==='[data-foundation-pause]'?pause:null}});
 assert.equal(timers.size,1,'play resumes even while its button retains focus');
 document.hidden=true;visibility.visibilitychange();assert.equal(timers.size,0);
 document.hidden=false;visibility.visibilitychange();assert.equal(timers.size,1);
 media.matches=true;preferences.change();assert.equal(timers.size,0);
 landing.mount({querySelector:()=>null});
 assert.equal(disconnected,1);assert.equal(Object.keys(handlers).length,0);assert.equal(Object.keys(visibility).length,0);
});
