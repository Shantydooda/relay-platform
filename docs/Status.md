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
