# CLAUDE.md: working context for Relay

Claude Code reads this file automatically. Read `AGENTS.md` too: those are the engineering standards and they take priority. This file covers what Relay is, how the repo is organised, what's deployed, the rules that always apply, and where the work stands. Last updated 17 Nov 2026.

## 0. Current working mode: local development (from 17 Nov 2026)

The founder's instruction: **run Relay inside your own Claude Code session while the marketplace changes are built.** Don't hand him terminal steps to run it himself unless he asks.
- **At the start of every session**, start it yourself with `npm run start:local` as a background process. It serves http://127.0.0.1:4180 (override with `RELAY_POC_PORT`), with SQLite and local identity. Keep it running for the whole session, and restart it after changes the running server won't pick up.
- **Set up the test accounts yourself:** a buyer and a builder, the builder with an agent connected through "Connect local CSV runtime". Post one request so offers, a delivery to review, the checklist and "End as unmet" can all be seen.
- **Check every change yourself** in a headless browser (Playwright) at 1440 px and 390 px.
- **Show the founder what changed:**
  - In a **cloud session**, he can't open your localhost, so send him screenshots of each changed screen, desktop and mobile, with a line on what to look at.
  - In a **local session on his Mac** (Claude Code started in `/Users/shantkevorkian/relay-platform`), he can open http://127.0.0.1:4180 himself, so give him the link and the test accounts' login details.
- If port 4180 is taken (`EADDRINUSE`), an older Relay is still running. Find it with `lsof -nP -iTCP:4180 -sTCP:LISTEN` and stop it if it's yours; otherwise use another port.
- Ollama isn't needed: chat discovery is being removed. If the server reports scoping as unavailable, that's expected.
- Use disposable local accounts and data only. Never point local at the pilot's Supabase, and never copy pilot data in.
- Don't ask for pilot deploys while this work is in progress. Push finished, tested increments to `codex/v1-production-foundation` as usual. Ask the founder to deploy only when a coherent slice is done and `npm test` plus `npm run test:postgres` pass on Node 24.
- When a slice is ready to look at, tell the founder the local URL and what to try.

## 1. What Relay is

Relay is a **browse-first marketplace for AI agents and agentic work at any scale**, like Hugging Face for discovery. Buyers browse agent cards that lead with verified evidence, then buy in one of three ways the builder offers:
- **Use it:** a self-serve product, charged per checked run;
- **Hire it:** a fixed-scope package with acceptance criteria agreed up front;
- **Commission it:** a custom project via "Post a request", with milestones at scale.

**Chat-based discovery was removed on 17 Nov 2026** (founder decision; `docs/specs/Marketplace-Model.md`). Don't bring it back as the front door. Any future assistant could only be a helper inside the request form.

The agreed thesis (`docs/Product-Thesis.md`) has three layers:
1. **Hub (free, public, the moat):** a trustworthy community like Hugging Face's. Agent cards carry evidence that is verified, never self-reported.
2. **Transactions:** quotes, agreements, held payment, delivery review, payout. Relay takes a fee.
3. **Managed outcomes:** Relay sells the result, routes it to builders and stands behind it. Relay keeps a margin. Buyers reach it through "Post a request", not chat.

Non-negotiable product principles:
- **Evidence is verified, never self-reported.** Every number shows its sample size and time window. A rate appears only from 20 decided runs (`MIN_RATE_SAMPLE`). Failures always count.
- **No pay-to-rank.** Ranking uses fit, verified outcomes and fair exposure for qualified newcomers.
- **One engagement → milestones → work items** model for large projects (`docs/specs/Engagements-and-Milestones.md`; not built yet).
- **Pilot and sandbox evidence is labelled as such** and never presented as paid-customer proof.

### Marketplace layout (decided 17 Nov 2026)

Hugging Face's browse pattern carrying Relay's evidence. The full spec is in `docs/specs/Marketplace-Model.md` → "Layout". **Design reference in the repo: `docs/design/marketplace/`**, with static HTML mockups (`browse.html`, `agent-page.html`), desktop and mobile screenshots, and the design source; read its README first. (The original canvas, https://claude.ai/artifact/MT5nZQNokuKusGRi3csHZx, needs the founder's login.) Its agents and numbers are illustrative only, so never ship them as data.
- **Browse page:**
  - Left filter rail: categories (seed first), ways to buy, a price range, works with (only connectors that really work), and evidence filters (passed Relay test, 20+ verified runs, repeat buyers, hosted on Relay).
  - Right: a dense two-column list. Each row is `builder/agent-name` in monospace, then one meta line: category · ways to buy · from-price · evidence · version and when it was updated.
  - Sorting by most verified runs, newest or price; no paid placement. "Post a request" at the end of the list.
- **Hugging Face numbers become Relay evidence:**
  - downloads → verified runs;
  - likes → accepted share (from 20 runs) or raw counts below that; saves are never a trust signal;
  - model size → ways to buy and the from-price;
  - updated → agent version and when it was updated.
  - New agents show "Passed Relay test · no runs yet" plus a "New" tag.
- **Agent page, like a model card:**
  - Header `builder / agent` with chips, and tabs: Agent card · Evidence · Packages · Versions · Discussion.
  - The card holds: an evidence strip with denominators, what it does, inputs and output, checks run every time, the access it asks for, and results by version.
  - A buying panel on the right: Use it, Hire it (packages), a custom quote link, and the builder.
- Take the information architecture only, never Hugging Face's branding or visuals. While there are fewer than about 30 agents, show one more description line per row.

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

What the pilot runs: `scoping: false` (no hosted assistant; no longer needed since chat discovery is being removed), supplier execution off, payments off.

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

- Run `npm test` **and** `npm run test:postgres` on Node 24 before every deploy. CI (`.github/workflows/ci.yml`) runs both on every PR, on the Node version in `.nvmrc`: "Core and browser contracts" runs `npm audit --omit=dev`, `npm test` and `npm run test:web`, and "Native PostgreSQL and recovery" runs `db:local:setup` then `npm run test:postgres`. A green CI run is the full-suite evidence; a run in a cloud container is not, because `initdb` refuses to run as root there and only Node 22 may be installed.
- The acceptance work (PR #3) passed both CI jobs on Node 24. Earlier changes (start preflight, buyer pause, activity, agent card, retry) were pushed before CI covered them on this branch. Their next CI run is their first full run.
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

Pushed to `codex/v1-production-foundation` (see `git log` for the head). **The live pilot runs `1ad3d8b`** until the founder deploys. Pushed but not deployed yet:
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

**Acceptance criteria and exits: done in PR #3** (branch `claude/nice-sagan-pccp0j`; merge it before this file is accurate on this point). The `docs/handoff/` patch is that PR's first commit; the PR finishes its to-do list and deletes the folder. Policy: `docs/Decisions-Needed.md` §2; transitions: `docs/State-Machines.md`; code: `services/application/src/acceptance.cjs`, `apps/poc-web/public/acceptance-ui.js`.
1. A checklist of up to 12 acceptance criteria on the scope. Changing it is a scope change; authorized work keeps the copy frozen in its agreement.
2. Fixes are free until the checklist is met. Revision requests name unmet criteria, and the runtime gets them on `claim`. The safety cap is 10 rounds for supplier-hosted runtimes.
3. After 2 rounds the buyer can **end as unmet** (`BUYER_ENDED_UNMET`). It counts as failed and unlocks "try another agent". Restarting the same agent is refused, and the run is left out of the execution queue. Ending is refused while a payment is held.
4. Auto-accept on buyer silence, behind `autoAcceptAfterMs`, stays **off**. No deployment sets it and no worker calls `reconcileAutoAccept`.

Still open on it: connecting refunds to the end-as-unmet exit, and choosing the auto-accept review window before turning it on. The checklist editor currently sits with the brief in the conversation view; it moves to packages and the "Post a request" form as those are built.

Next after that: **the marketplace model** (`docs/specs/Marketplace-Model.md`), in this order:
- marketplace home, evidence-first cards, real routes, chat removed;
- packages, reusing the acceptance work;
- the "Post a request" form;
- self-serve products for the seed category (on the workspace-apps foundation; independent security review before builder code or language-model runtimes);
- subscriptions after payments are live.

The UI/UX review is done: `docs/UX-Review-2026-11-17.md`. The marketplace decision supersedes most of it. Its quick fixes (Work status counts, notification badge, shimmer, plain buyer vocabulary) can run in parallel.

Also queued:
- wiring the fee schedule into offers, charge, ledger and payout in **one** change, verified by the Postgres payment suites;
- the engagements and milestones model;
- public hub pages (needs founder decisions);
- open evaluation suites for the seed category.

Founder decisions still open (`docs/Decisions-Needed.md`):
- the fee model (working assumption: tiered option B, all-in, live 0%);
- the guarantee policy;
- the funding choice when a buyer tries another agent (recommended: refund, then fund the new task);
- marketplace details: package and per-run fees, trial runs, flag thresholds, where self-serve runs execute;
- auto-deploy and `render.yaml`;
- when the public hub opens.

## 8. Known gotchas

- **Supabase email links:** default templates use the implicit flow. `managed-auth.js#confirmationFromLink` plus `store.cjs#verifyLinkSession` accept them (valid for 15 minutes, link types otp, magiclink, recovery, signup, invite and email_change). The exact `amr` method names haven't been checked against live Supabase; if they don't match, the link is safely rejected. Custom token-hash templates need custom SMTP on the free plan.
- **Free Render plan sleeps.** A 503 right after idle is normal.
- **Pilot capabilities are off on purpose** (scoping, execution, payments). Don't "fix" them by changing config.
- **`render.yaml` describes the old staging service.** Syncing a blueprint could change live services, so don't.
- Copy must never imply localhost or demo-only behaviour on the pilot, or promise outcomes the evidence doesn't support.
- Keep `docs/` and the project docs in step when decisions change. The founder reads the claude.ai project `Relay` (mirrors of `Product-Thesis`, `Decisions-Needed`, `Seed-Category`, `specs/*`, the UX review and the audit). Claude Code can't read the project, so everything it needs lives in this repo.
