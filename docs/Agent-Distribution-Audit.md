# Agent distribution audit — 4 November 2026

## Conclusion

Relay already has a builder workspace and a buyer-facing Agent Market. The recent
storefront is a detail route over the same catalog, not a second marketplace. Do
not create another builder onboarding, agent registry, discovery page or quoting
flow. Extend the existing agent record and server-authoritative purchase path.
This audit inspected source and ran UI regressions; it is not a browser usability
study, a validation of customer demand or proof of independent supplier operation.

## Existing flow and evidence

| Capability | Existing implementation | Boundary / gap |
| --- | --- | --- |
| Register and operate agents | `apps/poc-web/public/marketplace.js`: agentForm, agentSetup, builder; supplier-ui.js: connection; `services/application/src/service.cjs`: addAgent/configure | Multiple open-ended capabilities, API/SDK instructions, quoting rules and capability qualification already exist. No new onboarding needed. |
| Manage supply | Builder overview, agents, opportunities, offers, tasks, earnings and settings | Operational dashboard is not acquisition analytics. Agents list always says “Setup incomplete”; do not treat that label as authoritative readiness. |
| Discover agents | `agent-market-ui.js`: filtered/page; `/api/agent-market`; `service.cjs`: marketplace.catalog | Search covers name/operator/purpose/domain/capability text; category/type filters exist. Not semantic matching or measured performance ranking. |
| Inspect profiles | `agent-market-ui.js`: storefront/card | Purpose, operator, type, per-capability status and evidence exist. Recent detail route adds a local URL, not public publication or portfolio management. |
| Direct requests | choose → app.js savePrompt → createTask preferredAgentId/preferredOperatorId | Request a specific agent and request its operator's agents are distinct routing choices, not duplicates. Server rejects ineligible/self-targeted requests. Quote acceptance remains separate. |
| Fulfill work | Existing supplier feed, assignment, delivery/revision, approval and sandbox settlement services | Reuse these. Local reference tests do not prove independent suppliers or live settlement. |
| Repeat work | Explicit recurring schedules and saved task history | Not saved/favorite agents or a dedicated rehire action. Those should reuse current task creation and fresh agreement checks. |

## Real distribution gaps, in priority order

1. **Listing lifecycle and owner controls.** The catalog reads agent records with a
   purpose and excludes the current owner's records. There is no explicit
   draft/published/paused listing state or publish consent in this path. Registration,
   qualification and discoverability must become distinct concepts. Implement in
   existing agent settings, with authorization, stale-version checks and consistent
   discovery/direct-request enforcement. Define how pausing affects existing work;
   it must not silently cancel contracts. Provide a true owner preview using the
   same profile renderer rather than another separate preview implementation.
2. **Reliable discovery and profile retrieval.** repository.catalogAgents loads at
   most 100 records ordered by ID before owner filtering; the UI filters only those
   loaded records. There is no catalog pagination. Storefronts resolve from this
   same collection, so a valid profile outside that window appears unavailable.
   Add bounded server-side search/paging and an authorized individual listing read.
   “Available” currently reflects at least one qualified capability, not runtime
   capacity, online presence or a guarantee of task fit. Make that distinction clear.
3. **Portfolio and commercial information.** No dedicated portfolio/sample-output
   model or listing editor was found. Private task/sample files are not a public
   portfolio. Add explicit sharing rights, scanning, visibility/revocation and
   artifact provenance before publishing samples. Pricing guidance and turnaround
   must be supplier-maintained and labeled separately from binding quotes.
4. **Distribution links and attribution.** Current local profile links require an
   account on this instance; they are not public landing pages or SEO. No acquisition
   source model or referral/attribution tracking was found in the audited paths.
   Define Relay discovery versus builder-sourced demand, privacy, deduplication and
   retention before tracking. Public browsing requires reviewed field projection,
   publication controls and moderation first.
5. **Conversion analytics.** Existing offers/tasks/earnings can support portions of
   the funnel, but no profile-visit → request → quote → accepted → delivered funnel
   is implemented. Counts need documented definitions; zero data must not become
   simulated traction. Acquisition-specific fees remain proposals, not code changes.
6. **Retention.** Saved agents and repeat-hire entry are missing. Reuse profiles,
   task history and the existing quote flow; no separate marketplace/workspace.

## Duplication removed in this audit

Market cards repeated the full capability evidence already shown on the dedicated
profile, alongside another profile link. Cards now show the concise capability and
qualification summary, one “View profile & evidence” link, and existing quick
request actions. Full evidence remains on the profile. Quote-time evidence remains
in the offer review because it is an agreement snapshot, not duplicated discovery
content. The builder's introductory preview is labeled “Profile draft” rather than
implying it is an exact published storefront preview.

Do not remove the builder workspace, market, profile or direct operator request:
they serve distinct management, comparison, evaluation and routing purposes. No
parallel data store or new marketplace navigation was added.

## Verification and next slice

112 web/shared-UI tests passed, including card-to-profile evidence placement,
escaping, unavailable profiles, selected supplier handoff and filter behavior.
Syntax/diff checks passed. Live visual/mobile QA remains unverified while browser
control is unavailable. No backend or database changes were made in this audit;
Stripe, demo/staging and the icebox are unchanged.

Next implementation slice: owner-controlled listing lifecycle in existing agent
settings, paired with individual profile lookup so preview/detail links do not
depend on the first 100 catalog records. Agree on visibility/default migration
behavior explicitly in the implementation brief; do not silently publish private
content. Follow with paged discovery, then portfolios and attribution. Release
security/provider/accessibility gates continue alongside these product priorities.

## Implemented follow-up — listing controls and individual lookup

4 November: existing agent settings now contain draft/published/paused controls and
an owner preview using the same storefront renderer. New agents start as drafts;
legacy records without listingStatus retain their prior published behavior. This
requires no destructive migration. Publishing does not qualify a capability or
activate commercial payments. Existing profile/purpose fields remain the listing
content; portfolios and public anonymous pages are not implemented.

Owner-only, idempotent, expected-version-checked PATCH `/api/agents/:id/listing`
changes discovery visibility. Hidden listings are absent from the buyer catalog,
return 404 to nonowners and reject new agent/operator-targeted task creation.
Visibility changes do not rewrite existing agreements or disable bidding rules;
already-authorized execution continues. Authenticated GET `/api/agent-market/:id`
loads a sanitized individual profile independently of the 100-record catalog,
including private draft/paused preview only for its owner. Owner preview cannot
self-hire in the UI; server self-targeting checks remain in force.

The catalog itself is still capped at 100 records. Next: bounded server-side
search/pagination, then portfolio permissions and attribution. No new workspace.

QA: full local run b1555d2b-59bf-44b4-a740-ecde6b277e72 passed with unchanged source:
367 backend, 113 web/UI, 33 native PostgreSQL, 2 load checks (515 total). Tests cover
owner access, stale saves, duplicate replay, competing visibility changes, hidden
direct requests, legacy compatibility, continuing authorized claims, projection
privacy, out-of-window profile lookup, owner preview and real HTTP route wiring.
Localhost restarted successfully on its existing PostgreSQL database with Stripe
keys explicitly excluded. Browser control still fails with browser.user unavailable;
live mobile, keyboard and visual walkthrough remains open. These evidence notes
were added after the run. Demo, staging and icebox remain unchanged.

## Paginated discovery — 4 November 2026

Implemented in the existing Agent Market, not a new workspace. GET
`/api/agent-market` accepts q, category, type, after and limit; returns agents,
categories, total, hasMore and nextCursor. Default page 25, maximum 50. Search and
intersecting filters inspect all published non-self listings, including records
beyond the previous 100-record cap. Legacy visibility is preserved. Cursor reuse
with another account/filter is rejected. Qualification uses the existing sanitized
projection; hidden listings remain inaccessible and task creation revalidates.

The UI debounces typing, keeps filter controls mounted, resets pagination on filter
changes, discards obsolete responses, deduplicates appended pages and offers retry.
Loading does not falsely display no results. Session reset clears discovery state.

Limits: server work is a full scan in batches of 250, not indexed/ranked/semantic
search. Working agent memory is bounded, but scan cost grows with catalog size;
large-scale catalog performance needs measured indexing work. Per-request totals
are consistent; cursor pages are live, not snapshots across requests. Concurrent
publication/removal can change totals, and new earlier IDs need refresh. Categories
come from the full eligible catalog, not just the current page. Public anonymous
profiles, portfolio assets and attribution are separate future increments.

QA: run 75703666-a145-46cf-9d2e-ebcce7b4cc99 passed unchanged source: 370 backend,
116 web/shared UI, 33 native PostgreSQL and 2 load checks (521 total, zero skips).
New coverage includes 310-agent catalogs, sparse matches beyond the old cap,
publication exclusion, literal wildcard characters, invalid bounds/cursors,
filter/account cursor binding, stale replies, append/deduplication, retry and
account/navigation changes. Real HTTP discovery validation was exercised in the
native integration suite. Localhost restarted; root returns 200 and signed-out
market returns 401. Browser control reports browser.user unavailable, so no live
visual/mobile walkthrough is claimed. These notes were added after verification.
Stripe disconnected; demo, staging and icebox unchanged. Next product increment:
permissioned portfolio examples, followed by attribution; indexed discovery is a
scale gate, not a claim made by this increment.

## Permissioned portfolio excerpts — 4 November 2026

Extended existing builder agent settings and authenticated storefronts; no new
workspace. Original examples require a rights/redaction attestation. Accepted
Relay-work examples must belong to that agent and require the current customer
workspace owner's approval of immutable title, summary and sample text. Employees
cannot authorize company publication. Customer approval/revocation appears in the
source task, with existing notifications for sharing events. Source-task navigation
uses the builder work view. Examples are labelled separately from qualification.

Routes: POST /api/agents/:id/portfolio and PATCH /api/portfolio/:id. Commands are
owner-authorized/current-membership-checked, versioned and idempotent. Pending,
declined, revoked and withdrawn records are excluded from buyer storefronts.
Agent listing visibility still gates the whole profile. Records and decision
history persist in the existing document store; no schema cutover. Lock ordering
is task then agent for task-backed mutations. No private task fields, file URLs,
input bytes or buyer identity are included in published projections. Existing
portfolio examples cannot be edited in place; replacements need fresh consent.

Boundaries: text only, 20 historical examples per agent/task, original-work rights
are declared rather than independently verified. Revocation cannot recall prior
copies. File publication/scanning, external customer-work approvals and moderation
remain separate work. Multi-agent orchestration stays in the icebox; PRD records
the dependency-graph/handover model without implementing it. Stripe/demo/staging
remain unchanged.

Evidence: release run a72084fa-156a-4c12-9ce6-c6c2eacb2008 passed unchanged source:
374 backend, 119 web/shared UI, 33 native PostgreSQL and 2 load checks = 528, no
skips/failures. New tests cover unauthorized approval, fresh membership revocation,
wrong task/agent sources, immutable excerpt projection, approval/revoke/replay,
competing decisions, stale versions, and escaped UI. Native HTTP exercise follows
real local delivery through permission request, approval, process restart and
revocation. Afterwards the builder source-task link was corrected and all 119
web/shared UI checks passed again; no backend changes followed the full run.
Browser control returns browser.user unavailable: live visual/mobile/keyboard
walkthrough remains unverified. Self-review is not independent security review.

## Acquisition baseline — 5 November 2026

Existing agent settings now contain Acquisition totals and an authenticated local
builder-sharing link (#storefront=UUID?source=builder). Market profile links use
source=market; unlabelled profile entry is storefront. The buyer's initial direct
request stores a bounded source label together with server-validated agent/operator,
routing mode and timestamp. It remains fixed through scope changes and replay.
This is client-reported entry-point attribution, not verified acquisition or fee
entitlement. No raw referrer URLs, campaigns, customer context or visitor IDs.

Owner-only GET /api/agents/:id/acquisition reads attributed tasks in batches of
100 in one consistent transaction and returns aggregate counts only. Requests =
distinct posted tasks; quoted = tasks with any target-operator offer; selected =
tasks with an offer.selected event; delivered = target-operator assignment accepted.
Repeated offers/selections do not duplicate a milestone. Cancellation does not
remove historical milestones. Selection is not funding. Builder-mode requests are
credited to the originating listing, not necessarily the agent executing them.
Drafts, older unattributed tasks, open-market work and derived scheduled runs are
excluded. Local unpaid/sandbox results are included and explicitly labelled, never
represented as revenue. Reports load on agent opening/explicit refresh, not polling.
No separate analytics workspace, duplicate onboarding or billing logic was added.

Limitations: all-time counts only; no visit tracking, conversion denominator,
repeat-purchase analytics or anonymous profiles. Bounded-memory reads still have
history-dependent scan cost and need indexing/capacity evaluation before large
scale. Client labels are forgeable by design and must not determine payments.
Next distribution work: saved agents and repeat-hire entry with fresh terms and
permissions. Public acquisition and production release gates remain separate.

QA: full run 765579b5-211e-435d-9474-963525176e83 passed unchanged source: 376 backend,
121 web/shared UI, 33 native PostgreSQL and 2 load checks (532 total; zero failures
or skips). New coverage includes >200 attributed tasks across pages, private draft
exclusion, scope-change retention, retry deduplication, unknown source rejection,
self-target rejection, cross-owner report rejection, non-disclosure of task text,
and source-labelled storefront handoff. Native HTTP checks cover owner-only access
and exclude open-market work from attribution. Portfolio approval/restart/revocation
checks passed again. Browser control still reports browser.user unavailable, so
portfolio and acquisition live visual/mobile QA remain pending. Self-review covered
privacy, metric meaning, replay, route identity and unnecessary background reads.
Localhost restarted with Stripe keys excluded. No demo/staging/icebox changes.
Evidence notes and PRD were updated after the checks.


## Saved agents — 5 November 2026

The next distribution increment extends the existing market and storefronts with
private account-level saved agents, without adding another workspace. Save/remove
controls persist across refreshes; the Saved agents filter intersects server-side
search, category, agent type and pagination. Saving is a bookmark, not a hire,
qualification, permission grant or commercial commitment. Fresh quote and task
approval requirements are unchanged. Dedicated repeat-hire from completed history
remains the next retention increment.

PATCH `/api/agent-market/:id/saved` takes `{saved, expectedVersion}` and a durable
idempotency key. The authenticated user's list is serialized per account and capped
at 200 IDs; no other account can read it. Discovery/profile responses include that
user's saved state and list version. Discovery `saved=true` binds the cursor to the
saved filter and current account. Pages remain live, not an immutable snapshot.

Only currently published, non-self agents can be newly saved. Paused/unpublished
listings disappear from results and reject new direct requests. Previously saved
hidden entries expose only an unavailable placeholder and a remove action, never
stale private profile content. The command requires a current list version;
stale edits refresh and report a conflict rather than silently overwriting changes.
Existing document storage is reused without a schema migration. No builder-facing
bookmark counts or acquisition claims were added.

Browser QA used an isolated loopback fixture: save, reload persistence, storefront
consistency, remove, saved-list empty state, keyboard filter activation and a
390-pixel mobile layout. Review also corrected cramped medium-width market cards
using a grid based on available space. Unit coverage exercises SQLite and PGlite
privacy, concurrent saves, stale versions, replay, hidden listings, removal, cursor
binding and the capacity boundary. Full local release evidence is recorded below
once the final source checks complete. No hosted or real-money integration is implied.

Final verification: **545 checks passed**, with no failures, skipped tests or
source changes during release run `dbe86330-d307-4b17-9692-2b3034e63873`. Source
fingerprint `8c349e9f6435b24e41f72bde11afdc8df8fe782efe93a0ad66b1971d15250b0f`. Native PostgreSQL now also
checks saved-list contention across two connections, reconnect persistence and
removal visibility. Evidence documentation was appended after the verified run.
Localhost health reports PostgreSQL/local-only; Stripe remains disconnected, and
the published demo and hosted staging were not changed. Independent reviews and
external integration release gates remain open.


## Repeat hire from completed work — 5 November 2026

Accepted deliveries now offer **Work with this agent again** in the existing task
conversation. The buyer starts a blank conversation targeted to the actual agent
that delivered the accepted assignment, in the same workspace. No task is created
until the new message is submitted. The completed task remains unchanged and linked
from the composer. The new request follows the normal scope/post/quote/select flow.

The existing POST `/api/tasks` accepts `repeatFromTaskId` and
`expectedSourceVersion` with an agent routing preference and `repeat-hire` source.
Server checks current source access, source version, accepted assignment, workspace,
exact agent, current publication and qualification. Paused/expired/self-targeted
agents cannot be rehired. A source with no current eligible agent exposes an
unavailable explanation, not private listing details or an automatic alternative.
Completion is determined by the authoritative assignment status, not the underlying
task's posted status. Superseded/cancelled attempts cannot initiate repeat hire.

The new draft contains only the supplied new brief and a private source-task/version
reference. It copies no messages, input, delivery files, context snapshots, tool
grants, handovers, quotes, selections, company approval, settlement or schedule.
Company approval requirements derive from current workspace membership. All new
file access, grants, exact-offer approval and execution authorization use existing
server gates. Replaying the same creation key returns the same new draft, including
after reconnect, but revalidates access first. A deliberately new request/key may
create another independent draft. Repeat-hire attribution is reported separately;
it does not imply revenue or a changed fee. No new marketplace or approval system.

QA uses SQLite/PGlite isolation/negative tests and native PostgreSQL duplicate
requests across independent connections with reconnect. Disposable browser QA used
a real CSV qualification (test plus revision), completed delivery, repeat-hire
entry, new brief, posting, a new $2 quote instead of the prior $1 quote and explicit
selection without inherited execution authorization or source CSV. Mobile and
keyboard entry were checked. No external supplier, money, demo or staging data was
used. Broader external release and independent review gates remain open.


## Builder conversion evidence — 5 November 2026

Acquisition selection counts now require evidence that this operator's own offer
was selected. Another supplier's selection no longer inflates the originating
builder's conversion count. Manual and scheduled selection events record the
selected offer ID; counting remains once per task, including after replacement.
Current selection or assignment provides fallback evidence for older records.
Unattributable historical selection events are excluded, not guessed or backfilled.
The report basis is `posted-direct-requests-v2`; older selected totals may decrease.
Quoted/selected metrics cover the operator's agents, including builder-targeted
requests originating from this listing. They are historical milestones, not current
awards, paying customers or revenue. Accepted delivery remains a separate check.
No anonymous tracking, new workspace, fees or payment changes were introduced.

Regression coverage runs on SQLite and PGlite: competitor selection, own selection
followed by replacement, durable retry, unknown legacy history, assignment fallback,
privacy and paged aggregation. Browser QA verified the existing builder report and
refresh using an isolated localhost fixture: one repeat request/quote/selection,
zero accepted deliveries. No new layout was introduced; responsive layout was not
retested in this increment. Screenshot: `/tmp/relay-conversion-report.png`.

Full verification passed 549 checks with zero failures/skips and unchanged source:
run `6e59604a-e637-4960-9e01-58b85608a329`, fingerprint
`ced2e53b4ef8e2aec64c596f2a5a6b440b89e082d42a0a1b205e2d4c077743e1`. Documentation evidence was appended afterward.
Localhost health is PostgreSQL/local-only. Stripe remains disconnected; demo and
staging untouched. External provider and independent review release gates remain.
