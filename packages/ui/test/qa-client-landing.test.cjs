'use strict';
// QA (adversarial review, 25 Nov 2026): the rebuilt public landing (44c71e1).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const landing = require('../src/public-landing.cjs');

const MODES = {
  poc: {},
  staging: { managed: true },
  pilot: { managed: true, pilot: true },
  pilotRuns: { managed: true, pilot: true, unpaidExecution: true },
  local: { localExecution: true },
};

test('every in-page link on the landing points at an element that exists', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    const html = landing.render(mode);
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    for (const [, target] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(target), `${name}: #${target}`);
  }
});

test('SVG and element ids are unique, so clip paths and labels resolve to one element', () => {
  const html = landing.render(MODES.pilotRuns);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual([...new Set(dupes)], []);
});

test('copy never claims payments are on, and claims real runs only where unpaid execution is on', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    const html = landing.render(mode);
    assert.doesNotMatch(html, /payments (are )?(enabled|live|on)\b/i, name);
    if (name !== 'pilotRuns') assert.doesNotMatch(html, /agents run real requests/i, name);
  }
  assert.match(landing.render(MODES.pilotRuns), /nothing is charged/i);
  assert.doesNotMatch(landing.render(MODES.pilot), /nothing is charged/i, 'a pilot without runs makes no run claim');
});

test('the landing is presentation only: no inline handlers, styles, scripts or javascript: URLs in any mode', () => {
  for (const [name, mode] of Object.entries(MODES)) {
    const html = landing.render({ ...mode, prompt: '"><script>alert(1)</script><a href="javascript:alert(1)">' });
    assert.doesNotMatch(html, /<script|\son[a-z]+=|(href|src)="\s*javascript:|\sstyle=/i, name);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, `${name}: the prompt is escaped into the textarea`);
  }
});

test('the motion toggle states its pressed state and its label matches it', () => {
  assert.match(landing.render({ paused: true }), /aria-pressed="true">Play animations/);
  assert.match(landing.render({ paused: false }), /aria-pressed="false">Pause animations/);
});
