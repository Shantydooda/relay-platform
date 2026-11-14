'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { loadConfig } = require('./config.cjs');
const DIRECTORY = path.resolve(__dirname, '../../../.poc-data/pilot');
function privateText(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('PRIVATE_PILOT_FILE_REQUIRED');
    return fs.readFileSync(fd, 'utf8');
  } catch { throw new Error('PRIVATE_PILOT_FILE_REQUIRED'); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
function supervisedConfig(directory = DIRECTORY) {
  const env = parseEnv(privateText(path.join(directory, 'render.env')));
  const secret = privateText(path.join(directory, 'storage-secret.txt')).trim();
  if (!secret || /\s/.test(secret)) throw new Error('PILOT_STORAGE_SECRET_REQUIRED');
  // Do not inherit localhost or staging credentials from the calling shell.
  return loadConfig({ ...env, RELAY_APP_ORIGIN: 'https://relay-pilot-app.onrender.com',
    SUPABASE_SECRET_KEY: secret, RELAY_PILOT_STORAGE: 'private-bucket' });
}
module.exports = { supervisedConfig, privateText, DIRECTORY };
