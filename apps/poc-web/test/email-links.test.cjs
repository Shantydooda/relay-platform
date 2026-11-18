'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const ctx = vm.createContext({ URLSearchParams, state: {}, escape: value => String(value) });
vm.runInContext(fs.readFileSync(require.resolve('../public/managed-auth.js'), 'utf8'), ctx);
const read = hash => JSON.parse(JSON.stringify(vm.runInContext(`confirmationFromLink(${JSON.stringify(hash)})`, ctx)));

test('both email-link formats become a confirmation the server can verify', () => {
  assert.deepEqual(read('#token_hash=abc&type=recovery'), { confirmation: { tokenHash: 'abc', type: 'recovery' } });
  assert.deepEqual(read('#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=recovery'),
    { confirmation: { accessToken: 'a.b.c', type: 'recovery' } });
  assert.deepEqual(read('#access_token=a.b.c&type=signup'), { confirmation: { accessToken: 'a.b.c', type: 'email' } });
});

test('the refresh token is never kept, and expired links explain themselves', () => {
  assert.equal(JSON.stringify(read('#access_token=a.b.c&refresh_token=SECRET&type=signup')).includes('SECRET'), false);
  assert.match(read('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid').error, /expired or was already used/);
  assert.deepEqual(read(''), {});
  assert.deepEqual(read('#task=123'), {});
});
