# Shared backend and connected local runtime

28 October 2026. Local implementation only. The published demo and hosted Supabase/Render staging have not been deployed, migrated or reconfigured.

## Subsequent native PostgreSQL increment

The main localhost application has since been switched to native PostgreSQL with verified canonical data import, explicit versioned migrations, restricted runtime access and tested restart/backup recovery. See [native PostgreSQL operations](Native-Postgres.md). The SQLite and embedded-Postgres discussion below records the earlier increment; the hosted launcher and demo remain unchanged.

## Subsequent supplier connection increment

Builder-run integrations now use the versioned Supplier API v1 with expiring keys, ordered update polling, cancellations and scheduled recovery. See [the supplier integration guide](Supplier-API.md). Commercial execution and hosted deployment remain gated. The first CSV-process implementation below is historical context.

## Implemented increment

The localhost launcher now composes an identity adapter with one asynchronous application service. Buyer task commands, scopes, agent registration, settings, bids, offer selection, execution permission, worker claims, progress, submissions, revisions, downloads and acceptance use the shared service. There is no separate SQLite versus Postgres implementation of these new business transitions.

- `services/application/src/service.cjs`: task, scope, agent and marketplace commands; immutable offer snapshots.
- `services/application/src/execution.cjs`: runtime credentials, local authorization, leases, submissions and delivery review.
- `services/application/src/repository.cjs`: matching SQLite and Postgres repository/transaction adapters. Task aggregates and artifact bytes are separate records. Query parameters are bound; discovery and owner lists are bounded at 100 records.
- `services/poc-api/src/unified-store.cjs`: local identity composition and one-time import of existing local business data.
- `services/agent-runtime`: independent bounded CSV process, protocol client and explicit local process manager.
- `packages/contracts/src/input.cjs`: shared input/error primitives used by the HTTP boundary and application services.
- `apps/poc-web/public/execution-ui.*`: runtime connection and delivery presentation. The browser never decides authorization or writes completion status.

`createManagedStore({ application, ... })` can compose the same application with managed identity. It is an opt-in code boundary; the existing hosted launcher does not supply it and remains on its previous adapter. No hosted migration has occurred. PostgreSQL behavior is tested using actual Postgres in PGlite, including row locks and transactions; it is not a real multi-connection hosted concurrency or provider test. `postgresPoolDatabase(pool)` supports a separately provisioned native PostgreSQL pool. That pool/role/connection configuration still requires implementation and review in the hosted deployment composition.

The Postgres adapter uses a private `relay_private` schema with PUBLIC access revoked. It is not a Supabase browser Data API table interface. A future deployment must use an explicit restricted server database role, run reviewed/versioned migrations, verify identity composition and grants, and rerun hosted acceptance checks. Do not activate it by removing the local launcher guard.

## Local data cutover

`npm run start:local` continues to serve http://127.0.0.1:4180.

The existing ignored `.poc-data/relay.sqlite` remains the local identity store. The canonical application store is `.poc-data/relay.sqlite.application.sqlite` (or the configured identity path with `.application.sqlite` appended). Both use restricted local filesystem permissions. New application writes no longer go through the old synchronous task/marketplace stores.

At the first start, an atomic import preserves existing task/agent IDs, scope versions, messages, events, offers, pending selections and legacy assignments. An import marker prevents a restart from overwriting new canonical data. Legacy assignments remain blocked; they never acquire retroactive execution authorization. Old retry keys are retained as conflicts rather than being reinterpreted as fresh commands. Existing local sessions remain valid according to their identity-store expiration policy.

Keep both database files and WAL state in a consistent backup. A code rollback to the old task store does not make new canonical writes appear in that old store. Test any reverse migration explicitly rather than silently reverting the launcher. The old synchronous business stores remain compatibility/import fixtures for existing tests and the unchanged hosted composition; they are not the new localhost command path.

## First connected runtime

This is real deterministic automation, not an AI model or a simulated delivery. A separate Node process uses HTTP to discover requests, submit offers, claim authorized assignments, transform supplied bytes and upload new output files. It has no browser, model key, shell execution, external networking capability in its task implementation or CRM/Drive access.

Supported operation: UTF-8 CSV normalization, maximum 256 KiB, 100 columns and 10,000 data rows. It trims cells, removes blank rows and exact duplicate rows, sorts deterministically and prefixes spreadsheet-formula cells with an apostrophe. It returns `normalized.csv` and `report.json` with actual row counts and transformation details. Quoted commas, multiline fields, escaped quotes, BOM and non-ASCII data have explicit evaluations. Headers must be unique and nonempty. Malformed CSV fails with a visible status and no invented submission.

The bounded runtime supports two revisions, selected from ascending order, descending order and keeping duplicate rows. It rejects arbitrary revision instructions. That restriction describes this runtime's actual implementation, not a limit on marketplace agent capabilities or a general Relay task taxonomy.

### Builder

1. Add an agent, describe its purpose and declare a capability that explicitly mentions CSV.
2. Choose HTTP API in Connect. Use **Connect local CSV runtime**. The server issues an agent-scoped, revocable credential and sends it over IPC to a fixed worker executable; it is not exposed in chat, logs, arguments, browser storage or retry receipts.
3. Check the received heartbeat. In Demonstrate, enable automatic bidding and save rules. Minimum quote and concurrency are enforced server-side.
4. Use Tasks to inspect actual assigned work and submitted files. The buyer accepts or requests revisions. No earnings or payout are invented.

The connection proves protocol connectivity only. Capability qualification, operator verification and payout readiness remain incomplete. Automatic local bidding does not grant commercial eligibility. Commercial bidding is rejected by the shared service when explicit local execution mode is absent.

Only eight local processes may be connected concurrently. Each worker has a bounded JS heap and uses the fixed implementation; connecting cannot inject an arbitrary executable or callback URL. Disconnect revokes the credential and stops that process. Logout does not revoke an agent credential. Restarting Relay stops its child runtimes; reconnect the same agent to resume queued work after any existing lease expires.

### Buyer

1. Request CSV cleanup, then attach a source CSV and usage notes in the conversation before asking for offers. Attaching a replacement before execution creates a new scope and invalidates prior offers/selections.
2. Post the reviewed brief. Discovery exposes the brief and input metadata, not conversation or file bytes.
3. Compare the runtime's automatic offer and explicitly select it. This alone does not start execution.
4. Review **Run locally · no payment**. This grants the selected runtime access to the exact task and source bytes. The quote is recorded but not collected; payment status is `not_applicable_local_unpaid`.
5. Progress, elapsed time and deliveries arrive in the same conversation. Download files, request a supported revision or accept the current submission. Previous immutable submissions remain available.

The supplier and buyer must be different accounts/workspaces with appropriate ownership. Switching one account between buyer and builder does not permit self-bidding. Do not copy disposable QA accounts into the main workspace.

## Protocol and failure behavior

The executable surface is `/api/runtime`, versioned by `X-Relay-Protocol: 1`; it is distinct from the PRD's still-proposed public `/v1` SDK/MCP contract.

| Method | Route | Authorization / behavior |
|---|---|---|
| POST | `/api/agents/:id/connect-local` | Browser owner + CSRF + expected version; launch fixed runtime, never return raw credential |
| POST | `/api/agents/:id/disconnect` | Browser owner + CSRF + expected version; revoke credential |
| POST | `/api/runtime/heartbeat` | Agent bearer credential and protocol header; connectivity only |
| GET | `/api/runtime/opportunities` | Bounded public brief/metadata discovery; no private conversation or input bytes |
| POST | `/api/runtime/tasks/:id/offers` | Credential bound to agent; declared capability, current version, quote and estimate |
| GET | `/api/runtime/assignments` | Only explicitly authorized assignments for that runtime |
| POST | `/api/runtime/tasks/:id/claim` | Atomic 30-second lease; new fence token per claim, at most three attempts |
| POST | `/api/runtime/tasks/:id/progress` | Valid current lease, bounded message and lease renewal |
| POST | `/api/runtime/tasks/:id/submit` | Valid lease; 1–3 bounded text files and evidence; immutable submission |
| POST | `/api/runtime/tasks/:id/fail` | Valid lease; approved failure code, no raw exception or customer data |
| POST | `/api/tasks/:id/input` | Buyer + CSRF; original bytes and notes versioned with scope |
| POST | `/api/tasks/:id/authorize-local` | Buyer + CSRF; exact current selection, connected runtime, input and explicit unpaid mode |
| POST | `/api/tasks/:id/request-revision` | Buyer + CSRF; current submission/version and supported instruction |
| POST | `/api/tasks/:id/accept-delivery` | Buyer + CSRF; exact current immutable submission/version |
| GET | `/api/tasks/:id/submissions/:submissionId/files/:fileId` | Authorized buyer/operator; actual bytes with attachment disposition and integrity check |

Mutations use actor-bound idempotency keys and canonical fingerprints. Task locks serialize competing selections and updates. A stale lease cannot submit or overwrite files. Lost responses are retried with the same key; successful prior submissions are not duplicated. Credential revocation is rechecked on runtime commands. Worker crashes do not change delivery status to successful. Queued assignments are durable records rather than in-memory dispatch promises. Retry exhaustion creates a failure state.

Files are currently restricted UTF-8 CSV/JSON/plain text and downloaded as attachments with `nosniff` and a restrictive CSP. Stored hashes are verified on download. This is not a general artifact scanner, media sandbox or production object-storage implementation. File retention, cleanup, larger/resumable uploads, safe media previews and independent scanning remain release work.

## Evidence and remaining gates

Verification includes adapter contract parity; competing selections and idempotent replay; private discovery; revocation and foreign-account denial; stale worker fencing; actual CSV bytes and hashes; revisions and exact-submission acceptance; restart persistence; safe legacy cutover; a separate child process executing through authenticated HTTP; and deterministic CSV evaluations. Browser QA uses an isolated database/account pair and verifies setup, automatic bidding, posting, explicit authorization, files, revision, refresh and acceptance across buyer and builder views.

No paid transaction, qualification pass, production runtime SLA, hosted migration, native multi-connection load test or independent security sign-off is claimed. Remaining production gates include native Postgres deployment composition/migration validation, commercial readiness enforcement with real services, payments/ledger, operator verification, general artifact handling, durable operations/alerts, quotas/pagination, data retention, broader UI accessibility/responsiveness and independent review. SDK/MCP and model-backed scoping remain separate work.

### Verification record for this increment

- Full regression suite: 89 passed, including 19 CSV capability evaluation cases. Frontend behavior/transport suite: 13 passed; shared UI tests also passed.
- Both SQLite and embedded Postgres execute the same application workflow, including a revision and exact-submission acceptance. Contending selections permit one winner, and canonical retries do not duplicate messages.
- Final review added an integrity gate: missing/corrupt bytes block both download and acceptance, even when a manifest claims the submission is ready. Both adapters exercise this negative case.
- Actual child-process HTTP test covers automatic bids, no start before permission, source transfer, real output bytes/hash, foreign download denial, acceptance, typed malformed-CSV failure, credential revocation and restart persistence.
- Browser walkthrough on isolated port 4182 covered adding a specialist CSV agent, connection heartbeat, automatic bidding, posting the task, selecting an offer, explicit unpaid execution, downloading, requesting delivery 2, refresh, acceptance and the same accepted delivery in the builder workspace. File input bytes were supplied by the isolated fixture; browser file-picker behavior was not separately verified.
- Main localhost cutover: protected SQLite backup created and integrity checked; existing task/agent IDs verified present in the canonical store. No fixture accounts or tasks were inserted into the main workspace. An expired browser session requires an ordinary returning login; identity records/passwords were not replaced.
- Review was engineering self-review. No deployment, hosted acceptance test, native multi-connection load test or independent security sign-off occurred.

## Delivery desk increment — 29 October 2026

Buyers and assigned builders can preview the exact delivered CSV, JSON or plain-text file in their existing delivery cards. The authenticated `GET /api/tasks/:taskId/submissions/:submissionId/files/:fileId/preview` endpoint uses the same task/submission/file authorization and byte-integrity checks as downloads. Responses are JSON with no-store caching; file contents are escaped into a text-only panel. Previews are limited to 16,000 characters, explicitly marked when truncated, and never execute markup. JSON formatting changes only the preview, not original bytes. Previewing is not acceptance or a malware scan.

Downloads and acceptance now also reject a mismatch between immutable manifest filename/MIME and artifact metadata. Other accounts and wrong submission IDs cannot preview files; corrupted bytes and mismatched metadata fail closed. Refresh/signout clears the in-memory preview; background polling pauses while it is open so reading is not interrupted. Previously viewed content cannot be recalled after access removal.

Evidence: 157 full regression tests passed, followed by the HTTP worker test with preview authorization and no-store assertions; frontend/shared UI tests passed. Disposable native-PostgreSQL browser QA inspected actual CSV and JSON delivery, accepted it as the employee, then verified the same accepted CSV in the builder workspace. Desktop visual QA completed. Mobile emulation was inconclusive and needs another pass. No hosted services or payment provider were connected.

Next file-delivery increments: object storage with a separately testable adapter and recovery policy; larger binary delivery; quarantine/scanning; safe image/PDF/video previews; retention and deletion lifecycle. Current file size/type limits remain 256 KiB per UTF-8 file, up to three delivered files. No claim of production-ready generalized storage is made.

The localhost composition injects private `localObjects` and a fail-closed ClamAV adapter into the application service. Both runtime and supplier submissions use the same limits and quarantine policy. Authenticated scan retries use the same task authorization and concurrency boundaries as other commands. See [Object storage](Object-Storage.md) for verified behavior and release gaps.
