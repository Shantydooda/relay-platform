# Supplier SDK

Unpublished JavaScript/CommonJS package for Node.js 22+. Supports explicit localhost HTTP and hosted HTTPS origins. HTTPS transport does not itself deploy or enable a hosted supplier backend. No Stripe connection is created by this SDK. This wraps Supplier API v1.1; the backend remains authoritative.

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

Assignment feeds and task details expose `waitingForPermission`. When true, keep polling but do not claim: the assignment is paused for the buyer, even though its stored status remains `queued`. A false value is not permission to execute; `claim` and every tool command still check current authority. The field is optional for older-server compatibility. If a claim returns `PERMISSION_PENDING`, reconcile and wait rather than immediately retrying. Historical declined requests do not describe a replacement assignment's current state.

`createSupplierClient` also accepts `signal` (AbortSignal) and `timeoutMs` (1–30000, default 8000 per attempt). Only canonical HTTPS origins or explicit `http://127.0.0.1:<port>` origins are accepted. Paths, query strings, fragments, embedded credentials and redirects are rejected. Standard certificate validation remains enabled; never disable it or set `NODE_TLS_REJECT_UNAUTHORIZED=0`. Obtain the exact pilot origin and its own credential from the pilot operator; never reuse localhost or staging keys. Credentials stay in headers. The caller must keep its machine, connection file and tools secure. This library does not sandbox supplier code, infer capabilities, automatically approve work, persist jobs or publish to npm.

The independent CSV reference uses the same transport. It remains deterministic automation, not an AI model. Its integration test exercises bids, authorized execution, scanned downloads, application restart and revoked credentials on disposable native PostgreSQL.

### Diagnose a connection without running work

From the source checkout:

```sh
node packages/supplier-sdk/src/check-connection.cjs --config /private/path/relay-agent.json
```

The file must have owner-only permissions (`chmod 600`). This command reads one
page entry at most from each of opportunities, assignments and events. It prints
only check names and fixed guidance, never response contents, credentials or cursors.
It exits 0 when all three feed contracts pass and 1 otherwise. It does not send a
heartbeat, change runtime identity, quote, claim, qualify, execute or move money.
It does not verify that the key belongs to the agent ID in the file; the running
adapter must still compare the heartbeat agent ID with its configured identity.
A successful diagnostic is not a capability assessment or paid-work approval.
401/403/429 stop immediately; existing bounded network/5xx retries still apply.

### Response bounds

The SDK reads at most 32 MiB of response bytes per attempt, including streamed
responses without a Content-Length header. Set `maxResponseBytes` to a lower
positive integer in `createSupplierClient` for a tighter operator limit; values
above 32 MiB are rejected. This is a wire/decoded-body byte bound, not a total
process-memory guarantee. JSON parsing uses additional bounded memory.

Oversized responses are cancelled and fail with `SUPPLIER_RESPONSE_TOO_LARGE`
without automatic retry. Invalid UTF-8, malformed JSON and non-object successful
responses fail with `INVALID_SUPPLIER_RESPONSE`; response content is not logged.
The timeout covers body consumption, and caller cancellation stops retries.
Transient connection/5xx failures retain the same serialized command and idempotency
key across at most three attempts. Do not create a new command key after an
ambiguous failure: check authoritative task state before deciding what to do next.

### Standalone builder handoff

The SDK and read-only connection checker can run outside the Relay repository.
Create a local archive with `npm pack ./packages/supplier-sdk --pack-destination /tmp`,
extract it, then run `node src/check-connection.cjs --config /private/path/relay-agent.json`.
The package remains unpublished. The bundled reference runtimes are still local-only; HTTPS SDK support does not change their execution policy. Share source separately from
credentials. See [first-builder pilot](../../docs/First-Builder-Pilot.md) in the
repository for acceptance gates; repository-relative documentation links are not
bundled into the archive.
