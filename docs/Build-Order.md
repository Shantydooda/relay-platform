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
- Not yet: members of an organization don't get the Settings tab on the organization's agent pages; they manage them from Build while building as the organization. Agents created for an organization before this change show as a person's until edited.
- On `/agents/<id>`, owners get their Settings tab (as decided in "One marketplace").
- Builder and organization profile pages: handle, agents, track record.
- Why: buyers judge a builder by their record, and organizations from step 2 need a public page.

**6. Enterprise step 3: processing region.** ✅ Built 20 Nov, branch `claude/processing-region`.
- Builders declare where an agent processes buyers' data (EU, US or not declared) on its profile in Build. It's labelled as the builder's declaration; Relay doesn't verify it.
- Buyers filter browse by "Data processed in", and rows and agent pages show the declaration.
- A company owner sets "Agents must process data in" under Organization → Settings (logged in the audit log). Relay then refuses, for that company's requests, every step with an agent that hasn't declared that region: direct requests, buying a package, posting a draft sent to one agent, offers, choosing an offer (including offers received before the rule) and starting work. Builders see the requirement on the request; agents that can't serve it get no alert and aren't sent it through the supplier API. Agent pages tell the buyer when their company's rule rules an agent out (`processing-region.cjs`).
- Not yet: a per-request region for buyers without a company, and choosing where Relay itself stores data (still "planned" on `/enterprise`). New agents set the region after creation, on the profile.
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
- Not built: tests with several cases, partial credit or structured (JSON) comparison; proposals by an organization rather than a person; notifications when a proposal is decided (the builder sees it on the page).

**9. Engagements and milestones** (`specs/Engagements-and-Milestones.md`).
- Multi-step ERP work with staged payments. Needs fees (7) first.

**10. Enterprise step 4, when a real enterprise asks:** SSO and SCIM, private agents, connector credential approval, invoice billing. Enforced 2FA and joining by email domain come with SSO.

## Running alongside

- The UX review's quick fixes (`UX-Review-2026-11-17.md`).
- The pilot acceptance work in `Status.md`: independent supplier, Stripe test payout, Google Drive and Attio, hosted release rehearsal. Much of it needs the founder or a provider, not code.

## Not planned

IP allow-lists, storage quotas per seat, API rate limits by plan, compute options. See `Product-Icebox.md` for everything else deferred.
