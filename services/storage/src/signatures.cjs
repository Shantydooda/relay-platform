'use strict';
const { spawn } = require('node:child_process');
const { isAbsolute } = require('node:path');

function updateSignatures({ updater, updateConfig, certificatesDirectory } = {}) {
  if (!updater || !updateConfig) return Promise.resolve(false);
  if (![updater, updateConfig, ...(certificatesDirectory ? [certificatesDirectory] : [])].every(isAbsolute)) throw new Error('Signature updater paths must be absolute');
  return new Promise(resolve => {
    const child = spawn(updater, [`--config-file=${updateConfig}`, ...(certificatesDirectory ? [`--cvdcertsdir=${certificatesDirectory}`] : [])], {
      shell: false, stdio: 'ignore', env: { ...process.env, ...(certificatesDirectory ? { CVD_CERTS_DIR: certificatesDirectory } : {}) }
    });
    let settled = false;
    const finish = ok => { if (!settled) { settled = true; clearTimeout(timer); resolve(ok); } };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(false); }, 180000);
    child.once('error', () => finish(false));
    child.once('close', code => finish(code === 0));
  });
}
function startSignatureUpdater(config, { logger = console } = {}) {
  let pending, stopped = false;
  const tick = () => {
    if (stopped || pending || !config.updater) return;
    pending = updateSignatures(config).then(ok => {
      if (!ok) logger.error('ClamAV signature update failed. Files remain locked when valid signatures are unavailable.');
    }).catch(() => logger.error('ClamAV updater configuration is invalid.'))
      .finally(() => { pending = null; });
  };
  const timer = setInterval(tick, 6 * 60 * 60 * 1000);
  timer.unref(); tick();
  return { stop() { stopped = true; clearInterval(timer); }, done: () => pending || Promise.resolve() };
}
module.exports = { updateSignatures, startSignatureUpdater };
