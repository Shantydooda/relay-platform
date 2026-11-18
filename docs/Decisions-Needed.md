# Decisions needed from the founder

16 Nov 2026. Each item blocks specific work. Options are laid out with what each changes; nothing here has been implemented. See `docs/Product-Thesis.md` for the agreed direction.

## 1. Fee model (blocks: fees in checkout, milestone pricing)

**Today:** the buyer pays exactly the builder's quote. Relay keeps 0%, and Stripe's processing fee comes out of Relay's balance, so every job loses money. A tested fee calculation already exists (`packages/domain/src/marketplace.cjs#quoteBreakdown`) but is unused. It treats the fee as a share of the buyer's total: a 20% fee on a $100 payout makes the buyer total $125.

| Option | $100 payout | $10,000 payout | Effect |
| --- | --- | --- | --- |
| A. Flat 20% of the buyer total (PRD test model) | Buyer $125, Relay $25 | Buyer $12,500, Relay $2,500 | Simple; gets negotiated hard on large work |
| B. Tiered by payout band: 20% on the first $1k, 12% on $1k–$10k, 8% above (per engagement) | Buyer $125, Relay $25 | Buyer $11,477.27, Relay $1,477.27 ($250 + $1,227.27) | Holds at every scale; more to explain |
| C. Platform subscription plus a smaller rate (e.g. 10%) | Buyer $111.11, Relay $11.11 plus subscription | Buyer $11,111.11, Relay $1,111.11 plus subscription | Recurring revenue; adds friction for first-time buyers |

All figures are computed with `quoteBreakdown`; each rate is a share of the buyer total for that band.

Also decide:
- **Is the buyer shown an all-in price?** Recommended: yes, one price, with the split visible in the agreement.
- **Who absorbs Stripe's processing fee?** Relay out of its fee (recommended for simplicity), or added on top.
- **Managed outcomes (Layer 3):** Relay sets the price and pays the builder their quote. Set a target margin band (thesis: 25–40%).

*Recommendation:* B for direct hires, a margin for managed outcomes, all-in pricing, and Relay absorbs processing fees.

**Working assumption (16 Nov 2026), until the founder decides:** option B, all-in pricing, live rate 0%.

- Built: `packages/domain/src/fee-schedule.cjs` is the one implementation of the tiered rule. It is configured as a schedule string (option B is `100000:2000,1000000:1200,*:800`) and defaults to no fee. Tests check that payout + fee = total exactly at every band edge.
- Not yet wired: today's offers and sandbox payments carry no fee field at all (`platformFeeMinor: 0`). Charging, the ledger split and payouts have to adopt the schedule in one change, verified against the Postgres-backed payment suites, which can't run in the environment this was built in. Until then nothing a buyer or builder sees or pays changes.

## 2. Guarantee policy (blocks: managed outcomes, milestone disputes)

What Relay owes the buyer when managed work fails:
1. **Refund only.** Lowest cost to Relay; weakest differentiation.
2. **Rerun with a backup agent, then refund.** *Recommended.* It's what the Reddit thread says buyers pay for, and the outcome ledger plus pause and start checks now make it measurable.
3. **A stated service level** (e.g. delivered by the date or a partial refund). Strongest, but only once the ledger shows the rates to price it.

### Who pays a refund (answered 16 Nov 2026)

In the payment design (sandbox), the buyer is charged into Relay's Stripe balance ("separate charges and transfers"). The builder's transfer is made only after acceptance, and a refund or dispute blocks it.
- **Failed before acceptance:** the buyer is refunded from the held charge and the builder gets nothing. Relay loses Stripe's processing fee.
- **Refund after payout:** Relay refunds the buyer, then tries to reverse the builder's transfer, which can fail if their balance is empty. This is Relay's risk; the fee is the reserve.
- **Managed outcomes:** Relay is the seller and pays.

Before live money, get legal and Stripe review of how long funds may be held and of any licensing for holding funds for others (EU/Germany).

**Open:** when a buyer tries another agent, the first payment stays held on the failed task. Recommended: refund the failed task first, then fund the new one, rather than carrying a credit across. Today nothing moves automatically.

### Acceptance and exits (answered 16 Nov 2026)

1. **Acceptance criteria.** The buyer can add a checklist of up to 12 items to the scope. Changing it is a scope change: the scope version goes up, existing offers stop being valid, and authorized work keeps the copy frozen in its agreement.
2. **Free fixes until the criteria are met.** A change request can name the unmet items. Supplier-hosted runtimes get up to 10 rounds as a safety cap; the local CSV runtime keeps its 2.
3. **Exit.** After 2 rounds of changes the buyer can end the work as unmet (`BUYER_ENDED_UNMET`). The outcome ledger counts it as a failed run, and "try another agent" becomes available; restarting the same agent does not. It is refused while a payment is held, because refunds aren't connected to it yet.
4. **Auto-accept on buyer silence.** Off unless a deployment sets `autoAcceptAfterMs`. No deployment sets it and no worker calls `reconcileAutoAccept` yet. It never touches work with a payment.

**Open:** connect the exit to refunds before live money, and decide the review window before turning auto-accept on.

## 3. Seed category: decided

**B2B data & research**, with sales & marketing as the adjacent expansion (founder, 16 Nov 2026). Evidence and product changes: `docs/Seed-Category.md`.

## 4. Hosted assistant: no longer blocking

Chat-based discovery was removed on 17 Nov 2026 (`docs/specs/Marketplace-Model.md`). An assistant is no longer needed for the main flow. If one comes back, it's a helper inside the request form, and the questions below still apply then.

### Original question (kept for reference)

**Today:** the pilot reports `scoping: false`. The only model provider (`services/scoping/src/ollama.cjs`) refuses anything not on the same machine, so hosted users get "assistant unavailable" and review their own text.

Decide the provider and the data rules:
- **Provider:** a hosted model API (e.g. Anthropic, OpenAI) or a self-hosted model on separate infrastructure. Criteria: structured-output reliability on the existing scoping evaluations (`npm run eval:scoping`), data-processing terms for buyer briefs, latency and cost per conversation.
- **Credentials:** an API key added to the pilot's Render environment. That's a hosting and credential change I won't make without you.
- **Data:** whether briefs and attached files may be sent to the provider, and the retention terms.

## 5. Hosting and release process (blocks: nothing urgent; reduces risk)

- **Deploys:** the pilot deploys only by a manual click in Render, and my clicks there are blocked. Either keep manual deploys (you click), or turn on auto-deploy from `codex/v1-production-foundation` after CI runs the Postgres suites.
- **`render.yaml`:** describes `relay-staging` on `main`, not the live `relay-pilot-app`. Adding the pilot to the blueprint versions its configuration, but syncing a blueprint can change the live service, so it's your call.
- **Free plan:** the first visitor after idle sees Render's 503 "waking up" page for about 30–50 seconds. A paid instance removes it.
- **CI:** the Postgres/pglite suites, and now the pilot config tests, can't run in my sandbox. Running `npm test` and `npm run test:postgres` on Node 24 before each deploy closes that gap.

## 6. Public hub exposure (blocks: Layer 1 public pages)

The pilot is invite-only. Decide when agent cards become public, the builder consent terms (what is shown, operator display name, unpublish) and who moderates discussions. See `docs/specs/Agent-Cards-and-Public-Hub.md`.

## 7. Marketplace model details (blocks: packages and self-serve products)

Direction decided 17 Nov 2026 (`docs/specs/Marketplace-Model.md`). Still open:
- Fee levels for packages and per-run products. Follows §1.
- Free trial runs for self-serve products, and who pays for them.
- The flag window and flag-rate threshold that pulls a product out of recommendations.
- Where self-serve runs execute (Relay's infrastructure or the builder's), and therefore the security model. Builder-uploaded code or language-model runtimes need an independent security review first.
