# Relay product thesis

Agreed 16 Nov 2026. This document governs product and business decisions. Where the PRD, UI copy or code disagrees with it, the thesis wins and the other document gets updated.

## One sentence

Relay is the trusted hub for AI agents: builders publish agents and earn a verified reputation, and anyone can describe an outcome and have Relay deliver it with those agents, at any scale.

## The moat: a trustable community, as on Hugging Face

Hugging Face's moat isn't a marketplace or a services business. It is a free, public hub where builders publish, get credit and build a reputation, and where the community generates trust in the open. Revenue comes from services *around* the hub (compute, private enterprise hubs, support), not from taxing exchanges between members.

Relay copies that structure with one difference. Agents act, so trust can't come from downloads or likes. It has to come from **verified behaviour on real work**: did the agent deliver, how often did it fail, what happened when it did. That evidence only exists if real work runs through Relay. So Relay needs a working transaction layer to produce its trust signal, and that is what makes the trust hard to copy.

## Three layers

| Layer | What it is | Role |
| --- | --- | --- |
| **1. Hub** (free, public) | Agent cards (capabilities, inputs/outputs, required permissions, versions, operator identity). A per-version outcome ledger verified by Relay. Open evaluations on public task suites. Discussion per agent. Free to publish. | The moat: where builders publish first and where trust is visible. |
| **2. Transactions** (pay per outcome) | Hire an agent directly. Scoped agreement, money held per milestone, review before release. | Revenue, and the source of the verified outcomes that feed the hub. |
| **3. Managed outcomes** (premium conversation) | Describe a result. Relay builds the plan, picks agents using ledger evidence, orchestrates, and stands behind the result. | The default buyer experience; margin and retainers. |

The conversation is Layer 3. The Agents browse view and the agent inspector are the start of Layer 1.

## Principles

1. **Reputation belongs to the builder and is public.** Managed delivery hides the *choice* from the buyer, never the builder's credit. Every delivery is recorded against the agent version that did it.
2. **Trust signals are verified, never self-reported.** Show counts with their sample size and time window ("12 runs · 10 accepted first time · 1 revised · 1 failed · last 90 days"). Show a percentage only when the sample supports it. Never invent success rates, compliance claims or operator details.
3. **No pay-to-rank.** Ranking and "featured" status can't be bought. Paid verification may buy an *evaluation*, never a result.
4. **Don't charge for the community's core loop.** Publishing, discovery and reputation are free. Charge for compute, control, privacy and accountability.
5. **One model at every scale.** Engagement → milestones → work items. A one-off task is an engagement with one milestone. Funding, release, change orders and accountability work the same way at every size.
6. **Relay absorbs the error rate in managed work.** Reruns, swapping to a backup agent and refunds are Relay's job, not the buyer's. Human intervention is a cost to automate away, not a feature to sell.
7. **Seed one category deeply before going wide.** Hugging Face became the default for NLP models first.

## Revenue (most recurring first)

1. **Managed recurring workflows.** A subscription per running workflow: monitoring, alerts, one-click pause, approvals for actions that touch money or customers, reruns with a backup agent, an outcome guarantee.
2. **Hosted runtime and observability for builders.** Usage-based: hosting, run logs, failure traces, evaluation runs.
3. **Private enterprise hubs.** Approved company agents, policy, single sign-on, audit, spend controls. Annual contracts.
4. **Verification.** Paid evaluation runs; badges are earned by results, not purchased.
5. **Transaction fees and managed margin.** A modest fee on direct hires (Layer 2) and a margin between price and builder cost on managed outcomes (Layer 3). This replaces the single 20% assumption and today's 0%.

## Kill risks and tests

| Risk | Test before scaling |
| --- | --- |
| Community moats take years and need a tailwind | Do builders publish for verified reputation plus paid work? Target: 20 builders in the seed category, sourced without paid acquisition. |
| Builders already publish on GitHub, MCP directories and vendor stores | Does a public outcome ledger change their sales conversations? Interview the first 10 published builders. |
| Buyers won't pay for certainty | Quote a guaranteed managed outcome next to a direct hire in pilot conversations and compare uptake. |
| The ledger stays at small numbers | Seed it with shadow runs on real, buyer-sampled inputs, not fixtures. |
| Managed delivery turns Relay into an agency | Track human minutes per managed outcome; it must fall release over release. |
| Control features don't change delegation | Run the activity log, pause and approvals with 5 pilot buyers before building alerts. |

## Open decisions

1. The seed category: a job buyers already pay people for, with checkable output, ideally recurring.
2. How far Relay stands behind managed results: refund only, rerun plus refund, or a stated service level.
3. Fee levels for Layer 2 and the margin policy for Layer 3, and whether buyers see an all-in price.

## Build sequence

1. **Public outcome ledger per agent version.** The hub's trust currency, and the data behind recommendations. Thesis-independent; no open decision blocks it.
2. Fee model (after open decision 3).
3. Checks that a job's connections work before it runs, and "connection broken" alerts that pause recurring work.
4. One-click pause on running work; approval policy by action class.
5. Workspace activity view.
6. Managed recurring workflows and subscription pricing.
7. Engagement → milestone model with funding per milestone (large projects).
8. Public agent-card spec plus an SDK/MCP endpoint, so Relay agents can be called from anywhere.
