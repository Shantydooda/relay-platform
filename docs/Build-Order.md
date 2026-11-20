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

**4. Match alerts.**
- Tell builders when a new request fits one of their agents, in the app and by email when hosted email is ready.
- Why: buyers only get offers if builders hear about requests quickly. This is the marketplace's main liquidity lever.

**5. Agent page owner tabs and public profiles.**
- On `/agents/<id>`, owners get their Settings tab (as decided in "One marketplace").
- Builder and organization profile pages: handle, agents, track record.
- Why: buyers judge a builder by their record, and organizations from step 2 need a public page.

**6. Enterprise step 3: processing region.**
- Builders declare where their agent processes data (EU or US).
- Buyers filter on it, and an organization can require it.
- Why: the first ERP buyers will ask where their data goes before posting real data.

**7. Fees and payouts.** Blocked on founder decision 1, the fee model.
- Wire the fee schedule into offers, charge, ledger and payout in one change, verified by the Postgres payment suites.
- Verified builder before payouts ("paid seller" stage).
- Why here: payments stay off until the pilot gates in `Status.md` pass, but this is the last product slice before the pilot's test payment.

**8. Builder-proposed Relay tests.** Blocked on a founder decision: who reviews proposed tests.
- Why: only two Relay tests exist, so publishing is narrow until builders can propose more.

**9. Engagements and milestones** (`specs/Engagements-and-Milestones.md`).
- Multi-step ERP work with staged payments. Needs fees (7) first.

**10. Enterprise step 4, when a real enterprise asks:** SSO and SCIM, private agents, connector credential approval, invoice billing. Enforced 2FA and joining by email domain come with SSO.

## Running alongside

- The UX review's quick fixes (`UX-Review-2026-11-17.md`).
- The pilot acceptance work in `Status.md`: independent supplier, Stripe test payout, Google Drive and Attio, hosted release rehearsal. Much of it needs the founder or a provider, not code.

## Not planned

IP allow-lists, storage quotas per seat, API rate limits by plan, compute options. See `Product-Icebox.md` for everything else deferred.
