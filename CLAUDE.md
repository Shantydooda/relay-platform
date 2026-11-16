# CLAUDE.md: working context for Relay

Claude Code reads this file automatically. Read `AGENTS.md` too: those are the engineering standards and they take priority. This file covers what Relay is, how the repo is organised, what's deployed, the rules that always apply, and where the work stands. Last updated 17 Nov 2026.

## 1. What Relay is

Relay is a conversation-first marketplace for **agentic project work at any scale**. A buyer describes an outcome. Builders' agents quote on it. The buyer picks an offer, the agent does the work under scoped permissions, and the buyer reviews the delivery.

The agreed thesis (`docs/Product-Thesis.md`) has three layers:
1. **Hub (free, public, the moat):** a trustworthy community like Hugging Face's. Agent cards carry evidence that is verified, never self-reported.
2. **Transactions:** quotes, agreements, held payment, delivery review, payout. Relay takes a fee.
3. **Managed outcomes:** Relay sells the result, routes it to builders and stands behind it. Relay keeps a margin.

Non-negotiable product principles:
- **Evidence is verified, never self-reported.** Every number shows its sample size and time window. A rate appears only from 20 decided runs (`MIN_RATE_SAMPLE`). Failures always count.
- **No pay-to-rank.** Ranking uses fit, verified outcomes and fair exposure for qualified newcomers.
- **One engagement → milestones → work items** model for large projects (`docs/specs/Engagements-and-Milestones.md`; not built yet).
- **Pilot and sandbox evidence is labelled as such** and never presented as paid-customer proof.

Seed category: **B2B data & research**, with sales & marketing next (`docs/Seed-Category.md`). Builders can still offer any kind of work. The seed category only decides where Relay focuses its own go-to-market and evaluation effort.

## 2. Rules that always apply

These come from the founder's brief and stay in force until he changes them.
- **Push only to `codex/v1-production-foundation`.** Treat `main` as separate. Never merge, rebase onto or overwrite another branch without asking. Commit or push only when asked or when the task clearly includes it.
- The live app is a **private pilot**. **Payments and supplier execution stay disabled there.**
- **Don't change hosting, database, authentication, payment or provider credentials** unless explicitly asked. That includes Render environment variables, Supabase settings, `render.yaml` syncs and API keys.
- Keep the **production pilot separate** from the older public demo and the older staging service.
- **Don't reintroduce the old manual multi-agent planning form** into the main chat experience.
- **Don't claim production performance metrics** where only local or sandbox evidence exists. Don't expose or invent agent success rates, compliance claims or operator details.
- Make focused changes, **add meaningful regression tests**, and verify locally before pushing. State plainly anything you didn't verify.
- Before any real-money release, get **independent human review** of security, payments and operating procedures. Self-review doesn't count.
- Payment flows: no automatic money movement from new features. Unwired money code stays off by default.

## 3. Environments

| | Where | Notes |
| --- | --- | --- |
| Live private pilot | https://relay-pilot-app.onrender.com (Render service `relay-pilot-app`, free plan) | Entry point `services/pilot-api/src/server.cjs`. Deploys **manually** (Render → Manual Deploy → Deploy latest commit), and only the founder clicks. Free plan: a cold start shows Render's 503 "waking up" page for about 30–50 s. |
| Pilot data and auth | Supabase (hosted Postgres plus Supabase Auth) | Invite-only: rows in `public.relay_invites`. The founder's test accounts are invited. Default Supabase email templates send implicit-flow links (`#access_token=…&type=…`); see §8. |
| Old staging | `relay-staging` from `render.yaml` on `main` | Not the pilot. `render.yaml` doesn't describe `relay-pilot-app`. |
| Local | `npm run start:local` (poc-api, SQLite) | Local execution, a sandbox payments harness and the local model (Ollama) for scoping. |

What the pilot runs: `scoping: false` (no hosted assistant yet, decision pending), supplier execution off, payments off.

## 4. Repository map

Node.js, CommonJS (`.cjs`), npm workspaces. **Node 24** (`.nvmrc`).

- `services/application/src/`: **the domain application**. One implementation per business rule, shared by local and managed adapters.
  - `service.cjs`: `createApplication`, tasks, offers, selection, detail, marketplace views. `compose.cjs` has `APPLICATION_METHODS`; add new public methods there.
  - `execution.cjs`, `execution-lifecycle.cjs`: assignment, claim, lease, submit, review, cancel, pause/resume, the reconcile sweeper.
  - `buyer-pause.cjs`, `permission-wait.cjs`: the buyer's pause and permission waits. Frozen remaining time lives in exactly one place.
  - `start-preflight.cjs`: checks before a run starts (credential expiry, disabled sources, Drive reconnect).
  - `outcome-ledger.cjs`: verified outcomes, a read projection over tasks. `fair-exposure.cjs`: offer track records and newcomer exposure. `agent-card.cjs`: per-version evidence on the storefront.
  - `offer-recommendation.cjs`, `capability-matching.cjs`: recommendation and matching (lexical plus concept groups). Seed-category vocabulary is here.
  - `quote-limits.cjs`, `payments.cjs` (sandbox), `approvals.cjs`, `orchestration.cjs`, `recurring.cjs`, `activity.cjs`, `acquisition.cjs`, `qualification.cjs`, `scoping.cjs`, `supplier-feed.cjs`, `task-changes.cjs` (change proposals).
- `packages/domain/src/`: pure rules. `marketplace.cjs#quoteBreakdown` holds the fee arithmetic. `fee-schedule.cjs` is the tiered fee, **not wired, default 0**. `execution-state.cjs`.
- `packages/contracts/`: `supplier-openapi.json` (the supplier API contract) and input validation (`src/input.cjs`: `fail`, `text`, `exactKeys`).
- `packages/supplier-sdk/`: the builder runtime client. `packages/ui/`: the public landing (`public-landing.cjs`).
- `services/poc-api/src/app.cjs`: the HTTP router, used by **both** the local server and the pilot. `access-guard.cjs` has the local guards; `unified-store.cjs` is local composition.
- `services/staging-api/src/`: the managed store (Supabase identity, `store.cjs`) and `application-access.cjs`. New methods require a fresh browser principal unless listed as `INTERNAL`.
- `services/pilot-api/src/`: pilot config and composition.
- `apps/poc-web/public/`: the vanilla JS frontend.
  - `app.js`: actions, navigation, routing.
  - `buyer-flow.js`: task view, status copy, cards, activity page.
  - `marketplace.js`: offers, track records.
  - `execution-ui.js`, `agent-market-ui.js` (storefront), `chat-controller.js` (request send), `managed-auth.js`, `workspace-theme.css`.
- `supabase/migrations/`: hosted schema. `docs/`: everything. Start with `Product-Thesis.md`, `Decisions-Needed.md`, `State-Machines.md`, `Supplier-API.md`, `Status.md`.

## 5. Commands and testing

```
npm test                      # main suite (packages, poc-api, staging-api, pilot-api, web, …)
npm run test:application      # services/application tests (many need pglite)
npm run test:postgres         # native Postgres suites
npm run test:web              # frontend
node --test path/to/file.test.cjs
npm run start:local
```

- Run `npm test` **and** `npm run test:postgres` on Node 24 before every deploy. The previous working environment couldn't run the Postgres and pglite suites, so **the application-level tests behind these changes have only run through the SQLite end-to-end path**:
  - start preflight
  - buyer pause
  - activity
  - agent card
  - retry
  - acceptance
  Treat a full run as outstanding until it passes.
- End-to-end tests use `services/poc-api/test/helpers/recommendation-flow.cjs`: a real localhost server and the real supplier SDK. Two builders are qualified on `csv-normalize-v1`. Options are `{ repository, now, autoAcceptAfterMs }`, and each test needs its own port.
- Frontend tests load public JS into `vm` contexts (see `apps/poc-web/test/*.test.cjs`).
- Browser QA has used Playwright with system Chrome. Verify changed flows in a browser, desktop and mobile.

## 6. Domain cheat sheet

- Task `status` is `draft → posted` (or `cancelled`). The status buyers see adds `selected` (a live offer is chosen) and then follows the assignment: `queued → running → buyer_review → accepted | failed | cancelled`. Scope changes bump `scopeVersion` and invalidate offers.
- Offers bind to `scopeVersion`. Selection doesn't authorize work. Authorization creates the assignment with a frozen `agreement`.
- All consequential commands are **versioned (`expectedVersion`) and idempotent (`Idempotency-Key`)**, with server-side authorization. Use `command(actorId, key, input, authorize, execute)`.
- Ledger outcomes: `accepted_first_time`, `accepted_after_revision`, `failed`, `refunded`, `cancelled` (cancelled isn't counted as a decided run). The window is 90 days.
- Money (sandbox design): the buyer is charged into Relay's Stripe balance ("separate charges and transfers"). The builder's transfer happens **only after acceptance**, and a refund or dispute blocks payout. A refund before acceptance comes from held funds; after payout, Relay refunds first and tries to reverse the transfer.

## 7. State of the work

Pushed to `codex/v1-production-foundation` (head `b0501df`, the commit that adds this file; the acceptance patch also applies on top of it). **The live pilot runs `1ad3d8b`** until the founder deploys. Pushed but not deployed yet:
- the auth fix for Supabase's default email links (`01dc6da`);
- the seed category and its matching vocabulary (`2793988`);
- the fee rule, at 0% and not wired (`e99c5ce`);
- the agent card v1 track record (`cb3444f`);
- "Try another agent" after a failure (`c3a6cce`).

Earlier and already live:
- the outcome ledger;
- quote limits;
- buyer pause/resume;
- start preflight;
- the activity log;
- runtime version stamping;
- recommendation fixes;
- landing thesis copy.

**In progress: acceptance criteria and exits.** The server side is drafted and *not pushed*. The full patch, policy and to-do list are in the project doc `claude/Handoff-Acceptance-WIP.md` (claude.ai project "Relay"). The patch applies on `5222ef5` with `git am`. The policy:
1. a checklist of up to 12 acceptance criteria on the scope (a scope change);
2. fixes are free until the criteria are met (revision requests name unmet criteria; safety cap of 10 rounds);
3. after 2 rounds the buyer can **end as unmet**, which counts as failed and unlocks "try another agent". It's refused while a payment is held;
4. auto-accept on buyer silence, behind `autoAcceptAfterMs`, **off**.

It still needs an end-to-end test, unit tests, UI (a checklist editor, criteria on offers and the agreement, unmet checkboxes in the revision form, an "End as unmet" button, activity labels), builder views and docs.

Next after that:
- a UI/UX review (promised to the founder, not started);
- wiring the fee schedule into offers, charge, ledger and payout in **one** change, verified by the Postgres payment suites;
- the engagements and milestones model;
- public hub pages (needs founder decisions);
- open evaluation suites for the seed category.

Founder decisions still open (`docs/Decisions-Needed.md`):
- the fee model (working assumption: tiered option B, all-in, live 0%);
- the guarantee policy;
- the funding choice when a buyer tries another agent (recommended: refund, then fund the new task);
- the hosted assistant provider and data rules;
- auto-deploy and `render.yaml`;
- when the public hub opens.

## 8. Known gotchas

- **Supabase email links:** default templates use the implicit flow. `managed-auth.js#confirmationFromLink` plus `store.cjs#verifyLinkSession` accept them (valid for 15 minutes, link types otp, magiclink, recovery, signup, invite and email_change). The exact `amr` method names haven't been checked against live Supabase; if they don't match, the link is safely rejected. Custom token-hash templates need custom SMTP on the free plan.
- **Free Render plan sleeps.** A 503 right after idle is normal.
- **Pilot capabilities are off on purpose** (scoping, execution, payments). Don't "fix" them by changing config.
- **`render.yaml` describes the old staging service.** Syncing a blueprint could change live services, so don't.
- Copy must never imply localhost or demo-only behaviour on the pilot, or promise outcomes the evidence doesn't support.
- Keep `docs/` and the project docs in step when decisions change. The founder reads the claude.ai project `Relay`: `Product-Thesis`, `Decisions-Needed`, `Seed-Category`, `specs/*`, `QA-Audit-2026-11-15`, `Handoff-Acceptance-WIP`.
