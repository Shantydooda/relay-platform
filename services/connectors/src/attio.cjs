'use strict';
const { createHash } = require('node:crypto');
const { fail } = require('../../../packages/contracts/src/input.cjs');

// Local private integration. Credentials never enter the browser or task payloads.
function createAttio({
  token,
  tenantId,
  workspaceLabel,
  origin,
  fetchImpl = fetch,
}) {
  const site = new URL(origin);
  if (site.hostname !== '127.0.0.1' || site.protocol !== 'http:')
    throw new Error('Attio is localhost only');
  if (
    ![token, tenantId, workspaceLabel].every(
      (value) => typeof value === 'string' && value.trim(),
    ) ||
    workspaceLabel.length > 120
  )
    throw new Error('Incomplete Attio configuration');
  return {
    connectionKey: createHash('sha256')
      .update(JSON.stringify([token, tenantId, workspaceLabel]))
      .digest('hex'),
    tenantId,
    workspaceLabel,
    async assertCompany(company) {
      let response;
      try {
        response = await fetchImpl(
          'https://api.attio.com/v2/objects/companies/records?matching_attribute=domains',
          {
            method: 'PUT',
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
            headers: {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              data: {
                values: {
                  domains: [company.domain],
                  ...(company.name ? { name: company.name } : {}),
                },
              },
            }),
          },
        );
      } catch {
        fail(
          503,
          'ATTIO_UNAVAILABLE',
          'Attio could not be reached. Review and retry this delivery.',
        );
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        fail(
          response.status === 429 ? 429 : 502,
          'ATTIO_REJECTED',
          'Attio rejected this row. Check the connection, permissions and rate limits before retrying.',
        );
      }
      const chunks = [];
      let size = 0;
      try {
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > 65536)
            fail(
              502,
              'ATTIO_RESPONSE',
              'Attio returned an oversized response.',
            );
          chunks.push(Buffer.from(chunk));
        }
      } catch (error) {
        if (error.code === 'ATTIO_RESPONSE') throw error;
        fail(
          503,
          'ATTIO_UNAVAILABLE',
          'The Attio response was interrupted. Review and retry this delivery.',
        );
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString()).data;
      } catch {
        fail(502, 'ATTIO_RESPONSE', 'Attio returned an invalid response.');
      }
      if (
        typeof data?.id?.record_id !== 'string' ||
        !data.id.record_id.length ||
        data.id.record_id.length > 100
      )
        fail(502, 'ATTIO_RESPONSE', 'Attio did not confirm the record.');
      return { recordId: data.id.record_id };
    },
  };
}
module.exports = { createAttio };
