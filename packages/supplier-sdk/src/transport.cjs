'use strict';

const { setTimeout: delay } = require('node:timers/promises');

class SupplierError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = 'SupplierError';
    this.code = code;
    this.status = status;
  }
}

const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

async function readResponse(response, maximumBytes) {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > maximumBytes) {
    await response.body?.cancel().catch(() => {});
    throw new SupplierError('SUPPLIER_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  let bytes = Buffer.alloc(0);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new SupplierError('SUPPLIER_RESPONSE_TOO_LARGE');
      }
      if (size > bytes.length) {
        const capacity = Math.min(maximumBytes, Math.max(size, bytes.length * 2, 16384));
        const expanded = Buffer.allocUnsafe(capacity);
        bytes.copy(expanded, 0, 0, size - value.byteLength);
        bytes = expanded;
      }
      bytes.set(value, size - value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size)));
    return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
  } catch {
    return null;
  }
}

function createTransport({ origin, token, fetchImpl = fetch, signal, timeoutMs = 8000, maxResponseBytes = MAX_RESPONSE_BYTES }) {
  const url = new URL(origin);
  if (url.origin !== origin || url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new SupplierError('LOCAL_ORIGIN_REQUIRED');
  }
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new SupplierError('INVALID_CREDENTIAL');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new SupplierError('INVALID_TIMEOUT');

  if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > MAX_RESPONSE_BYTES) throw new SupplierError('INVALID_RESPONSE_LIMIT');

  return async function request(path, body, key, method = body === undefined ? 'GET' : 'POST') {
    // Never allow a caller-controlled origin, redirect or URL to receive a key.
    if (!/^\/(?:heartbeat|qualifications(?:\/[a-f0-9-]{36})?|events|opportunities|assignments|tasks\/[a-f0-9-]{36}(?:\/(?:offers|claim|progress|submit|fail|permission-requests|tool-read|messages|change-proposals))?)(?:\?after=[A-Za-z0-9_%:-]*&limit=\d+)?$/.test(path)) {
      throw new SupplierError('INVALID_ENDPOINT');
    }
    if (!['GET', 'POST'].includes(method)) throw new SupplierError('INVALID_METHOD');
    if (method === 'POST' && path !== '/heartbeat' && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))) {
      throw new SupplierError('IDEMPOTENCY_KEY_REQUIRED');
    }
    // Serialize once so every attempt has identical bytes and command identity.
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal?.aborted) throw new SupplierError('ABORTED');
      try {
        const response = await fetchImpl(`${origin}/v1/supplier${path}`, {
          method, redirect: 'error',
          headers: { Authorization: `Bearer ${token}`, 'X-Relay-Protocol': '1',
            ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(key ? { 'Idempotency-Key': key } : {}) },
          body: serialized,
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs)
        });
        const result = await readResponse(response, maxResponseBytes);
        if (response.ok && result !== null) return result;
        // Do not surface arbitrary remote messages or fetch errors containing secrets.
        const code = /^[A-Z][A-Z0-9_]{0,79}$/.test(result?.error?.code) ? result.error.code : response.ok ? 'INVALID_SUPPLIER_RESPONSE' : 'SUPPLIER_HTTP_ERROR';
        lastError = new SupplierError(code, response.status);
        if (response.status < 500) throw lastError;
      } catch (error) {
        if (signal?.aborted) throw new SupplierError('ABORTED');
        if (error instanceof SupplierError && error.status < 500) throw error;
        lastError = error instanceof SupplierError ? error : new SupplierError('SUPPLIER_CONNECTION_FAILED');
      }
      if (attempt < 2) {
        try { await delay(200 * 2 ** attempt, undefined, { signal }); }
        catch { throw new SupplierError('ABORTED'); }
      }
    }
    throw lastError;
  };
}
module.exports = { createTransport, SupplierError };
