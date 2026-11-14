# Current build and release status

Updated 12 November 2026. Dated entries below and in component documents are historical records and can describe older limitations.

## Current launch boundary — 12 November 2026

The separate free private-pilot application and database are provisioned. The
supplier SDK supports HTTPS. Private hosted storage and a supervised scanning
worker are implemented/tested locally but are not activated against the provider.
No invited buyer/builder identities have been selected. Hosted signup/email,
execution authorization and pilot-specific test payments still need acceptance.
The pilot server key is not available to the local storage setup yet. Do not
interpret the deployed landing page as a completed hosted delivery flow.

The next product milestone is one independent builder completing one real buyer
brief, including a revision, verified delivery and correctly reconciled test
payment. The first public paid release additionally requires provider acceptance,
independent review, support/dispute procedures and measured unit economics. More
marketplace features do not replace those gates. Hosting subscriptions, arbitrary
app hosting and other deferred items need not block a focused agent-work pilot.

## Next acceptance work

1. **Independent supplier:** connect a builder-owned API and verify qualification, quotes, mapping, permissions, delivery, revisions and failure recovery. Internal reference runtimes do not satisfy this gate.
2. **Stripe test payout:** funding/refund webhooks passed. The last provider record showed EUR 1 pending and no confirmed payout, with availability expected 12 November. Inspect current provider state and the existing recovery operation before retrying. Do not infer completion from elapsed time.
3. **Google Drive and Attio:** implementations and failure fixtures passed. Real consent/access/revocation and real destination delivery are not verified.
4. **Paid hosting:** the local interpreter executes bounded data pipelines in child processes. Subscription checkout is missing; fixture entitlements are not purchases. Arbitrary apps, public endpoints and OS/container isolation are not implemented.
5. **Hosted release rehearsal:** current managed-auth/database parity, migrations, secret handling, worker monitoring, alert delivery, backup restoration and rollback need acceptance in an explicitly authorized environment.
6. **Independent review:** security, payment flows, dispute/refund operations and release procedures require human review before real money.

## Verified foundations

- Durable task/offer/assignment flows; exact-offer approvals and access revocation.
- Capability qualification, storefront discovery, sharing permissions, repeat hire and attribution.
- File scanning/storage recovery, spending pagination and stable CSV snapshots.
- Local scheduled execution with explicit permissions and local unpaid multi-agent recovery.
- Test-mode Checkout/refunds and automatic signed-webhook reconciliation.
- Hosted local worker crash/timeout recovery, entitlement rechecks and retained saved downloads.

See [release acceptance](Release-Acceptance.md), [payments](Sandbox-Payments.md), [integrations](Delivery-Integrations.md) and [apps](Workspace-Apps.md) for precise evidence and limits.

## Evidence discipline

The 8 November consolidated run recorded 587 passing checks, no skips/cancellations and no source mutation. Landing changes followed and received targeted UI checks. Neither result substitutes for fresh checks on the GitHub review commit. CI status belongs to a commit, not to the product indefinitely.

Local GitHub CI has previously passed core, native recovery and load groups. Required branch protection could not be configured on the existing private-repository plan. Do not describe that control as enabled.

Keep the [icebox](Product-Icebox.md) deferred except for explicitly documented scope changes. Unit economics and production throughput remain unproven. No new live provider, paid service, hosted deployment or real-money transaction is authorized by this checklist.

## Recovery CI follow-up — 8 November 2026

The PR recovery job intermittently stalled while stopping its HTTP server during
an independent supplier reconnect. Phase diagnostics reproduced the failure in
CI: database recovery and delivery completed, but the HTTP close callback never
arrived. A separate successful run did not establish that the intermittent issue
was fixed.

The local launcher now stops accepting connections, grants active requests five
seconds, and closes remaining HTTP sockets. It separately waits for application
request promises and background workers before closing storage. This avoids
mistaking client disconnection for command completion. Socket shutdown follows
[Node's HTTP close guidance](https://nodejs.org/api/http.html#servercloseallconnections).

Recovery fixtures now use wall-clock polling deadlines, bounded child cleanup
that fails if forced termination is needed, and database restoration in cleanup
when an outage assertion fails. Regression tests cover incomplete headers,
normal response completion, commands surviving disconnection, already-signaled
children, unresponsive children and hung reads. Native recovery (37 checks) and
web contracts (130 checks) passed locally after the fix. Exact-commit CI remains
the release evidence; no deployment or real-money operation is part of this fix.

## Local audit follow-up — 9 November 2026

Fair offer exposure now reserves one of the first four eligible offer positions
for a currently qualified newcomer, with one rotation entry per operator. All
offers remain available; the buyer chooses. Capability badges and an all-source
builder funnel distinguish exposure/review/selection/accepted delivery from
paid work. See [walkthrough evidence](Fair-Exposure-QA.md). Eligibility and invitation
counts remain unmeasured; local qualification/history does not prove production
commercial performance.

The UI state-machine sequence continues with an explicit background refresh
lifecycle, preventing stale workspace/session results from replacing current
content. Next local controller scope: foreground chat/request state and navigation.
External supplier, real connector, payout and independent review acceptance gates
above remain open. No deployment or provider changes are implied by local tests.

## First independent builder preparation — 10 November 2026

See [pilot checklist](First-Builder-Pilot.md) for the existing implementation,
remaining connectivity/qualification/provider-mapping gates and end-to-end evidence.
The supplier diagnostic is now standalone instead of importing internal runtime
source. This prepares a source-only handoff; it does not constitute an independent
builder integration or enable remote access, hosted deployment or live money.

## Fresh consolidated verification — 10 November 2026

All 990 local release checks passed, including native recovery and both sustained
load profiles, with unchanged source during verification. Production dependency
audit: zero known vulnerabilities. See Release-Acceptance.md for the fingerprint,
Node 25 vs CI Node 24 caveat and prioritized external acceptance gates. No new
browser or independent supplier/provider acceptance is claimed.

## Hosted pilot preparation — 11 November 2026

Deployment is requested but not completed. The supplier SDK now supports explicit
HTTPS with normal TLS verification, no redirects and existing bounded/idempotent
retries. The old staging launcher is not the full unified backend and must not be
reused as a functioning buyer/builder pilot. Provider sign-in, managed composition,
explicit pilot execution policy, durable storage/scanning and email delivery gates
remain open. See Private-Hosted-Pilot.md. Existing environments are unchanged.

## Local recommendation recovery gate — 14 November 2026

Qualified supplier bids and explicit buyer selection now have native PostgreSQL
reconnect/concurrent-selection regression coverage. The same assessment evidence,
recommendation, winner and retry receipt survive application reconstruction with
new database pools; selection alone never starts or funds work. This uses a
separate disposable database and the real supplier SDK/local HTTP endpoints.
The full core suite passed 797 checks and frontend/shared UI passed 188 checks;
the new native check also passed. See Release-Acceptance.md for exact limits.

Next release work remains the independent supplier/API contract and actual buyer
brief, provider acceptance, and the separately authorized hosted rehearsal. Local
coverage does not close those external gates. No extra marketplace or enterprise
features are needed to claim progress against them.


## Conversation-first presentation — 14 November 2026

Read the supplied redesign brief and refactored the draft conversation rather than
adding another planning screen. Drafts now show a compact request proposal, a
Message Relay composer with a files/context shortcut, and optional custom planning
under Files & context → Advanced planning. Manual step inputs are outside the
message history. Scope review, offers, start authorization and permissions remain
separate server transitions; no generated price, performance or execution claim
is introduced. Historical known assistant-unavailable copy is presented as system
state rather than assistant speech; original stored messages remain unchanged.
Removed the client-generated canned conversation guidance. Failed/stopped replies
show a small notice outside the transcript with retry when configured.

QA: 797 core checks and 183 web + 8 shared UI checks passed. Added regressions for
known system notices versus user-authored text, closed advanced controls outside
the transcript, escaped unsent composer text and no invented offline reply or
authorization. Existing pending/clarification/hypothetical scope tests remain.
Authenticated localhost inspection verified draft review, return-to-composer focus,
files/context focus and advanced disclosure. Checked 390×844 layout and desktop,
light/dark appearance. Browser actions did not post or execute the user's task.
The current local draft has a failed assistant response; no successful live-model
conversation is claimed by this pass. Automated fixtures cover proposal and task
transitions; no new browser delivery or payment walkthrough was performed.

Remaining: automatic multi-agent planning is not implemented by this presentation
change. Arbitrary active-task instructions (pause/reassign/change price) must be
mapped to reviewed server commands before claiming full conversational control.
Model outage recovery and a successful model-backed user walkthrough remain needed.
Localhost stays running; pilot, demo, staging and payment settings unchanged.


### 2026-11-14 — Open conversation canvas (local)

Removed the outer rounded shell on buyer conversations, bounded only the 840px reading/composer column, and moved context access to a header action. Conversations now use document scrolling with a sticky composer; render updates preserve document position instead of a nested transcript scrollbar. Draft and posted-task commands are unchanged. Desktop and 390px long-thread layout fixtures verify no horizontal overflow or nested transcript scrolling. Authenticated localhost draft walkthrough passed: review stays inline, Keep chatting focuses the composer, header context controls open/close, and the sticky composer remains within desktop and 390px viewports. Found and removed an additional shared-token override forcing static composer positioning. No tasks were posted. No hosted deployment in this increment.
