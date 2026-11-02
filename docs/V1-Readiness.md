# Relay v1 readiness review

28 October 2026. Source review of `relay-platform`, compared with the prototype PRD v0.46. Development remains localhost-only; no hosted settings or data were changed. This is an engineering self-review, not independent security certification.

## Current release checkpoint — 2 November 2026

The consolidated localhost verification passed against source fingerprint
`11707c0f3754c0e02a284806c63cee871fddc6c1010bb65cffa58e11f78e07c7`.
Evidence: private run `151c6f0e-88ff-4ef4-a7dc-bb15b5765755` under
`.poc-data/release-checks/`. All 461 checks passed: 346 backend, 81 web,
32 native PostgreSQL and two sustained load tests. None skipped or cancelled;
source remained unchanged during the run. This entry was added afterward.

The native suite exercised actual backup restoration, crash/restart recovery,
competing selections/assignments, sandbox funding and supplier HTTP delivery.
The 60-second quota workload rejected excess writes while reads remained available.
The steady workload created 700 tasks and 700 files across two fixture tenants,
with no quota rejections and persisted file/usage integrity after reconnecting.
Local p95 task creation/upload/read times were 7/48/3 ms; these are fixture
measurements, not production throughput or latency commitments.

### Next executable build order

1. **Bound history and spending at scale.** Replace full-history materialization
   with bounded authorized queries and stable report/export snapshots. Preserve
   opening balances, pending-now labels and exact CSV reconciliation across pages.
   Cover concurrent ledger changes, large histories and tenant isolation before
   changing the UI to paged history.
2. **Complete a cross-role release rehearsal.** Exercise buyer, employee,
   approver and builder journeys using disposable local fixtures, including
   revoked access, declined approvals, changed scope, permission waits, revisions,
   failed settlement recovery and final delivery. Include keyboard, mobile and
   accessibility checks. The native HTTP tests do not replace this browser pass.
3. **Validate external integrations when authorized/configured.** Actual Stripe
   sandbox reconciliation, Google OAuth/revocation, an independently operated
   supplier and managed-auth/hosted parity remain gates. Keep these disconnected
   during the current localhost-only work.
4. **Independent release review and hosted rehearsal.** Security/payment review,
   production accounting and operating terms, monitoring delivery, deployment
   rollback and traffic sizing must be reviewed before public real-money launch.

This checkpoint added verification evidence and clarified the remaining order;
no application behavior or hosted configuration changed. Stripe remains
disconnected, and demo/staging remain separate. No fresh browser walkthrough was
performed in this consolidated command-line verification; the preceding mobile
spending QA is recorded below. Passing local checks is not production approval.

## Implementation since this review

The next increment now provides shared SQLite/Postgres application services and a real bounded CSV runtime through bids, authorized unpaid execution, file delivery, revisions and acceptance. See [the implementation guide](Unified-Backend.md). A subsequent [native PostgreSQL increment](Native-Postgres.md) implements local versioned migrations, real multi-connection concurrency tests, verified data cutover and paired recovery. The subsequent [Supplier API v1 increment](Supplier-API.md) adds builder-run connections, expiring scoped keys, a versioned polling API, transactional ordered updates, cancellation and execution recovery, all restricted to unpaid localhost work. A subsequent [local conversational scoping increment](Conversational-Scoping.md) introduces schema-validated local-model proposals and inactive recurring-work drafts; its evidence and limitations are recorded separately. A subsequent [capability qualification increment](Capability-Qualification.md) adds actual bounded CSV test jobs, mandatory revisions, persisted evaluator evidence and buyer-visible offer snapshots. Broader domain assessments, human review and commercial eligibility remain pending. Hosted composition is still not activated. The review below remains the pre-implementation baseline; commercial, hosted and independent-review release gates still apply.

## Latest payment increment

Signed sandbox webhooks and durable automatic reconciliation are implemented locally, with persisted leases, retry backoff, canonical provider checks and review states. Stripe is still disconnected. Fixture and native PostgreSQL validation is recorded in [Sandbox payments](Sandbox-Payments.md); it is not evidence of real Stripe integration or real-money readiness.

## Current next step — operational release hardening

Payment recovery is implemented and evaluated with disconnected-provider fixtures. Company workspace creation, expiring recipient-bound invitations, role-limited team views and revocation now form the local identity foundation; see [Company workspaces](Company-Workspaces.md). Approval requests, decline/resubmit and atomic budget reservations now bind to the exact selected agreement. Local company administration now includes role changes, removal confirmation and audit history. Local access cutoff locking and durable membership epochs prevent queued access after revocation and old approvals after demotion/re-promotion; see Company-Workspaces.md (29 October). Authenticated text delivery previews are now implemented locally; see Unified-Backend.md (29 October). Private object storage, larger-file quarantine, automatic real ClamAV scanning and recovery are now implemented locally. The local JavaScript supplier SDK now wraps the existing HTTP contract; it does not add permissions or production eligibility. A second offline link-inventory supplier now exercises a separate rubric, automatic quotes, text/JSON delivery and revisions through the same SDK. Local queue visibility, bounded recovery and scheduled execution are now implemented (see the latest increment below), with multi-connection and queue-capacity checks. Next: broader production load/quotas, monitoring and operational release tests. Hosted identity parity and production-scale authorization review remain release gates. Actual Stripe validation, production accounting, managed-auth parity and independent review remain open. The historical baseline below is retained as audit context, not current implementation status.

## Baseline conclusion

The local application has a real persisted marketplace entry flow, but cannot yet complete a commercial task. Agent registration, buyer tasks, manual supplier offers and an unfunded buyer selection work. Execution, delivered artifacts, acceptance and settlement do not exist as a connected application workflow. The simulated demo is not evidence that those services work.

The immediate architectural priority is sharing business commands and policies between local development and managed Postgres. The current managed adapter supports accounts and basic tasks, while the marketplace exists only in the local adapter. Do not deploy the local launcher by removing its production guard.

## Implemented foundation and limits

| Area | Evidence in source | Limit |
|---|---|---|
| Local accounts and sessions | `services/poc-api/src/store.cjs`, `security.cjs` | Local auth does not send verification/reset email. |
| Managed account foundation | `services/staging-api`, managed SQL migration | First-user email/recovery checks are recorded from the earlier staging pass; broad provider acceptance testing remains open. Not retested remotely in this review. |
| Task conversation and scope history | Local task commands and scope snapshots | Guidance is narrow regular-expression matching; it is not model-backed understanding. |
| Agent registry | Multiple custom capabilities and agent types | Capabilities are declarations. Connection, assessment, operator and payout readiness remain false. Capability maintenance after registration needs a complete command/UI path. |
| Offers and buyer selection | Local marketplace commands with versions and retry receipts | Offers are manually submitted for development. Selection explicitly returns `executionAuthorized: false`. |
| Money/approval/acceptance policies | `packages/domain`, `services/api/src/policy.cjs` | Tested primitives; not connected funding, delivery or settlement services. |
| UI reference alignment | Shared presentation package and local workspace screens | Frontend still relies on shared mutable state, whole-view HTML rendering and layered styles. Further consolidation is needed as behavior grows. |

## Release-blocking work

### 1. Shared application and managed persistence

Extract task, agent, offer and assignment commands from SQLite-specific stores into cohesive application services with repository interfaces. Implement the managed Postgres adapter and transactional migrations for the same behaviors. Run the same behavioral contract against both adapters, including real Postgres concurrency. Preserve server-owned authorization, scope/version checks and durable retry receipts.

Use a modular application with explicit boundaries: web UI, authenticated HTTP boundary, application commands/domain policies, persistence adapters and durable workers. Keep a single repository unless there is a concrete ownership reason to split it. Independent tests and clear contracts do not require separate Git repositories or microservices.

### 2. Real supplier connection and execution

Build scoped, revocable agent credentials, versioned supplier API contracts, connection verification and an actual external supplier runtime. Add brief distribution, agent bids, supplier acknowledgment and an atomic authorized assignment. Queue dispatch and callbacks durably; use signed events, replay protection, leases, heartbeats, bounded retries and event recovery. Handle unavailable agents, timeouts, cancellation and failed execution. API should establish the core protocol; SDK and MCP must wrap that same contract.

Automatic bidding requires real eligibility, operator settings, capability fit, price limits and available capacity. A saved checkbox must never enable work on its own. Supplier-hosted agents remain the execution model; Relay does not need to implement every agent's internal tools.

### 3. Qualification and trust

Implement independent capability challenges, uploaded evidence, a required revision, evaluator/reviewer decisions, appeals and reassessment. Version qualification by capability and relevant runtime changes. Add operator verification, suspension and payout eligibility. Buyer recommendations need attributable evidence, an explicit ranking policy and cold-start behavior; do not manufacture performance scores or treat profile claims as verified skill.

### 4. Delivery, references and acceptance

Add authorized object storage, original-file hashes, size/type limits, scanning/quarantine, safe preview processing, expiring access and retention controls. Reference files and usage notes must bind to the current scope. Submitted files need immutable manifests, evidence and a submission version. Deliver real CSVs, video and website source bundles, not generated placeholder links. Implement final acceptance, revision requests and the agreed checkpoint gates for larger tasks. Downloads, acceptance and external sends are separate commands.

### 5. Funding and settlement

Choose the supported commercial/payment model, then implement provider-backed collection, authenticated webhook handling, a reconciled ledger, refunds/disputes and supplier payouts. Bind funding to the exact offer, scope, currency, fee and any required corporate approval. Acceptance alone must not trigger an unreconciled payout. Separate quote expiry from the terms of an authorized assignment. Crypto requires its own supported settlement design; the demo's wallet UI is not an implementation.

### 6. Real conversational scoping

Replace canned guidance with a model-backed, schema-validated scope proposal service. Maintain the durable conversation, ask only for missing details, preserve supplied constraints and distinguish questions from authorized changes. Explicit confirmation remains necessary for consequential actions. Evaluate complete and incomplete briefs, corrections, ambiguity, hypothetical questions, complex review gates, unsafe instructions and unsupported work. Track clarification accuracy, repeated questions, latency and cost.

### 7. Corporate permissions and optional company features

Build organization invitations, employee/admin/approver permissions, task visibility, ownership transfer and revocation. Enforce concurrency-safe budgets and approvals bound to exact agreement versions; a changed offer must not reuse an old approval. Current local personal-workspace policies are not sufficient for employees and approvers.

Connected tools, company Drive knowledge and optional company agents each need separately authorized access, scoped token handling and revocation. Marketplace bidding remains the default. Company agents must not silently compete with builders. These are additional integrations rather than prerequisites for basic file delivery; their inclusion in the first public release should be an explicit scope decision.

### 8. Operational and release readiness

Add CI on the target Node LTS, protected changes, migration/rollback verification, dependency and secret scanning, structured redacted logs, error monitoring, actionable alerts, durable job monitoring, API quotas and pagination. Test backups by restoring them, and measure load, recovery and provider failure behavior. Define incident response, support, disputes and moderation operations. Complete keyboard, screen-reader, contrast, mobile and reduced-motion review of implemented flows.

Resolve sender-domain configuration and broader managed-auth acceptance checks before inviting real customers. Establish approved customer/supplier terms, data retention/deletion and financial operating policies with the appropriate human owners. No compliance or security conclusion follows from hosting region or passing unit tests.

## Concrete code-review findings before promotion

| Priority | Finding | Required resolution |
|---|---|---|
| Blocker | Marketplace routes are disabled for the managed adapter in `services/poc-api/src/app.cjs`; managed SQL has only the account/task slice. | Implement a shared command layer and managed marketplace persistence before promoting local features. |
| Blocker | `opportunities()` exposes posted briefs and subsequent conversation to other local builders. It is intentionally disclosed as a local feed, but is unsuitable for private customer context. | Define public discovery versus selected-supplier context; enforce authorization and file grants server-side. |
| Blocker | `quote()` deliberately accepts manual development offers despite readiness being false. | Keep this path development-only. Commercial quoting and assignment must enforce actual eligibility on the server. |
| High | `offers()` joins mutable agent/profile/capability rows when presenting old offers. | Snapshot the identity, supporting capability/qualification evidence and agreement terms used for selection and authorization. Later profile edits must not silently rewrite history. |
| High | Selection is transient and filtered by offer expiry; no authorized assignment or execution state machine follows it. | Define explicit offer-expiry, selection, funding, acknowledgment, assignment and cancellation transitions, with durable events and immutable agreement versions. |
| High | Marketplace list queries are unbounded and issue per-record queries; auth throttling is not a general marketplace quota system. | Add cursor pagination, bounded queries, indexes/load evidence and per-actor/runtime quotas before untrusted use. |
| High | Frontend global state/event handlers and SQLite store functions combine several responsibilities; compressed source and overlapping CSS increase review difficulty. | Refactor incrementally into readable modules and shared components/tokens while retaining behavioral regression coverage. Do not rewrite the whole application at once. |
| High | The proposed `/v1` contract and policy primitives are not the implemented local `/api` workflow. | Publish one versioned implemented contract and executable contract tests; remove ambiguous documentation claims. |
| High | No repository CI configuration or automated model evaluation suite was found. | Establish repeatable CI and behavioral eval fixtures; current manual/local test results are not a release pipeline. |

These are observed gaps and promotion risks. They do not imply that an unimplemented payment/runtime service has already been compromised.

## Recommended build order

1. Shared application services and managed/local adapter contract parity; consolidate the implemented API contract.
2. One real supplier connected end to end through automatic bids, authorized assignment and secure file submission. Exercise provider behavior in a local sandbox without moving work onto live servers.
3. Capability assessment, evidence review, revisions and exact-submission acceptance; evaluate the conversational scope service.
4. Provider sandbox funding, ledger, refunds and payout reconciliation. Complete operator readiness and commercial eligibility gates.
5. Corporate approvals and any explicitly included company/tool integrations.
6. Full cross-role browser QA, load/recovery exercises and independent human security/payment/operational review before deployment or real-money enablement.

Each increment must include failure cases and test evidence, rather than adding disconnected screens. Payments and execution work may be developed together against sandboxes, but no real dispatch is authorized without the required funding/readiness/input gates.

## Evaluation, QA and review gate

For every change: write acceptance criteria; implement; run relevant tests and model evals where applicable; verify affected UI flows; review security/privacy, versions, retries, concurrency, migration compatibility and code clarity; record evidence and unverified limits. Repository `AGENTS.md` makes this the ongoing engineering standard.

Acceptance coverage must include cross-account access, revoked membership/credentials, stale scope/offer versions, duplicate and reordered provider events, worker restarts, missing/quarantined files, revision races, cancellations, payment failure, disputes, old approval reuse and honest recovery states. Tests should assert outcomes, not merely implementation structure.

Audit evidence: source and PRD reviewed locally. The previous UI pass included a disposable buyer/builder walkthrough; no new browser walkthrough or external-provider validation was performed during this read-only application audit. Fresh regression run: `npm test` passed 59 tests; `npm run test:web` passed 11 frontend tests and reran the 5 shared UI tests already included in the core count. Syntax checks and `git diff --check` passed. No existing application code changed in this audit. Independent review remains outstanding.

## Business decisions still open

Take rate, minimum viable task pricing, supplier margin, refund exposure, revision limits and support costs remain unvalidated, as the PRD already states. Decide those policies using actual supplier quotes and measured costs before hard-coding checkout or promising profitability. Bounty provides competitor context; it cannot validate Relay's implementation, supply quality or margins.


## 28 October update: build-order item 4, integration first

Local operator onboarding and sandbox funding/refund/transfer/payout integration are implemented behind an absent-by-default test-key configuration. Stripe connection is deferred at the founder's request. See [Sandbox-Payments.md](Sandbox-Payments.md). Provider verification is not complete; live commercial eligibility remains disabled. Task-level control journal, durable operation recovery and native PostgreSQL recovery checks do not replace a production general ledger or provider reconciliation program. Webhooks, scheduled reconciliation, failure-resolution tooling and independent review remain open.

### 29 October 2026 — local delivery object storage
Private disk objects, 8 MiB/file limits, quarantine/scan gates and verified object backup recovery are implemented. See [Object storage](Object-Storage.md). Real ClamAV is not installed: new local deliveries remain quarantined until configured. Scanning fixtures are test-only. Hosted object storage, background scanning and large-media streaming remain release work.

### Automatic ClamAV integration follow-up
Background scanning, saved claims, retry backoff and late-result fencing are implemented locally. Real Homebrew ClamAV is installed but rejects the official signature databases. Detection evaluation remains blocked; files remain quarantined. Cisco package installation requires explicit approval after automatic approval review rejected the privileged system change. Do not mark malware scanning production-ready. See `Object-Storage.md` for evidence and exact installation status.

### Real ClamAV operational — 29 October 2026
The Cisco package resolves the Homebrew database validation failure. Official databases validated; clean-file, harmless EICAR, missing-database and timeout evaluations passed. Automatic worker integration rejects blocked downloads and acceptance. Native-database browser QA confirms automatic clean delivery, preview and acceptance. Localhost only; demo/staging unchanged and Stripe disconnected. Production scanner isolation and independent review remain outstanding.

### 29 October 2026 — local supplier SDK
Builders can select HTTP API or JavaScript SDK and issue the same scoped, expiring supplier credential. The SDK supplies named methods for heartbeat, paged discovery/updates, qualification, bidding, claims, progress, delivery and failure. It enforces loopback-only connections, rejects redirects, requires caller-persisted command keys, bounds retries and sanitizes errors. The independent CSV reference runtime uses its shared transport. No schema change or hosted deployment. MCP stays planned. See [Supplier SDK](../packages/supplier-sdk/README.md).

This is an unpublished Node.js package in the checkout. It is not a general agent, scheduler or execution sandbox. Suppliers own tools, job persistence, lease renewal and business logic. General capability qualification, real provider validation, hosted identity parity, paid-work eligibility and independent security/payment review remain release gates.

SDK increment verification: 168 core tests, 21 native PostgreSQL checks, and 34 frontend/shared-UI checks passed (5 shared UI checks overlap the core suite). Coverage includes lost-response retry identity, bounded/redacted transport errors, cancellation, stale leases/revoked keys, an SDK-selected independent CSV process, actual file delivery and app restart. A disposable native PostgreSQL browser fixture verified buyer-to-builder navigation, selecting SDK, save/refresh persistence, honest readiness and the connection guide. Saving a method now stays on Connect instead of prematurely jumping to Demonstrate. Existing prototype typography, cards, controls and readiness layout are reused. This is engineering self-review, not independent review; mobile layout and third-party supplier runtimes were not separately validated in this increment.

### 29 October 2026 — second supplier and assessment

Implemented an offline link-inventory supplier through the JavaScript SDK, with a separate `link-inventory-v1` test and mandatory revision. It extracts links from explicitly opted-in text briefs and delivers real JSON/text files; it is deterministic automation, not an AI researcher. Both agent types may declare this capability. Qualification remains attached to the chosen capability, and unrelated capabilities remain unverified. Buyer evidence and setup now name the actual rubric instead of always claiming CSV assessment. The UI retains existing prototype layouts and controls; text-only work no longer gets a required-sounding CSV upload prompt.

Acceptance evidence: 175 core tests, 21 native PostgreSQL checks and 35 frontend/shared-UI checks passed (5 shared UI checks also occur in core). New evaluations cover normalization, duplicates, credentials/malformed candidates, untrusted instructions, non-web schemes, bounds, unsupported briefs/revisions, fake evidence/report counts, credential identity and distinct revision claim keys. The native HTTP test launches an independent supplier process, qualifies both rounds, bids, authorizes unpaid work, downloads scanned output, requests a real revision, rejects old-submission acceptance and accepts the new submission. A disposable localhost browser walkthrough verified buyer-visible limits, selection, authorization, real ClamAV-cleared files, JSON preview and builder per-capability status. Native tests use scanner fixtures; browser QA used the installed real scanner. Browser revision/acceptance clicks were not repeated separately; those paths were exercised through authenticated HTTP.

Review corrected a CSV-specific revision instruction and a claim-key collision when revision attempt counts reset. Command identity now includes credential, submission round and attempt. No new schema migration. SDK, backend and UI preserve access/approval/scan gates. No third-party supplier, paid model, live payment or hosted deployment was used. Mobile was not separately checked. Engineering self-review is not independent security review. Next build increment: observable execution and queue health, bounded concurrency/load tests and operator recovery tooling before release hardening; managed identity parity and real payment-provider verification remain separate gates.

### 29 October 2026 — calmer buyer and builder UX

Buyer conversations now show one state-specific next-step summary, remove the repeated posted brief, and keep local implementation details collapsed. Offer selection has one start-review action. Delivery puts the latest files first, with earlier deliveries, evidence, file-check details and revision controls available on demand. Completed company approval is collapsed after execution begins. Builder connection uses three concrete steps, with SDK instructions and assessment evidence collapsed until requested. Existing prototype typography, controls and colors remain in use; server authorization and safety gates are unchanged.

Verification: 175 core tests and 38 frontend/shared-UI checks passed (5 shared checks overlap core). New tests cover next-step precedence, expired/stale offers, latest-delivery ordering, escaped evidence and quarantined-file acceptance/download gating. Disposable native PostgreSQL browser QA exercised offer selection, unpaid execution, real ClamAV-cleared output, revision, preview, acceptance and persistence after refresh, then builder workspace navigation, per-capability status and the optional SDK guide. Syntax and diff checks passed. This increment changes presentation only; no migration or backend change. Mobile and corporate browser flows were not rerun; approval presentation is covered by unit tests. Engineering self-review is not independent review. Demo/staging remain unchanged and Stripe remains disconnected.

### 29 October 2026 — scheduled execution and queue recovery

Local recurring execution now starts from an accepted, unpaid trial with a currently qualified capability. The buyer reviews an immutable context snapshot (brief and optional supplied CSV), a pinned supplier, an IANA-timezone daily/weekly/monthly calendar, per-run/monthly test-quote limits and explicit unpaid consent. This is saved task knowledge, not a connected Drive or general company knowledge-base service. Changed instructions, source inputs or agent require a new accepted trial. Revised trials must incorporate their changes into a new brief first.

A background worker creates each due run transactionally, waits for a fresh quote from the pinned agent, rechecks current owner access/epoch, qualification, connection and price, and uses the same authorization service as an interactive task. Each company run requires its own exact-offer approval. No prior approval, expired quote, automatic payment or automatic delivery acceptance is reused. Runs have independent conversations, artifacts and status, linked to schedule history. One unfinished run (including buyer review) holds the next; failures pause the schedule. Resume preserves history, closes unstarted requests and uses the next calendar slot. Existing active work is not silently cancelled by pause.

Calendar rules are explicit: nonexistent DST times and absent month dates are skipped; repeated clock times run once; a missed slot over one hour old is skipped, with no catch-up burst. The local server and supplier must remain running. Quote reservations are conservative local controls, not a financial ledger or charge. Stripe remains disconnected. Paid recurring agreements, automatic supplier substitution, live knowledge sync and hosted scheduler operation are not enabled.

Buyer/builder task views now summarize queue health. Buyers can authorize at most two recovery rounds for failed unpaid non-recurring tasks with no delivered submission, after adding a reason. Recovery retains agreement/approval gates and monotonically increasing claim attempts, invalidates old leases and records audit history. Scheduled failures resume as future fresh runs rather than automatically replaying failed side effects. A concurrency review also corrected the running-worker capacity lookup so a long queue cannot hide active workers.

Storage uses the existing private document tables for versioned schedules and run records; no SQL schema change. Schedule creation, due-run identity, quote reservation and assignment authorization commit transactionally. Native PostgreSQL checks exercise multiple independent repository connections, restart persistence and 105 queued records without exceeding agent capacity. Broader production load/quotas and monitoring remain release work.

Verification for this increment: 183 core tests, 22 native PostgreSQL tests and 39 frontend/shared-UI checks passed (5 shared UI checks overlap core). An additional native page-boundary check verifies that 100 expired leases do not hide a live worker. Browser QA on a disposable native-database localhost fixture created a schedule through the UI, advanced only its test clock, observed a real supplier bid and automatic execution, previewed ClamAV-cleared output, accepted delivery, refreshed, and followed the same run back to schedule history. The main localhost service was restarted with Stripe environment keys excluded. No hosted deployment or demo change occurred. Mobile, full company browser walkthrough and provider integration were not rerun; company decline/resubmit and fresh per-run approval were tested at the application layer. Self-review is not independent review.

### Workspace sidebar and runnable-delivery direction — 29 October 2026

Authenticated buyer and builder navigation now uses a left rail with role-specific destinations, buyer recent conversations, account controls and workspace switching. Small screens use an expandable workspace menu. Landing and authentication retain their layout. Navigation disclosure no longer accidentally suppresses background refresh of task status.

Validation: 39 web/shared UI tests passed (`/tmp/relay-sidebar-web.log`); isolated localhost browser walkthrough covered buyer request screen, recent accepted-delivery conversation, switching to builder dashboard and agent list. Desktop screenshots reviewed. Mobile CSS is implemented but has not been visually verified on a mobile viewport. Self-review only. No backend policy changes, deployments, Stripe connections or demo/staging edits.

PRD now specifies runnable app/automation delivery, installation separate from acceptance, isolated execution, scoped tool grants and per-call revocation. This is a defined upcoming increment, not implemented arbitrary-code hosting or live connector access. Next backend increment: grant model and audited local connector broker with isolation/revocation/replay coverage, before adding a runnable package type.

### Apps, local sources and task tool permissions — 29 October 2026

Implemented `workspace-apps.cjs` and the Apps & automations/Connected tools UI. Supported accepted trials install bounded CSV/link recipes with source-specific expiring consent. Manual/calendar runs store versioned input snapshots and exact output; review saves or discards results and saved outputs download with integrity and configured file-scanner checks. Task tool reads require the assigned supplier credential, current lease, assignment/scope and live requester/authorizer/source permissions. Source disconnect, removal/demotion epochs and grant revocation fail closed. This increment is owner-administered and unpaid localhost only.

Evidence: 124 application/API/native PostgreSQL tests passed (`/tmp/relay-apps-final.log`); after the final file-download safety addition, all 7 focused app/permission tests passed (`/tmp/relay-apps-tests.log`). 41 web/shared UI checks passed (`/tmp/relay-apps-web.log`). Native PostgreSQL test competes six workers, restarts connections and verifies one output plus persistent revocation. Browser QA on a disposable native-PostgreSQL fixture covered source creation, install from a real accepted link delivery, execution/output review/save, revoke/renew, daily calendar setup and refresh persistence. Screenshot: `/tmp/relay-installed-automation.png`. Main localhost restarted with Stripe keys explicitly unset; health/config show native PostgreSQL and workspaceApps enabled. No fixture records were inserted into the main database, and demo/staging were not deployed.

Self-review identified and fixed stale source grants after reconnect, prior-permission output approval, pending-run exclusion beyond list pagination, deep-linked workspace data refresh, requester membership epochs, and generated-download safety checks. No independent security review is claimed. Mobile visual QA and live third-party connectors remain unverified. General uploaded app code and external writes remain unavailable; see Workspace-Apps.md for boundaries and next gates.


### 29 October 2026 — recurring requests, not delivery conversion

Recurring scope can now request offers before any trial. Schedule activation requires a confirmed recurring plan with no open questions, matching supported cadence, current runtime offer, qualified capability, explicit consent and quote limits. One-off deliveries cannot be converted. Source requests cannot execute/fund/request approval as one-off work; each occurrence retains independent authorization and company approval. Activated source context is immutable; existing schedules remain compatible.

Validation: 92 application tests, 36 web tests and 2 native PostgreSQL recurrence/app tests passed. Includes concurrent scheduler workers, restart, fresh bids, real deterministic deliveries, membership revocation and per-run company approval. Browser QA on an isolated database verified selected recurring offer → weekly calendar/UTC → enable → refresh persistence, and absence of recurring conversion on accepted delivery. Browser fixture seeded the confirmed recurring plan; model parsing is covered by automated scoping tests, not a new live model conversation in this pass. Mobile visual QA was not repeated. Review was self-review, not independent review. No demo, staging or Stripe connection changes.


### Calendar review card

Added inline editable timing and authenticated server calendar preview; no browser-only scheduling calculation. Explicit timing is suggested, missing time/day remains required, timezone is reviewed, and next three slots are shown. Activation remains in the conversation. Current calendar is first matching upcoming date through manual pause; custom start/end dates remain future work.

Checks: 37 web tests and 23 calendar/account HTTP tests passed. Isolated browser QA verified suggested Monday 09:00 UTC, three upcoming dates, invalid timezone rejection, Berlin preview and successful activation matching preview. No mobile visual pass or new live-model conversation in this increment. Self-review only. Demo, staging and Stripe unchanged.


### Selected context and agent permission requests — 29 October 2026

Local drafts support explicit @/Add context selection and latest or saved-version source references; selection is not a grant. Scheduled runs inherit references but request their own access. Assigned runtimes can request read permission through API/SDK; owners approve/decline in the conversation. Current authority, source connection, lease, scope, expiration and revocation are checked on reads. Pending requests block submissions; request and decision history is audited. The link runtime requests, waits, reads and uses the selected source. Unsupported write/send permissions stay blocked.

Evidence: broad application/SDK/runtime suite 105 passing; focused permission/SDK/contract suite 16 passing; web suite 38 passing. Earlier access-boundary regression suite also passed. Browser QA on disposable native PostgreSQL data verified an agent-generated request, approval, scanned delivery containing the selected source URL, @ opening the picker, natural source-name suggestion, attachment and refresh persistence. Snapshot/decline/cross-workspace/concurrent request/revocation cases passed on SQLite and PostgreSQL adapters. No live connector, general LLM execution, mobile visual pass or independent reviewer in this increment. Existing execution timeouts still apply while waiting for a user.

### 29 October 2026 — permission waiting and recovery

Assignments now persist a permission wait, release/fence the previous worker lease and preserve the remaining execution budget. Queue reconciliation does not expire human waits or mark them overdue. Approval of every outstanding request requeues the same assignment with a fresh connection window; suppliers must claim a new lease. Declines remain blocked, are not repeatedly requested by the supplier, and can be reconsidered explicitly or cancelled. Cancellation prevents later permission decisions from restarting work. Waiting does not grant access or bypass current membership, source or credential checks. Existing queued/running storage statuses are retained with an explicit wait field; no migration is required. Waits currently remain until the user acts; reminders and abandoned-request retention remain future work.

Evidence: 106 application/SDK/runtime checks passed; final focused permission tests passed 10 checks (including delayed approval past the original deadline, restart composition, concurrent request deduplication, cancelled decisions and stale lease fencing). Frontend suite passed 38 checks plus 5 shared UI checks. Disposable native PostgreSQL browser QA covered decline, refresh, reconsideration/approval and real scanned delivery from the same task. Desktop visual review completed; mobile and independent review not performed. Local only, Stripe disconnected, demo/staging unchanged. Next: first real connector integration; no OAuth provider has been configured.

### 29 October 2026 — Drive connector integration, awaiting provider setup

Added a localhost-only Google OAuth/Picker integration and explicit immutable snapshot import into Connected tools. Selected-file scope, encrypted token storage, session/workspace-bound one-use state, PKCE, refresh, local disconnect and attempted Google revocation are implemented. Imports recheck authority/connection state, reject unsupported or oversized files, check provider version around the read and never create supplier grants. Imported sources work with existing @ selection and task permission requests. This is not live Drive synchronization: scheduled tasks keep using their chosen Relay snapshot until a new request selects a newly imported version. No Google OAuth application is configured yet.

Validation: 134 application/connector/local-HTTP tests passed; 39 frontend tests plus 5 shared UI tests passed. Provider tests use injected Google responses, not live Google. Disposable native PostgreSQL browser QA verified connected/disconnected presentation, saved snapshot persistence, immutable source controls and attaching a labelled snapshot to a task. Desktop screenshot reviewed. The actual Google consent screen, Picker and Google CSP behavior remain unverified; mobile and independent security review were not performed. Main localhost shows setup required and makes no Google requests without configuration. See [Google Drive setup and limits](Google-Drive.md). No migration is needed for the existing versioned document store. Hosted identity, retention/deletion, key rotation, full release testing and real provider acceptance remain open. Demo/staging unchanged; Stripe disconnected.

### 29 October 2026 — authorized live Drive reads

Owners can explicitly choose a saved snapshot or a live selected file. Live sources refresh on authorized task/app reads, including scheduled app runs; saved task context remains pinned. Provider errors never silently serve cached content. Reconnecting requires reselecting the file and renewing the affected grant. Source revisions are retained, buyer task history shows versions read, and app runs preserve their input snapshot. Scope stays limited to selected supported text files of at most 16 KB, with 100-version/read-history safety limits; no folder sync or external writes.

Validation: 143 application/connector/local-HTTP/runtime tests passed, plus 40 frontend and 5 shared UI checks. Tests cover changed content, immutable prior versions, scheduled execution across recreated workers, failure pausing, saved versus latest data, reconnect/relink grant fencing and expiry during a provider read. Disposable native PostgreSQL browser QA exercised the actual local supplier requesting access, resuming and delivering scanned files, with buyer-visible source history. Desktop screenshot reviewed. Google responses were fixtures: real OAuth/Picker/CSP acceptance, mobile QA and independent security review remain outstanding. Localhost only; Google and Stripe remain disconnected; demo and staging unchanged.

### 29 October 2026 — product UI cleanup

Refined localhost product styles using Plyxl as a visual reference: neutral surfaces, restrained violet actions, a narrower navigation rail, consistent control shapes, readable form typography and a larger request composer. Consolidated repeated product colors into semantic variables and formatted the existing CSS instead of adding another override stylesheet. Shared marketing assets and business commands were not changed. Drive actions now have a wrapping action group; mobile conversations precede secondary scope/history panels. Reduced-motion preferences and keyboard focus states are retained.

Validation: 40 web tests and 5 shared UI tests passed. Desktop fixture walkthrough inspected buyer request, selected offer/schedule review, delivery preview, connected tools, builder dashboard and agent setup. At 390px, conversation and setup layouts had no document horizontal overflow; keyboard navigation to the agent purpose field retained a visible focus outline. Self-review covered style variable definitions, responsive overrides and unchanged command handlers. This is a presentation change, not full product or accessibility certification. No provider, payment, staging or demo changes. Screenshot: /tmp/relay-ui-cleanup.png.

### 29 October 2026 — Apps clarity and interaction continuity

Reviewed the supplied 39-second recording through extracted frames. Added short view-entry motion on actual navigation only, reduced-motion opt-out and progressive disclosure transitions. Same-view updates preserve expanded disclosures, keyed to each app/run to avoid opening another app's panels. The Apps entry now distinguishes reusable installed tools from recurring agent responsibilities. Empty-state requests prepare editable briefs without creating work. App cards show source, process and reviewed output, explain blocked runs and link to the original task conversation. Installation remains explicit; accepted files do not automatically become running apps.

Validation: 42 web plus 5 shared UI checks passed. Disposable native PostgreSQL browser QA covered the empty state, editable app request, explicit installation/read consent, actual local run, blocked second run while awaiting review, output preview, save and resulting download link. Open permissions persisted across run/save updates. Desktop screenshot reviewed; 390px mobile check had no horizontal document overflow. No payment/provider integration changes. Arbitrary custom code hosting and conversational external-agent replies remain separate build work.

### Conversation feedback and task workspace — 2026-10-29

Local UI now shows the submitted request immediately while storage is pending, restores the draft on a failed save, and shows a sending bubble for follow-up messages. Scope processing uses an honest pending card. Execution displays the actual runtime update, elapsed time and authorization/start/file/review milestones; permission waits do not show an active spinner. No fabricated tool calls, percentages or model activity were added.

Relay's existing landing characters now appear on the request screen and Relay messages, with brief blinking and reduced-motion support. My tasks uses action-oriented cards grouped into Needs you, Under way and Completed; permission waits are surfaced for review rather than categorized as active. IDs remain action attributes, not the task-list copy.

Validation: 47 web tests and 5 shared UI tests pass, including pending-save failure/draft recovery, escaping and permission grouping. Disposable localhost browser walkthrough verified request creation, saved task navigation, accepted delivery/milestones, and 390px responsive layout with no horizontal overflow. Reviewed reference recording frames and desktop/mobile screenshots. Full screen-reader testing and external supplier live progress were not exercised. Demo, staging, Stripe and Google unchanged.

### Bottom chat composer — 2026-10-30

Request work now uses a viewport-height conversation welcome and a bottom-aligned composer. Removed workspace/marketing copy around the input, moved example prompts above it, and kept the input present but disabled during request storage. Existing conversations use a bottom reply dock with dark buyer bubbles. Enter submits chat requests/replies; Shift+Enter preserves multiline input, and IME composition does not submit.

Validation: 48 web + 5 shared UI tests pass. Disposable browser QA verified Shift+Enter, Enter submission, visible sending state, saved conversation and reply dock. Checked a 390px conversation for horizontal overflow. Physical mobile keyboard behavior remains unverified. Localhost only; no demo/staging/provider changes.

### Conversation before requesting work — 2026-10-30

Drafts now open as private conversations (`#chat=`), stay in Recent conversations and are excluded from My tasks. The saved draft is still the existing internal task aggregate, preserving permissions, version checks and message storage. No marketplace posting occurs on chat creation or model response. Review task request reveals the proposed scope; the buyer must confirm scope and explicitly request offers before work enters My tasks.

Selected saved source contents can be included in a local-model response through explicit per-response consent. The server checks current workspace ownership, tenant and active source state, bounds the whole model context, and records source/version receipts. It rechecks ownership/access epochs and source revocation before publishing the reply. Source text remains untrusted. This reads saved Relay copies, including imported Drive copies; it does not perform fresh external tool calls or grant supplier access. Latest-data task execution retains its separate permission flow.

Validation for this increment: 49 web + 5 shared UI tests and 15 scoping/API tests pass. Source consent, disabled sources, and revocation during model inference are covered. Browser QA used the real local model with disposable accounts/sources: initial chat, source attachment/read receipt, follow-up clarification, explicit scope review, and posting preserved the same conversation ID. Local 4180 server restarted with native PostgreSQL and Stripe explicitly disconnected. External live connectors and a physical mobile keyboard were not exercised.

### Task index visual redesign — 2026-10-30

Replaced oversized task cards and duplicated brief text with compact rows: linked title, update date, status and explicit next action. Counted filters show All, Needs you, Under way and Completed; empty filters provide a return to all tasks. Current permission waits and draft exclusion remain intact. Filters retain keyboard focus after rendering. Desktop and 390px fixture checks cover filtering and responsive layout. 50 web and 5 shared UI checks pass. Localhost only; no backend/provider changes.

### Builder-delivered data apps — 2026-10-30

Implemented a bounded declarative app interpreter and connected accepted `relay-app.json` deliveries to explicit installation, source consent, immutable package storage, runs, per-step evidence and reviewed downloads. Revised accepted packages work; unsupported operations, quarantined files and integrity mismatches fail closed. Apps UI shows purpose, source, steps, supplier provenance and run history. Supplier guide and PRD updated. Runtime supports JSON record transformations only, not arbitrary supplier code or custom UI hosting.

Validation: 16 focused runtime/application checks pass (SQLite and PostgreSQL-compatible adapters, duplicate installs, restart, revisions, corrupt/unsupported packages, immutable installation, permission loss and existing app regressions). 52 web + 5 shared UI tests pass. Disposable native PostgreSQL/real ClamAV browser walkthrough verified accepted package → explicit install → run → review → saved download, refresh, revoke/renew and a 390px layout without horizontal overflow. Download returned the expected invoice report. Main localhost server restarted on 4180; no test data imported there. Self-review completed; this is not independent security review. Stripe remains disconnected; hosted demo/staging and real connector configuration untouched.

Remaining: general isolated code/UI hosting, package upgrades/rollback, team app-sharing policy, operational retention/quotas and commercial running/support terms. Physical mobile keyboard and live third-party data were not exercised in this increment.

### Business workspace UI cleanup — 2026-10-30

Separated personal company setup from company administration. Added focused setup cards, a workspace context bar, available/reserved/committed allowance cards, compact member rows, on-demand role management/invitations, and collapsible access history/settings. Employee and approver actions remain role-specific. Superseded requests no longer show a decision form. Member disclosures use stable identities so saving one member does not expand another; workspace changes reset view-specific expansion state.

Validation: 57 web + 5 shared UI tests and 10 company/access checks pass. Disposable native PostgreSQL browser QA covered workspace selection, allowance saving, unchanged-role saving, invitation creation/success, independent member disclosures, and desktop/mobile layout with no horizontal overflow. Source escaping and role-specific controls covered by tests. Reviewed screenshots and implementation; no authorization rule or payment behavior changed. Main 4180 restarted and personal setup verified. Hosted demo/staging and Stripe unchanged. Pending approval rendering was tested automatically, not a fresh end-to-end approval/payment browser walkthrough.

### Persistent company identity — 2026-10-30

Buyer pages now show the active company and current membership role in a sidebar identity card and persistent content header. The header explicitly identifies the user as a team member and links to Workspace & team. Identity is derived from the active membership's company flag and role, not the business-page-only team payload, so it follows chat/task workspace changes. Personal, builder, signed-out and missing memberships do not inherit a company badge. No access rules changed.

Validation: 60 web + 5 shared UI checks pass. Disposable employee browser walkthrough verified company selection, chat, My tasks, the workspace shortcut, mobile width without horizontal overflow, and return to personal work with both indicators absent. Role variants, escaping and workspace changes are tested. Localhost only; no provider or hosted environment changes.

### Conversational tone and tool discovery — 2026-10-30

Added a searchable, categorized tool library with consistent cards and honest availability states. Relay sources work immediately. Google Drive uses the existing OAuth flow directly when configured, and otherwise explains setup requirements. Notion, Slack, Teams, Gmail, HubSpot, Salesforce and GitHub are catalog entries only, explicitly unavailable; no new external connector or credential was fabricated. Company employees see administrator-managed Drive status instead of owner actions. Existing per-task source authorization remains unchanged.

Local scoping instructions now favor concise, specific replies, direct answers and focused clarification rather than repeated formal summaries. Scheduling/conflict questions take precedence over conversational brevity. Updated sending/reply copy distinguishes private conversation from requesting work; posting is still explicit. Prompt version is local-scoping-2 with a content hash.

QA: 216 full regression tests, 23 native PostgreSQL concurrency/restart/recovery tests, and 64 web + 5 shared UI tests pass. Browser QA on disposable native PostgreSQL fixtures covered search/category intersection, empty search recovery, local-source creation and refresh persistence, mobile layout (390px, no horizontal overflow), real local-model reply, hypothetical follow-up and explicit review retaining the original 20-company scope. Main localhost refreshed and unconfigured Google status verified. Google connected status was exercised only with the isolated fixture provider. No live Google OAuth, other provider authorization, physical mobile keyboard, real payments or hosted environment changes. Self-review is not independent review.

The initial model evaluation surfaced a missing shorter-month question for a request on the 31st. Added a deterministic clarification guard for monthly dates 29–31 without a stated skip/last-day rule; it never chooses a rule or activates a schedule. Tests distinguish dates from clock minutes, preserve hypothetical/question intents and avoid duplicate calendar questions. This intentionally favors explicit calendar confirmation over fewer questions.

Final local Qwen3 evaluation: 16/16 representative cases passed after the clarification guard, covering complete/incomplete briefs, retained answers, corrections, pricing questions, hypotheticals, conflicting requirements, unfamiliar domains, recurrence and malicious quoted content. A focused 6-check library/calendar run and 17-check scoping/API run also passed. New replies remain model-generated and may vary in phrasing; these results do not establish universal model reliability. The localhost service was restarted with the final guard; hosted services remain untouched.

### In-app notification bell — 2026-10-30

Added a sidebar bell with unread count, a notification panel, direct task/approval links, individual read actions and mark-all-visible read. Updates cover task offers, execution, messages, permissions, approvals, delivery/revisions and sandbox payment events. Read receipts persist per account; feeds re-check current workspace membership and supplier assignment. Approvers receive approval-only visibility for other employees' work. Notification failures do not block the rest of the application. Background refresh runs every 15 seconds while the page is visible and preserves the active editor; the open panel has a refresh action.

Validation: 221 backend regression checks and 66 web + 5 shared UI checks pass. Tests cover authenticated routing/CSRF, visibility and revocation, supplier isolation, persistent/idempotent receipts, escaping and mark-all races. Disposable native PostgreSQL browser QA verified exact-task navigation, refresh persistence, a new unread permission-decline event and a 390px layout without horizontal overflow. Reviewed the desktop panel. Main localhost restarted; demo/staging untouched and Stripe disconnected. Self-review completed; no independent security review.

Limits: in-app only, latest 100 updates, derived from task history rather than a materialized notification inbox. Global connector/agent onboarding events, email/push delivery, preferences and scalable event fanout remain future work. No physical-device mobile testing. No schema migration was needed: receipts use the existing persisted document repository.

Notification placement refinement: moved the bell out of the sidebar to the top-right workspace area, with a right-aligned panel and compact unread badge. Mobile uses a fixed top-right bell and an inset panel. All 66 web + 5 shared UI checks pass; disposable browser QA verified desktop appearance and 390px mobile bounds with no horizontal overflow. Notification behavior and access rules are unchanged. Localhost only.

### Relay navigation icons and build review — 2026-10-30

Replaced mixed sidebar glyphs with a custom rounded SVG family: shared stroke weight, softly tinted surfaces, paired-dot conversation mark and character-inspired agent face. Apps, task lists, conversations, earnings and builder work now have distinct symbols rather than fallback duplicates. Labels remain visible and decorative SVGs are hidden from assistive technology. Verified buyer and builder desktop layouts on disposable localhost data; 66 web + 5 shared UI checks pass. No backend changes; mobile was not separately retested in this icon-only increment.

Current priorities, based on implementation and latest evidence rather than the historical baseline above:

1. Operational hardening: instrument queue/scanner/connector/payment failures, define service limits and tenant quotas, run realistic sustained load and failure/recovery exercises, and verify backup restoration including stored objects.
2. Managed deployment parity: exercise the full current marketplace with managed identity and database policies; existing staging account/task support does not prove parity with local v1.
3. External acceptance gates: configure and test real Google OAuth and Stripe sandbox when authorized; complete Connect/operator, funding/refund/payout and accounting verification. Stripe remains disconnected. Other catalog integrations remain unavailable.
4. Supplier coverage: onboard an external model-backed supplier, evaluate relevant domain capabilities and revision behavior, and establish human escalation. Current deterministic runtimes do not establish video/website/general-purpose supplier quality.
5. Commercial/release policy: finalize fees, revision/refund/dispute/support rules and obtain independent security/payment review before real-money release.

Optimization candidates: replace broad root.innerHTML rerenders with focused component updates to preserve focus/scroll; use cursor-based indexed notification/event projections instead of scanning task histories every refresh; consolidate polling and consider authorized server events; profile list/query behavior under realistic volume before choosing indexes or caching. These are identified opportunities, not measured speedup claims. Runnable apps remain bounded declarative data pipelines; arbitrary supplier app/code hosting requires a separate isolated runtime and package lifecycle. Email/push notifications and notification preferences are not implemented.

Tool library icon refinement: replaced letter placeholders with locally bundled Simple Icons v11.15.0 SVG brand marks (CC0, https://github.com/simple-icons/simple-icons/tree/11.15.0) for Drive, Notion, Slack, Teams, Gmail, HubSpot, Salesforce and GitHub, plus a Relay source mark. Icons use consistent 24px sizing and brand-colored tiles; no external image requests or connection-status changes. Desktop fixture visual QA and 66 web + 5 shared UI checks passed. Localhost only.

Attio added to the searchable Sales & CRM tool catalog with its locally bundled official favicon (source: https://attio.com, retrieved 30 October 2026). Catalog-only: clearly marked unavailable; no OAuth, credentials, data access or connection action is implemented. Verified search and logo rendering in a disposable browser workspace; 66 web + 5 shared UI checks pass. Local server restarted to serve the fixed icon asset; hosted environments untouched.

### Ticket 1a — background-worker health (30 October 2026)

Implemented process-local health tracking for file scanning, payment reconciliation, execution recovery, scheduled tasks and scheduled apps. Each worker records start/completion/success/failure times, completed runs, duration and consecutive failures. Failed loops retry on their existing interval; first failure and recovery produce sanitized logs without task content, credentials or raw exception text. A running job beyond its health threshold is reported stalled; it is NOT replaced or re-dispatched. Existing durable leases, idempotency, authorization and provider rules remain authoritative.

Execution, schedule and app reconciliation now run independently so failure in one does not skip the others. Shutdown prevents future ticks and drains in-flight work. `/health/workers` is enabled only in the local launcher and returns 200 for all-healthy workers, otherwise 503. `/health/live` and database readiness retain their separate meanings. The endpoint exposes operational metadata only, no task/account content. Counts reset on process restart.

Acceptance: failed/synchronous calls recover, stuck calls remain single-flight, missed ticks become stale, stopped workers do not dispatch, raw errors are not logged, and worker degradation does not alter process liveness. Backend regressions: 225 passing. Running localhost reports all five workers healthy after restart. No frontend change; no browser interaction required for this endpoint-only ticket.

Limits: this reports reconciliation-loop health, not success of every underlying job, virus signature freshness, model quality or payment-provider connectivity. A healthy disconnected payment loop is not evidence of Stripe connectivity. External alert delivery, persisted operational history and backlog/oldest-job metrics remain next work. A stalled promise can still delay graceful shutdown; operator intervention may be required, while durable work must recover through existing leases after restart. No hosted changes or Stripe connection.

Remaining reliability tickets, in order: (1b) operational backlog/failure metrics and actionable alerts; (1c) measured load tests with tenant quotas and resource limits; (1d) incremental frontend updates, indexed notification inbox and consolidated polling; (1e) full operational recovery/release drill. After that: external AI supplier, authorized real connectors/payment sandbox, managed-hosting parity, and independent release review.

Recovery audit note: the first combined native suite timed out in the HTTP restart walkthrough. Its disposable orphan processes were stopped. An isolated rerun with sanitized shutdown-phase logging passed all 21 checks, including app/database outages, external suppliers and backup restore; logging now distinguishes worker drain from storage close. No cause was conclusively established for the first timeout, so this is recorded rather than presented as a proven defect fix. Original test logging was restored before the complete-suite rerun.

Final complete native PostgreSQL rerun: 23/23 passed, including scheduler competition and app permission/restart tests. The initial timeout remains documented for follow-up if it recurs.

### Ticket 1b — saved-state backlog metrics and review alerts (30 October 2026)

Added a read-only operations backlog endpoint and Work health & alerts disclosure in the existing restricted Payment recovery view. Uses the same explicit server-configured operations account allowlist; company ownership alone grants no access. Covers queued/running/failed execution, permission waits, file scanning/quarantine, payment-check retries/review, and paused/overdue task/app schedules. Alerts provide record IDs and safe review instructions; they never retry, approve, resume or unlock work. Raw errors, filenames, tool contents and payment references are excluded.

Reads at most 1,000 saved records per category in keyset pages; truncated categories and partial counts are explicit. At most 20 alerts per category. Oldest ages use available saved timestamps and remain unknown when absent. Snapshot reads occur on opening/explicit Refresh rather than every polling tick. Counts are not globally atomic and can change while scanning. Paused schedules can be intentional and are review items, not inferred failures. An overdue schedule can be waiting on its current run.

Validation: 228 backend checks pass, including explicit access denial, saved-state classification, no mutation, secret exclusion and truncation bounds. Native PostgreSQL disposable browser QA verified the operations route, counts and actionable permission-wait guidance with Stripe disconnected. Frontend suite includes escaping/partial-count coverage. No provider calls or new schema. Localhost only; demo/staging untouched.

Limits: this is an on-demand in-app operations view, not push/email alert delivery or persistent incidents. Large datasets need indexed aggregate projections and paginated alert drill-down; current bounded snapshots are partial beyond the stated limit. Existing recovery permissions remain authoritative. Remaining ticket 1c: sustained load tests and measured quota/resource limits, including the cost of this projection.

### Ticket 1c, first increment — workspace conversation limits (30 October 2026)

Added a persistent shared-workspace safeguard: 120 new conversations per fixed one-hour window, starting with the first accepted request. This is a provisional operational default, not a commercial plan entitlement or a measured capacity ceiling. Existing conversations, deliveries and scheduled runs are not charged by this guard. It does not limit model calls, uploads, bytes, connector requests or execution time. Fixed windows permit bursts across a reset boundary; this is not a sliding-window throttle.

The workspace advisory lock covers usage, task creation and idempotency receipt in one transaction. Duplicate retries do not consume allowance; invalid/unauthorized input and failed transactions do not consume allowance. Usage survives application reconstruction and pool restart. HTTP 429 uses the existing error presentation, preserves the unsent prompt and explains that existing work can continue. No schema migration is needed: usage uses the existing transactional document repository.

Evidence: 231 backend regressions and 24 native PostgreSQL tests passed. A disposable two-pool workload sent 320 new-conversation commands in batches of eight over approximately 10.4 seconds: exactly 60 accepted at the test quota and 260 expected limit responses, no unexpected errors; p50 4ms, p95 14ms, maximum 21ms on this machine. Complete-suite repeat: p50 3ms, p95 9ms, max 25ms. These are application-command measurements without HTTP/network/model overhead, not production throughput or latency guarantees. Tests also cover independent-workspace acceptance, replay, persisted usage after pool restart, window reset and receipt-failure rollback.

Disposable native PostgreSQL browser QA confirmed the limit message, preserved prompt and navigation into an existing chat. No frontend layout change. Self-review checked transaction boundaries, bounded inputs and shared adapter behavior; this is not independent review. Localhost only, Stripe disconnected, demo/staging untouched.

Ticket 1c remains open for aggregate storage quotas, connector/model/execution budgets, longer mixed-workload testing and backlog projection cost. Next increment should address storage admission and recovery without blocking downloads or existing deliveries; ticket 1d follows after the resource-limit work.

### Ticket 1c, second increment — retained artifact storage admission (30 October 2026)

Added a provisional 256 MiB logical retained-artifact limit per workspace, covering CSV inputs, supplier deliveries and copied scheduled inputs. Historical, quarantined and blocked artifacts count; identical files count per retained artifact rather than physical deduplication. Existing records are included by an indexed tenant-filtered aggregate, with no empty-ledger migration or usage reset. This is an operational default, not finalized pricing or customer entitlement.

PostgreSQL holds a workspace storage advisory lock through the write transaction; SQLite serializes transactions. Admission precedes new delivery object writes and metadata changes. Replays return their original result without recharging. Failed database transactions leave usage unchanged. Full storage does not block reads, download authorization, scan updates or existing delivery review. Scheduled input copies pause with an explicit reason rather than creating partial runs. Capacity increases can permit retry with the existing assignment while its lease remains valid; expired leases still require normal recovery. There is no automatic deletion or self-service capacity UI.

Validation: full backend suite 233/233 passed, followed by the expanded targeted storage suite 3/3 (including an additional scheduled-pause/input-scope case). Native PostgreSQL suite 25/25 passed, including twenty competing admissions across two pools: exactly six 10-byte artifacts accepted at a 60-byte fixture limit; remaining calls returned the expected limit error. Reconnection retained enforcement and another tenant remained usable. Unit tests verify legacy usage, rollback, idempotent delivery, rejection before object writes, retained downloads and retry after a configured capacity increase. Disposable browser QA showed the inline upload limit error while retaining the selected CSV and usage notes. No frontend layout change; mobile layout was not retested.

Review limits: this protects logical artifact bytes only. Connected-tool text, qualification evidence, general database growth and abandoned physical objects are not covered. The physical local store retains its separate 1 GiB guard; its cross-process accounting and orphan cleanup still need hardening. A physical write followed by a database failure may leave an unreferenced object, as before. Usage aggregation reads the tenant's retained artifact metadata on admission; large-volume profiling and a reconciled counter may be needed. Storage admission does not reserve expected output capacity when accepting an offer. Existing upload/body size checks remain in force. Self-review completed, not independent security review. Localhost only; demo/staging unchanged and Stripe disconnected.

Next: longer mixed-workload profiling, physical-store concurrency/orphan recovery, and connector/model/execution budgets before the frontend polling/projection optimization ticket.

### Ticket 1c, third increment — physical object writer recovery (30 October 2026)

The local content-addressed file store now serializes physical capacity checks and publication across processes with a dedicated SQLite transaction lock in the private object directory. The operating system releases the lock on process death; no stale-PID guessing or timed lock stealing. Busy writers wait at most 50ms before a retryable storage-busy error. Reads do not acquire this writer lock. All writers sharing a directory must use this implementation and the same configured capacity; the normal local cap remains 1 GiB.

Under the writer lock, interrupted upload-* temporary files are removed before another write, including duplicate writes. An explicit recoverUploads operation supports recovery without adding a new object. Published content-addressed files are never deleted by this recovery, including files whose database transaction failed. Normal write failures now clean up their temporary file in a finally block. Object publication retains file/directory synchronization, integrity checking and atomic hard-link publication. Full capacity returns a safe storage-limit error and still permits reuse of existing identical bytes and downloads.

Validation: 237 backend regressions pass. Dedicated disposable tests exercise twelve separate writer processes against a small capacity, forcible writer termination while holding the lock, safe busy responses, lock release and partial-upload recovery, retained reads, restart and deduplication at full capacity. Existing scanning/quarantine and object backup/restore tests pass. Self-review covered lock scope, temporary-file ownership, failure cleanup and unchanged read access. This storage-only change has no frontend layout; browser QA was not repeated.

Remaining limits: synchronous directory scans/writes can block the event loop; the 50ms bound is lock waiting only. Completed unreferenced objects still count physically and are deliberately retained: safe garbage collection requires database-aware retention and coordination with transactions/backups. No disk-free-space reservation, distributed/network-filesystem guarantee, or proof of sustained production throughput. Temporary cleanup runs on the next write or explicit recovery, not a new periodic worker. Longer mixed-workload profiling and orphan reconciliation remain open before declaring storage hardening complete. Localhost only; hosted demo/staging unchanged and Stripe disconnected.

Final native PostgreSQL regression: 25/25 passed, including application/database restart and paired object backup restoration. Local server restarted with the updated writer.

### Ticket 1c, fourth increment — read-only storage reconciliation (30 October 2026)

Added `storage:inspect`, a native-localhost-only operational command that checks backend/identity pairing and compares saved artifact references with physical objects. Reports verified/unverified/missing/unavailable/corrupt files, invalid references, incomplete uploads and unreferenced candidates. No content or user filenames in output; findings capped at 100. At most 10,000 artifact records and directory entries and 64 MiB hash reads; truncation is explicit and incomplete reference scans suppress orphan inference. Files are opened without following symlinks and hashing uses bounded reads. No mutation, repair or deletion is performed, and snapshots explicitly are not atomic.

Evidence: 240 full backend checks passed before the final targeted expansion; final reconciliation suite 4/4 passes after bounded-read review, including three concurrent writer processes, delayed database reference commits, corruption, missing objects, symlinks, partial scans and hash budgets. Final concurrent run converged to 24 verified objects and no unreferenced candidates. The real local native PostgreSQL command also succeeded (zero artifact/object records at inspection time); populated and failure cases used disposable fixtures. Existing UI and server execution paths were unchanged; no browser QA or server restart needed for this operator-only command. No new full native recovery-suite run in this increment; previous 25-test recovery evidence remains separate.

This is advisory reconciliation, not completed garbage collection or a sustained load certification. Automated orphan removal still requires transaction/backup coordination, grace periods, retention policy and a reviewed recovery mechanism. Longer mixed-workload profiling and resource budgets remain next. Demo/staging unchanged, Stripe disconnected, self-review completed.

### Ticket 1c, fifth increment — repeatable sustained mixed workload (30 October 2026)

Added opt-in `npm run test:load` with isolated native PostgreSQL databases and object directories, four asynchronous lanes, two pools and two workspaces. Exercises conversation creation plus exact idempotency replay, artifact admission/publication, file and paginated task reads, concurrent integrity inspections and post-run database reconnection. All lanes drain before teardown. The complementary `RELAY_LOAD_MODE=steady` mode permits continued writes. No production defaults or runtime behavior changed.

Both full 60-second runs passed on this machine:

| Measurement | Limit-focused run | Accepted-write run |
| --- | --- | --- |
| New conversations | 60 accepted / 708 limited | 706 accepted / 0 limited |
| 8 KiB artifacts | 64 accepted / 704 limited | 704 accepted / 0 limited |
| Successful read operations | 768 | 704 |
| Integrity inspections | 30 | 30 |
| Creation p95 / maximum | 4 / 13 ms | 5 / 34 ms |
| Upload p95 / maximum | 19 / 76 ms | 46 / 73 ms |
| Read p95 / maximum | 5 / 39 ms | 3 / 14 ms |
| Inspection p95 / maximum | 17 / 19 ms | 49 / 49 ms |
| Event-loop delay p95 (20ms sampling resolution) | 22 ms | 39 ms |

No unexpected failures, missing/corrupt objects or final unreferenced candidates. Both tenants remained within their test allowances; saved usage matched actual retained file counts after reconnect. Creation latency includes replay, and limit-focused percentiles include rejected calls. This is a rate-limited one-process application workload across two database pools, not a multi-process web-server or HTTP benchmark. Earlier separate-process storage tests cover writer locking. No model calls, external connectors, malware scanning, payments, large videos, long soak or many-tenant scale are represented.

The higher accepted-write upload/inspection latency and event-loop delay justify profiling synchronous file enumeration/hashing before larger scale. These observations do not isolate a root cause or justify claiming a throughput ceiling; no speculative runtime optimization was added. Next: move heavy storage inspection off request/event-loop paths where needed, profile larger files/more retained objects, and add model/connector execution budgets. Resource-limit ticket remains open.

QA/review: both opt-in scenarios passed and cleanup completed; repository diff check passed. Tests/documentation only, so no server restart, browser retest or full backend rerun was necessary. No claims of independent security review or production certification. Localhost data, demo, staging and disconnected Stripe configuration unchanged.

### Ticket 1c, sixth increment — profile-driven directory scan reduction (30 October 2026)

Added an isolated `storage:profile` microbenchmark at 100/1,000/5,000 retained small objects, twenty writes each. Instrumented process-local enumeration, metadata and synchronization calls. Profiling identified two directory enumerations per write. The writer now reuses the first snapshot for quota calculation under the existing cross-process writer lock. Removed temporary names cannot enter the content-key filter. All size checks, no-symlink checks, quota decisions and durable publication remain intact. No cached byte count or relaxed durability was introduced.

Observed before/after p95 write times in this single sample: 100 objects 17.66/17.57ms; 1,000 objects 17.63/14.00ms; 5,000 objects 50.40/37.49ms. At 5,000 objects, enumeration calls fell 40→20 across twenty writes and enumeration time 117→57ms. Metadata calls remained 100,209 and synchronization calls remained 40. These timings are noisy local microbenchmark observations, not a guaranteed percentage improvement or production SLA. File metadata enumeration remains the main scaling concern; large files and provider traffic were not profiled.

241 backend tests pass, including independent writers, crash cleanup, full-capacity deduplication, scanner recovery and read-only reconciliation. Self-review confirmed snapshot reuse stays inside the writer lock and recovery's public response remains unchanged. No frontend change, so no browser QA in this increment. Model/connector execution budgets remain next; crash-safe physical accounting is a separately scoped optimization if retained-object volume warrants it. Hosted demo/staging and disconnected Stripe configuration unchanged.

Final native PostgreSQL suite: 25/25 passed, including restart and paired object restore. Local service restarted with the optimized writer.

### Ticket 1c, seventh increment — model attempt allowance and Drive concurrency (30 October 2026)

Added a provisional allowance of 60 admitted scoping attempts per workspace per fixed one-hour window. Usage is persistent in the shared repository and serialized by a workspace resource advisory lock on PostgreSQL (SQLite transactions serialize locally). It is charged in the same transaction as the scoping job, after access/version/message-limit checks and before adding a follow-up message. Receipt replay does not charge again; transaction rollback does not charge. Provider failures and local-provider busy responses after admission retain the charge to bound repeated attempts. Window resets are fixed, not sliding, and can allow bursts across boundaries. This is an operational attempt allowance, not token accounting, pricing or a monetary budget.

Exhaustion returns a safe 429 with retry timing and manual-review guidance. Existing tasks, messages and delivery operations remain available. The provider's existing single-flight guard, 150s maximum timeout, input/output byte bounds and generation-token cap are unchanged. It is still possible for one workspace to occupy the local model; cross-workspace scheduling fairness and distributed inference concurrency are not implemented.

Google Drive now admits at most four simultaneous HTTP requests per provider instance, retaining a slot through response-body consumption. Excess calls receive retryable DRIVE_BUSY before any fetch. Slots release on success or failure; existing 10s abort signals and byte limits remain. This cap also applies to token/revocation requests, which may need a retry when busy. No automatic retry, expanded scopes, real credential or connection was introduced. It is not a durable per-tenant request budget, cross-process global cap or provider billing control. Aborts depend on the fetch implementation honoring its signal.

Evidence: 19 focused scoping/connector checks and 243 full backend regressions passed. Native PostgreSQL test passed twenty competing model admissions across two pools (six accepted at fixture limit, fourteen expected denials), reconnect persistence, another workspace and window reset. Tests cover persistent failed-attempt charging, idempotent replay, rejected-message preservation, streamed-body slot retention and release after provider failure. No new model behavior/prompt or UI layout; model-quality evaluations and browser visual QA were not rerun. Drive remains fixture-tested, not live-provider verified. Self-review covered lock ordering, transaction/receipt boundaries and safe error handling; not independent review. Localhost only, no demo/staging or Stripe changes.

Remaining execution safeguards: per-workspace connector rate/byte budgets, fair inference admission across tenants, provider cancellation verification, per-run aggregate usage accounting and longer provider-inclusive load tests. Do not interpret these initial controls as complete resource governance.

### Ticket 1c, eighth increment — interactive Drive workspace allowance (30 October 2026)

Added durable shared-workspace admission for imports and picker-token requests: provisional 120 operations per fixed hour. Owner membership and active connection/epoch are validated before charging; credentials revalidate afterward. Usage commits separately before provider work, so failed imports and retries retain their charge. A workspace advisory lock protects competing admissions; restart retains counts. Exhaustion is a safe 429 with retry guidance. OAuth setup, status and disconnect remain outside this allowance. No live Google connection, credential or scope changes.

244 backend regressions passed. New integration coverage verifies failed-attempt charging, persistence, rejection before provider access, unauthorized/disconnected denials, reset and disconnect at exhaustion. Native PostgreSQL contention test passes twenty simultaneous admissions over two pools (six accepted at fixture quota), restart persistence, another workspace and reset. Self-review checked transaction boundaries, disconnect behavior and reauthorization; no independent review. No new visual component or browser QA this increment; live provider acceptance remains deferred.

Scope limitation: automatic source reads from task/app execution still use their existing transactional broker path and are NOT governed by this interactive allowance. Adding durable attempt accounting there requires an admission phase outside the execution/source transaction; do not nest a new quota transaction while holding those locks. Existing HTTP timeout, response-byte bounds and per-provider concurrency cap still apply. Direct Google picker-client traffic is also outside the server allowance. No claim of complete connector budget coverage. Next: broker admission for automatic reads, followed by fair model scheduling. Localhost only; demo/staging and Stripe unchanged.

### Follow-up conversations and agent-read admission — ninth increment

- Buyer conversations now use a single reading column with a compact title, inline work cards, a viewport-contained reply composer and collapsed context/history controls. Post-request follow-ups appear after work cards. Draft chats retain their task identity for scroll preservation; opening a conversation starts at the latest exchange. New delivery auto-scroll is limited to an already-followed conversation, avoiding displacement of later messages on reopen.
- Live supplier Drive reads commit shared workspace admission before provider I/O, bind source/grant versions, and recheck permissions/lease before releasing contents. Failed remote attempts count; snapshots do not. Exhaustion does not remove saved files or disconnect controls.
- Evidence: full backend suite 244 passing; focused conversation regression tests 10 passing; web/UI suites passing; native PostgreSQL two-pool allowance/reconnect test passing. SQLite and PostgreSQL-compatible live-source scenarios verify success/failure charging, exhaustion after application reconstruction, stale access/leases and pinned snapshot behavior.
- Browser QA: disposable localhost PostgreSQL fixture, private-chat follow-up, delivered-task follow-up, refresh, context disclosure, desktop and 390×844 viewport. Reply remains inside viewport; no horizontal overflow. The fixture has no conversational model, so it verifies messaging/layout and honest unavailable-model copy, not answer quality.
- Remaining: admission for scheduled app reads and snapshot-preparation refreshes; fair model scheduling. UI still groups current work cards ahead of post-request messages rather than implementing a fully chronological persisted card/event stream. No hosted deployments or real Stripe connections.

### Chat visual simplification

The local product now uses white navigation and a warm cream canvas. Open requests present one truthful “Request sent” activity card instead of repeated waiting messages and runtime implementation copy. Optional CSV input remains available under context details until an offer is selected; input requirements stay inline at the selection stage. The title is a compact breadcrumb, assistant attribution is quieter, and the composer retains its accessible label without displaying a redundant heading.

QA: 69 web tests plus 5 shared UI tests passed. Inspected the user's open-request page without changing task data at desktop and 390×844; no horizontal overflow and the composer stays within the viewport. No backend/provider behavior changes, hosted deployments or simulated tool-read claims were introduced.

### Background refresh stability fix

The two-second workspace poll incorrectly used the interactive command handler, disabling/re-enabling every button on every request. It now reads into a separate candidate state without setting the user-action busy flag. It commits only changed data, discards results after newer actions/navigation or input focus, and prevents overlapping polls. Queue check timestamps are excluded from visual change detection. Notification polling also skips unchanged markup and focused notification controls.

QA: 72 web + 5 shared UI tests passed. Added regressions for unchanged reads, real updates, concurrent action invalidation, overlapping polls and input focus. Browser observation sampled the live posted-task buttons 36 times across 7.2 seconds: zero disabled states and zero node replacements. Local frontend changes only; no demo/staging deployment or payment changes.

### Scheduled app Drive admission (31 October 2026)

Scheduled app execution now commits shared-workspace Drive attempt admission before
provider I/O. It binds execution to the app version and scheduled slot, then
rechecks the source version, grant version and live permissions before reading.
Provider failures retain the charge. Exhaustion pauses the app with allowance/reset
and explicit resume guidance; it does not silently execute from cached data.
Concurrent preflights may each consume an attempt, but only one can produce a run.
Local sources do not consume Drive allowance. Missed slots retain the existing
skip behavior rather than catching up in bursts.

Evidence: 254 full backend regressions passed; a subsequently added source-change
race test passed with the seven focused live-Drive tests. Two native PostgreSQL
checks passed for competing workers/one result, revocation, persistent allowance
and reconnect. No layout changes; existing paused-app reason presentation is used.
Browser walkthrough was not repeated for this backend-only increment. Providers
remain fixture-tested and Stripe remains disconnected. Self-review, not independent
security certification.

Still next: manual app runs, context snapshot preparation and permission-preparation
refreshes need their own durable admission/replay design. Fair model scheduling,
aggregate per-run byte/usage accounting and hosted identity parity remain open.

### Manual execution, snapshots and fair model admission (31 October 2026)

Manual live-Drive app runs and draft context snapshots now commit workspace
attempt admission before fetching. Provider failures retain usage; replay of a
successful command does not charge again. Task/app versions, source versions and
app grants are checked again before execution. Local sources are not charged.
Concurrent preflights can consume separate attempts even if only one result commits.

Local inference now has one active slot, at most 16 waiting requests globally and
two waiting requests per workspace. Waiting work rotates between workspaces in
workspace FIFO order and expires after 25 seconds. Access, task version and source
revocation are rechecked before inference starts. A busy/expired queue preserves
the message and gives retry/manual-review guidance. This queue is process-local;
restart handling uses existing durable scoping-job expiry rather than replaying
in-memory requests. This is not distributed model scheduling.

Validation: 260 backend regression tests passed, including failed-attempt accounting,
receipt replay, fair rotation, queue capacity/expiry, failure release and pre-inference
authorization. No live Google credential or model-quality evaluation was performed
for this increment. No layout change; browser walkthrough was not repeated.
Engineering self-review only. Demo/staging and Stripe configuration are unchanged.

Remaining admission work: permission-preparation refreshes, aggregate per-run byte
accounting, and distributed/hosted queue ownership. Hosted identity parity remains
a separate production requirement.

### Permission preparation and supporting-data reservations (31 October 2026)

Live task permission preparation now uses the same durable Drive attempt admission
as snapshots and execution. The same validation helper runs before admission and
before grant creation; source versions are bound to the admission. Failed provider
reads retain usage, successful receipt replay does not charge again, and pinned
snapshots do not perform a new Drive read.

Task records retain a conservative supporting-document budget: 160,000 reserved
content bytes during draft snapshot preparation and 1,024,000 per assignment for
permission preparation plus supplier reads. Live reads reserve the connector's
16,000-byte document maximum before I/O; local/pinned reads count UTF-8 content
bytes. Failed attempts retain the reservation. Concurrent commands serialize on
the task lock, and exhausted budgets reject before provider access. A new assignment
has a new budget; retries/restarts do not reset it. This is a content reservation,
not exact network-byte metering or a financial charge. Existing model input bounds
remain separate. Apps currently consume one bounded source per run.

Recovery copy explains that saved results remain available and directs the user
to a narrower new request or a newly agreed execution scope. There is no silent
allowance reset or cached-data fallback. Existing error presentation is reused.

Evidence: 262 backend tests, two existing native PostgreSQL concurrency/restart
checks and 78 web/UI tests passed. The subsequently strengthened competing-budget
case passed in the 10-test live-Drive suite on SQLite and PostgreSQL-compatible
storage. Permission failures/replay, pinned data, revocation, exhausted budgets and
restart persistence are covered. No browser walkthrough or real Google connection
was repeated for this backend-only increment. Engineering self-review only.

Next: durable multi-process worker/model scheduling, wider provider integration QA,
and hosted identity parity. Aggregate accounting for future multi-source app
runtimes and actual network/metadata bytes is not implemented. Localhost only;
Stripe, hosted staging and demo remain unchanged.

### Durable conversation recovery worker (31 October 2026)

A localhost background worker now scans saved conversation jobs in bounded pages
and resumes unstarted, unexpired jobs after resolving current identity and access.
It uses the existing transactional claim, so competing processes cannot claim the
same job. Each recovery worker admits at most two in-flight recovered jobs. It
does not hold its scan/access boundary while waiting for inference.

Expired running jobs are not replayed: recovery marks them stale, deletes their
saved model snapshot and exposes an interrupted-reply state while preserving the
user's message. Revoked owners cannot start saved work. Existing job-status, task
version, source-access and expiry checks reject late results. Shutdown drains the
recovery worker and pending inference before closing storage.

Validation: 264 full backend tests passed. Subsequently strengthened revoked-owner
coverage plus a native PostgreSQL restart/two-worker test passed in a 20-test focused
run; 78 web/UI regressions passed. The native test reconnects storage before two
application instances attempt the saved job and verifies exactly one provider
invocation. No real model-quality evaluation or browser walkthrough was repeated
for this backend-only change. Engineering self-review only.

This completes saved-job discovery/recovery, not a distributed inference scheduler.
Global model capacity and fair workspace rotation remain process-local; shared
capacity leases across different jobs/processes are next. Recovery currently pages
through job history; a dedicated active-job index/query should accompany larger
hosted workloads. Demo/staging and Stripe remain untouched.

### Shared local-model capacity (31 October 2026)

All application workers sharing the local database now contend for one durable
`model-capacity` document under a PostgreSQL advisory lock. Claiming a conversation
job and its capacity reservation commit together. When occupied, the job remains
pending for the recovery worker rather than becoming a failed reply.

Reservations use random ownership tokens and a 180-second expiry, exceeding the
local provider's bounded 25-second wait plus 150-second inference timeout. Before
inference and before saving results, ownership/expiry are checked; the result
transaction locks capacity until commit. Finally releases only the matching token.
A stale worker cannot release its successor's slot. Interrupted owners expire;
late results remain fenced by both capacity and job/version checks. Lease expiry
does not prove a remote process has stopped: the provider must honor cancellation;
this is not a guarantee of exactly-once physical inference during network failures.

The capacity document uses the existing generic document schema; no schema change
or destructive migration is needed. The key intentionally limits all local scoping
models together. A multi-model/hosted resource map remains future work. Shared fair
workspace ordering is not yet implemented; process-local fairness alone is not a
distributed fairness guarantee. An active-job query/index is also still pending.

Evidence: 265 backend tests, two native PostgreSQL tests and 78 web/UI tests passed.
Native tests cover 12 competing claims, reconnect, expiry, stale release and saved
job recovery. Application coverage verifies a different job stays pending until
release and subsequently completes. Existing expired-result tests pass. No real
model-quality evaluation or browser walkthrough was repeated for this backend-only
increment. Self-review only; hosted demo/staging and Stripe remain untouched.

### Shared workspace fairness and active-job discovery (31 October 2026)

Model admission now chooses the least-recently-served workspace, then its oldest
eligible pending job (creation time with ID tie-break). The choice and durable
workspace turn are checked/updated inside the same shared capacity lock as the
claim. A worker attempting a different job cannot skip that choice. Turn records
and the global turn counter persist in the existing document schema.

New jobs include tenant identity and creation time. Candidate lookup joins the
task's workspace for legacy jobs and falls back to the existing expiry-derived
creation time. Expired pending jobs cannot win admission. Recovery queries only
pending/running records using the existing kind/status index, rather than paging
through completed history. It separately includes the next fair candidate so
cursor position cannot hide eligible work from another workspace. Authorization
and stale-scope checks still run before inference.

Evidence: 267 backend tests, two native PostgreSQL tests and 78 web/UI tests passed.
Fairness tests run against SQLite, PostgreSQL-compatible storage and two native
PostgreSQL pools: A with three queued jobs, B with two and C with one receives
A1/B1/C1/A2/B2/A3. Out-of-order claims are refused; competing claims admit once;
completed history is excluded and expired jobs cannot win. Existing restart,
revocation and result-fencing checks pass. No live model evaluation, browser
walkthrough or large-scale query benchmark was performed for this backend-only
increment. Self-review only.

No migration or hosted deployment is required. The existing three-minute reply
deadline remains in force; fairness does not extend a waiting job indefinitely.
Priority tiers, weighted fairness, separate model pools and user-facing queue
position/estimates are not implemented. Stripe and demo/staging stay unchanged.

### Conversation progress, stopping and recovery (31 October 2026)

Buyer conversations now distinguish waiting for shared capacity from working on a
reply using the saved job status. Elapsed time measures time since the request,
not an invented completion estimate. A lightweight text update leaves controls
mounted. Both draft chat and posted-task review use the same progress component.

The new authenticated cancel-reply command checks task access, expected version
and exact job ID under the job lock. It records cancellation, removes the saved
model snapshot and preserves the user's messages and agreed scope. Late replies
cannot commit. Stopping an in-flight reply does not promise immediate provider
abort: capacity remains held until provider completion/timeout. Retry reuses the
conversation without appending a duplicate user message and still consumes the
normal model-attempt allowance.

Operations Work health & alerts includes bounded conversation counts and expired/
failed reply guidance, with no snapshots, prompt contents or provider secrets.
Existing explicit operations authorization and Refresh behavior remain in place.

Evidence: 268 backend tests, 79 web/UI tests and two native PostgreSQL regressions
passed. Focused cancellation tests cover unauthorized actors, replay, late output
and retry without duplicate messages; operator tests cover sanitized alerts.
Desktop browser QA used an isolated in-memory fixture on port 4182: failure, retry,
working, stop, capacity waiting and stopping pending work all remained in one chat.
No user records were used. Mobile visual QA and real-provider cancellation were not
repeated. This is self-review, not independent production approval.

Localhost only. Stripe remains disconnected; staging and the published demo are
unchanged. Next production validation needs real external-agent and connector
walkthroughs when credentials are available, plus broader operational/release review.

### First model-backed supplier round trip (1 November 2026)

An optional separate SDK process now uses the installed free Qwen3 8B model for
supplied-text link extraction. It passes the existing capability test and revision,
bids only on explicitly supported briefs, and submits source-validated JSON/text
files through the same supplier protocol. Normalization, counts and revision
sorting are deterministic; missing/invented model links fail closed. No automatic
Relay-owned marketplace competitor is added.

Inference renews the execution lease every ten seconds; a failed renewal aborts
inference. Model response/input/time limits, cancellation, credential fencing and
failure backoff apply. Existing deterministic link runtime remains compatible.

Evidence: 276 backend tests passed, including hallucinated/missing output,
cancellation and lease loss. A clean real-model evaluation on disposable native
PostgreSQL and a separate CLI process passed heartbeat, both qualification rounds,
automatic quoting, buyer award/unpaid authorization, delivery, real ClamAV scanning,
download validation, revision and acceptance. Earlier evaluation caught model
sorting mistakes; sorting now belongs to deterministic code instead of relying on
the model. No buyer/builder UI was changed or browser visual QA repeated in this
increment. Self-review only.

See [Model-Supplier.md](Model-Supplier.md) for the runnable integration and its
limits. Qualification remains narrow, not general AI research competence. This
reference is not an independent third-party supplier integration. Hosted auth,
real Google credentials, actual Stripe sandbox, capacity/load validation and
independent operational/security/payment review remain release gates. Localhost
only; demo and staging unchanged and Stripe disconnected.

### Reproducible local release verification (1 November 2026)

`npm run verify:local` now runs backend, web, native PostgreSQL recovery/concurrency
and two 60-second load modes sequentially. A private report binds the results to
the source fingerprint before/after execution. Failures, skipped/cancelled tests,
missing evidence, timeouts and source changes cannot pass. Logs remain in ignored
local storage; process groups are terminated on cancellation/timeout. See
[Release-Verification.md](Release-Verification.md).

A passing local report explicitly does not certify production readiness. Provider
credentials, hosted identity, external supplier validation, cross-role browser QA
and independent human reviews remain visible gates. No UI, deployment or payment
configuration changes are included in this increment.

### Managed identity command-entry parity (1 November 2026)

The opt-in managed/shared application composition now refreshes session, verified
identity, eligibility and membership before browser domain commands. Cached actor
objects and replayed receipts cannot bypass logout, reset or removed access at
entry. Supplier-key paths remain distinct. A second session read catches deletion
while provider lookups are in flight. Local HTTP QA proves that demotion between
route authentication and task creation denies the write.

See [Managed-Identity-Parity.md](Managed-Identity-Parity.md). SQLite and
PostgreSQL-compatible adapter tests exercise the same domain policies; provider
calls are fixtures. No hosted migration, UI/config switch or deployment occurred.
Next managed increment: persistent membership generations and transaction-level
revocation ordering, approval invalidation and background actor resolution. This
entry check does not close those races or constitute independent security review.

### Managed durable access generations and cutoff (local implementation)

An opt-in unified managed composition now stores authoritative membership epochs,
serializes access updates with application actions, and shares approval
invalidation/reservation rules with the local identity path. Old approvals stay
stale after re-promotion; interrupted invalidation is repaired before subsequent
work. Background actor resolution uses the durable authority. Nested authorization
reads reuse their current transaction, with a regression test for detached work.

Real native PostgreSQL coverage verifies two-pool ordering, restart and competing
snapshots. A discovered test-only database-name collision was corrected with
UUID-based fixture names. See [Managed-Identity-Parity.md](Managed-Identity-Parity.md)
for the trusted snapshot contract and precise boundary of these guarantees.

Remaining: connect the authoritative managed-provider change/refresh feed and
bootstrap, then validate real-provider and cross-role behavior. Uningested
provider changes cannot be treated as transactionally applied revocations. No
launcher switches identity mode, deployment, real payment or UI change is included.

### Signed membership-feed receiver (localhost)

An optional, separate receiver now authenticates raw Relay-adapter messages with
pinned issuer/key ID, timestamp tolerance and HMAC. Durable receipts prevent
conflicting event reuse; duplicates replay without renewing membership expiry,
older valid revisions are acknowledged as superseded, and interrupted application
retries reconciliation before acknowledgment. Signed demotion tests preserve the
same task and invalidate its approval/reservation. Native two-pool tests cover
concurrent delivery deduplication.

The local HTTP fixture listener adds bounded bodies, concurrent admission and
sanitized errors. It is not mounted on the buyer/builder app. See
[Managed-Membership-Feed.md](Managed-Membership-Feed.md) for the contract and limits.
Next: real authoritative producer/bootstrap/refresh and delivery operations;
provider-side credentials, hosted ingress, monitoring and independent review are
still required. Demo/staging remain unchanged and Stripe remains disconnected.

### Authoritative local producer, bootstrap and refresh

The managed membership producer now persists source generations and outbox entries
atomically, bootstraps explicit users idempotently, refreshes short-lived snapshots,
and delivers signed updates with leases and bounded retries. Lost acknowledgments
reuse the same envelope; expired access requires fresh generations, and divergent
receiver revisions block automatic overwrites. A private-config CLI runs against a
separate native local PostgreSQL source database and loopback receiver.

See [Managed-Membership-Producer.md](Managed-Membership-Producer.md). Local HTTP and
native multi-pool/restart tests cover the delivery path. Real provider change
capture is still a separate integration: current Supabase/admin UI mutations do
not yet populate this source automatically. Next operational work includes source
status/refresh-lag visibility and a safe divergent-source reconciliation workflow.
No user accounts were attached to a running producer; demo/staging/Stripe remain
unchanged.

### Membership producer health and controlled recovery

Added read-only per-user CLI health (freshness, lag, delivery/lease state) and an
operator-only reconciliation API. Recovery requires reviewed source/receiver
versions, preserves receiver generation history and sends a revocation before
allowing any new grant. Idempotent audited commands and receiver monotonic checks
fence stale reviews and concurrent receiver advancement. Operator authentication
and a trusted receiver-record adapter are required at integration time; this is
not a public recovery endpoint. Provider capture and aggregate monitoring remain
outstanding. See Managed-Membership-Producer.md for QA and operational limitations.
Localhost only; no Stripe, demo or staging configuration changed.

### Trusted provider capture and aggregate visibility

Prepared transactional SQL membership capture with initial bootstrap and ordered
incremental events; wired a bounded consumer into the local producer CLI. Capture
failure/backlog stops renewal, while explicit recovery revocations can still drain.
Provider-bound sources cannot be manually overwritten or renewed without capture.
Added read-only aggregate CLI health with freshness/backlog/delivery counters and
explicit partial-scan reporting. Tested using disposable local provider fixtures,
including native PostgreSQL concurrent commits and runtime reader permissions.
The hosted migration is not applied; actual Supabase/admin changes are not yet
connected. See Managed-Membership-Producer.md for commands, evidence and limits.
Stripe remains disconnected; demo/staging and current user records unchanged.

### Local operator incidents

Added durable incident transitions for membership producer/capture health, evaluated
after successful and failed cycles. Repeated observations do not repeat incidents;
failed or incomplete monitoring cannot clear known problems. A read-only --alerts
CLI shows active codes and recent history with a stale-observation flag. Tests:
328 backend passes plus native PostgreSQL concurrency/restart checks. No external
notifications, UI change, access repair or deployment is included. Next operating
gaps are independent worker-liveness monitoring, retention/capacity testing and a
reviewed provider rollout procedure. Hosted provider rollout remains unapproved;
Stripe stays disconnected and demo/staging remain separate.

### Independent local liveness and retention/capacity checks

Added a separate membership watchdog command with its own persisted state and
incident transitions. It reads completed producer-cycle timestamps without
renewing them, detects missing/stale/future observations, and exposes one-shot
health exit codes. Storage thresholds include source/receipt growth as well as
incident history. Explicit retention batches delete only old incident events,
keep the newest 100 per stream and preserve all authoritative/replay state.
QA: 332 backend passes, final adapter rollback/read-only checks, and native
PostgreSQL concurrency plus separate CLI process checks. No ongoing watchdog was
attached to real records and no real-data cleanup was run. See the producer
runbook for limits. Next: safe provider-log retention watermarks and measured
capacity/load evidence; hosted supervision and rollout remain separate.
Stripe, demo and staging remain unchanged.

### Safe provider-log retention and backlog checks

Added explicit consumer registration, durable-cursor acknowledgments and operator-only
bounded pruning below the slowest registered watermark. Old prefixes only; newest
100 records and all source/receiver histories remain. Persistent provider stream IDs
prevent cursor reuse across databases; stale restores below retained history fail
closed. Local tests cover restart batches, slow backlog expiry, concurrent pruning,
rollback and privilege boundaries. Native capture measurements are fixture evidence,
not production capacity guarantees. Hosted deployment and real cleanup remain off.
Next: reviewed bootstrap/restore/retirement workflow and sustained multi-tenant load,
then a complete buyer-to-builder release rehearsal. Stripe/demo/staging unchanged.

### Reviewed provider recovery operations

Added read-only restore assessment plus an operator CLI and audited consumer
retirement. Retirement requires exact reviewed provider versions and a current,
active replacement; stale requests fail and retired identities cannot re-register.
No automatic cursor rebasing, permission restoration or skip-to-latest bootstrap
is provided. Local fixtures and native PostgreSQL cover concurrent retries,
rollback and privilege boundaries. Actual consistent backup/bootstrap execution
and operator CLI deployment remain separate. No real records or hosted services
were changed; Stripe stays disconnected.

### Actual isolated membership restore and neutral UI polish

Added a coordinated three-store native dump/restore utility and passed an actual
recovery rehearsal: initial bootstrap, pending delivery replay, existing receiver
generations and subsequent role changes survive. Corrupt bundles and existing
targets are rejected. Restored databases stay operator-only and are not activated
in the app. Pruned-history reconstruction is still blocked without a valid source.

Local product tokens now use black primary actions, warm neutral selected states,
consistent borders and clearer small-text sizing. Company panels share those
semantic tokens; status colors and tool branding retain their meanings. Browser
QA covered buyer request/tasks/conversation/apps and builder dashboard, including
390px mobile layout. Web checks: 74 application plus 5 shared UI tests passed.
Backend: 339 passed, plus actual native restoration. No hosted changes or payments.

### History and spending — localhost

Buyer navigation now exposes History & spend for the selected workspace. The server scopes records to current membership: owners see workspace tasks; other members see only their own. All saved tasks are included, with links back to the original conversation. Confirmed funding and refunds are summed from current and archived settlement ledgers; transfers and payouts are not counted again. Net funded includes funds held for unfinished work; the detailed view separates confirmed releases to builders from held funds. All amounts are USD sandbox amounts, not real charges or invoices.

Regression coverage includes pending funding/refunds, refund/re-funding archives, payout double-count prevention and workspace/member isolation on SQLite and PostgreSQL adapters. Desktop/mobile browser QA covered existing saved history, task navigation and refresh persistence. Large-history server pagination/aggregation remains a scale follow-up; this initial endpoint reads the authorized workspace history in one request. Stripe, hosted demo and staging are unchanged.

Detailed spending now exposes confirmed funding/refunds/releases, held funds, pending funding and pending refunds separately. Each task includes the selected quote, dated movements, transaction reference, settlement and agreement/scope references. All calculations use integer minor units and reject unsupported currency, invalid precision or a negative held balance. Confirmed transfers count as released work cost; bank payouts never count twice. Pending refunds remain held until confirmation. Quotes are not charges. The page labels all amounts as sandbox USD and includes an observed timestamp and explicit refresh. Invoices and paginated reporting remain future work.

### Client state cleanup and complete local release check (2 November 2026)

The buyer/builder shell now declares every client-side state field in one factory and
uses the same complete reset after logout or session expiry. Account-specific
notifications, recovery data, company context, file previews, drafts, filters and
workspace records can no longer remain as ad hoc properties after another account
reaches the login screen. Scheduled-work examples also use one shared source rather
than separate display and click-handler copies. Regression coverage verifies fresh
mutable collections and preservation of environment configuration only.

The complete local release command passed without source changes: 348 backend tests,
85 web/shared UI tests, 32 native PostgreSQL recovery tests, one bounded-limit load
profile and one steady-load profile. Local smoke checks reported PostgreSQL storage
healthy and all six workers healthy. This evidence is local and does not mark Relay
production-ready. Managed hosted auth, real connector OAuth/revocation, Stripe sandbox
reconciliation, an independent supplier, cross-role/mobile/accessibility rehearsal and
independent security/payment/operations reviews remain release gates.

### CI and dependency review gates (2 November 2026)

GitHub Actions now defines separate core/browser and native PostgreSQL recovery
jobs for every pull request. Main and manual runs additionally execute both
60-second load profiles. Jobs use Node 24 from `.nvmrc`, `npm ci`, read-only
repository permissions, concurrency cancellation and a final source-diff check.
No deployment or provider secret is part of this workflow. Dependabot is bounded
to weekly npm and monthly Actions updates, which still require review and CI.

The workflow must be pushed before GitHub can execute it, and branch protection
must then require both pull-request job groups plus a human approval. Until that
remote configuration is confirmed, CI is prepared source rather than an enforced
production control. See [Continuous-Integration.md](Continuous-Integration.md).

### Date-filtered spending and CSV exports

History & spend supports optional From/Through dates, inclusive UTC calendar days. Confirmed transactions use ledger timestamps, not task creation dates. Opening held funds plus in-period funding minus refunds and releases equals closing held funds. Tasks with an opening balance or current pending amounts remain visible even without in-period movements. Pending amounts, selected quotes and task/payment status are current snapshot values, explicitly labeled rather than reconstructed historical state.

The authorized server response includes the CSV generated from the exact same report snapshot displayed in the page. Export does not refetch totals. CSV has per-task rows and a TOTAL row with eight decimal monetary columns, USD/sandbox flags, dates and snapshot timestamp. Do not sum task rows and TOTAL together. Monetary decimals are generated from integer minor units; formula-like task titles are escaped. Existing workspace/member authorization applies.

QA: 346 backend and 79 web tests passed. New cases cover cross-period funding/refunds/releases, inclusive end boundaries, exact cent sums (including negative net funding), invalid dates, CSV quoting/formula safety and zero-row exports. Browser verified a UTC single-day filter and actual downloaded CSV: four task rows, eight numeric columns reconciled to the displayed zero totals. Follow-up authenticated browser QA at 390×844 completed: reversed dates show an inline error while preserving the prior report; correcting the range clears the error; open-ended dates and empty results work; All time clears both fields and restores nine tasks. The mobile CSV download contained four task rows plus TOTAL, with all eight monetary columns reconciled exactly to the displayed zero totals. Nonzero and negative amounts remain covered by automated fixtures. Empty results now offer Show all history instead of prompting a new task; the button was verified to restore the full history. The latest web suite passed 76 application plus 5 shared UI tests, and 7 targeted spending/export checks passed, including exact downloaded Blob bytes. Desktop viewport restored after responsive emulation; physical-device date-picker behavior was not tested. Demo/staging/Stripe unchanged.
