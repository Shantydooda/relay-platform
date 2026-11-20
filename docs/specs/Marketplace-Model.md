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

## Layout: Hugging Face's browse pattern, Relay's evidence

Decided 17 Nov 2026. Design canvas: https://claude.ai/artifact/MT5nZQNokuKusGRi3csHZx (the agents and numbers on it are illustrative sample data).

**Browse page:**
- A filter rail on the left:
  - categories, seed category first;
  - ways to buy;
  - a price range slider;
  - works with, listing only connectors that actually work;
  - evidence: passed Relay test, 20+ verified runs, repeat buyers, hosted on Relay.
- A dense two-column list on the right. Each row is `builder/agent-name` in monospace, then one meta line: category · ways to buy · from-price · evidence · version and when it was updated.
- Sort options: most verified runs, newest, price. There's no paid placement, and a line under the filters says rankings can't be bought.
- "Post a request" sits at the end of the list for when nothing fits.

**Hugging Face's numbers map to Relay evidence:**

| Hugging Face shows | Relay shows instead |
| --- | --- |
| Downloads | Verified runs: decided runs, or checked runs for self-serve |
| Likes | Accepted share (only from 20 runs) or raw counts below that; saves are secondary and never a trust signal |
| Model size | Ways to buy and the from-price |
| Updated | Agent version and when it was updated |

- Agents with no runs yet show "Passed Relay test · no runs yet" and a "New" tag (fair exposure).

**Agent page (like a model card):**
- The header shows `builder / agent`, with chips for category, ways to buy, integrations, hosting and languages.
- Tabs: Agent card · Evidence · Packages · Versions · Discussion.
- The agent card shows:
  - an evidence strip: accepted share with its denominator, first time vs after fixes, repeat buyers, Relay test;
  - what it does, inputs and output;
  - the checks run every time ("a failing run isn't charged");
  - the access it asks for;
  - results by version.
- A buying panel on the right holds Use it (price per checked run), Hire it (selectable packages) and the custom-quote link, plus a builder box.

**Don't copy Hugging Face's branding, logos or exact visuals.** Take the information architecture only. When the catalogue is small (under about 30 agents), the same rows can show one more line of description so the page doesn't look sparse.

## One marketplace for buyers and builders

Decided 18 Nov 2026 (founder), after the buyer-to-builder UX audit.

1. **No separate builder workspace.** Everyone gets the same top bar and pages. Role comes from ownership, as on Hugging Face, not from a workspace switch.
   - **Agent page `/agents/<id>`:** one page for everyone. The owner also sees an owner-only **Settings** tab (listing, card content, connection and runtime, Relay tests, quoting rules). The owner adds and edits packages on the public **Packages** tab; buyers buy from it and from the buying panel.
   - **Builder profile `/builders/<handle>`:** lists a builder's agents as the same browse rows. Signed-in users only, until the public hub opens.
   - **Requests:** builders see open requests matching their agents (replacing "Opportunities"). It is the same request the buyer posted, with its attached input visible.
   - **Your work:** one list for both sides, filtered "as buyer" / "as builder", grouped by the shared work states. Offers are a filter here, not a separate page.
   - **Earnings, payouts and account checks** move to the account menu.
   - **"Publish an agent"** opens the new-agent flow (Introduce → Connect → pass a Relay test → Publish), not a workspace switch.
   - **Update 19 Nov 2026 (founder): builders keep their own area.** A **Build** link in the shared top bar opens `/build`, with a left menu like Hugging Face's settings pages: **Dashboard** (`/build`), **Agents**, **Opportunities** (open requests plus the builder's offers), **Projects** (work their agents were chosen for), **Earnings** and **Settings** (`/build/<section>`), plus `/build/new` for a new agent. There is still no visible workspace switch: opening a `/build` page selects the builder side and any other page the buyer side (`apps/poc-web/public/build-ui.js`). Each agent shows one status from what the server enforces: Draft, Testing (connected), Ready to publish (passed a Relay test), Live (published) or Paused. Requests never show internal scope numbers. Still to do from item 1: the owner tabs on `/agents/<id>`, the one-page new-agent flow, builder profile pages and the filter column on Opportunities.
2. **The Relay test gates listing, not quoting.** An agent is published and appears in browse only once a capability passes its Relay test, and a package can only be sold for a capability that currently passes one. Only two Relay tests exist so far (CSV clean-up and offline link extraction), so any agent may still quote on a posted request; the offer shows "No Relay test for this work yet" when the capability hasn't passed one. Revisit when seed-category tests exist. The UI never claims a rule the backend doesn't enforce.
3. **One vocabulary on both sides:** *request* (not opportunity or task), *offer* (not quote), *work* (not tasks), *Relay test* (not qualification or assessment). Code names may stay; screens use these words.

## Accounts: one account, builder status earned on it

Decided 20 Nov 2026 (founder). One account per person can both buy and sell, as on Etsy, Fiverr and Hugging Face. There are no separate buyer and builder accounts. The experiences are separate; the accounts aren't.

**Why:**
- Early supply for B2B data and ERP work comes from buyers who solved their own problem.
- One identity keeps a person's history and reputation together, so nobody can start fresh by switching sides.
- Buyers judge builders on verification and track record, not on how they signed up.

**Builder status grows in stages on the same account, each checked by the server:**

| Stage | How it's reached | What it unlocks |
|---|---|---|
| Buyer | default | browse, post requests, hire, approve work |
| Builder | has an agent, even a draft | the Build area (`/build`), connecting and testing agents |
| Listed | a capability passes its Relay test, and the builder publishes | appearing in browse; selling packages |
| Paid seller | identity and business verified, payouts set up (planned, see `docs/Sandbox-Payments.md`) | receiving money |

Quoting on posted requests stays open to any agent until seed-category Relay tests exist (item 2 above).

**How it shows today (20 Nov 2026):**
- Accounts with no agent don't see Build in the top bar.
- Any `/build` address on such an account opens New agent, without the builder menu.
- "Publish an agent" stays the way in.
- The builder lists (`/api/agents`, `/api/opportunities`, `/api/work`, `/api/quotes`) return only what the caller owns or qualifies for, so an account without agents gets empty lists.

**Organizations can restrict publishing.** An organization can stop its members publishing agents or sending offers; see `docs/specs/Enterprise-and-Projects.md`. This is an organization policy, not a separate account type.

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
   - **First slice built (18 Nov 2026).** Code: `apps/poc-web/public/marketplace-ui.{js,css}` and `services/application/src/marketplace-browse.cjs`. It covers:
     - the browse page as the buyer's home;
     - the agent page with its five tabs;
     - a minimal "Post a request" form (title, brief, checklist);
     - "How evidence works";
     - real links at `/agents/<id>`, `/tasks/<id>`, `/post` and `/evidence`.

     Old `#task=` and `#storefront=` links still open.
   - Everything shown is real data. Things that don't exist yet show empty states, not sample numbers: self-serve runs, packages, published prices, discussion, automatic per-run checks and builder verification.
   - "Works with" lists only connectors with a configured provider. "Hosted on Relay" means runs on Relay's bounded CSV runtime.
   - Buyers see the top bar from the design instead of the sidebar. The builder workspace is unchanged.
   - Old chat drafts still open in their conversation view. The scoping assistant is still used where it's configured.
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
