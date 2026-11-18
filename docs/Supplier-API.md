# Supplier API v1: local implementation

28 October 2026. This increment remains on localhost, separate from the published prototype and hosted staging. Commercial payments and MCP are not enabled by this API. Later local increments add the SDK and per-capability qualification described below.

## Product behavior

Builders have two connection paths under stage 2 of agent setup:

1. **Connect your own runtime.** Create an expiring, agent-scoped supplier key. Save the private connection file and start code under your control. A successful heartbeat updates readiness to connected, but does not qualify any capability or verify the operator.
2. **Try the local CSV runtime.** Relay starts the fixed deterministic reference process for local integration testing. This remains clearly labeled automation, not an AI model.

One agent can have multiple open-ended capabilities. A supplier-hosted runtime can bid for a supported capability without a CSV attachment; it receives the exact agreed brief after buyer permission and can return text, CSV or JSON. The supplied reference implementation only performs CSV normalization. Registering a broad capability does not give that reference implementation new skills.

The buyer still reviews offers and explicitly authorizes unpaid execution. Starting work is not automatic merely because an API key exists. Corporate funding/approval and commercial dispatch remain gated. Buyer delivery, revisions, acceptance, progress and cancellation remain in the existing conversation. Supplier-hosted revisions accept bounded free text; the deterministic CSV reference understands only its documented CSV revisions.

## Implemented transport and source

- Executable contract: `packages/contracts/supplier-openapi.json`, served locally at `/supplier-openapi.json`.
- HTTP boundary: `services/poc-api/src/supplier-api.cjs`.
- Credentials: `services/application/src/supplier-credentials.cjs`.
- Ordered updates and scoped reads: `services/application/src/supplier-feed.cjs`.
- Cancellation and scheduled recovery: `services/application/src/execution-lifecycle.cjs`.
- Reference process: `services/agent-runtime/src/cli.cjs` and the shared CSV worker.

The versioned base path is `http://127.0.0.1:4180/v1/supplier`. The `/v1` path carries the protocol version; no extra version header is required here. It uses the same application commands and permissions as the local reference integration, rather than duplicating marketplace logic. The old `/api/runtime` interface remains a distinct local-reference transport and requires its existing version header; supplier keys cannot use it.

This is a pull protocol. Relay makes no calls to supplier-supplied URLs and does not host supplier code. Heartbeat proves possession of the credential, not endpoint ownership or task quality. There is no webhook transport/signature claim. If callbacks are added, signing, replay windows, event IDs and delivery recovery need their own implementation and tests. The PRD's broader proposed supplier/SDK/MCP contract remains a design, not an assertion that those transports exist.

## Register and connect

Register an agent/capability through the authenticated builder workspace. Select and save HTTP API as the connection method. Enable automatic bidding and save minimum quote/concurrency rules in stage 3.

The authenticated owner can call `POST /api/agents/{agentId}/supplier-credentials` with browser session, CSRF and idempotency key:

```json
{ "expectedVersion": 2, "expiresInSeconds": 604800 }
```

The first response contains a random secret token and metadata. A repeated successful request returns metadata with `token: null`. The server cannot recover the raw token from a receipt. If that response was lost, rotate a new key after refreshing the current version.

Keys expire after a selected lifetime of 1 hour to 30 days (default 7 days). One active key exists per agent. Rotation invalidates the old key immediately, clears connection status and requires a new heartbeat. `POST /api/agents/{agentId}/disconnect` revokes it. Issuing a supplier key stops the in-app reference process for that agent. Switching back to the in-app reference issues a different key and revokes the supplier connection. Changing the saved integration method also revokes the existing key.

Scopes are fixed to `opportunities:read`, `offers:write`, `assignments:read`, `execution:write` for this implementation. They do not include buyer acceptance, funding, payouts, workspace administration, other agents or connected customer tools. The server checks current credentials/expiry and ownership on operations, including after key rotation. Local execution must be explicitly enabled; this is not an invitation to issue paid production credentials before eligibility services exist.

In the UI, the key is held in page memory and is offered as a private connection-file download, not written into browser storage, URLs or task records. Leave or dismiss the setup to clear it. Keep the downloaded file private; downloading alone does not enforce filesystem permissions. The CLI refuses a config readable by other OS users or a symlink config.

Example private file (replace placeholders locally; never commit it):

```json
{ "origin": "http://127.0.0.1:4180", "agentId": "<your-agent-id>", "token": "<your-one-time-key>" }
```

Run the CSV reference independently of Relay:

```sh
chmod 600 /path/to/relay-agent.json
node services/agent-runtime/src/cli.cjs --config /path/to/relay-agent.json --state /path/to/relay-cursor.json
```

Use a separate cursor file per agent. The CLI binds it to origin and agent ID and stores only its event cursor, never input bytes, private task content or credentials. It connects only to an explicit loopback origin and refuses redirects. It is a reference client, not a published SDK or an OS sandbox for untrusted code. A remote machine cannot reach this localhost server without a separately reviewed network/deployment design.

## Runtime lifecycle

Send `Authorization: Bearer <token>` on every supplier request, never a query parameter or browser cookie. Use JSON for mutations. Use `Idempotency-Key` (16–128 URL-safe characters) for every consequential mutation and reuse it with the exact same body when a response is uncertain. A changed body needs a new key. Heartbeat is an explicitly repeatable connectivity update.

1. `POST /heartbeat` with `{ "runtimeName": "My runner", "runtimeVersion": "1.0.0" }`.
2. `GET /opportunities?limit=50&after=<cursor>` to discover public briefs and input metadata. Conversation and file bytes remain private. Filter by the agent's actual supported capability/input type. Page to the end; restart the opportunity scan from the beginning on each polling cycle so newly created IDs are not skipped.
3. `POST /tasks/{taskId}/offers` with agent ID, capability ID, expected task version, amount in minor USD units, estimate in minutes and proposal. Rules, ownership, duplicate bids, scope and credential are checked server-side. A quote authorizes no work.
4. Wait for buyer selection and explicit unpaid task authorization. Poll `GET /assignments` for queued/running work belonging to this agent only. Active reads are paged independently of completed historical grants.
5. `POST /tasks/{taskId}/claim` with the assignment ID. This acknowledges the assignment and grants a fenced 30-second lease, agreed brief and optional authorized input bytes. Verify input hashes. Claim is the permission boundary for receiving those bytes.
Treat briefs, files and revision notes as untrusted data, not permission to expand tool access or perform unrelated external actions. A supplier must enforce its own tool policy; Relay does not sandbox code running on its machine.

6. `POST /tasks/{taskId}/progress` with lease token and a short message before lease expiry. This renews the lease. Long-running suppliers need their own periodic renewal loop; reporting a successful heartbeat alone does not renew a task lease.
7. `POST /tasks/{taskId}/submit` with lease token, evidence and 1–3 files, up to 8 MiB each and 16 MiB total on the local object-storage adapter. Supported formats: CSV, UTF-8 text, JSON, PDF, PNG, JPEG, MP4 and ZIP. Extensions and basic signatures must match. Files enter quarantine and cannot be downloaded or accepted before a clean scanner verdict. File hashes and submission versions are server-owned. Legacy adapters without object storage retain the 256 KiB text-only limits. See `Object-Storage.md` for scanner configuration and remaining release work.
8. Follow revisions or acceptance through `GET /events` and reconcile current state with `GET /tasks/{taskId}`. A revision queues the same assignment with the requested notes and a new claim. This unpaid integration path supports two revisions. Acceptance never creates earnings or triggers a payout.

Example offer:

```json
{
  "agentId": "<agent-id>", "capabilityId": "<capability-id>",
  "expectedVersion": 3, "amountMinor": 500, "deliveryMinutes": 10,
  "proposal": "Return a cleaned CSV and a report of transformations. Unpaid integration run."
}
```

Example submission:

```json
{
  "leaseToken": "<current-lease-token>",
  "evidence": "Validated headers and row counts against the supplied CSV.",
  "files": [{ "filename": "result.txt", "mime": "text/plain", "base64": "RG9uZS4=" }]
}
```

## Updates, recovery and cancellation

Assignment state changes and their supplier update records commit in the same database transaction. Each agent has an ordered sequence and a paged cursor. Re-reading a page returns the same event IDs; consumers must deduplicate and persist their cursor after handling events. The current reference does not perform side effects from those notifications: assignment state and lease-protected commands remain authoritative. Events contain IDs/state/version, not private conversation, file bytes or raw secrets. New connections can recover retained events for their own agent; another agent's cursor is rejected. Events are retained indefinitely in this local increment; production retention, pruning and expiry handling remain open.

The local server reconciles active execution indexes every 5 seconds with bounded scans. New authorizations/revisions have a 2-minute acknowledgment window. Their overall unpaid execution window is 2 minutes plus twice the quoted delivery estimate, with execution duration bounded between 5 minutes and 24 hours. These are explicit development recovery limits, not a validated production SLA. They are not a promise that every task finishes within minutes. Delivery estimates still depend on task and agent.

Expired worker leases requeue work with a new acknowledgment window until three attempts are exhausted or the total window ends. Old workers cannot progress or submit using stale leases. Key rotation invalidates the old credential and its lease identity; a new runtime reclaims after the old lease expires. Missing runtimes and exhausted/expired work receive truthful failure states. Migration 003 backfills recovery/grant indexes for prior assignments, without imposing a new retroactive deadline on earlier agreements.

The buyer can cancel queued, running or review-stage unpaid execution on the same task using expected version and a reason. Further progress/submission is rejected, the state is visible to the supplier and existing deliveries remain auditable. Relay cannot undo actions already taken by supplier tools or forcibly stop a process on a supplier's machine. Runtime authors must poll/reconcile cancellation and stop their own side effects. Production cancellation, refunds, partial work and reassignment need an agreed commercial policy before enabling real money.

## Evidence and remaining gates

Acceptance tests cover SQLite, embedded PostgreSQL and native PostgreSQL; brief-only work, free-text revisions, current-submission acceptance, keys shown once, expiry/rotation/revocation, foreign-agent denial, ordered update recovery, cancellation, stale leases, retries, acknowledgment/total timeouts, real external-process CSV execution and app restart. Browser QA and final suite counts are recorded after review.

Remaining production gates include managed identity/deployment composition, independent capability/operator eligibility, model-backed scope understanding, general file storage/scanning, commercial funding/ledger/payouts, multi-instance quotas, external actions/permission boundaries, production deadlines, event retention, monitoring, offsite recovery and independent review. The local JavaScript SDK wraps this same API; MCP remains planned. Neither introduces independent permission or state logic.

## Verification record

- Fresh regression: 92 core tests, including the existing 19 deterministic CSV evaluation cases; 16 native PostgreSQL tests; 14 frontend tests. The 5 shared UI tests also pass and are already included in the core count.
- A separately launched CLI process authenticated with an expiring supplier credential, bid, claimed authorized work, uploaded actual CSV/report files and reconnected through an application restart. Tests exercise one-time key responses, incorrect transport/cookie rejection, rotation, revocation, expiry and revocation on integration-method changes.
- Shared lifecycle scenarios run against SQLite, embedded PostgreSQL and native PostgreSQL, including brief-only text work, free-text revisions, ordered event pages/replay, cross-account denial, cancellation, stale leases, retry exhaustion and acknowledgment/overall deadlines. Native tests retain concurrency, crash/restart and paired recovery coverage.
- Main localhost was stopped for a paired backup before migration 003. Only that local migration was applied. Its pre-change backup was restored into an isolated database and upgraded forward successfully; main data and identities were not replaced.
- Browser QA used a separate PostgreSQL database and disposable identity store on port 4182. It verified supplier heartbeat/expiry/readiness presentation, the optional built-in reference section, automatic bidding, buyer selection, explicit unpaid start, actual downloadable files, a requested revision, refresh, exact delivery-2 acceptance and the builder's matching accepted history.
- Supplier credentials/config were fixture-provisioned for the browser walkthrough. Key issuance/rotation/revocation ran through authenticated HTTP tests; the connection-file download button and browser file picker were not separately exercised end to end in that walkthrough. The frontend test verifies that the raw key is absent from rendered HTML and clears with dismissal.
- Review checked task/agent lock ordering, atomic update indexing, cursor isolation, stale credential/lease fencing, secret lifecycle, scope and artifact boundaries, forward-compatible recovery, fail-closed hosted/commercial gates and truthful UI state. This is engineering self-review; no independent security or commercial readiness approval is claimed.

The published demo and hosted staging remain unchanged. No model key, external agent provider or paid service was used. The reference runtime remains deterministic automation.

## Capability assessment extension (v1.1)

The supplier can now poll `/qualifications` and submit bounded CSV test rounds to `/qualifications/:assessmentId`, using its existing `execution:write` permission. The builder requests the test separately. A first pass creates a mandatory revision; only both passing rounds qualify the narrow rubric. See [Capability qualification](Capability-Qualification.md) and the updated OpenAPI contract. No human review or paid-work eligibility is implied.

Local delivery scanning is automatic: new submissions enter quarantine and background checks update their file metadata. No supplier or buyer click is needed when the scanner is healthy. Incomplete scans retry automatically; blocked files require a new submission. Download and acceptance still require a clean result. Real Cisco ClamAV is installed locally; configuration and recovery are tracked in `Object-Storage.md`.

## JavaScript SDK
Choose JavaScript SDK in builder setup, save the method and create a supplier key. See [the SDK guide](../packages/supplier-sdk/README.md) for usage, command identity and recovery. HTTP API and SDK use the same transport and permissions. Switching a saved method invalidates the previous connection and requires a fresh assessment as applicable.

## Contract 1.2 — offline link assessment

Qualification jobs may use `link-inventory-v1` as well as `csv-normalize-v1`; ignore rubrics your runtime does not support. The link submission contains `{round, links, report}` with counts `candidates`, `rejected`, `duplicatesRemoved`, `uniqueLinks` and `sort`. The job specifies its brief and revision; return actual evidence without a claimed status. Existing CSV payloads are unchanged. The [offline reference](../services/link-runtime/README.md) uses the SDK for qualification, automatic bids, lease-protected execution and actual JSON/text delivery.


## Selected context and permission requests (localhost)

An assigned supplier receives `contextReferences` (IDs, names, version modes; never source contents), `permissionRequests`, and grant metadata from its assignment endpoint. To request missing read permission, call `POST /v1/supplier/tasks/{taskId}/permission-requests` with `{sourceId, operation: "read", reason}` and an idempotency key, or SDK `requestPermission(taskId, body, key)`. Only user-selected sources on an active assigned task are eligible. Duplicate pending requests collapse to one. Never treat a request or a user chat message as consent.

The buyer workspace owner explicitly approves or declines. Poll the assignment for the decision. Once approved, claim the execution and call `POST /v1/supplier/tasks/{taskId}/tool-read` (SDK `readTool`) with `{grantId, leaseToken}`. Each read checks current credential, lease, assignment, scope, workspace authority, expiry, revocation and source connection. Content is returned as untrusted data with its source version. Approval is not durable authority after revocation. Pending permission requests block delivery submission. If declined, stop the dependent operation; do not repeatedly prompt or fabricate output. Execution recovery/deadline rules still apply: this increment does not suspend deadlines indefinitely while a person is unavailable.

Only local read operations are implemented. Write/send/delete, OAuth connection prompts, third-party destinations and arbitrary permission categories remain unsupported and blocked. The supplied link runtime demonstrates request → wait → read → output; the CSV runtime has not been extended to interpret supporting sources. A general LLM supplier must implement this protocol in its own tool loop.

Permission waiting: creating an access request fences the current execution lease and places the assignment in a queued permission wait. Claims return `PERMISSION_PENDING` until all current-assignment requests are approved. Execution deadlines pause during this wait. A decline remains blocked and repeated requests return the existing declined decision rather than notifying again. The user can reconsider or cancel. After approval, claim a fresh lease using a fresh attempt-derived command key; never reuse the old worker lease. Cancellation remains authoritative. External writes/sends are still unsupported.

### Delivering an installable data app

Include a file named `relay-app.json`, MIME `application/json`, in the normal delivery `files` array (base64 encoded, alongside optional sample output). Use the manifest and bounds in [Workspace Apps](Workspace-Apps.md#builder-delivered-data-apps--30-october-2026). No new supplier permission or endpoint is required. A package is not installed by submission or buyer acceptance: the owner separately selects a source and approves read access. Unsupported operations fail installation. Package code cannot call external tools; supplier task-time tool requests remain a separate permission flow.

### Task conversation and change proposals

A selected agent with `execution:write` can `POST /v1/supplier/tasks/{taskId}/messages`
with `{expectedVersion, body}`. It can propose revised terms with
`POST /v1/supplier/tasks/{taskId}/change-proposals`, supplying `expectedVersion`,
`kind` (`scope-change`, `correction`, `included-revision`), `title`, `brief`,
`reason`, `amountMinor`, `retainedMinor`, and `deliveryMinutes`. Both require an
idempotency key. The SDK exposes `message` and `proposeChange`.

Read messages and proposals on the assignment response. Supplier proposals cannot
accept themselves. Observe the cancellation event and abandon the previous lease
when the buyer accepts revised terms; wait for a newly authorized assignment.
Prices are local unpaid test amounts. See Local-Marketplace.md for scope limits.

SDK transport correction (3 November 2026): `message` and `proposeChange` now
pass the transport endpoint allowlist as well as the server router. Previously
the SDK rejected these documented commands before sending them. An isolated
loopback HTTP regression exercises the actual supplier router with a fixture
application adapter: lost-response retries preserve payload and idempotency key,
stale proposals fail without retry, and missing keys never reach the server.
This checks transport/router compatibility, not a new independent supplier
qualification or real financial settlement. Existing server authorization and
buyer approval requirements remain authoritative.

## Local model-backed reference (1 November 2026)

A separate optional Qwen3 8B supplier now uses this SDK for assessed link extraction, automatic bids, execution, files and revisions. See [Model-Supplier.md](Model-Supplier.md) for setup, explicit supported scope, failure behavior and the disposable real-model evaluation. It is not a default Relay-operated competitor and does not enable commercial payments or general web research.

## Existing API onboarding — 4 November 2026

The Connect step now explains the operator-run adapter path and exposes the same
persisted quoting controls as Demonstrate. Suppliers can opt into automatic local
test quotes, save a minimum quote in USD and limit simultaneous execution before
connecting. Saving rules in Connect stays on Connect. Refresh and API/SDK method
changes retain the saved limits. The minimum is a floor rather than a fixed price
or a guaranteed net payout; the adapter computes each quote and checks task fit.

The in-product guide covers input mapping, private provider credentials,
authorized assignment claims, durable background provider job IDs, results and
revisions. It explicitly states that a no-code endpoint connector is unavailable
and research qualification cannot be inferred from a reference CSV test.
PRD v0.54 section 18 records these product boundaries and unvalidated economics.

QA: 98 web/shared tests and 13 application/supplier tests passed (SQLite and
Postgres-compatible adapters). Added checks cover preserved credentials,
below-floor rejection, bidding opt-out, exact 2,575-cent persistence and no task
execution from quoting. Browser QA used a disposable native PostgreSQL fixture:
specialist introduction, custom research capability, $25.75 floor/two-task limit,
saving while disconnected, refresh, SDK selection and separate assessment status.
No external provider was contacted. No native concurrency suite or full
accessibility audit was rerun for this presentation increment. Stripe remains
disconnected; published demo and staging were not changed.

## Existing API end-to-end browser rehearsal — 4 November 2026

Used isolated native PostgreSQL on localhost:4183 and a separate deterministic
HTTP provider on localhost:4184. The operator-run adapter used the supplier SDK
and called the provider for actual link extraction; no third-party API was
contacted and no external URLs were visited. This demonstrates the adapter path,
not compatibility with the real-estate builder's API.

Browser sequence: introduce specialist/capability, save $12.50 minimum and one
active task, issue/download scoped credential, start adapter, check heartbeat,
complete offline-link assessment and its revision, buyer posts a matching brief,
automatic $12.50 quote with assessment evidence, select, explicitly authorize
unpaid execution, preview delivery, request descending-order revision, download
and accept delivery 2. Builder sees the same accepted task and both submissions;
payout remains zero. Actual ClamAV checks gated acceptance and downloads. Provider
received two assessment calls and two execution calls (original and revision),
with no task-execution call before authorization. Downloaded JSON contained two
unique links in the requested descending order.

Fixed three disconnected paths:
- Connect has an explicit heartbeat check and a connected-only assessment action.
- Saving a connection method persists the displayed Connect stage. Method changes
  clearly explain existing key revocation; quoting-only edits preserve credentials.
- A scan/supplier update while writing revision notes can make the task version
  stale. Conflict recovery refreshes once, restores notes only for the same
  submission, and requires explicit resubmission. It never auto-replays the
  consequential action. Browser-tested with a concurrent supplier message.

Validation: 101 web/shared UI tests and 33 native PostgreSQL checks passed.
Regression tests cover setup-stage/configuration preservation, heartbeat handoff,
revision conflict note recovery, changed submissions and authorization failures.
The native suite covers supplier HTTP execution, restarts and concurrent storage.
Desktop visual inspection completed; no full mobile or assistive-technology
rehearsal in this pass. Disposable services/data were shut down after QA.
Original localhost:4180 stays running; Stripe, staging and demo remain unchanged.

### Local read-access diagnostics — 4 November 2026

Builder setup now links to the SDK's `check-connection.cjs` command. Using the
private downloaded config, it reads bounded opportunity, assignment and event
pages and reports fixed recovery guidance for rejected credentials, permissions,
throttling, unavailable servers or incompatible payloads. It issues no heartbeat
or consequential commands and emits no private response bodies. Runtime identity,
qualification, saved quoting rules and end-to-end execution still need separate
verification. See `packages/supplier-sdk/README.md` for invocation and boundaries.

QA includes real disposable localhost HTTP, credential header handling, no-write
requests, malformed responses, empty feeds, denied access, throttling, private
config rejection and redacted output. Browser automation remains unavailable in
this session, so the new onboarding disclosure and outstanding keyboard/mobile
walkthrough must still be checked live. Stripe, demo and staging are unchanged.

### PostgreSQL-backed diagnostic lifecycle review — 4 November 2026

Extended the existing independent-process CSV supplier rehearsal to exercise the
connection diagnostic against the actual local HTTP router and PostgreSQL-backed
application, not only transport fixtures. Both the library and CLI pass before
worker startup without changing agent metadata. After key rotation, the previous
key fails with fixed credential guidance and CLI exit 1, while the replacement key
passes. Disconnecting the replacement key then rejects diagnostic access. The
same rehearsal still completes bidding, authorized execution, scanned delivery,
acceptance and application/worker restart. This is our reference supplier, not an
independently operated third-party supplier.

Full local release check `6163dac7-068e-44da-bd8a-c4c51bb95a61` passed with an
unchanged source fingerprint during execution: 364 backend, 107 web/UI, 33 native
PostgreSQL and 2 load tests (506 total; none failed or skipped). This evidence note
was added after the run. Localhost health remains PostgreSQL/local-only. Review
found no new product defect in this increment. Browser inventory was reachable,
but tab control still returned `browser.user is unavailable`; live keyboard,
mobile and onboarding-disclosure QA remain open. No Stripe connection, hosted
change or icebox expansion. Independent security/payment/operations review and
real-provider validation remain release gates.

## Local parent-plan handovers

Execution claims now optionally include `handoffs`, an array of buyer-approved
upstream excerpts. Each item identifies `sourceTaskId`, `submissionId`,
`submissionVersion`, `planVersion`, `approvedAt` and `notes`; optional `file`
contains filename, SHA-256 and size. The selected CSV bytes use the existing
claim input. Treat these as versioned task inputs, not credentials or permission
to access upstream tasks. Agents must respect the downstream task's agreement and
tool grants. Handover notes are not exposed in open opportunities or pre-start
supplier task views. This orchestration path currently rejects paid execution.

## Supplier transport response hardening — 6 November 2026

The operator-side SDK now bounds each response to 32 MiB by default; operators
may lower `maxResponseBytes`, but cannot increase it above the ceiling. Both
Content-Length and actual consumed bytes are checked. A geometrically grown,
capped buffer prevents unbounded per-chunk bookkeeping for tiny streamed chunks.
Oversized bodies are cancelled without retry. Success requires an object encoded
as valid UTF-8 JSON; malformed responses fail without exposing response contents.
Timeouts cover response consumption, and caller cancellation stops the request.
Existing three-attempt transient retries preserve command bytes and idempotency keys.

QA covers declared/streamed oversized bodies, exact byte boundaries, split Unicode,
malformed payloads, slow HTTP bodies, caller cancellation, transient malformed 503s,
revoked access and unchanged command identity. The SDK and reference-runtime suite
passed 52 tests. The broader native PostgreSQL suite passed 36 checks; the native
supplier workflow was rerun after the final buffer review. No UI behavior changed,
so no new browser walkthrough was performed for this transport-only increment.
This improves local integration robustness; it does not certify an independently
operated supplier API. That release gate still needs the builder's own runtime.
