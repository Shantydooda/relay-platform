# Spec: engagements and milestones (work at any scale)

Status: proposed, 16 Nov 2026. Implementation needs the approvals listed at the end. Governed by `docs/Product-Thesis.md` (principle 5: one model at every scale).

## Problem

Today one task = one quote = one upfront payment = one operator. That serves a 10-minute job and breaks above it:

- **Medium work** uses `orchestration.cjs`: 2–8 flat steps, local only, started from an empty draft, every step quoted and funded separately, USD only.
- **Large work** has no milestone funding (one upfront charge), no phases, no change orders across the project and no lead operator who answers for the whole.

Already fixed for scale: quotes and change requests share one range (`quote-limits.cjs`), and the execution window follows the agreed delivery time instead of a 24-hour cap.

## Model

```
Engagement   one agreed outcome, one buyer workspace, one accountable lead
 └─ Milestone   a reviewable result with its own price, money held, acceptance and payout
     └─ Work item   one assignment to one agent (today's task + assignment)
```

- **A one-off task is an engagement with one milestone and one work item.** Small and large work share one code path, one conversation and one ledger. No user ever sees an empty "plan" form.
- **Engagement**: `id, tenantId, ownerId, title, scopeVersion, leadOperatorId, currency, status, milestones[], changeOrders[]`. Agreement versions stay immutable (AGENTS.md).
- **Milestone**: `id, sequence, title, acceptanceCriteria, priceMinor, payoutMinor, feeMinor, dueAt, dependsOn[], status (planned → funded → in_progress → in_review → accepted | disputed | cancelled), workItemIds[]`.
- **Work item**: today's task record plus its `assignment`, with `engagementId` and `milestoneId` added. Pause, preflight, the outcome ledger and the activity log already work at this level and stay unchanged.

## Behaviour

1. **Decomposition belongs to Relay, approval to the buyer.** Relay proposes milestones in the conversation from the scope. The buyer approves, edits or asks questions in plain language. Small scopes produce one milestone silently.
2. **Money moves per milestone.** Each milestone is funded before it starts and released only on acceptance. Partial refunds apply per milestone; earlier accepted milestones are never re-opened by a later dispute.
3. **One accountable lead per engagement.** The lead operator answers to the buyer for every milestone. Other agents act as subcontractors: payouts are split per work item from the milestone's payout, and the split is recorded in the agreement.
4. **Change orders** are versioned at engagement level and re-price only the affected milestones that aren't accepted yet. They reuse the `proposeChange` / `reviewChange` flow and `quote-limits.cjs`.
5. **Recommendations depend on scale.** For one milestone, recommend an agent, as today. For several, recommend a plan: milestones, lead operator, total and per-milestone prices, with the per-milestone agents visible in the inspector.
6. **The outcome ledger** records each work item against its agent version. Milestone and engagement outcomes are reported separately and never inflate an agent's record.

## Migration path (no big-bang rewrite)

1. Add `engagementId`/`milestoneId` as optional fields; create a one-milestone engagement per new task. Existing tasks read as implicit single-milestone engagements, so no data migration is needed.
2. Move funding and payout from task level to milestone level behind the existing `payments.cjs` interfaces.
3. Retire `orchestration.cjs` plans by mapping each step to a milestone with one work item. Its local-only restriction lifts once milestone funding is qualified.
4. Then add model-proposed decomposition (needs the hosted assistant decision).

## Acceptance criteria

- A one-off task behaves exactly as today, with identical prices, funding and ledger.
- A three-milestone engagement funds, delivers and accepts milestone 1 while 2 and 3 stay unfunded. Cancelling milestone 3 refunds only milestone 3.
- A change order to milestone 2 doesn't alter milestone 1's accepted agreement or payout.
- Every money amount reconciles: price = payout + fee per milestone, and the engagement total = the sum of its milestones (`quoteBreakdown`).
- Retries, stale versions and competing requests on funding and acceptance fail closed (AGENTS.md).

## Approvals needed before building

- **Fee model** (see `docs/Decisions-Needed.md`): milestone price, payout and fee fields depend on it.
- **Guarantee policy:** what Relay owes the buyer when a milestone fails (refund only, rerun plus refund, or a stated service level).
- **Payment changes** need independent human review before any real-money use (AGENTS.md).
