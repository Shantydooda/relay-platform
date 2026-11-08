# Relay v1 release acceptance

Current gate checklist — 6 November 2026. Localhost only; demo and staging remain
separate. Stripe sandbox activity is test money only. Icebox scope is deferred.
This is engineering self-review, not independent release approval.

## Repeatable cross-role acceptance

Use a disposable database and registered fixture identities. Never seed fake
financial or qualification evidence into a user's workspace. Record the source
fingerprint, fixture environment and whether each result was browser-observed or
automatically tested. Browser rehearsal does not replace native PostgreSQL tests.

| Role | Acceptance criteria |
| --- | --- |
| Buyer | Conversation remains a draft until confirmation; post once, compare fresh offers, accept one, authorize execution, download evidence, request a revision and accept the resulting submission. Reload preserves the same task. |
| Employee | Company identity is visible; decline can be revised and resubmitted on the same task. Execution requires current budget approval. |
| Approver | Review the exact offer, amount and scope; reserve budget once. Changed offers or revoked/demoted approvers invalidate old approval; re-promotion does not revive it. |
| Builder | Register an existing API, qualify the relevant capability, configure quoting rules, receive the assignment, submit evidence and handle revisions. Buyer acceptance and payout state agree across workspaces. |
| Recovery | Failed funding cannot start paid work; retries are idempotent. Refunds and payouts show provider-confirmed status, never optimistic success. Revoked access stops active commands and clears protected UI. |
| Interaction | Keyboard focus, narrow viewport, loading/error states, date filters and exports remain usable. Export totals agree exactly with the selected report snapshot. |

Prior observed rehearsal and regression evidence is in
[Cross-role rehearsal](Cross-Role-Rehearsal.md). Re-run relevant scenarios after
changes; do not mark an older browser result as fresh QA.

## Consolidated source gate

Run `npm run verify:local` after freezing source edits. Require every stage to pass,
no cancelled/skipped tests, and `sourceChanged: false`. Preserve the private
`.poc-data/release-checks/<run-id>/report.json` and record its fingerprint.
The runner covers backend, web, native PostgreSQL and sustained load checks.
A passing report explicitly does not establish production readiness.

## Remaining external release gates

1. Independently operated builder: real input mapping, quotes, delivery, revisions,
   permission requests, timeouts and retries using that builder's runtime.
2. Stripe sandbox: finish the actual payout when funds are available; confirm the
   payout webhook, reconciliation and ledger. Funding/refund evidence is separate.
3. Google OAuth: real consent, selected-file access and revocation with configured
   credentials; fixture coverage does not prove provider integration.
4. Hosted parity: managed auth/database, migrations, backup restore, worker health,
   secrets and recovery validated in an explicitly authorized environment.
5. Independent human security/payment/operational review before real-money release.

## Optimization policy

Measure before changing architecture. Prioritize bounded provider responses,
query pagination, stable exports, queue fairness and reliable recovery. No new
marketplace surface or orchestration expansion is needed for this acceptance pass.

## Evidence recorded after the source freeze

Consolidated run `294af5cf-0d90-4edf-9a48-4a150fc4c8e3` passed on 6 November:
404 backend + 124 web + 36 native PostgreSQL + 2 sustained load checks = **566**.
Zero failures, skips or cancellations; `sourceChanged: false`.
Fingerprint: `1f1fd165d5dd3037a68f4b24cad3e689973e3f5ff55cb225088b78bcc0a403bb`.
This evidence paragraph was added afterward; no application code changed afterward.

Fresh browser spot checks used disposable SQLite fixtures on port 4185, separate
from the native PostgreSQL app on 4180. Identities, qualified agents, initial
quotes and the initial declined request were prepared through normal application
commands. These setup steps were not manually repeated in the browser.

Browser-observed: employee resubmitted the same declined task with clarification;
approver saw the prior decline and exact offer, then reserved $1 ($99 available).
The employee saw the new approval. Execution while the fixture runtime was offline
was rejected; after reconnecting it, browser authorization started real CSV
normalization. The delivery preview contained the header and sorted unique A/B
rows. Acceptance survived reload and the builder saw the identical accepted
submission. Personal buyer spending and builder payouts remained $0 for unpaid
runs. No browser console errors were recorded. Approval layout had no horizontal
overflow at 390px; this is not a complete mobile/accessibility certification.

Fresh exhaustive keyboard coverage, real-provider payout completion and the
external gates above remain open. Previous fuller role walkthroughs are retained
in Cross-Role-Rehearsal; they are not relabeled as fresh results. No application
code changes were justified by this spot check.

## Mobile and keyboard rehearsal — 6 November 2026

Disposable localhost 4185 fixtures; no Stripe requests or hosted changes. Browser
checks used 390×844 and 320×740 viewports, plus 1280×900 keyboard navigation.
Both light and dark appearance were observed. This is browser viewport emulation,
not physical-device or screen-reader certification.

Fixed demonstrated issues:
- Route changes now close mobile navigation and focus the main region. Background
  refreshes do not apply this focus change. Interactive focus rings remain visible.
- Offer confirmation focuses the matching confirmation button; dismissing returns
  to the same offer. Acceptance focuses the updated task content.
- Builder stage labels no longer overflow at 320px. Setup grid children can shrink,
  keeping the acquisition table's horizontal scrolling inside its own panel.
- Mobile spending filters use aligned grid fields and 44px controls.

Browser-observed: Enter login/logout; menu and route activation; sequential Tab
from main content; task list and delivery preview; Shift+Enter multiline drafts;
category filtering with focus retention and search empty state; two-offer comparison,
review/dismiss/selection; invalid date alert focus and reset; CSV download; builder
profile draft/type/capability transition, existing connection and assessment screens,
delivery and earnings; company approval history and released reservation.
No page-level horizontal overflow remained on the inspected narrow screens, and
no console errors were recorded. The downloaded unpaid fixture report contained
one TASK row and a matching all-zero TOTAL row. Nonzero accounting scenarios remain
covered by the automated report tests, not this zero-value browser fixture.

The setup/qualification and initial offers were fixture-prepared through normal
application commands. This pass did not repeat live provider onboarding or execute
real-money payments. Physical mobile keyboard behavior, screen-reader testing and
independent accessibility review are not claimed complete.

Final frozen-source verification for this increment:
`a57e146f-0957-4850-a1ae-5ca796a4c5eb`, fingerprint
`3f8ee8e905a04a981795e142d25e55e3ec9a4acf77d4f9ca189a34a3a8d8931d`.
**568 checks passed** (404 backend, 126 web, 36 native PostgreSQL, 2 load),
zero failures/skips/cancellations and `sourceChanged: false`. This evidence entry
was added after verification; application source was not changed afterward.
The earlier in-progress run overlapping the offer-focus fix is superseded.

## Integration failure review and full verification — 7 November 2026

Fixed Attio response-stream failures escaping the connector as raw errors after response headers. Interrupted bodies now return a redacted `ATTIO_UNAVAILABLE` error; failed response cleanup cannot replace the intended provider-rejection error. No UI or provider contract changed.

Added local fixtures for Attio 401/403/429/500/503 responses, network and body interruption, malformed/missing confirmation, plus Drive provider rejection and stream interruption with concurrency-slot recovery. Application tests on SQLite and PGlite verify the five-attempt limit, no provider call after exhaustion, preserved confirmed rows, and that reopening a review does not reset the retry budget.

Final `verify:local` run `ea64b28d-6853-4c0e-9684-1a146b9d1332`: **579 checks passed** (412 backend, 128 web, 37 native PostgreSQL, 2 sustained-load checks). Zero failures, skips or cancellations; `sourceChanged: false`. Fingerprint: `0bb7da24f83f6d140c1287f63f1508992e7efc3bcd00f4e454a7baa6c5e3a82b`. Documentation was appended afterward. An earlier run interrupted before formatting was superseded by this final run.

This pass used automated local fixtures; the prior delivery-recovery browser walkthrough was not repeated or relabeled as new browser evidence. No real Google/Attio traffic, real-money actions, demo deployment or staging changes. Live provider acceptance, independent supplier acceptance and independent release review remain open.
