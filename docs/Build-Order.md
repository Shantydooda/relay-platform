# Build order

Updated 20 Nov 2026. This is the order the next slices are built in, and why. Each slice gets its own short-lived branch and a PR into `main`. Decisions it depends on are in `Decisions-Needed.md`.

The goal hasn't changed (`Status.md`): **one independent builder completes one real buyer brief**, with a revision, a verified delivery and a correctly reconciled test payment. Slices that bring that milestone closer come first.

## Where things stand

Five branches are built and pushed but **not merged**. Each one is built on the one before it, so they land together:

| Branch | What it adds |
| --- | --- |
| `claude/packages` | Fixed-price packages, reusing the acceptance work |
| `claude/one-marketplace` | One marketplace for buyers and builders; a Relay test required to publish |
| `claude/enterprise-projects` | Organization page, projects with budget caps, `/enterprise` plan page |
| `claude/builder-flow` | Build only for builders; agent overview and tabs; simpler Opportunities and Projects; limited automatic offers; enterprise step 1 (the publishing switch, the audit log, CSV previews) |
| `claude/builder-orgs` | Enterprise step 2: builder organizations ("Building as"), local only |
| `claude/builder-settings` | Builder slice 2: Settings page, live connection status, plainer Earnings (PR into `claude/builder-orgs`) |
| `claude/match-alerts` | Match alerts for builders (PR #14) |
| `claude/builder-profiles` | Builder profiles and owner tabs (PR #15) |
| `claude/processing-region` | Processing region: declare, filter, require (PR #16) |
| `claude/fees` | Fees and payouts, option B, off by default (PR into `claude/processing-region`) |
| `claude/relay-test-proposals` | Builder-proposed Relay tests, reviewed by Relay staff (PR into `claude/fees`) |
| `claude/engagements` | Milestone plans (step 9), plus per-builder Relay test attempts and answer times (PR into `claude/relay-test-proposals`) |
| `claude/small-gaps` | A region per request, Settings tab for organization members, notifications on Relay test decisions (PR into `claude/eval-suites`) |
| `claude/eval-suites` | Open evaluation suites for company research and lead lists, shown on agent pages (PR into `claude/relay-test-cases`) |
| `claude/relay-test-cases` | Relay tests with 1–5 cases, and four Relay-written B2B data tests (PR into `claude/ux-quick-fixes`) |
| `claude/relay-connector` | Relay Connector: ERP data through a connector inside the buyer's network (PR into `claude/ux-quick-fixes`) |
| `claude/ux-quick-fixes` | UX review quick fixes: readable notification badge, drafts in Your work, buyer wording (PR into `claude/connection-reads`) |
| `claude/connection-reads` | Agents read buyer systems outside the request's lock (PR into `claude/integrations`) |
| `claude/integrations` | Settings → Integrations for every account, Hugging Face settings style (PR into `claude/refund-on-end`) |
| `claude/refund-on-end` | Ending paid work refunds it: "End as unmet" and ending a plan, sandbox only, off by default (PR into `claude/engagements`) |

The pilot still runs `1ad3d8b`. Nothing above is deployed.

## The order

**1. Land the stack.** PR #12; CI passed on Node 24 (20 Nov).
- One PR, `claude/builder-orgs` into `main`. CI runs the full suites on Node 24.
- Founder review, merge, then the founder deploys when ready.
- Why first: 32 unmerged commits on a chain of branches get harder to review and riskier to merge every day.

**2. Builder organizations on hosted Relay.** *Waiting for founder approval:* it changes hosted sign-in membership resolution (`services/staging-api/src/membership-authority.cjs`), and CLAUDE.md §2 says auth isn't changed without approval.
- Hosted sign-in has to resolve an organization as an operator, as local now does. Until then, the "Building as" switcher stays hidden on hosted.
- Why now: the first pilot builder may well be a small firm, not one person.

**3. Builder slice 2: settings and getting paid.** ✅ Built 20 Nov, branch `claude/builder-settings`, except notification preferences (nothing to configure until match alerts and email exist).
- A real Build → Settings page: profile, notifications, connection keys, payout setup.
- Plainer Earnings wording.
- A live connection indicator ("Connected · last check-in 20 s ago") everywhere an agent appears.
- Why: the pilot builder needs to set up, connect and see the path to money without help.

**4. Match alerts.** ✅ Built 20 Nov, branch `claude/match-alerts`, in the app only (email waits for hosted email).
- A request alerts a builder when it was sent to them directly, or fits an active agent: the buyer's chosen category (or, if none, Relay's classifier) matches a capability's category, or its wording matches a capability (`agentFits` in `capability-matching.cjs`). Opportunities shows "Fits …" by the same rule.
- Alerts are worked out on each read, never stored: offering, the buyer choosing someone, or 7 days passing removes them. The buyer's workspace is never included.
- Known limit: an uncategorized request that only wants a CSV back can alert a CSV-cleanup agent. Buyers who choose a category don't cause this.
- Tell builders when a new request fits one of their agents, in the app and by email when hosted email is ready.
- Why: buyers only get offers if builders hear about requests quickly. This is the marketplace's main liquidity lever.

**5. Agent page owner tabs and public profiles.** ✅ Built 20 Nov, branch `claude/builder-profiles`.
- `/builders/<handle>`: a builder's published agents, verified runs and categories, marked "Organization" for firms. Signed-in users only, like the rest of the marketplace.
- Builders are grouped by an opaque `builderId` (a hash, never the account id), so two builders with the same name are no longer merged. If they share a handle, the profile lists each one separately and says so.
- Agent pages link the builder's handle to their profile. The owner gets a Settings tab linking to each part of the agent in Build.
- Each agent's Build page has its own address, `/build/agents/<id>/<tab>`. It survives reloads and works with Back.
- Members who can build as the organization (its owners, and members while "Members can publish agents" is on) get the Settings tab on its agent pages, including drafts; each link switches Build to building as the organization (22 Nov, `claude/small-gaps`). Package drafts for an organization's agent are still edited only from the owner's view. Agents created for an organization before step 2 show as a person's until edited.
- On `/agents/<id>`, owners get their Settings tab (as decided in "One marketplace").
- Builder and organization profile pages: handle, agents, track record.
- Why: buyers judge a builder by their record, and organizations from step 2 need a public page.

**6. Enterprise step 3: processing region.** ✅ Built 20 Nov, branch `claude/processing-region`.
- Builders declare where an agent processes buyers' data (EU, US or not declared) on its profile in Build. It's labelled as the builder's declaration; Relay doesn't verify it.
- Buyers filter browse by "Data processed in", and rows and agent pages show the declaration.
- A company owner sets "Agents must process data in" under Organization → Settings (logged in the audit log). Relay then refuses, for that company's requests, every step with an agent that hasn't declared that region: direct requests, buying a package, posting a draft sent to one agent, offers, choosing an offer (including offers received before the rule) and starting work. Builders see the requirement on the request; agents that can't serve it get no alert and aren't sent it through the supplier API. Agent pages tell the buyer when their company's rule rules an agent out (`processing-region.cjs`).
- A buyer can require a region for one request on "Post a request" ("Data processed in": any, the EU or the US), with or without a company (22 Nov, `claude/small-gaps`). Relay enforces it at the same steps as a company rule, in the buyer's own words; a company's rule always wins over the choice. Not yet: choosing where Relay itself stores data (still "planned" on `/enterprise`). New agents set the region after creation, on the profile.
- Builders declare where their agent processes data (EU or US).
- Buyers filter on it, and an organization can require it.
- Why: the first ERP buyers will ask where their data goes before posting real data.

**7. Fees and payouts.** ✅ Built 20 Nov, branch `claude/fees` (option B, decided 20 Nov).
- A builder's quote or package price is what they receive. Relay's tiered fee is added on top and frozen on each offer when it's made (`feeMinor`, `totalMinor`), so a later rate change never reprices agreed work.
- Buyers see, reserve, approve and are charged the all-in total, with the split shown ("$40.00 to the builder, $10.00 Relay fee"). Budgets, project caps, approvals, recurring limits, recommendations and package prices all use it.
- The builder is transferred and paid out exactly their quote; the ledger records Relay's share as its own entry (`buyer_funds → relay_fees`), and the buyer's spending report counts it as released, so nothing stays "held". Tested on SQLite and Postgres, plus the Stripe sandbox adapter.
- Builders are told where they set prices: "buyers see this plus Relay's fee". Only shown once fees are on.
- Off by default everywhere. Locally: `RELAY_FEE_SCHEDULE=100000:2000,1000000:1200,*:800 npm run start:local`. Hosted isn't wired: switching fees on for the pilot needs the founder's approval and the independent review in CLAUDE.md §2 before real money.
- Not yet: "verified builder before payouts" beyond today's sandbox payout readiness (needs Stripe identity checks); fee bands use the same numbers in EUR; a package bought just as the rate changes is priced at the rate when bought.
- Wire the fee schedule into offers, charge, ledger and payout in one change, verified by the Postgres payment suites.
- Verified builder before payouts ("paid seller" stage).
- Why here: payments stay off until the pilot gates in `Status.md` pass, but this is the last product slice before the pilot's test payment.

**8. Builder-proposed Relay tests.** ✅ Built 20 Nov (branch `claude/relay-test-proposals`). Decided 20 Nov: Relay staff review each proposed test before it can be used.
- Why: only two Relay tests exist, so publishing is narrow until builders can propose more.
- A test is data, never code: instructions, a synthetic input, the expected output, a change request and the expected revised output, compared exactly or line by line (`services/application/src/relay-tests.cjs`). Builders propose from Build → Relay tests; Relay staff approve, reject with a reason, or retire one later.
- Rules, from how exams and benchmarks stay honest:
  - `{{nonce}}` must appear in the input and both answers; Relay fills a fresh value on every run, so answers can't be replayed;
  - answers are seen only by the author and staff; submitted outputs and their hashes never appear in public evidence (the run's input is public, so a hash could be checked offline);
  - the person behind an organization's proposal can't review it either; reviewers show as "Relay staff";
  - the expected output can't be the input unchanged, and the change request must change the answer;
  - a pass only counts for the test's category; 3 attempts per builder per test per day, across all their agents;
  - evidence says how long the agent took to answer each round (a runtime is usually much faster than a person; a signal, not proof);
  - a reviewer can't approve their own test.
- **The author may take their own test, and the agent card says so** ("written by this agent's own builder"). Exam bodies usually bar writers from their own exam; here that would leave a builder in an untested category with no way to list, so it's disclosed instead and staff review with it in mind. Revisit if it's abused.
- Retiring stops new runs; passes already earned stand until they expire (30 days at most). A run already started (it has an hour) can still finish.
- Limits to know: only the `{{nonce}}` changes between runs, so an agent built around one test's template can pass it every time; treat builder-written tests as basic checks.
- Staff are set locally with `RELAY_TEST_REVIEWER_USER_IDS` (comma-separated user IDs) and see "Review Relay tests" in the account menu. Local only, like the Relay tests themselves; hosted isn't wired.
- **Several cases, and Relay's own B2B data tests** (22 Nov, branch `claude/relay-test-cases`):
  - A test now holds 1–5 cases under one set of instructions, each with its own input, answers and change request. The agent passes only if it gets every case right in both rounds, and each case gets its own `{{nonce}}` value per run. Every rule above applies per case, and cases can't repeat each other.
  - Relay ships four tests of its own for the seed category, as data (`services/application/src/relay-test-seeds.json`), two cases each: company list deduplication (Data cleanup), job title seniority (Lead lists), country codes from country names (Data enrichment) and domains from URLs and emails (Web data extraction). Builders see them under "Relay's tests"; staff can read them but not retire them, since they change with a release. Their answers stay private like builders' tests, and the card doesn't say "written by a builder".
  - Reference solvers in `relay-tests.test.cjs`, written from each brief alone, pass every seeded case, so a seed's answers can't silently disagree with its instructions.
  - Runtimes get `cases` and `answer: "outputs"` for tests with several cases and reply with `{round, outputs}`; one-case tests keep `{round, output}`, and tests proposed before this still run as one case (`supplier-openapi.json`, `Supplier-API.md`).
  - Limit to know: the seeded answers live in the repository, so anyone who can read the code can see them. The nonce stops replaying a stored answer, not building a solver for these exact tasks; treat a pass as a basic check, like builder tests.
- Not built: partial credit or structured (JSON) comparison; proposals by an organization rather than a person. The author now gets a notification when staff approve, reject or retire their test (22 Nov, `claude/small-gaps`); it opens Build → Relay tests.

**9. Engagements and milestones.** ✅ First slice built 20 Nov (branch `claude/engagements`, `specs/Engagements-and-Milestones.md`).
- Multi-step ERP work with staged payments. Needs fees (7) first.
- **Builders offer in milestones.** On any open request, a builder can split their offer into 2–6 milestones, each with a name, a checklist, a price and a delivery time (Build → Opportunities). The offer's price and time are the totals. Like Upwork and Fiverr, the seller proposes the stages and the buyer accepts or chooses another offer. Plans are written by the builder in Relay; the Supplier API refuses them (`MILESTONES_UNSUPPORTED`), so automatic bids stay single-price.
- **Accepting the plan.** Choosing a plan offer turns the request into a plan and each milestone into its own task, reserved for that agent with its terms already chosen (`services/application/src/engagements.cjs`). From there a milestone is ordinary work: company approval, budget caps, processing region, funding, start checks, delivery, free fixes until its checklist is met, change requests and acceptance all run unchanged, and the outcome ledger counts each milestone as one run of the agent.
- **One at a time.** A milestone can be paid for or started only after the one before is accepted (`MILESTONE_ORDER`); money is never held for work that can't start. The plan itself can never be paid for or started as a whole (`ENGAGEMENT_PARENT`). Accepted terms are frozen: the plan can't be re-chosen, edited or changed by a change request, and a milestone's scope is fixed until it starts. Once it starts, change requests work as for any task and reprice that milestone on its own. A milestone's agreed terms don't expire while the plan is open.
- **Ending the plan** cancels the milestones not started; accepted milestones stand, and one in progress finishes or ends on its own page. A paid milestone that hasn't started is refunded with it where refunds on ending are on (see "Running alongside"); otherwise ending is refused until it's refunded.
- **Fees:** each milestone carries its slice of the tiered fee on the whole amount (fee of the first k milestones minus the first k−1), so a plan costs exactly what one offer of the same total would, and every milestone reconciles (price = builder's price + fee). Tested on SQLite and Postgres with the sandbox payments double.
- **What buyers see:** the plan inside the offer (each milestone's all-in price and checklist), a plan page with each milestone's status and what's accepted so far, a "Milestone 2 of 3" page per milestone, and the plan listed once in Your work with its current milestone.
- Not yet: Relay proposing the milestones (needs the hosted assistant decision); adding or repricing a milestone after acceptance (today: a change request inside a running milestone); subcontractors under a lead builder; milestones running in parallel; retiring `orchestration.cjs` plans into this model; auto-release on buyer silence (still off everywhere); hosted wiring and real money (need founder approval and the independent review).

**10. Enterprise step 4, when a real enterprise asks:** SSO and SCIM, private agents, connector credential approval, invoice billing. Enforced 2FA and joining by email domain come with SSO.

## Running alongside

- ✅ **Open evaluation suites, first slice** (22 Nov, branch `claude/eval-suites`; `specs/Agent-Cards-and-Public-Hub.md` step 4, `Seed-Category.md`):
  - Two suites for the seed category, as data (`services/application/src/eval-suites.json`): **Company research fields** (5 synthetic company pages; name, country, founding year, headcount band, domain) and **Lead list fields** (5 synthetic team pages; the senior sales contact's name, title, seniority, email from the stated pattern). 25 and 20 field checks.
  - A builder runs a suite from the agent's Relay tests tab when the agent has a capability in its category; the runtime answers every item once through the supplier API (`/evaluations`), and Relay checks each field automatically (`evaluations.cjs`). The score is a count with its sample: "17 of 20 fields correct · 5 items".
  - Inputs are public (`/docs/evaluations`); answers stay on the server. Builders see only their total, three runs per suite per day across their agents.
  - Buyers see the latest score per suite on the agent page's Evidence tab, labelled "Relay evaluation on synthetic data, not buyer work", for 90 days on the current runtime version. It never counts as a run, isn't a pass mark and doesn't change browse order.
  - Conservative defaults, recorded as open in `Decisions-Needed.md` §9: no leaderboard or ranking effect, totals-only feedback, Relay-written suites only. Local only, like Relay tests.
  - Not yet: re-running a suite automatically on a new runtime version; shadow runs on buyer-sampled inputs (needs buyer consent design); suites for other categories; a public JSON format for scores.

- ✅ **Integrations for every account** (21 Nov, branch `claude/integrations`). Connecting systems used to be an organization tab, so ordinary accounts couldn't reach it, and the request page's "Connect one" link dead-ended for them; the server already allowed personal owners. Now one Settings → Integrations page serves personal and organization workspaces, and replaces both the organization tab and the old Tools page (Drive, Attio, a tool library of mostly unbuilt tools). Also fixed: the account menu ran off the left edge on phones. Still needed to make integrations really work: trying GitHub, HubSpot and Attio against real accounts (tested only against simulated responses); Google and Attio developer apps for Drive and Attio delivery (founder, credentials); the ERP connectors (NetSuite, SAP, Dynamics: a test account and independent security review each); reading outside the task's lock; and, for the pilot, the vault key as a hosting secret.
- ✅ **Refunds on ending paid work** (21 Nov, branch `claude/refund-on-end`). "End as unmet" on funded work now refunds the buyer's full test payment, fee included, in the same step; the builder is never paid for it. Ending a plan does the same for a milestone that's paid for but not started. As with the manual refund, only the workspace owner can end paid work. Payment that's still being set up, being refunded or paused for review still blocks ending, with a plain reason, and the page hides the button rather than failing on submit. The run stays a failure on the agent's record after the refund: a returned payment no longer relabels a failed run as "refunded". The refund is recorded with the end, then asked of the provider; if that call fails, the payment reconciler retries the same refund, never a second one. Sandbox only, and off unless a deployment sets `refundOnEnd` (local: `RELAY_REFUND_ON_END=1`). Not checked in the browser: local Relay has no Stripe test key, so no payment can be funded there; the page wording is covered by tests. Still needs the independent review before real money, and the guarantee decision may add a rerun on top.
- ✅ **The UX review's quick fixes** (21 Nov, branch `claude/ux-quick-fixes`; `UX-Review-2026-11-17.md` findings 3, 4, 9):
  - The notification count is a readable badge in both themes; it was a white blob.
  - "All" in Your work now includes unposted drafts, so an ERP request waiting for its files can't vanish. A plain draft reopens in "Post a request", filled in, and posting reuses it.
  - Buyer wording: "execution" and "supplier" are gone from the offer, start and run screens ("Recommended agent", "Stop the work", "Why it fits").
  - Already fixed by the redesign: the needs-you count includes offers waiting for a choice, the shimmer is gone, the chat composer no longer exists.
- ✅ **Reads outside the lock** (21 Nov, branch `claude/connection-reads`): a slow buyer system no longer holds the request while it answers; access that ends mid-read returns nothing.
- ✅ **Relay Connector** (23 Nov, branch `claude/relay-connector`; founder chose "bring your own connector" for ERP). Buyers set up NetSuite, SAP S/4HANA, Dynamics 365 or any ERP's exports under Settings → Integrations without giving Relay a login: Relay issues a one-time connector key, the buyer runs the connector (`packages/relay-connector`, Node or Docker) next to their CSV exports, and it answers only granted reads, outbound only, with its own local log. Agents ask for and read ERP data exactly as for other connections. Not yet: direct ERP API adapters behind it, formats other than CSV, a published package, hosted wiring, and the independent security review before real data. Spec: `specs/Buyer-Connections.md` → "Relay Connector".
- ✅ **v1 step 1: the builder path on the pilot** (23 Nov, branch `claude/pilot-relay-tests`). Tested on the pilot's own setup: connect a runtime, pass a Relay test, publish, appear in browse, and (with unpaid runs on) run a request with a revision. In-app notifications, including match alerts, are now on for the pilot; Relay test reviewers are set with `RELAY_TEST_REVIEWER_USER_IDS` (`Private-Hosted-Pilot.md`). Turning on unpaid runs and naming reviewers are Render settings for the founder. Live on the pilot 25 Nov.
- ✅ **v1 step 2a: the first-builder kit** (25 Nov, branch `claude/first-builder-kit`). A sample agent inside the SDK archive (`packages/supplier-sdk/examples/sample-agent`): the builder edits one file (`my-agent.cjs`) and `run.cjs` handles connecting, Relay tests, offers, leases, retries, delivery and revisions over HTTPS. Its README is the builder's guide. The Connection tab now points builders at the kit instead of Relay's source code, and hides the localhost-only references on the pilot. Tested on the pilot's setup and walked as a new builder on localhost (`First-Builder-Pilot.md`, "The builder kit").
- The pilot acceptance work in `Status.md`: independent supplier, Stripe test payout, Google Drive and Attio, hosted release rehearsal. Much of it needs the founder or a provider, not code.

## Not planned

IP allow-lists, storage quotas per seat, API rate limits by plan, compute options. See `Product-Icebox.md` for everything else deferred.
