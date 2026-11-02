'use strict';
const {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/drive/v3/files/';

function createGoogleDrive({
  clientId,
  clientSecret,
  apiKey,
  projectNumber,
  encryptionKey,
  origin,
  fetchImpl = fetch,
  maxConcurrent = 4,
}) {
  if (
    !clientId ||
    !clientSecret ||
    !apiKey ||
    !/^\d+$/.test(projectNumber || '') ||
    !/^[a-f0-9]{64}$/i.test(encryptionKey || '')
  )
    throw new Error('Incomplete Drive configuration');
  if (
    !Number.isInteger(maxConcurrent) ||
    maxConcurrent < 1 ||
    maxConcurrent > 16
  )
    throw new TypeError('Invalid Drive concurrency');
  let activeRequests = 0;
  const site = new URL(origin);
  if (
    site.origin !== origin ||
    site.hostname !== '127.0.0.1' ||
    site.protocol !== 'http:'
  )
    throw new Error('Drive connector is localhost only');
  const redirectUri = `${origin}/drive/callback`;
  const key = Buffer.from(encryptionKey, 'hex');
  function seal(value, binding) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(binding));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value)),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      'base64',
    );
  }
  function open(value, binding) {
    try {
      const bytes = Buffer.from(value, 'base64'),
        decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(binding));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString('utf8'),
      );
    } catch {
      fail(
        503,
        'CONNECTOR_LOCKED',
        'The connection key is unavailable. Reconnect Drive.',
      );
    }
  }
  async function request(url, options = {}, maximum = 32768) {
    if (activeRequests >= maxConcurrent)
      fail(
        503,
        'DRIVE_BUSY',
        'Drive is handling other requests. Please retry shortly.',
      );
    activeRequests++;
    try {
      return await performRequest(url, options, maximum);
    } finally {
      activeRequests--;
    }
  }
  async function performRequest(url, options, maximum) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      fail(503, 'DRIVE_UNAVAILABLE', 'Drive could not be reached. Try again.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      fail(
        response.status === 401 ? 409 : 502,
        response.status === 401 ? 'DRIVE_RECONNECT' : 'DRIVE_REJECTED',
        'Drive did not allow this request. Check the connection and selected file.',
      );
    }
    if (Number(response.headers.get('content-length')) > maximum) {
      await response.body?.cancel();
      fail(
        413,
        'SOURCE_TOO_LARGE',
        'Choose a smaller text file (16 KB maximum).',
      );
    }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maximum)
          fail(
            413,
            'SOURCE_TOO_LARGE',
            'Choose a smaller text file (16 KB maximum).',
          );
        chunks.push(Buffer.from(chunk));
      }
    } catch (error) {
      if (error.code === 'SOURCE_TOO_LARGE') throw error;
      fail(
        503,
        'DRIVE_UNAVAILABLE',
        'The Drive response was interrupted. Try again.',
      );
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function token(fields) {
    let data;
    try {
      data = JSON.parse(
        await request('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            ...fields,
          }),
        }),
      );
    } catch (error) {
      if (error.code) throw error;
      fail(502, 'DRIVE_RESPONSE', 'Drive returned an invalid response.');
    }
    if (
      !data.access_token ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0 ||
      data.token_type?.toLowerCase() !== 'bearer' ||
      (data.scope && !data.scope.split(' ').includes(SCOPE))
    )
      fail(
        502,
        'DRIVE_RESPONSE',
        'Drive did not grant the required selected-file permission.',
      );
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: Math.min(data.expires_in, 3600),
    };
  }
  function authorization(state, verifier) {
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
  }
  async function readFile(accessToken, id) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(id))
      fail(400, 'FILE_INVALID', 'Choose a Drive file.');
    const headers = { authorization: `Bearer ${accessToken}` };
    let metadata;
    try {
      metadata = JSON.parse(
        await request(
          `${API}${id}?fields=id,name,mimeType,modifiedTime,version,trashed,capabilities(canDownload)&supportsAllDrives=true`,
          { headers },
        ),
      );
    } catch (error) {
      if (error.code) throw error;
      fail(502, 'DRIVE_RESPONSE', 'Drive returned invalid file metadata.');
    }
    if (
      metadata.id !== id ||
      metadata.trashed ||
      metadata.capabilities?.canDownload !== true
    )
      fail(403, 'FILE_UNAVAILABLE', 'This file cannot be read.');
    const native = metadata.mimeType === 'application/vnd.google-apps.document';
    if (
      !native &&
      !['text/plain', 'text/csv', 'application/json'].includes(
        metadata.mimeType,
      )
    )
      fail(
        400,
        'FILE_UNSUPPORTED',
        'Choose a Google Doc, plain text, CSV or JSON file. Folders, PDFs and other formats are not supported yet.',
      );
    const content = await request(
      native
        ? `${API}${id}/export?mimeType=text%2Fplain`
        : `${API}${id}?alt=media&supportsAllDrives=true`,
      { headers },
      16000,
    );
    let after;
    try {
      after = JSON.parse(
        await request(
          `${API}${id}?fields=id,version,trashed,capabilities(canDownload)&supportsAllDrives=true`,
          { headers },
        ),
      );
    } catch (error) {
      if (error.code) throw error;
      fail(502, 'DRIVE_RESPONSE', 'Drive returned invalid file metadata.');
    }
    if (
      after.id !== id ||
      after.trashed ||
      after.capabilities?.canDownload !== true ||
      !metadata.version ||
      after.version !== metadata.version
    )
      fail(
        409,
        'FILE_CHANGED',
        'This file changed during import. Review it and try again.',
      );
    if (!content.trim() || content.includes('\u0000'))
      fail(400, 'FILE_UNSUPPORTED', 'Choose a nonempty text document.');
    return {
      name: String(metadata.name || 'Drive document').slice(0, 80),
      content,
      providerVersion: String(metadata.version || metadata.modifiedTime || ''),
      mimeType: metadata.mimeType,
    };
  }
  return {
    seal,
    open,
    authorization,
    readFile,
    exchange: (code, verifier) =>
      token({
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    refresh: (refreshToken) =>
      token({ refresh_token: refreshToken, grant_type: 'refresh_token' }),
    picker: (accessToken) => ({ accessToken, apiKey, projectNumber, origin }),
    revoke: async (accessToken) => {
      await request('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: accessToken }),
      });
    },
  };
}
module.exports = { createGoogleDrive, SCOPE };
