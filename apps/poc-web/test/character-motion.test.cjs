'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const events = {};
  const frames = new Map();
  let nextId = 0;
  const face = () => ({
    style: { removeProperty(name) { delete this[name]; } },
    parentElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 30, height: 24 }) },
  });
  let node = face();
  const media = { matches: true, addEventListener: (_, fn) => { events.preference = fn; } };
  const document = {
    hidden: false,
    querySelector: () => node,
    addEventListener: (type, fn) => { events[type] = fn; },
    documentElement: { addEventListener: (type, fn) => { events[type] = fn; } },
  };
  const source = readFileSync(path.join(__dirname, '../public/buyer-flow.js'), 'utf8');
  vm.runInNewContext(source.slice(source.indexOf('// One listener survives sidebar refreshes.')), {
    document,
    window: { addEventListener: (type, fn) => { events[type] = fn; } },
    matchMedia: () => media,
    requestAnimationFrame: fn => { frames.set(++nextId, fn); return nextId; },
    cancelAnimationFrame: id => frames.delete(id),
  });
  return {
    events, frames, media, document,
    get node() { return node; },
    replace() { node = face(); },
    move(x, y, pointerType = 'mouse') { events.pointermove({ clientX: x, clientY: y, pointerType }); },
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); },
  };
}

test('face follows latest pointer in one bounded frame and survives sidebar replacement', () => {
  const f = fixture();
  f.move(-10000, -10000);
  f.move(10000, 10000);
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.node.style.transform, 'translate(5px, 4px) perspective(180px) rotateX(-12deg) rotateY(18deg) rotateZ(8deg)');
  const old = f.node;
  f.replace();
  f.move(15, 12);
  f.flush();
  assert.equal(old.style.transform, undefined);
  assert.equal(f.node.style.transform, 'translate(0px, 0px) perspective(180px) rotateX(0deg) rotateY(0deg) rotateZ(0deg)');
});

test('touch, reduced motion, hidden pages and pointer exit stop tracking', () => {
  const f = fixture();
  f.move(100, 100, 'touch');
  assert.equal(f.frames.size, 0);
  f.media.matches = false;
  f.move(100, 100);
  assert.equal(f.frames.size, 0);
  f.media.matches = true;
  f.move(100, 100);
  f.events.preference();
  assert.equal(f.frames.size, 0);
  f.move(100, 100);
  f.flush();
  f.events.pointerleave();
  assert.equal(f.node.style.transform, undefined);
  f.document.hidden = true;
  f.move(100, 100);
  assert.equal(f.frames.size, 0);
});
