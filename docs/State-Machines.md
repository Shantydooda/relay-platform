# Relay state-machine audit

Source review: 8 November 2026. Scope: the local v1 repository, including buyer/builder UI, application commands, supplier protocol, persistence, workers and managed-identity infrastructure. Demo and staging were not changed. This is a source inventory of lifecycle families, not a proof that every possible runtime interleaving has been enumerated.

## Decision

Keep separate lifecycles separate. A task is the coordination record, not one enormous state machine. Its brief, offer, approval, assignment, permission wait, scanned delivery and settlement have different owners and different transition rules.

Use authoritative application commands for transitions and small shared projections for facts consumers need to display or act on. Do not introduce a global state-machine engine, rename stored states, or rewrite the transaction layer as part of this audit. Existing expected versions, idempotency receipts, locks, fenced leases, membership epochs and provider reconciliation are safety boundaries worth preserving.

For each future change, specify: owner, event, guards, atomic writes, side effects, retry identity, terminal behavior and the buyer/builder/agent projection. Shared display facts never authorize commands. A successful UI action must represent a committed server transition; a timeout is an unknown result requiring reconciliation.

## Inventory

Paths below are relative to the repository. Arrows describe lifecycle shapes; labels described as derived are not necessarily stored enum values. Related submachines are grouped to keep the map usable.

### Demand, supply and execution

| Family | Owner / source | Lifecycle and invariant |
| --- | --- | --- |
| Conversation and task publication | `services/application/src/service.cjs`; `apps/poc-web/public/app.js` | Conversation/scoping precedes explicit publication. Draft and posted task state must not be confused with an assignment's execution status. Sending a message does not itself authorize work. |
| Scope generation | `services/application/src/scoping.cjs` | Pending/running jobs resolve to completed, failed, cancelled or stale outcomes. Results bind to the request/task version; a late response must not replace newer scope. A proposed work plan is not an activated schedule. |
| Offers and selection | `services/application/src/service.cjs` | Quote availability, selection, expiry and invalidation depend on scope and agent eligibility. `selected` is a task-view projection, not proof of funding or authority to start. |
| Agent registration and runtime identity | `services/application/src/service.cjs`, `supplier-credentials.cjs` | Saved configuration, runtime heartbeat, credentials and usable capability are separate facts. A heartbeat is neither qualification nor an execution lease. |
| Capability qualification | `services/application/src/qualification.cjs`, `link-assessment.cjs` | `test_pending → revision_pending → passed`, with failure and derived expiry/invalidation. Qualification binds to a particular capability and runtime identity/version; it is not a universal agent badge. |
| Storefront publication and discovery | `services/application/src/agent-discovery.cjs` | Published visibility and current requestability differ. Search/cursor state must not turn unpublished or ineligible agents into selectable suppliers. |
| Portfolio consent | `services/application/src/portfolio.cjs` | Pending consent, publication, decline, withdrawal and revocation. Buyer acceptance of work is not permission to publish it. Reads must honor revoked sharing authority. |
| Saved agents and repeat hire | `services/application/src/saved-agents.cjs`, `acquisition.cjs` | Saved membership and a new request are distinct. Repeat hire carries a preference, not the previous quote, approval, funding or permissions. |
| Assignment execution | `services/application/src/execution.cjs` | `queued → running → buyer_review → accepted`; revisions return to queued, failures/cancellation terminate attempts. Claims and progress use assignment identity and fenced leases. |
| Permission pause | `services/application/src/permission-wait.cjs`, `workspace-apps.cjs` | An orthogonal pause while assignment status remains queued. Pause fences the old lease and freezes execution allowance; unresolved requests for the current assignment prevent resume. Historical requests must not pause a replacement. |
| Execution recovery | `services/application/src/execution-lifecycle.cjs` | Queue deadlines, lost leases, retries and manual restart eligibility form a clock-driven machine. Recovery cannot revive a cancelled assignment or bypass budget/permission checks. |
| Submission and revision | `services/application/src/execution.cjs`, `task-changes.cjs` | Delivery versions, buyer review, requested revision and acceptance are separate from file scan results. Revision requires a fresh claim. Scope changes use a proposal and explicit acceptance rather than chat text changing a contract. |
| Scope-change agreement | `services/application/src/task-changes.cjs` | Pending proposals may be accepted, declined or superseded. Acceptance invalidates old execution/offer assumptions and must require the current commercial authorization. |
| Multi-agent plan | `services/application/src/orchestration.cjs` | Active parent plan coordinates child tasks; parent acceptance requires accepted child deliveries. Independent children can progress independently; dependencies gate downstream publication. |
| Versioned handover and replacement | `services/application/src/orchestration.cjs`, `orchestration-recovery.cjs` | Accepted source artifact/version is explicitly handed over. Recovery supersedes failed work and creates new work; changed dependencies cannot silently inherit previous approvals. |

### Access, money, files and integrations

| Family | Owner / source | Lifecycle and invariant |
| --- | --- | --- |
| Company approval | `services/application/src/approvals.cjs` | Required → pending → approved/declined, with stale/expired projections. Approval binds to the exact agreement fingerprint and authority epoch, not just task ID. |
| Budget allocation | `services/application/src/approvals.cjs` | Reserved → committed/released; expiry affects held reservations. Approval, reservation and provider-confirmed spend are different amounts. |
| Operator verification/readiness | `services/application/src/payments.cjs` | Creating/onboarding-required records produce readiness or refresh-required views. Readiness expires and is checked again for consequential actions. Sandbox readiness is not production verification. |
| Funding and refund | `services/application/src/payments.cjs` | Creating checkout → awaiting payment → funded/expired; creating refund → pending/failed/refunded. Only reconciled provider results establish financial outcomes. |
| Transfer and payout | `services/application/src/payments.cjs` | Accepted funded work → creating transfer → transferred → creating payout → pending/failed/paid. Delivery acceptance, transfer and bank payout must not share a completion label. |
| Provider event ingestion | `services/application/src/payment-jobs.cjs`; `services/payments/src/` | Events schedule reconciliation, may be ignored/unmatched, and are deduplicated. An event is a hint to reconcile authoritative provider state, not arbitrary permission to set settlement fields. |
| Payment retry/recovery | `services/application/src/payment-recovery.cjs`, `payment-jobs.cjs` | Due work is leased, retried with bounded backoff or moved to review. Unknown provider outcomes reuse durable operation identity; retry never means making a new payment blindly. |
| Spending snapshot/export | `services/application/src/spending-snapshots.cjs`, `spending-report.cjs` | Report creation, stable paging/export and expiry form a snapshot lifecycle. Money stays in integer minor units; filtered totals and exported rows must use the same immutable snapshot. |
| Membership and invitations | `services/poc-api/src/`; `services/application/src/access-boundary.cjs` | Invitations, membership, role changes and revocation are distinct. Removed/re-promoted users need fresh authority; a replayed command receipt is not a shortcut around current access. |
| Authentication and session recovery | `services/poc-api/src/`; `services/staging-api/src/provider.cjs`, `token-vault.cjs`; `apps/poc-web/public/managed-auth.js` | Registration/verification, login, reset, expiry and revocation are separate routes and token lifecycles. Session state in the browser is not authoritative membership. |
| Artifact storage and scanning | `services/application/src/file-scans.cjs`; `services/storage/src/` | Quarantined → scanning → clean/blocked/scan-error, with recovery and object reconciliation. Upload completion does not grant download, preview, publication or acceptance. |
| Source connection | `services/application/src/workspace-apps.cjs`, `drive-connections.cjs` | Active/disconnected source plus OAuth pending/exchanging/used/cancelled state. Saved connection metadata does not prove current access to an individual resource. |
| Tool permission request | `services/application/src/workspace-apps.cjs` | Pending → approved/declined request plus separately active/revoked/expired grant. Grants bind to subject, assignment, agent, operation and source; read access is not write access. |
| Context references and snapshots | `services/application/src/workspace-apps.cjs`, `drive-connections.cjs` | Selected reference → permission-checked read/snapshot. Source version/content identity and access must be checked at use time; a mention alone is not a grant. |
| Attio delivery | `services/application/src/attio-delivery.cjs` | Reviewable delivery job → send/reconcile → sent or failure/partial outcome. Bind export to accepted submission and destination, preserving external operation identity across retries. |

### Scheduled work, hosting and operations

| Family | Owner / source | Lifecycle and invariant |
| --- | --- | --- |
| Recurring schedule | `services/application/src/recurring.cjs`, `calendar.cjs` | Explicit activation, active/paused schedule and calendar-driven due runs. Every run has its own task/assignment outcome. Delivery must never implicitly activate recurring work. |
| App installation/configuration | `services/application/src/workspace-apps.cjs` | Accepted, scanned package is installed/configured and active/paused. Installation, scheduling and host allocation are different actions. |
| Hosting entitlement | `services/application/src/workspace-apps.cjs` | Subscription status and expiry derive `canHost`. Entitlement is enforced on actual execution, not just the subscribe button; a retained host record does not grant access. |
| Host lifecycle | `services/application/src/workspace-apps.cjs` | Running/stopped/deleted, with availability derived from entitlement. Stop/delete must not be interpreted as successful output delivery. |
| Hosted run and output | `services/app-runtime/src/local-worker.cjs`, `worker-entry.cjs`; `services/application/src/workspace-apps.cjs` | Child execution, timeout/crash and bounded recovery precede output review. `needs_review → saved/discarded` output is a separate decision, bound to output hash. Local bounded execution is not a general-purpose production sandbox. |
| Admission and capacity | `services/application/src/model-capacity.cjs`, `model-budget.cjs`, `workspace-limits.cjs`, `storage-limits.cjs`, `drive-budget.cjs` | Reservations, leases, counters and time windows implement state even without a `status` string. Release/expiry must not double-credit capacity; queue ownership and fair admission are independent of task completion. |
| Supplier event/feed checkpoints | `services/application/src/supplier-feed.cjs`; `packages/supplier-sdk/src/` | Cursor advancement and materialized assignment indexes must reflect committed authoritative work. Clients checkpoint after handling and reconcile after restart. |
| Runtime polling and retry | `services/agent-runtime/src/worker.cjs`, `services/link-runtime/src/worker.cjs`, `services/model-runtime/src/worker.cjs` | Poll → evaluate → quote/claim → execute → submit/fail; leases, stop flags and network uncertainty add substate. Permission waiting is not executable queue capacity. Model runtime delegates its execution loop to the link runtime. |
| Command receipts and transactions | `services/application/src/service.cjs`, `repository.cjs`, `postgres.cjs`, `sqlite.cjs` | New command, committed result, duplicate replay, version conflict and retryable storage contention. Check authority on replay, preserve command identity and commit related state atomically. |
| Authoritative membership producer | `services/staging-api/src/membership-producer.cjs`, `membership-authority.cjs` | Source revision/conflict/revocation and pending/sending/delivered/blocked outbox form separate machines. Signed delivery does not itself prove source freshness. |
| Membership stream and feed | `services/staging-api/src/membership-provider-stream.cjs`, `membership-feed.cjs` | Catch-up/current/unavailable transport and applied/superseded revisions. Reject stale/replayed authority; fail closed when required freshness is unavailable. |
| Monitoring and liveness | `services/staging-api/src/membership-monitor.cjs`, `membership-watchdog.cjs`, `membership-alerts.cjs`, `membership-retention.cjs`; `services/operations/src/` | Worker heartbeats, due work, stale leases, capacity and alert open/resolution are clock-driven state. Monitor health must not depend solely on the worker it monitors. |
| Backup, restoration and bootstrap | `services/storage/src/backup.cjs`; `services/application/scripts/`; `services/staging-api/src/membership-recovery.cjs` | Snapshot/verification, isolated restoration and authority bootstrap are distinct phases. Restored data does not automatically imply fresh authorization or safe worker resumption. |
| Process lifecycle | `services/operations/src/http-shutdown.cjs`; worker entrypoints | Starting, ready, draining and stopped have admission implications. Do not accept new work while closing resources; retain enough durable state to recover in-flight operations. |

### Browser/controller machines

| Family | Owner / source | Lifecycle and invariant |
| --- | --- | --- |
| Navigation, workspace and auth context | `apps/poc-web/public/app.js` | Route, active workspace, selected task, role and session interact. A response from a previous workspace must not overwrite the new one. |
| Chat composer and asynchronous replies | `apps/poc-web/public/app.js`, `buyer-flow.js` | Editing/sending/pending reply/error/retry and task conversion. Preserve drafts and focus; send is not publish, and a stale reply must not reset current input. |
| HTTP mutation uncertainty | `apps/poc-web/public/request.js` | Pending, slow, failed/timeout and committed-but-response-lost are different possibilities. Do not display an unknown result as confirmed failure or invent a new consequential command on retry. |
| Polling, refresh and display | `apps/poc-web/public/execution-ui.js`, `recurring-ui.js`, `app.js` | Server refresh, optimistic/local edit and rendering must coexist without resetting controls or replaying entrance animations. Derive business labels from server projections. |
| Search, pagination and filters | Discovery and billing controllers under `apps/poc-web/public/` | Query generation, loading, cursor, date validity and snapshot identity. Reset dependent cursors on changed filters and reject late results from superseded queries. |
| Notifications | `services/application/src/notifications.cjs`; `apps/poc-web/public/notifications-ui.js` | Event visibility, read/unread cursor and navigation target. A notification is historical evidence, not current authorization or current task state. |
| Appearance and accessibility | UI controllers/styles under `apps/poc-web/public/` | Theme persistence, reduced motion, expanded dialogs/panels and focus restoration. Cosmetic state must not trigger domain commands or replace focused controls on polling. |

## Concrete mismatch corrected

The assignment permission latch was authoritative in claim/recovery commands but missing from supplier assignment feeds. Runtime clients saw `queued`, attempted a claim and received `PERMISSION_PENDING`. Meanwhile buyer labels inferred waiting from any historical declined/pending request, so old requests could mislabel replacement work. Execution-health counts treated paused work as ordinary queued work.

The shared projection in `packages/domain/src/execution-state.cjs` now answers one question: is the current active assignment paused for permission? Task, execution, supplier and queue views expose the same `waitingForPermission` boolean. Reference workers skip claims while it is true. Buyer labels/progress and queue counts consume that fact. Terminal assignments do not inherit a live wait indicator from retained metadata.

This improves all three experiences:

- **UX:** consistent “Permission needed” state and no misleading running spinner/count for paused work.
- **DX:** one projection with contract and regression tests, rather than repeated inference from request history.
- **AX:** an explicit wait signal before claiming, while command-time checks still prevent races and unauthorized tool use.

Compatibility: additive optional API field; no stored enum changes, migration, dependency or permission relaxation. Older clients still encounter the existing claim guard. The browser retains its old inference only when connected to an older server lacking the boolean. A false projection is never a promise that a later claim will succeed.

## Next improvements, in risk order

1. Add transition tables and generated negative/sequence tests around existing execution, approval and payment commands. The [transition contracts](Transition-Contracts.md) now document all three, with generated execution, approval and payment matrices and concurrency/replay sequences. Approval/payment coverage adds 224 fixture checks across both adapters. The next priority is consistent server-owned action eligibility and stable reason codes. Do not move their writes out of transactions merely to make the tables look uniform.
2. Consolidate remaining action eligibility into server projections with stable reason codes, starting with approval/funding/recovery. Continue rechecking every command; display eligibility may become stale immediately.
3. Extract chat, request and workspace-switch controllers into explicit small UI reducers. Target stale responses, focus preservation and unknown mutation outcomes; avoid a whole-app rewrite.
4. Expand model-based concurrency tests for pause/cancel/replace, approval-role changes and late provider outcomes. Assert public projections as well as persisted state.
5. Review compatibility-only domain/legacy policies against the active application modules before reuse. Similar status names across old and active implementations do not establish semantic equivalence.

Do not add more top-level task statuses to encode every combination of approval, money, permission and delivery. That creates a combinatorial contract and encourages clients to treat a display label as authority.

## Verification boundary

The accompanying checks cover the pure active/terminal wait projection, SQLite and PostgreSQL-compatible application fixtures, buyer labels overriding stale permission history, supplier response contracts and reference workers skipping paused work. `npm test` passed 429 checks; `npm run test:web` passed 124 web and 7 shared UI checks. The first backend attempt was blocked by sandbox restrictions on localhost fixture listeners; the rerun with localhost access passed. PostgreSQL-compatible fixtures are not a new native PostgreSQL stress run.

Localhost was reachable in the browser; refresh revealed an expired authenticated session. Authenticated browser walkthrough is therefore unverified for this change. No paid or live provider operation was performed. Independent production review and real-provider acceptance are not replaced by this source audit.

### Availability increment

Approval and payment guards now produce actor-specific advisory actions for buyer detail, company approval queues and supplier work. Commands retain transactional revalidation. See [the response contract and limits](Transition-Contracts.md#server-defined-action-availability). Execution start/review/cancel/retry and recurring schedule create/pause/resume now use shared guard projections too. Remaining families, including supplier runtime commands and broader app controls, should be audited before extending the contract. Do not infer an authorization token from `allowed: true`.

## Background refresh lifecycle — 9 November 2026

The next bounded controller extraction is `apps/poc-web/public/refresh-lifecycle.js`.
Its lifecycle is idle → pending read → apply or discard → idle. Each read captures
its account object, user ID, workspace side, tenant, task, view and action revision.
Results and errors from a replaced session or changed context are discarded. The
existing focus/edit/review guards remain in place; reads do not disable buttons,
retry mutations or grant server authority. Attio status and delivery receipts are
now included in the applied refresh projection instead of being fetched and lost.

Deterministic UI tests cover unchanged reads, concurrent actions, overlapping
polls, focus gained while reading, tenant/side/account/session replacement, stale
401 errors, and delivery receipt updates. This is a first controller extraction,
not a claim that all chat and navigation handlers have been refactored. Foreground
request and chat controller extraction remains next in this audit sequence.

Validation for this increment: 768 backend tests and 144 UI checks passed; the
initial backend run lacked localhost listener permission and was rerun with that
permission. Diff checks passed. Localhost serves the new module and the public
page loads. The authenticated browser session was signed out on reload; workspace
switching browser QA remains pending login, rather than being claimed from unit
coverage alone. Demo and staging were not modified.

Authenticated browser follow-up: after the user logged in, buyer → builder →
builder Tasks → buyer navigation completed with the correct workspace navigation
and content. An existing buyer conversation opened correctly. An unsent test draft
and textarea focus survived multiple polling intervals; the draft was cleared
without sending. Returned to My tasks. No tasks, offers, payments or permissions
were changed. This closes the ordinary authenticated navigation/focus walkthrough;
forced late-response and replaced-session races remain covered by deterministic
controller tests, not manually induced in the user's browser.

## Foreground chat/request lifecycle — 9 November 2026

`chat-controller.js` extracts request creation and message submission from the
page event handler. Each pending operation owns a token and captures the account,
workspace, task, route and action revision. Reads assemble a candidate projection
before committing; stale successes and failures cannot replace the new screen or
trigger follow-up scoping. A newer request/message draft is preserved. Cleanup is
owned by the operation token, so an old completion cannot clear a newer spinner.
Existing server commands and durable retry keys remain unchanged; there is no
automatic mutation retry. A write that completed after navigation remains on the
server and can be found in task history; discarding its UI response is not a
cancellation. Successful creation still opens its private conversation and starts
scoping, without posting or authorizing execution.

QA: 16 controller race tests; 160 total UI checks and 768 backend checks passed.
An isolated browser harness using the actual controller verified navigation during
a delayed request and newer typing during a delayed message. The main localhost
app reloaded successfully while authenticated. No user tasks were submitted for
this QA; the harness used simulated responses. Demo/staging and provider settings
were untouched. Diff checks passed. This does not claim every other foreground
controller (auth, file uploads, editing, integrations) has received the same guard.

## Scope-control continuation — 9 November 2026

Analyze brief, read connected context, confirm scope and cancel reply now use the
same guarded foreground controller. Commands capture the original task ID,
version and proposal/job ID before awaiting anything; their refresh is pinned to
that task and applied only in the original view/session. This removes the prior
unqualified `refresh()` that could target the task currently open after completion.
The server remains authoritative for version, permission and cancellation checks.
Navigation does not cancel an already committed scope command.

Validation: 170 UI checks and 22 scope application/HTTP checks passed. New cases
cover all four command payloads, late success after navigation, uncertain outcomes
without automatic retries and old cleanup encountering a replacement operation.
A disposable browser harness using the real controller confirmed that delayed
analysis cannot overwrite a second conversation. Localhost serves the updated
module. No live user scope was changed; demo/staging/provider settings unchanged.
The full backend suite was not repeated for this UI-only continuation; the preceding
768-check run remains historical evidence. Remaining foreground controller families
include explicit brief editing, uploads, authentication and tool connection flows.

## Brief edits and task input uploads — 9 November 2026

The guarded controller now owns explicit brief edits and the buyer CSV input
upload. Each command captures the original task/version and submitted values.
After asynchronous file reading, upload rechecks the current account/view, File
object and usage notes before sending. Both commands discard late refreshes after
navigation and skip applying a refresh if the original form changed. No automatic
resubmission is introduced. Already submitted writes may commit on the original
task even when their UI response is discarded; this is not server cancellation.

These operations deliberately keep native forms mounted while pending and on
failure. That preserves File objects, notes, unsaved edits and inline error targets.
A successful unchanged edit closes its editor; a newer edit stays open. The existing
server scope/version, authorization, validation and idempotency checks are unchanged.
This covers the current buyer CSV attachment surface, not all supplier uploads,
file previews or future generalized upload controllers.

QA: 182 UI checks and 16 application/runtime HTTP checks passed. Browser checks
used an isolated native-form fixture and the actual controller: newer brief text
survived a delayed save; upload response after navigation retained the second task;
changed notes during File reading prevented another upload command. The browser
file chooser was unusually slow, but the selected fixture File passed the exact
identity check and reached the controlled upload. No user task was mutated.
Syntax/diff checks passed and localhost serves the updated handlers. Demo, staging
and provider configuration were untouched. Full backend checks were not repeated
for this UI-only increment; prior whole-suite results remain dated evidence.
