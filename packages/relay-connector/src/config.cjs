'use strict';

// The connector's settings file (README.md → "Settings"). It names Relay's
// address, where the connector key is, and which export file serves each
// object. Files must sit inside one folder (`root`); nothing outside it is
// ever read, including through links.
const { readFileSync, realpathSync, statSync } = require('node:fs');
const { resolve, dirname, sep } = require('node:path');

const OBJECTS = Object.freeze(['vendor', 'customer', 'item', 'account', 'purchase-order', 'sales-order', 'invoice', 'bill', 'journal-entry']);
const KEY = /^rcn_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/;

class ConfigError extends Error {}
const bad = message => { throw new ConfigError(message); };

function relayUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { bad('Set "relay" to Relay’s address, for example https://relay.example.com.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) bad('"relay" must use https (http is allowed only for this machine).');
  if (url.username || url.password || url.search || url.hash) bad('"relay" must be a plain address.');
  return url.origin;
}

function inside(root, file) {
  const real = realpathSync(file);
  if (real !== root && !real.startsWith(root + sep)) bad(`${file} is outside the exports folder.`);
  return real;
}

function loadConfig(path, env = process.env) {
  const file = resolve(path);
  let raw;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { bad(`Couldn’t read the settings file ${file}: ${error.message}`); }
  const base = dirname(file);
  const allowed = ['relay', 'key', 'keyFile', 'root', 'objects', 'auditLog'];
  const extra = Object.keys(raw || {}).filter(k => !allowed.includes(k));
  if (extra.length) bad(`Unknown settings: ${extra.join(', ')}.`);
  if (raw.key) bad('Don’t put the connector key in the settings file. Use "keyFile" or the RELAY_CONNECTOR_KEY environment variable.');
  let key = env.RELAY_CONNECTOR_KEY || '';
  if (!key && raw.keyFile) {
    const keyPath = resolve(base, raw.keyFile);
    if (process.platform !== 'win32' && (statSync(keyPath).mode & 0o077)) bad(`${keyPath} must be readable only by you (chmod 600).`);
    key = readFileSync(keyPath, 'utf8').trim();
  }
  if (!KEY.test(key)) bad('Set the connector key from Settings → Integrations (RELAY_CONNECTOR_KEY or "keyFile").');
  let root;
  try { root = realpathSync(resolve(base, raw.root || '.')); } catch { bad('"root" must be an existing folder of exports.'); }
  if (!statSync(root).isDirectory()) bad('"root" must be a folder.');
  if (!raw.objects || typeof raw.objects !== 'object' || Array.isArray(raw.objects) || !Object.keys(raw.objects).length)
    bad(`List the exports under "objects", for example { "vendor": "vendors.csv" }. Objects: ${OBJECTS.join(', ')}.`);
  const objects = {};
  for (const [object, rel] of Object.entries(raw.objects)) {
    if (!OBJECTS.includes(object)) bad(`"${object}" isn’t an object Relay knows. Use: ${OBJECTS.join(', ')}.`);
    if (typeof rel !== 'string' || !/\.csv$/i.test(rel)) bad(`"${object}" must point at a .csv export.`);
    let real;
    try { real = inside(root, resolve(root, rel)); } catch (error) { if (error instanceof ConfigError) throw error; bad(`${rel} doesn’t exist in ${root}.`); }
    objects[object] = real;
  }
  return { relay: relayUrl(raw.relay), key, root, objects, auditLog: resolve(base, raw.auditLog || 'relay-connector-audit.log') };
}

module.exports = { loadConfig, ConfigError, OBJECTS };
