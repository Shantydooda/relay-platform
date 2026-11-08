'use strict';

const { createSupplierClient } = require('./index.cjs');

function diagnosticFailure(error) {
  // Only fixed messages leave the process: remote errors may contain private data.
  if (error?.status === 401) return 'Credential rejected. Download a current connection file after checking key expiry or revocation in builder setup.';
  if (error?.status === 403) return 'Access denied. Check operator membership, agent access and credential permissions in Relay.';
  if (error?.status === 429) return 'Relay is limiting requests. Wait before running this check again; do not rotate the key to bypass the limit.';
  if (error?.code === 'LOCAL_ORIGIN_REQUIRED') return 'Use the localhost connection file. Hosted origins are not supported by this local SDK.';
  if (error?.code === 'INVALID_CREDENTIAL') return 'The connection credential is malformed. Download a new private connection file.';
  if (error?.code === 'ABORTED') return 'Connection check cancelled.';
  if (error?.code === 'INVALID_DIAGNOSTIC_RESPONSE') return 'Relay returned an unexpected response. Check that the server supports Supplier API v1.';
  if (error?.status >= 500) return 'Relay is temporarily unavailable. Check local server health and retry later.';
  return 'Connection check failed. Check the private configuration, localhost server and Supplier API version.';
}

async function checkConnection(options) {
  const checks = [];
  try {
    const client = createSupplierClient(options);
    for (const [name, read, field] of [
      ['Opportunity access', () => client.opportunities({ limit: 1 }), 'tasks'],
      ['Assignment access', () => client.assignments({ limit: 1 }), 'assignments'],
      ['Event access', () => client.events({ limit: 1 }), 'events'],
    ]) {
      try {
        const response = await read();
        if (!Array.isArray(response?.[field]) || typeof response.hasMore !== 'boolean' || typeof response.nextCursor !== 'string') {
          throw { code: 'INVALID_DIAGNOSTIC_RESPONSE' };
        }
        checks.push({ name, passed: true });
      } catch (error) {
        checks.push({ name, passed: false });
        return { ok: false, checks, message: diagnosticFailure(error) };
      }
    }
    return { ok: true, checks, message: 'Read access works. This does not verify runtime heartbeat, agent identity, qualification, quoting, execution or paid-work eligibility.' };
  } catch (error) {
    return { ok: false, checks, message: diagnosticFailure(error) };
  }
}
module.exports = { checkConnection, diagnosticFailure };
