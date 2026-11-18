'use strict';
const { spawn } = require('node:child_process');
const { isAbsolute } = require('node:path');

function clamScanner(executable, { databaseDirectory, certificatesDirectory, timeoutMs = 90000 } = {}) {
  if (executable && !isAbsolute(executable)) throw new Error('Scanner executable must be an absolute local path');
  if (databaseDirectory && !isAbsolute(databaseDirectory)) throw new Error('Scanner database must be an absolute local path');
  if (certificatesDirectory && !isAbsolute(certificatesDirectory)) throw new Error('Scanner certificate path must be absolute');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 90000) throw new Error('Invalid scan timeout');
  return {
    name: 'ClamAV',
    async scan(bytes) {
      if (!executable) return { status: 'quarantined', reason: 'Scanner is not configured. Files remain quarantined.' };
      const args = ['--no-summary', '--official-db-only=yes', '--fail-if-cvd-older-than=7',
        '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--max-filesize=8M', '--max-scansize=32M',
        '--max-recursion=10', '--max-files=1000', '--max-scantime=60000',
        ...(databaseDirectory ? [`--database=${databaseDirectory}`] : []),
        ...(certificatesDirectory ? [`--cvdcertsdir=${certificatesDirectory}`] : []), '-'];
      return new Promise(resolve => {
        let settled = false, output = '', diagnostics = '';
        const finish = value => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        };
        const child = spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false, env: { PATH: '/usr/bin:/bin', LANG: 'C', ...(certificatesDirectory ? { CVD_CERTS_DIR: certificatesDirectory } : {}) } });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          finish({ status: 'scan_error', reason: 'Scanning timed out. Relay will retry automatically.' });
        }, timeoutMs);
        child.on('error', () => finish({ status: 'scan_error', reason: 'Scanner unavailable. Relay will retry automatically.' }));
        child.stdin.on('error', () => {});
        child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(0, 32768); });
        child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(0, 32768); });
        child.on('close', code => finish(code === 0 && /^(stdin|stream): OK\r?$/mi.test(output) && !diagnostics.trim()
          ? { status: 'clean', reason: 'ClamAV reported no threats.' }
          : code === 1
            ? { status: 'blocked', reason: 'ClamAV flagged a threat, encrypted content or a scan limit. Request a replacement file.' }
            : { status: 'scan_error', reason: 'Scanner or current signatures unavailable. Relay will retry automatically.' }));
        child.stdin.end(bytes);
      });
    }
  };
}
module.exports = { clamScanner };
