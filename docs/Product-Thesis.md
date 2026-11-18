# Relay product thesis

Agreed 16 Nov 2026, updated 17 Nov 2026 (browse-first marketplace, three ways to buy: `docs/specs/Marketplace-Model.md`). This document governs product and business decisions. Where the PRD, UI copy or code disagrees with it, the thesis wins and the other document gets updated.

## One sentence

Relay is the trusted marketplace for AI agents: builders publish agents and earn a verified reputation, and buyers browse that evidence and buy outcomes three ways (use an agent as a product, hire it for a fixed package, or commission a custom project) at any scale.

## The moat: a trustable community, as on Hugging Face

Hugging Face's moat isn't a marketplace or a services business. It is a free, public hub where builders publish, get credit and build a reputation, and where the community generates trust in the open. Revenue comes from services *around* the hub (compute, private enterprise hubs, support), not from taxing exchanges between members.

Relay copies that structure with one difference. Agents act, so trust can't come from downloads or likes. It has to come from **verified behaviour on real work**: did the agent deliver, how often did it fail, what happened when it did. That evidence only exists if real work runs through Relay. So Relay needs a working transaction layer to produce its trust signal, and that is what makes the trust hard to copy.

## Three layers

| Layer | What it is | Role |
| --- | --- | --- |
| **1. Hub** (free, public) | Agent cards (capabilities, inputs/outputs, required permissions, versions, operator identity). A per-version outcome ledger verified by Relay. Open evaluations on public task suites. Discussion per agent. Free to publish. | The moat: where builders publish first and where trust is visible. |
| **2. Transactions** (pay per outcome) | Three ways to buy from a listing: **Use it** (self-serve product, charged per checked run), **Hire it** (fixed-scope package with criteria agreed up front), **Commission it** (custom project via "Post a request", milestones at scale). Money is held until acceptance. | Revenue, and the source of the verified evidence that feeds the hub. |
| **3. Managed outcomes** (premium) | A buyer posts a request and asks Relay to stand behind it. Relay picks agents using ledger evidence, orchestrates, and guarantees the result. | Margin and retainers for buyers who want certainty. |

The marketplace (Layer 1 browse plus Layer 2 buying) is the front door; chat-based discovery was removed on 17 Nov 2026. Managed outcomes are entered through "Post a request", not a conversation.

## Principles

1. **Reputation belongs to the builder and is public.** Managed delivery hides the *choice* from the buyer, never the builder's credit. Every delivery is recorded against the agent version that did it.
2. **Trust signals are verified, never self-reported.** Show counts with their sample size and time window ("12 runs · 10 accepted first time · 1 revised · 1 failed · last 90 days"). Show a percentage only when the sample supports it. Never invent success rates, compliance claims or operator details.
3. **No pay-to-rank.** Ranking and "featured" status can't be bought. Paid verification may buy an *evaluation*, never a result.
4. **Don't charge for the community's core loop.** Publishing, discovery and reputation are free. Charge for compute, control, privacy and accountability.
5. **One model at every scale.** Engagement → milestones → work items. A one-off task is an engagement with one milestone. Funding, release, change orders and accountability work the same way at every size.
6. **Relay absorbs the error rate in managed work.** Reruns, swapping to a backup agent and refunds are Relay's job, not the buyer's. Human intervention is a cost to automate away, not a feature to sell.
7. **Seed one category deeply before going wide.** Hugging Face became the default for NLP models first.

## Revenue (most recurring first)

1. **Self-serve agent products.** Per checked run, later subscriptions. Repeat use is also the strongest trust signal.
2. **Managed recurring workflows.** A subscription per running workflow: monitoring, alerts, one-click pause, approvals for actions that touch money or customers, reruns with a backup agent, an outcome guarantee.
3. **Hosted runtime and observability for builders.** Usage-based: hosting, run logs, failure traces, evaluation runs.
4. **Private enterprise hubs.** Approved company agents, policy, single sign-on, audit, spend controls. Annual contracts.
5. **Verification.** Paid evaluation runs; badges are earned by results, not purchased.
6. **Transaction fees and managed margin.** A modest fee on direct hires (Layer 2) and a margin between price and builder cost on managed outcomes (Layer 3). This replaces the single 20% assumption and today's 0%.

## Kill risks and tests

| Risk | Test before scaling |
| --- | --- |
| Community moats take years and need a tailwind | Do builders publish for verified reputation plus paid work? Target: 20 builders in the seed category, sourced without paid acquisition. |
| Builders already publish on GitHub, MCP directories and vendor stores | Does a public outcome ledger change their sales conversations? Interview the first 10 published builders. |
| Buyers won't pay for certainty | Quote a guaranteed managed outcome next to a direct hire in pilot conversations and compare uptake. |
| The ledger stays at small numbers | Seed it with shadow runs on real, buyer-sampled inputs, not fixtures. |
| Managed delivery turns Relay into an agency | Track human minutes per managed outcome; it must fall release over release. |
| A browse-first market looks empty | Don't open browse publicly until the seed category has 15–20 builders with packages; lead with "Post a request" until then. |
| Builders have custom workflows, not products | Ask seed builders in outreach; if fewer than a third have repeatable agents, keep self-serve behind packages. |
| Control features don't change delegation | Run the activity log, pause and approvals with 5 pilot buyers before building alerts. |

## Open decisions

1. ~~The seed category~~ Decided: B2B data & research (`docs/Seed-Category.md`).
2. How far Relay stands behind managed results: refund only, rerun plus refund, or a stated service level.
3. Fee levels for Layer 2 and the margin policy for Layer 3, and whether buyers see an all-in price.

## Build sequence

Status as of 16 Nov 2026. Open decisions are in `docs/Decisions-Needed.md`.

1. **Outcome ledger per agent version.** Done (`1a1bd6f`); the execution window now follows the agreement, so multi-day jobs aren't recorded as failures (`bebb370`). Public display comes with step 8.
2. Fee model. **Waiting for decision 1.**
3. Checks before work starts. **Done** (`cc047ac`): expired runtime credentials and disconnected sources or Drive connections block the start. "Connection broken" alerts need notifications, which are off on the pilot.
4. One-click pause and resume. **Done** (`cc047ac`). Approval by action class: agents currently have no way to move money or write to customer systems (read-only tools; Attio writes and funding are buyer-only with consent). Keep that invariant when write tools arrive.
5. Workspace activity view. **Done** (`cc047ac`, `72dd0e7`).
6. Managed recurring workflows and subscription pricing. **Waiting for decisions 1 and 2.**
7. Engagement → milestone model with funding per milestone. **Spec ready** (`docs/specs/Engagements-and-Milestones.md`); waiting for decisions 1 and 2.
8. Agent cards, public hub, SDK/MCP. **Spec ready** (`docs/specs/Agent-Cards-and-Public-Hub.md`); public exposure waits for decision 6.
9. **Browse-first marketplace, packages, request form, then self-serve products.** Spec ready (`docs/specs/Marketplace-Model.md`), decided 17 Nov 2026. Acceptance criteria and exits (in progress) are its foundation.
