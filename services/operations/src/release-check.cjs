'use strict';
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const blockers = Object.freeze([
  'Managed-auth parity and hosted environment verification',
  'Real Google connector authorization and revocation walkthrough',
  'Actual Stripe sandbox funding, refund and payout reconciliation',
  'Independent third-party supplier integration',
  'Cross-role browser, mobile and accessibility release walkthrough',
  'Independent security, payment and operational review',
]);
function stages() {
  return [
    { id: 'backend', args: ['test'], timeoutMs: 180000 },
    { id: 'web', args: ['run', 'test:web'], timeoutMs: 60000 },
    {
      id: 'postgres-recovery',
      args: ['run', 'test:postgres'],
      timeoutMs: 300000,
    },
    {
      id: 'load-limits',
      args: ['run', 'test:load'],
      timeoutMs: 150000,
      env: { RELAY_LOAD_SECONDS: '60', RELAY_LOAD_MODE: 'limits' },
    },
    {
      id: 'load-steady',
      args: ['run', 'test:load'],
      timeoutMs: 150000,
      env: { RELAY_LOAD_SECONDS: '60', RELAY_LOAD_MODE: 'steady' },
    },
  ];
}
function fingerprint(root) {
  const names = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
    { cwd: root, maxBuffer: 16 * 1024 * 1024 },
  )
    .toString()
    .split('\0')
    .filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].sort()) {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep))
      throw new Error('INVALID_SOURCE_PATH');
    hash.update(name + '\0');
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink())
        hash.update('symlink:' + fs.readlinkSync(file));
      else if (stat.isFile()) hash.update(fs.readFileSync(file));
      else hash.update('non-file');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      hash.update('deleted');
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}
function testSummary(output) {
  const counts = { tests: 0, failed: 0, skipped: 0, cancelled: 0 };
  for (const [label, key] of [
    ['tests', 'tests'],
    ['fail', 'failed'],
    ['skipped', 'skipped'],
    ['cancelled', 'cancelled'],
  ]) {
    for (const match of output.matchAll(
      new RegExp('(?:# |ℹ )' + label + ' (\\d+)', 'g'),
    ))
      counts[key] += Number(match[1]);
  }
  return counts;
}
function runStage(stage, { root, directory, signal }) {
  return new Promise((resolve) => {
    const started = Date.now(),
      logName = stage.id + '.log';
    const fd = fs.openSync(path.join(directory, logName), 'wx', 0o600);
    const env = {
      ...process.env,
      ...stage.env,
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    };
    delete env.RELAY_STRIPE_SANDBOX_KEY;
    delete env.RELAY_STRIPE_WEBHOOK_SECRET;
    let tail = '',
      bytes = 0,
      reason = null,
      killTimer;
    const child = spawn('npm', stage.args, {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    function stop(cause) {
      if (reason) return;
      reason = cause;
      const kill = (sig) => {
        try {
          process.kill(-child.pid, sig);
        } catch {
          /* Already exited. */
        }
      };
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 2000);
    }
    const timeout = setTimeout(() => stop('timeout'), stage.timeoutMs);
    const abort = () => stop('cancelled');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const output = (chunk) => {
      bytes += chunk.length;
      if (bytes > 32 * 1024 * 1024) {
        stop('output_limit');
        return;
      }
      fs.writeSync(fd, chunk);
      tail = (tail + chunk.toString()).slice(-262144);
    };
    child.stdout.on('data', output);
    child.stderr.on('data', output);
    child.on('error', () => {
      reason = 'spawn_failed';
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', abort);
      fs.closeSync(fd);
      const counts = testSummary(tail);
      resolve({
        id: stage.id,
        status:
          !reason &&
          code === 0 &&
          counts.tests > 0 &&
          !counts.failed &&
          !counts.skipped &&
          !counts.cancelled
            ? 'passed'
            : 'failed',
        reason:
          reason ||
          (code !== 0
            ? 'exit_nonzero'
            : !counts.tests
              ? 'no_test_evidence'
              : counts.skipped
                ? 'skipped_tests'
                : counts.failed || counts.cancelled
                  ? 'incomplete_tests'
                  : null),
        exitCode: code,
        elapsedMs: Date.now() - started,
        ...counts,
        log: logName,
      });
    });
  });
}
async function verify({
  root,
  directory,
  signal,
  run = runStage,
  hash = fingerprint,
  onStage = () => {},
}) {
  const before = hash(root),
    startedAt = new Date().toISOString(),
    results = [];
  for (const stage of stages()) {
    if (signal?.aborted) {
      results.push({ id: stage.id, status: 'not_run', reason: 'cancelled' });
      continue;
    }
    onStage(stage.id, 'running');
    const result = await run(stage, { root, directory, signal });
    results.push(result);
    onStage(stage.id, result.status);
    if (['timeout', 'output_limit', 'spawn_failed'].includes(result.reason))
      break;
  }
  const after = hash(root),
    sourceChanged = before !== after;
  return {
    schemaVersion: 1,
    startedAt,
    completedAt: new Date().toISOString(),
    sourceHash: before,
    sourceChanged,
    localChecksPassed:
      results.length === stages().length &&
      results.every((r) => r.status === 'passed') &&
      !sourceChanged,
    productionReady: false,
    releaseBlockers: [...blockers],
    stages: results,
  };
}
async function main() {
  if (process.argv.length !== 2)
    throw new Error('No arguments supported. Run npm run verify:local.');
  const root = path.resolve(__dirname, '../../..');
  const directory = path.join(
    root,
    '.poc-data',
    'release-checks',
    randomUUID(),
  );
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const report = await verify({
      root,
      directory,
      signal: controller.signal,
      onStage: (id, status) => console.log(`${id}: ${status}`),
    });
    fs.writeFileSync(
      path.join(directory, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log(`Report: ${path.join(directory, 'report.json')}`);
    console.log(
      report.localChecksPassed
        ? 'Local checks passed. External release gates remain open.'
        : 'Local verification failed or incomplete. Review the private logs.',
    );
    process.exitCode = controller.signal.aborted
      ? 130
      : report.localChecksPassed
        ? 0
        : 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}
if (require.main === module)
  main().catch(() => {
    console.error(
      'Local verification could not finish. No production approval was recorded.',
    );
    process.exitCode = 1;
  });
module.exports = { stages, fingerprint, testSummary, verify, runStage };
