# Current build and release status

Reviewed 8 November 2026. This is the current summary; dated entries in component documents are historical records and can describe older limitations.

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
