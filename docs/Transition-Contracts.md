# Consequential transition contracts

These tables describe the existing application commands. They are behavioral specifications, not a second transition engine. Guards, access checks, writes, receipts and supplier events stay inside the authoritative application transaction. Provider operations retain their durable operation IDs and reconciliation boundaries.

## Execution: generated command matrix

`services/application/test/execution-transitions.test.cjs` exercises every combination of the six states and eight commands below, against SQLite and PostgreSQL-compatible PGlite fixtures. States are reached through real registration, quote, selection, authorization and execution commands; no assignment state is directly patched into the database.

| Current assignment | Allowed commands → resulting state |
| --- | --- |
| queued | claim → running; cancel → cancelled |
| running | progress → running; submit → buyer_review; fail → failed; cancel → cancelled |
| buyer_review | accept → accepted; revise → queued; cancel → cancelled |
| accepted | None of these commands |
| failed | retry → queued, subject to recovery eligibility |
| cancelled | None of these commands |

Every unlisted combination must fail without modifying the task, version, submissions, audit history or supplier event feed. The fixtures supply valid payloads, current versions and owned leases, so rejection is attributable to lifecycle state. Allowed transitions must agree in persisted assignment, buyer task/execution and supplier views.

Additional guards remain essential:

- Claim requires a matching assignment, usable credential, available capacity and execution window. An unexpired running lease rejects a competing claim; an expired lease can be reclaimed subject to attempt limits. A permission-paused queued assignment rejects claims.
- Progress, failure and submission require the current credential-bound lease. Replaying an old successful claim must not resurrect a lease after delivery, revision, cancellation or replacement.
- Buyer commands require current access and record version. Delivery acceptance additionally requires the latest ready submission and available, verified/scanned bytes.
- Retry is limited to eligible local unpaid failures, fresh runtime connection, remaining recovery allowance, no existing submissions and current company approval. It preserves monotonically increasing attempts.
- Revisions return to queued and require a fresh claim. They do not grant broader tool access or alter the commercial agreement through message text.

The sequence tests cover competing claims, an idempotent winning-claim replay, stale claim/submission after revision, fresh lease acquisition, and cancellation racing submission in both launch orders. One command commits against the original task version; the loser cannot overwrite it. Existing permission, credential, scan, recovery and scope-change suites cover the additional guards.

## Approval and reservation: generated command matrix

| Event | Required boundary | Result |
| --- | --- | --- |
| Request / resubmit | Current selected agreement, requester access and version | New pending approval for the current agreement |
| Approve | Current approver authority, approval identity/version, valid agreement, available budget | Approved agreement and reservation |
| Decline | Current approver authority and pending request | Declined request; no reusable approval |
| Change offer/scope or invalidate authority | Exact agreement/authority binding no longer matches | Previous approval cannot authorize the changed work |
| Start funding/execution | Recheck current approval and authority | Reservation committed under the existing budget rules |
| Expiry/refund/termination | Reconcile allocation against current task/payment state | Release where applicable; do not silently approve another agreement |

Existing coverage: `approvals.test.cjs`, `access-boundary.test.cjs`, `task-changes.test.cjs`, `orchestration.test.cjs`. These include decline/resubmit, competing approvals, budget exhaustion, revoked authority, changed offers and expiry. `approval-transitions.test.cjs` now exercises seven conditions (required, pending, declined, approved, changed-offer stale, expired and funding committed) against request, approve, decline and fund on both adapters. Rejected commands preserve the entire task, approval queue, budget and provider mutation calls. Successful commands check the selected offer, exact minor-unit amount, reservation/commitment and remaining allowance.

Sequence coverage races approval commands, replays the winning receipt without reserving twice, changes the selected offer, rejects the old approval identity, and requires a fresh request and decision before funding the replacement offer. Initial actors and quoted offers are fixtures; approval states are reached through application commands. Existing access tests continue to cover revocation and authority epochs.

## Payments: generated command matrix

| Event | Required boundary | Result |
| --- | --- | --- |
| Fund | Current selected offer, approval, operator readiness, no conflicting settlement | Durable checkout operation; not yet confirmed funds |
| Funding reconciliation | Provider identity, amount/currency and operation match | Funded or another verified checkout outcome |
| Refund | Eligible funded work; no conflicting transfer | Durable refund operation, then pending/failed/refunded provider outcome |
| Transfer | Accepted latest delivery matches the funded assignment | Transfer operation and confirmed transferred state |
| Payout | Confirmed transfer and eligible operator | Payout operation, then pending/failed/paid provider outcome |
| Retry / webhook | Durable identity, bounded retry and authoritative reconciliation | Resume/reconcile the same operation or require review |

Existing coverage: `payments.test.cjs`, `payment-reconciliation.test.cjs`, `payment-recovery.test.cjs`. These cover lost responses, duplicate events, restarts, refund/transfer exclusion and late provider responses. `payment-transitions.test.cjs` now tests 16 conditions against fund, refund, transfer, payout and reconcile on both adapters. Conditions include no settlement; all four creating/uncertain states; awaiting payment; expired; funded before and after accepted delivery; pending/failed/completed refunds; transferred; and pending/failed/completed payouts. Accepted delivery is an explicit prerequisite fixture, not a claim of execution coverage in this suite. Payment states themselves are reached through commands and provider responses, including thrown responses for uncertain operations.

Rejected commands must preserve the task, reconciliation job and provider mutation calls. Success checks buyer/operator payment projections, exact minor-unit amounts, ledger counts and unique references. Re-funding an eligible expired/refunded settlement preserves its archived ledger. Concurrent commands with different keys and the same starting version create one durable financial operation. Failed provider outcomes require recovery review rather than an ordinary new payment command. Existing recovery and webhook suites still cover recovery actions, replay windows, provider validation and late responses; these fixtures are not real Stripe evidence.

## Acceptance and environment boundary

The execution increment must pass the generated matrix and sequence cases on both adapters, plus the full backend and web suites. It introduces no new stored states, migration, API field or runtime dependency. Tests use disposable databases and no provider calls. PGlite coverage is not a claim of a new native PostgreSQL load or crash-recovery rehearsal. Authenticated browser evidence is recorded separately; a signed-out landing page is not workflow QA.

### Local verification, 8 November 2026

- New execution matrix/sequences: 102 checks passed across both adapters.
- Full backend run: 530 of 531 passed. The sole failure was the existing real-child recovery test's 250 ms deadline timing out its healthy retry under load. The test now uses the unchanged production worker deadline; its complete three-test file passed on rerun. The whole backend suite was not repeated after this test-only adjustment.
- Web/shared UI: 124 + 7 checks passed.
- Diff whitespace validation passed. Self-review checked transaction boundaries, fixture isolation, rejected-command immutability, supplier event consistency and absence of production behavior changes.
- Localhost browser is available but signed out. A login request is pending; authenticated permission-wait/browser flow QA remains unverified. No demo/staging changes or provider operations were made.

### Authenticated browser follow-up

After the user signed in, their localhost account was confirmed accessible. It had only two posted tasks awaiting offers, so the permission lifecycle was exercised against the current code on a separate localhost:4198 server with in-memory databases, fictional source records, separate buyer/supplier identities and no payment provider. The user's localhost:4180 records were not seeded or changed.

Observed in the browser: the paused task appears under Needs you; declining access preserves the pause after refresh; the builder sees Permission needed and one permission-waiting task rather than an executable queued task. Approving read access to the fictional source resumes the same assignment. The fixture runtime reads the approved source and produces a real 31-byte text file; its preview contains the expected fictional company names. Buyer acceptance appears on the same task in the builder workspace, with no earnings or payout from this unpaid run.

Two UI gaps were fixed: active permission decisions were hidden inside Context & details, and the builder queue incorrectly described permission waiting as needing a restart. Current-assignment decisions now render directly in chat. Historical or completed requests remain read-only, without duplicate decision forms. Builder guidance says Waiting for the buyer's decision. Server authorization is unchanged.

The web/shared UI suite passed 124 + 7 checks, including permission rendering, escaping, owner-only controls, terminal state and replacement-assignment suppression. This closes the desktop permission-to-delivery browser walkthrough; it is not a mobile, real-provider or arbitrary-agent acceptance claim.

### Approval/payment matrix increment

- Targeted matrix and concurrency run: 224 checks passed (56 approval combinations, 160 payment combinations, plus parent/sequence checks), across SQLite and PostgreSQL-compatible PGlite.
- The shared disposable fixture database uses unique provider references for each operation; settlement uniqueness protections stay enabled. No payment/approval production policy was changed.
- This increment changes tests and documentation only. Existing UI behavior is unchanged, so it does not add new browser acceptance evidence. Native PostgreSQL, live provider behavior and independent human review remain separate release checks.

- Final full backend run: **755/755 passed**, with no failures or skips (approximately 271 seconds). This supersedes the earlier partial full-suite result above.
- Web/shared UI run: **124 + 7 passed**. `git diff --check` passed. Existing localhost:4180 returned HTTP 200. Demo, staging and provider configuration were unchanged.
- Self-review covered independent expected outcomes, negative-command immutability, exact ledger amounts, approval identities, reservation release/commitment, concurrent version checks and test-only provider isolation.

## Server-defined action availability

Buyer task detail now includes an additive `actions` snapshot:

```json
{
  "version": 12,
  "payments": {
    "fund": {"allowed": false, "code": "APPROVAL_REQUIRED", "reason": "Request company approval for this exact offer before starting or funding work."}
  },
  "approvals": {
    "request": {"allowed": true, "code": null, "reason": null}
  }
}
```

Payment keys are `fund`, `refund`, `transfer` and `payout`; approval keys are `request`, `approve` and `decline`. Supplier work records include their own actor-specific payment actions. Company approval queue records include approval actions bound to that request identity; superseded records cannot inherit eligibility from their replacement.

These are advisory, current-access checks, not capabilities or authorization tokens. `version` is the task snapshot version. Clients still submit the existing version, approval identity, valid input and idempotency key. Commands recheck the shared guards under their write transaction. Responses can become stale as access, reservations, operator readiness, offers or payment state changes. Provider funding-support checks remain in the command; reading availability does not contact a provider or guarantee provider success.

The same extracted guards serve reads and commands. Availability performs no state writes or provider operations, preserves existing error codes, and returns user-facing reasons. Unexpected errors still fail the read rather than being disguised as permission denials. Funding approval checks use a copy of the task so the existing company flag normalization cannot mutate the read snapshot.

The UI fails closed if guidance is absent. Relevant blocked financial controls are disabled with an adjacent explanation. Approval requests explain their blocker; the reviewer can choose decline when budget prevents approval. Checkout, reconciliation, execution, scheduling and other action families retain their existing guards and are not claimed as migrated by this increment.

### Availability verification

- Approval/payment matrices now assert eligibility/command parity, including negative codes and read immutability. Targeted parity run: 224 checks passed on both adapters.
- New tests cover expired operator readiness between viewing and clicking, disconnected providers, foreign task access, unexpected read errors, missing guidance, reason escaping and supplier-specific UI state.
- Desktop browser QA used a separate in-memory localhost:4198 fixture with actual application-derived availability and production rendering modules. Observed blocked buyer funding with its explanation; insufficient-budget approval disabled while decline remains selected and available. This is rendering QA, not an authenticated end-to-end payment run or mobile certification.

- Final full backend run: **758/758 passed**, no failures or skips. An earlier run had one browser-fixture/Attio-test port collision; the temporary fixture was stopped and the complete suite rerun successfully.
- Web/shared UI: **127 + 7 passed**. Diff whitespace check passed. The existing localhost server was gracefully reloaded through its unchanged launcher and returned HTTP 200.
- Demo and staging were not modified. All new qualification of financial behavior used in-memory provider doubles; no new real-provider payment acceptance is claimed. Existing localhost provider configuration was preserved.


### Execution and scheduling availability

Buyer detail now also exposes `actions.execution` with `startLocal`, `startFunded`, `accept`, `revise`, `cancel` and `retry`, and `actions.scheduling.create`. Schedule list records expose `actions.pause` and `actions.resume`. All use the same `{ allowed, code, reason }` shape. Execution queue records expose lifecycle actions; legacy `canRetry` now derives from the authoritative retry guard rather than a status-only approximation.

These projections share command guards for runtime freshness, current agreements/approval, funding, input integrity, delivery integrity, revision limits and schedule ownership. Reads do not authorize work or contact a provider. Acceptance eligibility checks the stored deliverable bytes just as acceptance does. Reads clone tasks before approval normalization. Commands still revalidate under their transaction, including versions, submission identities and idempotency keys.

Schedule creation availability checks the source request prerequisites. Calendar values, budget limits and explicit consent still require command validation; `allowed: true` does not validate an unsubmitted form. Revision/cancellation/retry text is likewise validated on submission. Schedule resume checks the owner's current access epoch. Existing pause/resume replay semantics are preserved.

Relevant UI controls fail closed when guidance is missing and show the server's reason. Failed executions retain a recovery explanation even when retry is blocked. No new permission, paid execution mode, or scheduling policy is introduced.

Verification: execution transition parity and recurring regression checks passed 111/111. Six additional SQLite/PGlite fixture checks cover stale runtime readiness, access changes, stale schedule versions, corrupt delivery bytes, foreign access and read immutability. Desktop rendering QA used an ephemeral localhost fixture with actual application-derived metadata and production UI modules: retry was disabled with a reconnect explanation and resume was disabled after an owner access change. This was not an authenticated end-to-end or mobile run. Provider configuration, demo and staging were unchanged.

The full run exposed an older/manual offer without an agent reference: availability attempted an invalid database lookup. The shared start guard now treats that as `RUNTIME_REQUIRED`; the task remains readable. All five access-revocation/replay regression tests passed after the fix, with an explicit missing-runtime assertion. Web/shared checks passed 128 + 7. Localhost was gracefully reloaded and returned HTTP 200.

Final execution/scheduling regression rerun: **764/764 passed**, no failures or skips (approximately 373 seconds). This supersedes the initial run with five missing-runtime-reference failures. Diff whitespace review passed.
