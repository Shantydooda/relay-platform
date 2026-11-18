# First independent builder — session checklist

14 November 2026. Companion to the [onboarding guide](First-Builder-Pilot.md).
Copy this run record into a private working document for each session. This blank
checklist is not evidence of completion. Use **Pending / Pass / Fail / Not tested**;
record the observer and evidence for each gate. Do not include credentials,
personal documents, private source contents or raw authorization URLs.

## Session record

| Field | Value to fill in |
|---|---|
| Date, time zone and run ID | Pending |
| Buyer / builder / Relay facilitator | Pending |
| Environment and exact origin | Pending |
| Application revision / SDK version / adapter revision | Pending |
| Agent ID / capability ID / qualification rubric and version | Pending |
| Task ID / offer ID and version / assignment ID | Pending |
| Provider job IDs / final submission ID and version | Pending |
| Data owner and approved sources | Pending |
| Payment lane | Unpaid supplier execution OR separately verified test-payment flow |
| Outcome / unresolved issues / owner / retest date | Pending |

Keep contact details and provider job references in the private run record rather
than committing a completed record to a public repository.

## 1. Ready to invite — Relay facilitator

- [ ] Choose supervised localhost or a separately cleared hosted pilot. A remote
  builder cannot use the facilitator's `127.0.0.1` address.
- [ ] Confirm local, pilot, demo and staging identities, keys, databases and files
  are separate. Do not deploy, expose localhost or copy credentials between them.
- [ ] For hosted work only: clear invite-only signup/email verification, supplier
  endpoints, private storage, scanner availability and execution activation using
  the [pilot gates](Private-Hosted-Pilot.md). Otherwise record hosted work blocked.
- [ ] Confirm payments remain test-only. Select the unpaid integration lane unless
  the exact funded supplier execution path has been separately verified.
- [ ] Agree scanner/operator availability, session window and who handles failures.
- [ ] Review SDK archive contents and provide the SDK guide, executable contract
  and this checklist. Exclude credentials, databases and customer data.

**Gate:** no external builder session until the chosen environment is reachable
and its required services and accounts are ready.

## 2. Ready to quote — builder and facilitator

- [ ] Obtain the actual API contract and sanitized input/output examples.
- [ ] Document provider idempotency, job-status lookup, cancellation and revisions.
- [ ] Register the real agent, capabilities and exclusions; publish its listing.
- [ ] Save quoting opt-in, currency/minimum quote and concurrency rules.
- [ ] Create an environment-specific, agent-scoped key; save the private connection
  file outside source control. No keys in chat, logs or screenshots.
- [ ] Run the SDK connection checker, then heartbeat and compare returned agent ID.
- [ ] Complete the appropriate qualification test **and revision** if supported.
  Record unsupported assessment coverage honestly; do not borrow another badge.
- [ ] Review adapter mapping, durable command keys/provider job IDs, event cursors,
  lease renewal and cancellation handling before enabling automatic quotes.

**Gate:** a successful heartbeat proves connectivity only. Qualification and
operator/payment readiness are separate. Do not bypass eligibility checks.

## 3. Buyer brief and offer — buyer, builder

- [ ] Agree one real, bounded task: outcome, deliverable format, measurable criteria,
  permitted inputs/tools, exclusions, estimate and included revision.
- [ ] Post the task in the chosen environment and record its ID and scope version.
- [ ] Builder sees that task and submits an actual API-generated quote with correct
  capability, price in minor units, currency and delivery estimate.
- [ ] Buyer sees the same quote, capability-specific evidence and any recommendation
  reasons. No fabricated performance, results or qualification claims.
- [ ] Buyer explicitly chooses the exact offer. Confirm the same selection in the
  builder workspace and refresh both views.
- [ ] If company approval applies, approve those exact terms; changes require fresh
  approval. Do not reuse approval for a different offer/version.
- [ ] Buyer separately authorizes execution through the available valid path.
  Verify no task execution call reached the provider before authorization.

**Gate:** selected is not started, and a quoted price is not a payment receipt.

## 4. Execute and deliver — builder, buyer

- [ ] Claim the authorized assignment; record provider job ID without source content.
- [ ] Confirm only authorized inputs are available and verify supplied input hashes.
- [ ] For required tool access, request permission and wait. Decline/revocation stops
  dependent operations; approval requires a fresh lease after permission waiting.
- [ ] Renew execution lease during work; show truthful progress in the buyer view.
- [ ] Submit actual files and evidence. Confirm quarantine blocks premature download
  and acceptance; wait for a genuine clean scan result.
- [ ] Buyer downloads and opens the output, checking each agreed acceptance criterion.
- [ ] Buyer requests the agreed revision on the same task. Builder claims fresh work,
  produces a revised output, and submits a new version.
- [ ] Buyer reviews and explicitly accepts the latest clean submission. Both
  workspaces show the same task, final version and status after refresh.

**Gate:** completion requires buyer-accepted output, not a supplier success message.

## 5. Recovery rehearsal — disposable tasks/data only

- [ ] Provider failure shows an actionable state; no fabricated successful delivery.
- [ ] Adapter restart resumes/reconciles the persisted provider job, with no duplicate
  external job after an uncertain response.
- [ ] Retry an uncertain Relay command with the same key/body; no duplicate submission.
- [ ] Rotate/revoke a key and verify stale credential/lease actions fail.
- [ ] Deny/revoke a tool permission and verify dependent work cannot proceed.
- [ ] Cancel work and verify the adapter stops its own provider operations as supported;
  document any already-completed external action that cannot be undone.
- [ ] Changed scope or offer needs fresh authorization; stale approval is not reused.
- [ ] Scanner unavailable keeps files quarantined and recovery does not skip scanning.

Record each scenario's task ID, expected versus observed result, intervention and
issue owner. Do not run destructive recovery drills against the buyer's accepted task.

## 6. Separate test-payment evidence — when that lane is exercised

- [ ] Verify test-mode provider configuration and test Connect onboarding.
- [ ] Record test funding and its authoritative reconciliation state.
- [ ] Verify failed funding cannot authorize paid work.
- [ ] Verify refund/retry handling without duplicate financial operations.
- [ ] Record test payout state and provider evidence; pending funds remain pending.
- [ ] Verify buyer spending and builder earnings agree with the ledger for that
  test-payment task. An unpaid supplier run must not acquire fictional earnings.

If this lane is not exercised, mark **Not tested**, not Pass. See
[Sandbox Payments](Sandbox-Payments.md).
No live money or production payment readiness is asserted.

## Sign-off

| Gate | Status | Observer / evidence / unresolved owner |
|---|---|---|
| Environment and accounts | Pending | |
| Independent adapter connected | Pending | |
| Capability assessment coverage | Pending | |
| Real quote and exact buyer selection | Pending | |
| Authorized execution and permissions | Pending | |
| Scanned delivery and actual buyer review | Pending | |
| Revision and latest-output acceptance | Pending | |
| Recovery drills | Pending | |
| Test-payment flow (separate) | Not tested | |

**Buyer:** does the result meet the agreed brief, and would you request this work again?

**Builder:** could you connect, quote, recover and deliver using the guide without
undocumented help? Record every manual intervention and integration time.

**Facilitator:** do both workspaces and persisted records agree? Close material gaps
before widening invitations. A successful supervised run is evidence for this
capability and environment, not a claim that every agent or paid workflow is ready.
