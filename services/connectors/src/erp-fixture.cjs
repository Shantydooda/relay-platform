'use strict';

// A sample ERP for local testing of buyer connections. It is labelled as a
// sample everywhere it appears and holds made-up records only. Real connectors
// (NetSuite, SAP S/4HANA, Dynamics 365) implement the same contract:
//   verify(credentials) -> { account, objects }   rejects bad credentials
//   read(credentials, { object, cursor, limit }) -> { rows, nextCursor }
// Every operation is a read. Relay never writes to a buyer's system: changes go
// back as files the buyer reviews and loads with their own import tool.
const RECORDS = Object.freeze({
  vendor: [
    { id: 'V-1001', name: 'Acme Supply Co', taxId: '12-3456789', country: 'US', terms: 'Net 30' },
    { id: 'V-1002', name: 'ACME SUPPLY CO.', taxId: '12-3456789', country: 'US', terms: 'Net 30' },
    { id: 'V-1003', name: 'Borealis Metals', taxId: '98-7654321', country: 'CA', terms: 'Net 45' },
  ],
  customer: [
    { id: 'C-2001', name: 'Northwind Traders', country: 'US', creditLimit: 50000 },
    { id: 'C-2002', name: 'Contoso Retail', country: 'GB', creditLimit: 20000 },
  ],
  item: [
    { id: 'I-3001', name: 'Steel bracket 40mm', uom: 'EA', cost: 1.25 },
    { id: 'I-3002', name: 'Steel bracket 40 mm', uom: 'ea', cost: 1.25 },
  ],
});
const SAMPLE_TOKEN = 'sample-erp-token';

function createSampleErp() {
  return {
    kind: 'sample-erp',
    label: 'Sample ERP (local testing)',
    environments: ['sandbox', 'production'],
    objects: Object.keys(RECORDS),
    credentialFields: [{ name: 'accountId', label: 'Account ID', secret: false }, { name: 'token', label: 'Access token', secret: true }],
    async verify(credentials) {
      if (credentials?.token !== SAMPLE_TOKEN || typeof credentials.accountId !== 'string' || !credentials.accountId)
        throw Object.assign(new Error('The sample ERP rejected these credentials.'), { rejected: true });
      return { account: credentials.accountId, objects: Object.keys(RECORDS) };
    },
    async read(credentials, { object, cursor = 0, limit = 500 }) {
      await this.verify(credentials);
      const rows = RECORDS[object] || [];
      const start = Number(cursor) || 0;
      const page = rows.slice(start, start + limit);
      return { rows: page.map(row => ({ ...row })), nextCursor: start + page.length < rows.length ? String(start + page.length) : null };
    },
  };
}

module.exports = { createSampleErp, SAMPLE_TOKEN };
