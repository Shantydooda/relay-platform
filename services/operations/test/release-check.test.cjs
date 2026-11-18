'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  verify,
  fingerprint,
  testSummary,
  runStage,
} = require('../src/release-check.cjs');
const pass = async (stage) => ({ id: stage.id, status: 'passed' });
test('passing local suite never claims production readiness', async () => {
  const report = await verify({
    root: '/unused',
    hash: () => 'fixed',
    run: pass,
  });
  assert.equal(report.localChecksPassed, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.stages.length, 5);
  assert.ok(report.releaseBlockers.some((b) => b.includes('Stripe')));
});
test('source changes, failure, timeout and cancellation cannot pass', async () => {
  let count = 0;
  assert.equal(
    (await verify({ root: '/unused', hash: () => String(++count), run: pass }))
      .localChecksPassed,
    false,
  );
  const failed = await verify({
    hash: () => '',
    run: async (s) => ({ id: s.id, status: 'failed', reason: 'timeout' }),
  });
  assert.equal(failed.localChecksPassed, false);
  assert.equal(failed.stages.length, 1);
  const c = new AbortController();
  c.abort();
  const cancelled = await verify({
    hash: () => '',
    signal: c.signal,
    run: () => assert.fail('must not run'),
  });
  assert.equal(cancelled.localChecksPassed, false);
  assert.ok(cancelled.stages.every((s) => s.status === 'not_run'));
});
test('test summaries count multiple suites and preserve failures/skips', () => {
  assert.deepEqual(
    testSummary(
      'ℹ tests 4\nℹ fail 0\nℹ skipped 1\n# tests 2\n# fail 1\n# cancelled 1',
    ),
    { tests: 6, failed: 1, skipped: 1, cancelled: 1 },
  );
  assert.equal(testSummary('success').tests, 0);
});
test('fingerprint includes untracked code and deletion but excludes ignored private output', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'relay-fingerprint-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, '.gitignore'), 'private/\n');
  writeFileSync(join(root, 'file.cjs'), 'first');
  const initial = fingerprint(root);
  mkdirSync(join(root, 'private'));
  writeFileSync(join(root, 'private', 'report.json'), 'private evidence');
  assert.equal(fingerprint(root), initial);
  writeFileSync(join(root, 'file.cjs'), 'second');
  assert.notEqual(fingerprint(root), initial);
  execFileSync('git', ['add', 'file.cjs'], { cwd: root });
  const before = fingerprint(root);
  rmSync(join(root, 'file.cjs'));
  assert.notEqual(fingerprint(root), before);
});

test('real child stages require evidence and enforce timeout', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'relay-stage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = (code) =>
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ scripts: { test: 'node run.cjs' } }),
    ) || writeFileSync(join(root, 'run.cjs'), code);
  script(
    "console.log('# tests 1\n# fail 0\n# skipped 0\n# cancelled 0')".replaceAll(
      '\n',
      '\\n',
    ),
  );
  const passed = await runStage(
    { id: 'pass', args: ['test'], timeoutMs: 5000 },
    { root, directory: root },
  );
  assert.equal(passed.status, 'passed');
  assert.equal(passed.tests, 1);
  script("console.log('no test evidence')");
  assert.equal(
    (
      await runStage(
        { id: 'empty', args: ['test'], timeoutMs: 5000 },
        { root, directory: root },
      )
    ).reason,
    'no_test_evidence',
  );
  script('setTimeout(() => {}, 15000)');
  const timeout = await runStage(
    { id: 'timeout', args: ['test'], timeoutMs: 300 },
    { root, directory: root },
  );
  assert.equal(timeout.status, 'failed');
  assert.equal(timeout.reason, 'timeout');
});

test('CI is read-only, pinned and cannot become an implicit deployment path', () => {
  const workflow = readFileSync(
    join(__dirname, '../../../.github/workflows/ci.yml'),
    'utf8',
  );
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.doesNotMatch(workflow, /\b(?:deploy|environment|secrets\.)\b/i);
  assert.match(workflow, /if: github\.event_name != 'pull_request'/);
  assert.match(workflow, /npm run test:postgres/);
  assert.match(workflow, /git diff --exit-code/g);
  const uses = [...workflow.matchAll(/uses:\s*([^\s#]+)/g)].map((match) => match[1]);
  assert.ok(uses.length >= 2);
  for (const action of uses)
    assert.match(action, /^[\w.-]+\/[\w.-]+@[a-f0-9]{40}$/);
});
