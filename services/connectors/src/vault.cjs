'use strict';

// Sealed storage for buyer connection credentials (docs/specs/Buyer-Connections.md).
// AES-256-GCM with the record id as additional authenticated data, so a sealed
// value copied onto another connection record fails to open. The key lives
// outside the database (a private local file or a hosting secret), so a
// database copy alone does not reveal credentials.
const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

function createVault(keyHex) {
  if (typeof keyHex !== 'string' || !/^[0-9a-f]{64}$/.test(keyHex)) throw new TypeError('Connection vault needs a 32-byte hex key');
  const key = Buffer.from(keyHex, 'hex');
  return {
    seal(value, binding) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(binding));
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    open(sealed, binding) {
      const bytes = Buffer.from(sealed, 'base64');
      const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
    },
  };
}

module.exports = { createVault };
