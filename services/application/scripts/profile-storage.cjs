'use strict';
// Isolated benchmark: instrumentation applies only in this process.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  crypto = require('node:crypto');
const modulePath = path.resolve(
  __dirname,
  '../../storage/src/local-objects.cjs',
);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-profile-'));
try {
  for (const count of [100, 1000, 5000]) {
    const dir = path.join(root, String(count));
    fs.mkdirSync(dir);
    for (let i = 0; i < count; i++) {
      const b = Buffer.from('fixture' + i);
      fs.writeFileSync(
        path.join(dir, crypto.createHash('sha256').update(b).digest('hex')),
        b,
      );
    }
    const store = require(modulePath).localObjects(dir),
      times = [],
      stats = {};
    const originals = {};
    for (const name of ['readdirSync', 'lstatSync', 'fsyncSync']) {
      originals[name] = fs[name];
      fs[name] = function (...args) {
        const start = performance.now();
        try {
          return originals[name](...args);
        } finally {
          const row = (stats[name] ||= { calls: 0, ms: 0 });
          row.calls++;
          row.ms += performance.now() - start;
        }
      };
    }
    try {
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        store.put(Buffer.from('new' + i));
        times.push(performance.now() - start);
      }
    } finally {
      for (const name of Object.keys(originals)) fs[name] = originals[name];
    }
    times.sort((a, b) => a - b);
    console.log(JSON.stringify({ files: count, p95Ms: times[18], stats }));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
