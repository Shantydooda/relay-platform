'use strict';

const { readFileSync, lstatSync } = require('node:fs');

function readPrivateConfig(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('CONFIG_PERMISSIONS');
  const config = JSON.parse(readFileSync(path, 'utf8'));
  if (!/^[A-Za-z0-9_-]{43}$/.test(config.token) || typeof config.origin !== 'string' || !/^[0-9a-f-]{36}$/.test(config.agentId)) throw new Error('CONFIG_INVALID');
  return { origin: config.origin, token: config.token, expectedAgentId: config.agentId };
}
module.exports = { readPrivateConfig };
