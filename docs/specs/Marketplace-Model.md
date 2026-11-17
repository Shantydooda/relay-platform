# Marketplace model: browse first, three ways to buy

Decided 17 Nov 2026 (founder). This replaces chat-based discovery as Relay's front door. It updates `docs/Product-Thesis.md` and builds on `Agent-Cards-and-Public-Hub.md` and `Engagements-and-Milestones.md`.

## Decision

1. **The marketplace is the home page**, as on Hugging Face. Buyers search and browse agents by category, starting with the seed category. Each agent card leads with verified evidence.
2. **Chat is removed from the main flow.** It doesn't come back as the front door. A future assistant could only appear as a helper inside the request form. The old manual multi-agent planning form stays out too.
3. **Every listing offers up to three ways to buy, and the builder chooses which:**

| Way to buy | What the buyer does | Pricing | Acceptance | Evidence it adds to the card |
| --- | --- | --- | --- | --- |
| **Use it**: a self-serve product | Runs a vertical agent on its own inputs, once or on a schedule | Per run (subscriptions later) | Automatic checks on every run; the buyer can flag a bad result | Checked runs, failed runs, flags, repeat use and retention |
| **Hire it**: a package | Picks a fixed-scope package, adds inputs and authorizes. No scoping step | Fixed package price | The package's acceptance criteria, agreed up front | Accepted deliveries (first time / after revision), failures |
| **Commission it**: a custom project | Posts a request: outcome, deliverable, deadline, budget, criteria. Agents quote; larger projects use milestones | Quoted (per milestone at scale) | Agreed criteria per milestone | Same as Hire it, per milestone |

4. **"Post a request"** is the fallback when nothing listed fits and the path for large projects. It's a short structured form, not a chat. Agents quote on it as they do today.
5. **No downloadable agents.** Relay earns from hosted, metered, checked runs, never from selling code, prompts or workflow files. A file that leaves Relay can't be verified, protected or charged for.

## Why

- The Hub is the moat, and trust is only visible if people browse it. Behind a conversation it's invisible.
- On the pilot the chat had no assistant, so it was a form dressed as a chat (UX review, 17 Nov 2026, finding 1). Removing it also removes the hosted-assistant decision.
- Packages turn browsing into transactions without a scoping step. Agreeing the criteria up front lets revisions, the exit rule and auto-accept work unchanged.
- Self-serve products give recurring revenue and give builders something that scales for them. Retention is the strongest trust signal there is.

## How revisions work in each mode

The same principle applies everywhere: **fixing what was agreed is free; changing what was agreed is a new agreement; either side can leave cleanly; nobody pays for work that wasn't accepted.**

**Hire it (package)**
- The package's acceptance criteria are fixed at purchase.
- Fixes needed to meet them are free and unlimited, with a safety cap of 10 rounds.
- A revision request names the criteria that aren't met.
- Anything beyond the package is a **change request**: the builder re-quotes and the buyer accepts or declines.
- A builder may offer extra polish rounds as a package term, shown on the offer. Revision counts appear on the card.
- After 2 rounds without the criteria being met, the buyer can **end as unmet**. It counts as failed, the builder isn't paid, and "try another agent" opens.
- If the buyer goes silent on a delivery that passes its checks, it's accepted automatically after the review window. This stays off until payments are live.

**Commission it (custom project)**
- The same rules apply per milestone. Each milestone has its own criteria and its own exit.
- A change request reprices the remaining milestones only. Accepted milestones stay accepted and paid.

**Use it (self-serve)**
- There are no human revision rounds. Each run is checked automatically against the product's declared checks (e.g. required columns, row count, every row has a source).
- **A run that fails its checks isn't charged** and can be rerun.
- The buyer can flag a passed run as wrong within a short window. A flag refunds the run as credit and counts against the product on its card.
- Repeated flags trigger a builder review. A product whose flag rate exceeds a threshold drops out of recommendations until fixed.
- Charging only for checked runs means self-serve needs no refund process for normal failures.

## What has to be built

1. **Marketplace home**
   - Make the Agent Market the signed-in home, and keep "Post a request" prominent.
   - Agent cards lead with one plain evidence line.
   - Add real routes for agent profiles and tasks so they can be linked (UX finding 6).
   - Remove the chat from the main flow; tasks keep a message thread for coordination.
2. **Packages**
   - Builders define packages per capability: title, what's included, price, delivery time, acceptance criteria, required inputs, and optional extra rounds.
   - Buying a package creates a task with an immutable agreement straight away. It reuses the acceptance work (criteria, revisions, end as unmet).
3. **Request form**
   - Fields: outcome, deliverable, deadline, budget and criteria. Quotes work as today.
   - At scale it hands over to the engagement and milestone model.
4. **Self-serve products** (after 1–3)
   - Seed category only, starting with one fixed task with checkable output.
   - Built on the workspace-apps foundation: scoped expiring grants and approve-before-save.
   - Products declare checks; a run is charged only when its checks pass; buyers can flag runs; the card shows usage evidence.
   - Builder-uploaded code or language-model runtimes need an independent security review first. Today's workspace apps run only reviewed, fixed operations.
5. **Subscriptions and builder-run products**: after payments are live and the security review is done.

## Kill tests

- **Supply before browse.** Don't open browse-first publicly until the seed category has 15–20 builders with packages. Until then, lead with "Post a request" so the market doesn't look empty.
- **Products are real.** In builder outreach, check whether seed builders have repeatable agents worth turning into products, rather than custom workflows. If fewer than a third do, keep self-serve behind packages.
- **Packages convert.** Compare how often package purchases and posted requests lead to authorized work.

## Not decided here

- Package and per-run fee levels. They follow the fee model (Decisions-Needed §1).
- Free trial runs for self-serve products, and who pays for them.
- Flag window length and the flag-rate threshold.
- Whether self-serve runs on Relay's infrastructure or the builder's (and therefore the security model).
