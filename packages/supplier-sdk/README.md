# Local supplier SDK

Unpublished JavaScript/CommonJS package for Node.js 22+. Localhost, unpaid integration only. No Stripe, hosted demo or staging connection. This wraps Supplier API v1.1; the backend remains authoritative.

In builder setup, choose **JavaScript SDK**, save, create a scoped key and save the connection file privately (`chmod 600`). Never commit it or put credentials in command arguments, URLs or logs. The built-in CSV shortcut still uses HTTP API; your separately running reference or custom runtime may use SDK.

From the repository root in a `.cjs` script:

```js
const { createSupplierClient } = require('./packages/supplier-sdk/src/index.cjs');
const config = require('/private/path/relay-agent.json');
const client = createSupplierClient(config);

async function main() {
  const agent = await client.heartbeat({ runtimeName: 'My supplier', runtimeVersion: '1' });
  if (agent.agentId !== config.agentId) throw new Error('AGENT_MISMATCH');
  const page = await client.opportunities({ limit: 50 });
  // Inspect page.tasks; follow page.nextCursor while page.hasMore.
  // Only quote work your runtime can actually perform.
}
main().catch(error => console.error(error.code || 'SUPPLIER_FAILED'));
```

`heartbeat(body)`, `opportunities(page)`, `assignments(page)`, `events(page)`, `task(taskId)` and `qualifications()` mirror the documented HTTP responses. Pages accept `{after, limit}` (1–100). Persist event cursors only after handling events; reconcile task state on restart. Rescan opportunities from the beginning each cycle.

Consequential methods take `(taskId, body, commandKey)`: `quote`, `claim`, `progress`, `submit`, `fail`. `submitQualification(testId, body, commandKey)` handles test/revision evidence. Payload schemas and examples remain in [Supplier API](../../docs/Supplier-API.md) and the versioned OpenAPI contract.

Persist a random UUID **before** sending each command. Reuse that key and identical body after an uncertain response, including process restarts. Do not generate a new key just because a request timed out. A changed command/body needs a new key. The SDK retries network/5xx failures at most three times with identical serialized bytes. It does not retry authorization failures, conflicts or throttling. Reconcile those against current server state. `SupplierError` exposes sanitized `code` and `status`, not remote messages or credentials.

After buyer selection and authorization, `claim` returns the authorized brief/input and fenced lease. Renew with `progress` before lease expiry; a heartbeat does not renew the lease. Return files through `submit`. Quarantine/scanning still gates buyer downloads and acceptance. Revisions require a fresh claim; old leases must never be reused. Handle cancellation, expired deadlines and revoked credentials by stopping the affected work.

`createSupplierClient` also accepts `signal` (AbortSignal) and `timeoutMs` (1–30000, default 8000 per attempt). Only explicit `http://127.0.0.1:<port>` origins are accepted; redirects are rejected. Credentials stay in headers. The caller must keep its machine, connection file and tools secure. This library does not sandbox supplier code, infer capabilities, automatically approve work, persist jobs or publish to npm.

The independent CSV reference uses the same transport. It remains deterministic automation, not an AI model. Its integration test exercises bids, authorized execution, scanned downloads, application restart and revoked credentials on disposable native PostgreSQL.
