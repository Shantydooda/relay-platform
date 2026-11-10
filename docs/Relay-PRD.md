<!-- Repository snapshot of ../relay/docs/Relay-PRD.md, synchronized 2026-11-10. -->
# Relay Product Requirements Document

**Status:** Draft for founder review
**Version:** 0.65
**Date:** 9 November 2026
**Product:** Relay, working name
**Review audience:** Founder, product, design, engineering and marketplace operations
**Decision requested:** Approve the initial customer segment, commercial pilot scope, operating model and release priorities described below. This document does not authorize launch, spending or external integrations.

## 1 Product definition

Relay is a distribution and customer-acquisition channel for independently operated agents, with a marketplace and protocol for purchasing their work. Builders connect existing agents to get discovered and win incremental paid demand. Buyers discover agents by the outcome they need, inspect capabilities and evidence, and request a supplier-backed quote. Outcome-first open requests remain an equally supported entry point. Relay coordinates the agreement, execution and delivery; billing alone is not the supplier value proposition.

This is the established product direction, not evidence of proven demand or unit economics. Relay remains broad as a platform; GTM campaigns may focus on specific outcomes and buyer groups without restricting open-ended agent capabilities. Relay does not require a pivot into a managed-service vertical.

Agent developers retain their models, tools, hosting, execution state and internal workflows. They connect to Relay to discover suitable work, quote, accept assignments, communicate, submit artifacts and receive payment. Relay does not require developers to upload their agent runtime.

The routing principle is **use the fewest agents needed to deliver the outcome reliably**. One agent is the default. Additional agents are justified only when a specific capability, quality, time or resilience benefit exceeds the added coordination cost. Agent count is an implementation choice, not the customer proposition.

The intended product has four connected responsibilities:

1. A marketplace for demand, qualified supply, quotes and assignments.
2. A work coordination system that coordinates scope, dependencies, checkpoints and exceptions.
3. A verification and delivery system that checks evidence against the agreed outcome.
4. A protocol that allows external runtimes and customer tools to participate safely.

The published `.site` prototype demonstrates these experiences. It remains browser-only and is not a production marketplace.

### 1.1 Distribution-first priorities — 4 November 2026

**Local implementation update (v0.60, 5 November): acquisition baseline.** Agent
settings now include an owner-only Acquisition section and an authenticated
builder-sharing link. Direct-request creation records a bounded source label
(market, storefront, builder-link or unspecified), the validated originating
agent/operator, routing mode and server timestamp. The source label is reported
by the client and is not verified causal attribution, a fee entitlement, or a
referral reward. No customer content or identifiers go into sharing URLs.

Counts are derived from persisted tasks in a consistent server read, in batches
of 100, rather than incremented in the browser. Only tasks with a task.posted event
and new attribution metadata count. Requests count distinct tasks; quoted counts
tasks with at least one offer by the target operator; selected counts tasks with
at least one offer.selected event; delivered counts accepted assignments by the
target operator. Repeated events and request retries do not inflate counts.
Cancelled requests remain in milestone history. Selecting an offer is not funding.
All sources refer to the originating listing, including builder-directed requests
that another agent of that builder may fulfill. This is acquisition by listing,
not a measure of each agent's execution quality.

Draft conversations, legacy unattributed work, open-market work and derived
scheduled runs are excluded. Local unpaid and sandbox tasks are included and
labelled; these counts are not paid customer/revenue validation. No private task
text, customer identity, visitor tracking or third-party analytics is exposed.
The report loads on opening agent settings or explicit refresh, not background
polling. Visits, visit-to-request conversion, repeat-customer analysis and public
anonymous links remain unimplemented. Query cost still grows with task history;
large-scale indexing/capacity evaluation remains required. No billing changes.


**Local implementation update (v0.59): permissioned portfolio excerpts.** Existing
agent settings now let builders add an original, rights-attested text example or
propose a redacted excerpt from accepted work completed by that same agent. The
exact title, summary and sample are immutable. Original examples are clearly
self-declared; Relay does not claim to have verified their ownership or quality.
Customer work stays pending and absent from storefronts until a current customer
workspace owner explicitly approves the exact text in the source task. Employees
and builders cannot approve company customer work. Existing task notifications
surface requests and decisions. No task prompt, client identity, input file,
delivery download, connected-tool data or URL is automatically published.

Approval publishes only the selected text to authenticated storefront viewers,
subject to the agent listing visibility. Customers can revoke; builders can
withdraw. Both hide it on subsequent reads and preserve decision history. Neither
can recall content already seen or copied. Editing requires a new example and new
approval; old request replay cannot restore revoked content. Current membership,
record version and idempotency are checked server-side. Accepted-delivery status
alone is never publication permission. There is a bounded local limit of 20
example-history entries per agent/task. Media galleries, external customer-work
consent, moderation and anonymous public portfolios remain future work.

Multi-builder orchestration remains deferred. Its intended coordination model is
a dependency graph under one parent agreement, not an unconditional waterfall:
independent steps may run concurrently; dependent steps consume approved,
versioned artifacts through explicit handover contracts. Relay would retain brief
versions, decision history, scoped permissions, per-step acceptance criteria,
retry/idempotency policy and budget allocations. A shared task does not imply
sharing every supplier’s private context or credentials. This is a design note,
not a shipped orchestration capability.


**Local implementation update (v0.58):** Agent Market now uses authenticated,
server-side discovery over all published non-self listings, including legacy
published records. Search is literal, case-insensitive text across agent/operator
names, purpose, domain and capability categories/tasks; category, agent type and
qualified-capability filters intersect. Pages default to 25 (maximum 50), with
filter/account-bound keyset cursors, total matches and Load more. Hidden listings
remain excluded and direct requests recheck eligibility. No anonymous marketplace
or new workspace was added.

The server scans records in bounded batches of 250 to remove the old completeness
limit. This is not indexed full-text/semantic ranking and has linear scan cost;
large-catalog performance/indexing needs a separate measured increment. Each
request has a consistent read, but successive pages are live rather than a frozen
snapshot: publication changes can alter totals or require a fresh search.
Categories reflect the whole eligible catalog at fetch time. The UI guards stale
responses, resets pagination on filter changes, preserves controls and offers retry.
Local release checks: 521 passed; live browser QA remains pending due to unavailable
browser control. Stripe stays disconnected; demo/staging/icebox are unchanged.


**Local implementation update (v0.57):** draft/published/paused listing controls
and owner preview now live in existing agent settings. New agents start as drafts;
legacy agents retain prior visibility. A hidden listing blocks new discovery and
direct requests without canceling existing work or changing bidding rules.
Individual account-gated profiles now load independently of the catalog window.
At that increment, catalog pagination, portfolios, public publication and attribution remained pending; v0.58 above supersedes the pagination status.
The v0.56 audit below records the pre-change findings.

**Implementation audit correction (v0.56):** the builder workspace, Agent Market,
capability evidence and direct quote entry already exist. A storefront is the
market's agent detail view, not another workspace. Extend existing agent settings
with listing lifecycle and owner preview; add authorized individual profile lookup
and paged discovery before portfolios and attribution. Current catalog retrieval is
limited to 100 records and profile links resolve only within that collection.
Private task files are not automatically portfolio assets. Keep purchase-time
evidence snapshots and direct operator routing; remove repeated discovery detail
from cards. See relay-platform/docs/Agent-Distribution-Audit.md for the source-backed
inventory and gap order. No new marketplace or onboarding is required.


**Builder promise:** Connect your agent. Get discovered. Win paid work.
**Buyer promise:** Find capable agents and buy the work you need done.

Build order for the distribution experience:
1. Agent storefronts and outcome-oriented discovery. Profiles identify the operator,
   agent type, specific capabilities and capability-level evidence. Buyers can move
   directly into the existing quote flow. Unverified capabilities must remain visibly
   distinct. No fabricated customers, ratings, prices, turnaround or availability.
2. Builder-managed publishing and portfolios: explicit listing controls, permitted
   sample artifacts, pricing guidance and scope limitations. Public anonymous pages,
   SEO and externally shareable URLs require a separately reviewed publication and
   privacy boundary; existing authenticated catalog access is not that boundary.
3. Acquisition attribution and builder analytics: distinguish Relay discovery from
   builder-shared links. Define deduplicated visits, qualified requests, offers,
   accepted offers, completed work and repeat purchases; do not show simulated
   counters as actual demand or put customer context into tracking URLs.
4. Repeat hiring: saved agents and reuse of approved briefs, with fresh terms and
   permissions when required. Recurring work remains explicitly authorized.

The first localhost increment is an authenticated storefront using existing catalog
fields, a stable local profile URL, current capability evidence, and direct quote
entry. It does not publish an agent to the internet or add portfolio uploads,
analytics, paid placement, production payments or automatic purchasing.

Measure distribution through incremental qualified demand, completed purchases,
repeat buyers, supplier earnings and contribution margin after support/revisions.
Supplier signups and page views alone do not establish marketplace liquidity.
Marketplace fees for Relay-acquired work versus lower infrastructure pricing for
builder-acquired customers are hypotheses for review, not approved pricing or
implemented settlement rules. Section 16 unit economics remain uncertain.

Existing production gates remain mandatory: authorization, accurate accounting,
provider verification, browser/accessibility QA and independent release review.
Advanced routing, multi-supplier orchestration and enterprise icebox items remain
unchanged and deferred. Stripe remains disconnected in local development.

## 2 Direction already established and proposals for review

| Area | Established direction from the discussion | Proposal requiring approval |
| --- | --- | --- |
| Customer promise | Buy an outcome; keep routing in the background | Start with inspectable business deliverables rather than unrestricted tasks |
| Supply | External operators connect existing agents | Curated operators and human-assisted routing for the first paid cohort |
| Work complexity | One agent if sufficient; coordinated specialists when beneficial | Single accountable operator in the first commercial release; multi-operator contracts later |
| Buyer experience | Continuous conversation, reuse supplied details, readable scope and confirmed quote; direct delivery for bounded tasks and guided review for complex work | One recommended quote with an optional comparison of qualified alternatives |
| Corporate product | Company workspace, employees, approvers, budgets, shared delivery | Small-team pilot; enterprise SSO and procurement automation deferred |
| Billing | Personal and business sources; crypto allowed | Card first; USDC as a gated pilot after provider validation |
| Delivery | Real files, previews, downloads and connected tools | Downloads first, then Slack and one CRM integration; Teams/email/streaming follow |
| Economics | Marketplace fee with operator payout shown separately | Test a fee equal to 20% of buyer subtotal, not a final pricing commitment |
| Design | Upwork-inspired marketplace clarity and Peec-inspired calm layouts: monochrome surfaces, restrained green accents and purposeful motion | Carry the same visual language through conversation, offers, buyer and builder workspaces, approvals and delivery; remove demo switches in production |

References to “must” below define the proposed product contract for the indicated release. Numerical targets, durations and operating policies are planning assumptions until approved.

## 3 Customer problem and initial segment

A buyer can access many AI tools but still has to translate an objective into instructions, select tools, manage revisions and decide whether the output is usable. Hiring a supplier can add another selection and coordination burden. Relay should reduce that work while preserving buyer control over cost, quality and external actions.

An operator may already have a capable agent but lack repeatable demand, payment infrastructure, a trusted reputation and a standard way to exchange work with customers. Relay should make commercially viable assignments available without taking over the operator's runtime.

A company has an additional problem: employees can buy fragmented AI services without a shared view of ownership, spend, permissions or deliverables. Relay should provide a governed way to request work without forcing every employee through a procurement process for each small task.

**Recommended initial segment:** small B2B teams with recurring sales research and marketing deliverables, plus individual founders buying the same outcomes. Prioritize company/account research as the first paid category because the structure and evidence are relatively inspectable. Keep video and website examples in the product, but admit paid jobs only when the supply and review process for each category are ready.

This recommendation is a sequencing choice, not evidence that demand or willingness to pay has already been validated. Customer interviews must establish task frequency, current spend, acceptance standards and the cost of coordination before scaling acquisition.

## 4 Competitive context and positioning

The originating discussion, [Bounty AI revenue analysis](chatgpt-conversation://6ad756ee-ab74-83eb-9988-d93a8f2c4393), establishes the marketplace-plus-protocol model and the one-agent-first principle. The supplied architecture brief reinforces external execution as the core boundary.

Bounty's current documentation says operators retain their runtime and decide whether to bid; buyers decide whom to hire. It documents persistent agent/job context and webhook recovery. Its October 22 update describes availability release to active, eligible, payout-ready agents. This supersedes the earlier local research inference that release necessarily implied undisclosed curated matching. [Bounty connection lifecycle](https://docs.trybounty.ai/agents/how-it-works/)

Bounty's raw API describes bidding as the normal path and claiming for older claim-mode jobs. It requires current terms and expected-version checks. Relay should not copy a race-to-claim model into its first release simply because an older reference supported it. [Bounty HTTP interface](https://docs.trybounty.ai/agents/raw-interface/)

Bounty already provides buyer-side MCP, posting, supplier communication, bid acceptance and a checkout handoff. Conversational scoping, agent connectivity or the phrase “buy outcomes” alone will not distinguish Relay. [Bounty buyer MCP](https://docs.trybounty.ai/buyers/mcp/)

Relay's differentiation hypothesis is that managed assignment, accountable project coordination, company controls and usable delivery into existing tools produce better repeat-purchase outcomes. Multi-agent coordination becomes valuable only if measured results support it. The potential defensibility comes from reliable supply, category-specific evaluation data, reusable outcome specifications and repeat workflows—not the number of integrations or an unproven routing claim.

The earlier research observed a 15% buyer markup on Bounty's posting form. Treat that as an October 20 observation, not a permanent fee guarantee. No reliable Bounty revenue or ARR figure has been established. Operator earnings, buyer transaction volume and platform revenue must not be treated as interchangeable.

## 5 Goals and non-goals

### Goals

- Convert a natural-language request into an explicit, reviewable outcome contract with minimal repeated clarification.
- Obtain a quote backed by an accountable, available operator before promising a fixed price and delivery window.
- Preserve project identity through posting, approval, funding, execution, revisions, delivery and settlement.
- Make quality review evidence-based and distinguish automated checks from buyer judgment.
- Deliver work as usable artifacts, with optional authorized transfers into customer tools.
- Give companies clear ownership, spending policy and auditability without overloading employees.
- Demonstrate positive contribution per fulfilled job and repeat buyer demand before expanding supply or orchestration complexity.

### Non-goals for the first commercial release

- Hosting arbitrary customer or supplier agent runtimes.
- Unlimited autonomous purchasing, public publishing or access to production customer systems.
- A universal marketplace for regulated advice, sensitive personal-data acquisition or unrestricted outreach.
- Fully autonomous multi-provider composition for any imaginable objective.
- Guaranteed revenue, guaranteed sales from leads, or guaranteed commercial performance of creative work.
- Enterprise-wide procurement, HR identity synchronization, unrestricted streaming and every CRM at launch.
- A custodial crypto exchange, speculative crypto balances or a proprietary token.

## 6 Users and responsibility model

| Persona | Main job | Primary next action |
| --- | --- | --- |
| Individual buyer | Get a specific outcome without managing tools | Finish brief, approve quote, review checkpoint or accept delivery |
| Employee requester | Obtain useful work within company policy | Request budget, supply inputs, review own work and choose delivery destination |
| Budget approver | Authorize a defined commitment | Approve or decline the exact quote with a reason |
| Company admin | Govern workspace, sources and permissions | Resolve budget or connection blockers, manage members, authorize funding where required |
| Operator | Earn a margin on reliable execution | Quote suitable work, accept assignments, submit checkpoints and artifacts |
| Relay operations | Keep the marketplace functioning | Resolve unmatched work, stale assignments, disputed quality and settlement exceptions |

An account can buy work and operate agents. Buyer and operator identities remain separate for assignment and reputation. Self-dealing must not create public ratings or artificial earnings.

For the initial pilot, the operator owns production responsibility and Relay owns customer coordination and adjudication. Relay's legal role in the transaction—marketplace intermediary, contracting principal or another structure—requires a separate commercial/legal decision before live launch. UI language must match the adopted structure.

## 7 Release scope

| Release | Included | Exit condition |
| --- | --- | --- |
| Current prototype | Local buyer/builder flows, corporate role previews, demo billing, sample assets, simulated connections | Reviewable UX only; no claim of real fulfillment |
| P0 paid concierge pilot | Real identity, isolated workspaces, scoped requests, curated supplier quotes, card funding, checkpoints, file upload/download, evidence review, operational dispute handling, basic company approvals | End-to-end jobs and settlement reconcile without role or data leaks |
| P1 repeatable marketplace | Supplier API and SDK, buyer/operator MCP, automated checks, category reputation, Slack and one CRM, policy-driven company exports, eligible USDC pilot | Repeat usage and positive contribution with bounded support load |
| P2 expansion | Multi-operator execution graphs, Teams/email expansion, scoped streaming, enterprise identity and richer budgets | Controlled experiments demonstrate quality and economic benefit |

The external-runtime boundary is P0 even if the first operators use a portal and manual notifications. API/MCP surfaces are a staged means of implementing that boundary, not a requirement to build four production transports before the first customer can receive work.

## 8 Buyer experience requirements

### Entry and onboarding

**BUY-01 — Preserve intent.** A visitor can begin a brief before signing up. Signup retains the brief and asks whether they want to get work done or connect an agent, then whether the workspace is personal or business. Switching intent later must remain possible.

Acceptance: entering a website brief, completing signup and choosing buyer onboarding returns to that brief without forcing re-entry. An existing user signs into the correct workspace rather than being silently reset to personal.

**BUY-02 — Clarify only missing information.** Relay extracts explicit details, shows the user's wording alongside interpreted fields and asks one focused question at a time. It distinguishes supplied facts, inferred suggestions and unresolved conflicts. Contradictory quantities, budgets or delivery constraints require resolution.

Acceptance: “100 German SaaS companies, 10–100 staff, CSV with website and source” does not prompt for the same quantity or country again. Employee count is not mistaken for requested row count. Corrections update the scope and invalidate dependent estimates and quotes.

**BUY-10 — Keep the conversation open.** The composer remains available after all required details are present and on the brief recap. A user can ask a question, correct a detail or add a requirement without starting over. Recognized corrections update the structured brief and preserve unaffected details. Informational and hypothetical questions must not silently change scope, even when they mention quantities or formats. Explicit requests such as “Can you make it 20 companies?” should update the brief; “What if I needed 200 companies?” should discuss the option without committing the change. The original request and subsequent changes remain distinguishable.

If Relay cannot confidently interpret a message, it must acknowledge that uncertainty and ask a focused follow-up. It must not pretend a change was understood. The prototype offers explicit confirmation to add unsupported text as an exact requirement and routes it to guided review; production must resolve ambiguity sufficiently for suppliers to quote. An exact-text note alone is not proof that a requirement is feasible or testable.

Acceptance: after a complete company-list brief, “Make it 20 companies in Canada” updates quantity and geography while retaining other requirements. “How much will it cost?” explains the estimate/quote distinction without altering the brief. The user can continue typing in either case.

**BUY-03 — Define the outcome.** The reviewed scope includes deliverables, formats, quantity, audience, inputs, acceptance criteria, exclusions, review mode and any agreed checkpoints, revision allowance, data permissions and timing assumptions. Scope versions are immutable after commitment; changes create a new version.

**BUY-04 — Separate estimate and quote.** An estimate is a planning range with assumptions. A confirmed quote records supplier consent, expiry, operator payout, Relay fee, taxes if applicable, total, required inputs and delivery window. The system must never label an unaccepted supplier estimate a confirmed commitment.

**BUY-05 — Make start conditions explicit.** Work starts only after valid buyer approval, any company approval, confirmed funding, supplier acceptance and required inputs. The buyer sees the remaining blocker. A connected card, an approved budget or a checkout redirect alone must not activate a project.

### Samples and reference material

**BUY-13 — Attach samples while scoping.** Buyers can attach example outputs, style references, brand assets or sample data from the request conversation and scope recap, with a per-file note describing how the supplier should use it. Show filename, size, upload state and remove/download actions. Reference files remain distinct from acceptance criteria and from supplier deliverables; attaching an example must not imply that Relay has understood its content or that the supplier has permission to reproduce it.

Include reference metadata and immutable file versions in the scope reviewed by suppliers. Eligible suppliers may access authorized references when quoting; the awarded supplier retains access during fulfillment. Changes after posting must use scope revision and invalidate affected offers/approvals. Funded references cannot silently change. Production access must respect workspace policy, file sensitivity and least privilege; confidential files must not be broadcast to all agents.

**BUY-14 — Preview references in context.** Buyers and authorized suppliers can open a reference inside the task, with its usage note alongside the content. On narrow screens the note stacks below the preview. Opening, closing or paging through a reference does not alter scope, approve a checkpoint or accept a delivery.

| Reference type | In-task experience | Fallback |
| --- | --- | --- |
| PNG, JPG/JPEG, WebP | Image contained within the preview area without distortion; filename and usage note visible | Original download if decoding fails |
| PDF | Locally rendered pages with current/total page count and previous/next controls; boundary controls disabled | Clear rendering error and original download for unsupported or protected documents |
| MP4 | Native playback, pause, seeking and volume controls; no autoplay; usage note remains visible | Original download if the browser cannot play the codec |
| TXT, CSV, ZIP | Filename, size and usage note; download available | No inline preview promised in the initial release |

Show loading, unavailable-file and format/decode error states. A preview failure must not remove the reference or its note. PDF rendering must not execute embedded scripts or interactive content. Reference files and their instructions remain untrusted inputs, including when an agent processes them.

A compact reference summary with filenames and a link to usage notes appears during scope review and quoting. References remain accessible during execution and in the delivery desk, clearly labeled as buyer inputs rather than supplier outputs. When references are attached, new supplier submissions include a short explanation of how they were used and any departures from the usage notes. Store this explanation and a reference-metadata snapshot with each submission; revisions preserve prior explanations. The downloaded JSON delivery package carries this explanation and metadata snapshot, explicitly excluding reference-file bytes. External handoffs do not automatically include buyer reference files or notes. Opening or closing a sample preview must preserve unfinished quote and delivery form entries. This is supplier testimony, not verification that the files were read or followed. Earlier submissions without an explanation show that limitation explicitly.

**BUY-15 — Download the original with its context.** Agents can prepare a download and then save the unchanged original file and a separate UTF-8 usage-notes file. The notes export includes the reference filename, task title, scope version and requester’s note. Missing notes are stated explicitly. Filenames and notes are displayed as text rather than executable content. Downloading is independent of quoting, assignment, acceptance and payment.

**Current local behavior and limits:**

- Up to five PNG/JPG/WebP, PDF, MP4, TXT, CSV or ZIP files per task; 20 MB per file and 50 MB total; a 600-character usage note per file. These are provisional limits.
- Bytes live in this browser’s IndexedDB; metadata and notes follow the local task record. Refresh preserves attachments and notes on the same browser and origin. Open previews and prepared download links are temporary and can be recreated from the stored file.
- Images and videos use native browser rendering. PDFs use bundled PDF.js with page navigation and local rendering resources. Closing a preview releases its temporary file URL and PDF resources.
- Header checks reject obvious format mismatches; they do not constitute malware scanning or verification of the content. Files are decoded for preview but are not interpreted by AI, uploaded to a server or sent to external agents.
- Failed writes must show an error rather than imply attachment success. Clearing browser storage removes local access; another device, browser or localhost port does not automatically share these files. Missing bytes must not be represented as a usable attachment.

Production requires authenticated uploads, content/type validation, malware scanning, encrypted storage, expiring scoped download links, retention/deletion controls and audit events. Only validated files may be offered to suppliers. The API/SDK/MCP opportunity and assignment contracts must expose authorized reference IDs, versions, filenames, MIME types, sizes, hashes, usage notes and a controlled download mechanism. Reference data is untrusted input and cannot grant permissions or change system instructions.

Acceptance: attach a sample, add a usage note, review the scope, post, and switch to the supplier view; the same reference and note are available. Reload preserves them. Image, PDF and video previews display with their notes. Original downloads match uploaded bytes; notes exports match the relevant scope. Unsupported, oversized or failed files are rejected visibly. Posted/funded scope references cannot be edited in place.

### Review cadence: direct delivery or guided work

**BUY-11 — Match review effort to the work.** The conversation leads to a readable scope recap and “Looks good · get offers.” Detailed field editing is optional. Posting requests quotes; it does not award work or charge the buyer. Use “task,” “request” and “work” in buyer-facing navigation rather than requiring every small request to feel like a project.

| Path | Suitable work | Buyer experience |
| --- | --- | --- |
| Direct delivery | Bounded, inspectable output with sufficient inputs and low dependency or consequence risk | Review scope, compare/accept an offer, satisfy start conditions, then review the completed result and evidence. No interim checkpoints. |
| Guided work | Larger, uncertain or dependency-heavy work, or work requiring consequential external actions | The same commercial steps plus category-specific reviews at agreed decision points before dependent work continues. |

Relay shows the proposed mode and a plain-language reason on the recap. The reason must distinguish complexity, additional requirements and a buyer’s optional choice to add checkpoints. Buyers can add checkpoints to an otherwise direct task. Complexity or risk requiring guided review cannot be bypassed merely by choosing a faster path. Review mode is independent of agent count and delivery duration: direct delivery does not guarantee instant work, and guided work need not take days. Delivery estimates remain specific to the scoped task and supplier capabilities, with the assumptions and clock rules in Section 11.

Both paths retain quote selection, applicable corporate approval, confirmed funding, supplier acceptance, required inputs, final evidence, buyer acceptance, revisions and payout controls. The builder sees the same agreed review mode as the buyer. With no interim checkpoints, the builder submits final artifacts and evidence directly; final verification and acceptance are never skipped. Corporate roles see the same task state and their own next action.

**BUY-12 — Reassess changes without rewriting commitments.** Before posting, changes to scope recompute the proposed review mode and explain any change. After quoting, a changed scope requires new offers and invalidates dependent approvals. Once funded, changing scope or review gates requires an agreed change request. Existing work retains its committed checkpoint structure; no migration may silently remove a review. The current prototype supports reposting revised scope for new offers, not a production contract-amendment system.

Prototype thresholds are illustrative: up to 50 company records without sensitive contact work, up to three static website sections without live collection, or up to 15 seconds of video with explicitly approved, ready assets. External actions and integrations require guided review in the demo. These are unvalidated heuristics, not capability or safety guarantees. Production classification must evaluate scope, consequences, supplier capabilities, uncertainty and workspace policy, and seek clarification where needed.

### Execution and review

**BUY-06 — Show useful progress.** Each update identifies the milestone, completed output, next action, owner and timing implications. Avoid fabricated activity or exposed model reasoning. Operator details remain available when needed for trust and troubleshooting.

**BUY-07 — Enforce agreed checkpoints.** Direct delivery has no interim review gates. For guided work, work dependent on a checkpoint stays paused until the authorized requester/admin approves it. Feedback stays attached to the versioned artifact. Approval of a storyboard is not acceptance of a final video.

**BUY-08 — Preserve context through revision.** The operator sees the exact requested changes, evidence and submission version. In-scope corrections remain on the project; extra requirements trigger a priced change request. Neither party can silently rewrite the funded contract.

**BUY-09 — Separate verification and acceptance.** A machine check reports what was checked, the evidence, result and limitations. Creative fit and business usefulness remain buyer decisions. Acceptance records the submission ID, actor and timestamp and creates a payout instruction exactly once.

## 9 Corporate workspace requirements

### Membership and permissions

The workspace owns projects, billing policy, tool connections and delivery records. Every request records a requester, department or cost center and responsible approver where applicable. Production invitations are single-use, expiring and scoped to a workspace role. Revocation immediately stops new privileged actions; it does not delete project history.

| Capability | Employee | Approver | Admin |
| --- | --- | --- | --- |
| Create a request | Yes, within policy | Yes, as requester | Yes |
| View projects | Own and explicitly shared | Assigned approval context and explicitly shared | Workspace-wide, subject to restricted projects |
| Approve own spending request | No above threshold | No above threshold | Explicit override policy with audit |
| Approve assigned budget request | No | Yes | Yes |
| Fund work | Own valid approved quote using permitted source | Only when separately acting as authorized requester | Yes |
| Manage payment sources or integrations | No | No | Yes |
| Accept or revise delivery | Own projects or explicit delegate | Only own/delegated projects | Yes, with audit |
| Export externally | Own accepted work within policy | Own/delegated work within policy | Manage policy and exceptional approvals |

Role capabilities are additive: an approver can also be a requester. The current prototype's simplified role switch must not become the production authorization model. Company-wide visibility in the demo is also not a production privacy default.

### Budget and dashboard

**CORP-01 — Bind approvals to commercial terms.** Approval records scope version, quote ID, total, currency, supplier identity and expiry. Material changes invalidate approval. Declines require a reason and return the requester to the same project.

**CORP-02 — Enforce budgets atomically.** Pending approvals are requests, not reserved funds. On funding, reserve budget and create the payment intent transactionally. Two simultaneous $150 purchases cannot both consume the same final $200 allocation. Failed payment releases the reservation; successful funding converts it to committed spend.

**CORP-03 — Define every spend number.** Show allocation, reserved, committed, completed, refunded and available values with the selected period/currency. The pilot may use one lifetime USD allocation as in the prototype. Monthly resets or cost-center budgets require an explicit later policy and timezone. Completed spend remains part of committed spend; do not add it twice.

**CORP-04 — Prioritize role-specific work.** Admins see policy/payment/destination blockers; approvers see their budget queue; employees see their own quote, input, checkpoint and delivery actions. Filters include all permitted team requests, mine, awaiting approval, in progress and delivered. Empty states explain the next useful step.

**CORP-05 — Preserve handoffs.** Changing role, returning from billing or reopening a notification returns to the relevant project and outstanding action. Removing a requester requires an admin to assign a replacement owner. Approval delegation is explicit and audited.

## 10 Marketplace and operator requirements

**SUP-01 — Agent identity and readiness.** Operators create an Agent Card with capabilities, supported output formats, capacity, runtime contact, data-handling constraints, sample work and operating entity. Identity and payout onboarding precede paid eligibility. A successful connection test is not proof of quality or autonomy.

**SUP-02 — Discover without premature commitment.** Eligible operators receive redacted opportunity details and may ask scoped questions, decline or quote. Discovery does not reserve work or grant access to confidential inputs. Release criteria and reasons for ineligibility should be understandable to the operator.

**SUP-03 — Quote with capacity.** A quote includes payout, window, assumptions, dependencies and expiry. The operator must explicitly consent to the current scope. Competitor bids remain private. Selection is atomic; the losing quote cannot later become an active assignment through a delayed event.

**SUP-04 — Maintain one durable context.** Messages, retries, scope changes, checkpoints and revisions resume the same project/assignment context. The operator controls its local persistence. Relay stores the authoritative contract and state.

**SUP-05 — Support failure and relinquishment.** An operator can report a blocker or request withdrawal with a reason. Relay operations handles reassignment, approved partial compensation or cancellation. Replacement suppliers cannot inherit customer secrets or change price without appropriate authorization.

**SUP-06 — Make economics legible.** Show offered payout, fees if any, acceptance criteria, expected rework obligations and settlement state. Pending earnings, released payout and funds received in the bank are distinct. No promised earnings or unlimited free revision burden.

The pilot should recruit a small, vetted supply cohort per supported category. Manual qualification tasks must be paid or clearly identified as voluntary samples; the marketplace should not depend on speculative unpaid production from many bidders.

### Builder onboarding product POV (v0.18)

**Product objective:** help an operator bring an existing agent to paid work with a clear next action. Relay registers and connects the supplier's agent; it does not imply that choosing a type creates or hosts one.

**Current prototype, verified on the published site:** separate general-purpose and domain-specialist agents can coexist under one supplier. Each retains its own connection and capability assessment state across refresh. Both can quote on the same task. Buyers see type, supporting capability and matching assessment status on the offer, and can expand the full roster to distinguish qualified from unassessed capabilities. Paid-work history remains separate. All execution, assessment decisions and payments are simulated.

**POV:** the information model is sound, but the six-stage setup feels more like integration documentation than a marketplace onboarding experience. A builder's immediate questions are “Can my agent work here?”, “What do I need to connect?”, and “When can it quote?” The experience should answer these progressively and preserve a clear path back to earning work.

**Three-stage experience (v0.19 prototype):** the interface now groups requirements into three user-facing stages. Connection checks and assessments are simulated; automated runtime checks and commercial eligibility remain production work:

1. **Introduce your agent.** Choose General-purpose or Domain-specialist, name it, describe its focus and add one concrete capability. Permit more capabilities now or later. Show a live buyer-profile preview, including “Declared · not assessed.” Explain that either type can support multiple capabilities and that type alone does not improve ranking.
2. **Connect your runtime.** Choose API, SDK or MCP with a short “best for” explanation. Reveal only that method's setup instructions. A production connection check should run automatically, report identity/permission/event-delivery checks and expose failures with retry actions. Keep detailed protocol documentation available without making the builder manually role-play buyer funding and settlement.
3. **Demonstrate and get ready for work.** Select one capability, inspect its bounded test, allowed inputs, expected effort, compensation policy and assessment criteria before starting. Show real execution progress, evidence received, revision feedback and independent review. End with either eligible work, a precise remaining requirement, or review status and the next update. Never promise instant approval for a capability without an approved rubric.

The nine-step sandbox lifecycle is now an optional developer diagnostic under Connect. A quick simulated connection check unlocks capability assessment without completing that diagnostic. Skipping it does not award a capability pass. A successful technical connection and a successful quality assessment must remain separate even when their interface is simplified.

**Persistent readiness summary (implemented in prototype):** show Profile, Connection, Capability assessment, Operator checks and Payout setup as distinct states. Each incomplete state has one next action. “Ready to quote” and “Ready to receive paid assignments” must reflect a defined policy, not a generic completion percentage. Proposed pilot policy: browse redacted opportunities before readiness; enable commercial quotes only after at least one relevant assessment and required operator checks; require payout readiness before paid assignment. Current demo eligibility is more permissive and must remain labeled simulated.

**Multiple-agent continuity:** always name the active agent when editing, testing or quoting. Adding another agent preserves earlier profiles. Switching agents restores each agent's state. An offer binds agent ID, capability revision and assessment reference; switching the active builder profile never changes ownership of an accepted assignment or buyer-visible results. Production should also identify a shared operator behind multiple agents so sibling offers cannot masquerade as independent suppliers; duplicate-offer and ranking treatment require pilot policy.

**Acceptance criteria for the simplification:** builders can save and resume at each stage; connect only the selected method; recover from failed checks without losing declarations; qualify one capability while leaving others unassessed; receive clear review/retry feedback; see the same status as buyers; and arrive at relevant work with blockers explained. Track registration-to-connection completion, assessment completion, time to eligibility, first valid quote and abandonment by stage. Targets remain unvalidated until pilot data exists.

### Capability qualification: demonstrate, revise, assess

**Agent type (v0.16):** During Agent details, builders explicitly select General-purpose or Domain-specialist. General-purpose describes breadth across fields; Domain-specialist requires an open-ended domain such as B2B sales or brand design. Both types support multiple capabilities without category restrictions. Type and domain are supplier-described profile metadata, not verified competence, paid eligibility or a ranking boost. Changing only this classification preserves capability evidence and connection progress; changes to actual capability scope or runtime retain existing reassessment rules. The chosen type appears in capability setup and the buyer-visible capability profile. Existing agents remain unspecified until their builder chooses a type; do not infer one from a legacy task category. Proposed Agent Card fields: `agent_type: general | specialist`, `domain: string` (required only for specialist).

**Builder setup and multiple capabilities (v0.14):** Agent details → Capabilities → Connection method → Setup → Connection test → Qualification. Capability declaration happens during agent setup, before integration or evaluation. One agent can add multiple capabilities across any broad categories, with no fixed list or product count limit. Each record has a stable ID, category (suggestions plus free text), specific task name in the builder’s words, deliverables and scope limits, optional required inputs/human assistance, and a capability revision. For example: Sales & Marketing / Lead generation; Sales & Marketing / GTM planning; Design / Pitch-deck design. “Design” is a discovery category, not a sufficient description of what the agent delivers. Distinct tasks requiring different evidence should be separate capability records. Adding a capability requires no assessment brief or rubric.

Builders can add, edit and remove capabilities from their profile. An unchanged save preserves qualification; changing a capability’s category, task, scope or inputs requires reassessment of that capability only. Adding a new capability does not invalidate others. Superseded assessment data is retained; removed capabilities are hidden from future offers and cannot carry a current qualification. Existing saved declarations migrate without inventing passes. The integration test fixture remains a technical walkthrough independent of declared capabilities; agent details no longer display a restrictive specific-task selector.

Qualification selects from the agent’s declared capabilities and records a separate result for each capability revision and agent configuration. The prototype uses illustrative test and revision prompts derived from the declaration; in production an independent evaluator must approve a representative challenge and rubric. A supplier claim is not proof. New capabilities begin “Declared · not assessed”; passing one never grants a universal qualification or copies the result to another. Quote records store the chosen capability ID and revision. Buyers see the specific supporting capability, its assessment status and limitations; old offers cannot inherit a new pass for materially changed scope. Production matching considers actual task requirements rather than label equality. Existing buyer creation/delivery examples remain research, video and website demonstrations; open supplier declarations do not claim universal execution support.

**Buyer transparency and continuity (v0.15):** Offer cards name the capability supporting the offer before expanding assessment details. A separate current-profile list displays every active declared capability, its category, scope/inputs and individual assessment state; the skill used for the offer is marked. Current profile status must not be confused with the capability revision committed in the quote: the offer assessment still checks its stored revision. Other suppliers never inherit this agent’s statuses. Saving unchanged agent details preserves integration progress; genuine configuration changes continue to require the relevant checks.

A reusable agent may have several capabilities while each job runs in a separate execution context. Capability breadth, concurrent-job capacity and the number of agents assigned to one job are separate concepts. Relay should assess demonstrated performance per capability and prefer one agent where sufficient; coordinated specialists are justified by measurable quality, reliability or speed benefits. Anthropic’s [Agent Skills documentation](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) describes composable capabilities for general-purpose agents, while [Building effective agents](https://www.anthropic.com/research/building-effective-agents) recommends increasing architectural complexity only when needed. This supports the architecture direction, not a guarantee of any supplier’s performance.

Acceptance scenarios: register a new agent, add Lead generation, GTM planning and Pitch-deck design under two categories, refresh and recover all three; complete an assessment for one and confirm the other two remain unassessed; edit only one capability and invalidate only its result; quote using any declared capability and show the correct revision to the buyer; do not offer undeclared template capabilities as agent skills.


Qualification is capability-specific and separate from operator identity, payout readiness, API/SDK/MCP connection certification and paid-work reputation. A successful connection proves protocol compatibility; it does not prove output quality. Portfolio examples are supplier claims until independently assessed.

Proposed pilot flow:

1. Register an agent and complete the integration test lifecycle. Declare any specific capability in the builder’s own words; an agent may have multiple capabilities with no fixed category list. Research, video and websites are example assessment templates, not eligibility boundaries.
2. Receive a representative, bounded test brief with acceptance criteria and permitted inputs. Production challenges should vary to limit memorized answers; use synthetic or licensed data and avoid unpaid client production.
3. Execute through the registered runtime and submit an immutable artifact manifest, criterion-specific evidence, elapsed time, costs, tool permissions and any human assistance. Inspect actual outputs; prose assertions alone are insufficient.
4. Receive a small, in-scope revision. Submit a new artifact version and change explanation. Feedback handling is assessed alongside the initial output.
5. An independent evaluator records **passed**, **needs improvement**, or **manual review pending**, with evidence and reasons. Suppliers may submit or appeal; they cannot grant their own qualification. Automated file/schema checks support human review where judgment is required. Missing evidence or unresolved critical failures prevents passing.
6. A passing result supports limited pilot access only after separate operator and payout checks. Paid work builds a distinct history of outcomes, reliability, revisions and disputes. Monitor degradation and reassess material runtime/model/tool changes.

| Capability | Initial assessment | Required revision | Evaluation focus |
| --- | --- | --- | --- |
| Company research | Structured company CSV, sources and rationale | Add confidence and handling of uncertain information | Accuracy, relevance, provenance, uniqueness and usable structure |
| Launch video | Playable clip matching duration, aspect ratio and brief | Improve an opening scene and resubmit | Brief adherence, media integrity, asset rights and response to direction |
| Landing page | Responsive preview and source package | Clarify the call to action on mobile | Functional behavior, accessibility, responsiveness and reproducibility |

Store assessment ID, operator/agent ID, agent configuration/version, capability, brief/rubric version, attempt number, both artifact manifests, evidence, assistance disclosure, reviewer identity, timestamps, outcome and reasons. Preserve attempts for audit; material changes supersede qualification rather than inheriting it. Retest cadence, pass thresholds, reviewer costs, challenge compensation and limits on initial paid work remain pilot decisions—not validated policy or established unit economics.

Buyers see the capability and assessment status on offers, with assessment date, assistance disclosure and scope limitations. Show “Assessment passed” separately from “New to Relay” and verified paid-work history. A pass is neither a task guarantee nor an automatic recommendation: recommendations still balance task fit, quality evidence, price, speed and reliability. No matching assessment is labeled unknown, never implied by fictional ratings. Production quote records should retain the assessment reference and its status at quote time, with current revocation/supersession checked again before award.

**Prototype contract (v0.12):** A dedicated builder onboarding step lets users choose a capability after the connection test, submit a sample reference and criterion notes, complete a mandatory revision, and preview a reviewer outcome. Explicit demo reviewer controls simulate all three outcomes. Sample evidence is labeled fictional; no runtime executes and no file is independently evaluated. Results persist in browser storage per agent configuration and capability. Offers created by that agent reference the configuration and display the matching result; older offers without a reference or offers from other agents show “Not assessed in this demo.” Changing the configuration invalidates the visible match. Assessment status does not alter existing demo ranking, funding permissions, or fabricate paid-work history. The builder includes an exact buyer-status preview. A failed attempt can be restarted; manual review remains pending without a production reviewer service.

Acceptance checks: block qualification before connection-test completion; block missing evidence and skipped revision; require both submissions before a simulated decision; preserve status across refresh; prevent a different capability, agent or changed configuration from inheriting a pass; show transparent status on buyer offers; retain existing quote, approval, funding and delivery behavior.

## 11 Routing and orchestration

Eligibility is a hard filter: task-relevant capability evidence, required file types, availability, approved geography/data policy, permission boundaries and payout readiness. Ranking then considers demonstrated quality, relevant reputation, delivery reliability and total cost.

The first routing implementation can be operations-assisted. It should recommend one qualified operator with an explanation such as “matches the required format and has capacity for this deadline.” Buyers need meaningful quality and timing information, not internal model scores presented as objective truth.

For later multi-operator routing, the execution graph records dependencies, artifact contracts, access permissions, individual commitments, payout allocation and a responsible lead. Every necessary operator must accept before the buyer is promised the aggregate quote. Coordination and verification costs must fit the approved total.

When a node fails, pause dependent work, retain successful artifacts and determine whether retry, replacement or scope change is needed. A replacement that changes price, deadline, data exposure or acceptance criteria requires buyer/company approval. An automated router must never manufacture capacity or silently charge for an additional specialist.

A controlled routing experiment should compare matched single-operator and multi-operator jobs on first-pass acceptance, elapsed time, buyer effort and contribution. Add orchestration only if it improves the combined result. Category reputation and routing data are hypotheses for defensibility, not a proven moat.

### Managed competition and supplier selection

**Proposed model:** eligible suppliers compete with private quotes for the same scope; Relay recommends a qualified offer with a concise explanation, and the buyer chooses. One funded assignment is awarded atomically. Suppliers do not all execute speculatively, and choosing an offer for review does not itself authorize execution.

The proposed selection sequence is:

1. **Eligibility:** require task-relevant capability evidence, supported deliverable formats, available capacity, deadline compatibility, data/region policy compliance, permission boundaries, operator readiness and payout eligibility. Self-declared capability is not verified capability.
2. **Candidate invitation:** invite a small batch of relevant suppliers using a redacted brief. Expand the batch if insufficient suitable offers arrive. Batch size and response windows remain pilot experiments; no fixed 100-agent broadcast is required. Include a controlled opportunity for qualified newcomers.
3. **Private offers:** record agent/operator identity, exact scope version, supplier payout, buyer total, delivery window, included revisions, assumptions, capacity commitment, expiry and offer revision. Suppliers can replace or withdraw their own unawarded offer. They cannot read competing offers or competing supplier conversations.
4. **Evaluation:** compare only currently eligible, unexpired offers against identical acceptance criteria. Assess relevant capability evidence, first-pass acceptance, on-time delivery, withdrawal/failure history, current capacity, buyer fit and total cost. Compare category-specific evidence rather than treating a generic star rating as sufficient.
5. **Recommendation:** show one recommended offer and a small set of meaningful alternatives, such as lower cost or earlier delivery. Explain the evidence, its sample size, material limitations and tradeoffs. Buyers may choose an alternative. Do not claim an objectively best agent or turn uncertain evidence into a precise-looking quality guarantee.
6. **Review and award:** bind selection, company approval and funding to the exact offer ID, revision, scope version, price and delivery terms. A replacement, withdrawal, expiry or scope change invalidates affected approval. A selection change clears prior approval. Funding rechecks availability and versions before creating one assignment; remaining offers become not selected. Losing suppliers receive a status update without private competing bid details.

| Selection signal | Evidence | Category emphasis |
| --- | --- | --- |
| Capability fit | Qualified samples, supported formats and comparable completed work | Research sourcing, video style/production requirements, website functionality |
| Quality | Criterion-level results, first-pass acceptance and revision history | Accuracy/freshness for research; creative fit for video; functional correctness for websites |
| Reliability | On-time delivery, failures, withdrawals and response history | Interpret relative to job difficulty and buyer-caused delays |
| Capacity | Explicit commitment, current workload and start availability | Hard deadline constraints precede ranking |
| Value | Buyer total, included revisions, time and expected coordination burden | Lowest price is not automatically highest value |
| Buyer fit | Language, industry, data constraints and prior successful collaboration | Respect company policy and avoid unsupported suitability claims |

Weights, minimum evidence thresholds, shortlist sizes and tie-breakers are not validated. The pilot may use operations-assisted evaluation with logged reasons. New agents should receive qualification opportunities and limited lower-risk work; no-history must be labeled as unknown, not converted into invented positive reviews or treated as proof of poor quality. Sample sizes, recency, task complexity and operator identity must be considered to reduce misleading rankings, duplicate identities and reputation gaming. Suppliers should receive actionable eligibility/decision reasons without competitor pricing disclosure.

**Prototype contract:** localhost supports multiple private supplier offers against one shared scope and an advisory recommendation. Capability fit is a qualifying check (illustrative threshold: 80/100); the ranking then balances four dimensions:

| Buyer priority | Quality | Reliability | Price | Speed |
| --- | --- | --- | --- | --- |
| Balanced (default) | 35% | 35% | 20% | 10% |
| Quality first | 65% | 25% | 5% | 5% |
| Lower price | 20% | 20% | 55% | 5% |
| Faster delivery | 20% | 20% | 5% | 55% |

These are unvalidated demonstration weights, not an established production ranking policy. Demo quality uses first-pass acceptance and reliability uses on-time delivery. Price and speed use the lowest buyer total and shortest quoted duration among current qualifying offers with history as their respective reference points (reference / offer × 100). Ties use lower price, then stable offer ID. These relative scores are sensitive to the available candidates and must not be presented as objective quality scores. Production requires calibrated evidence, eligibility constraints and checks against unrealistic low bids or timing promises.

The buyer sees “Why Relay recommends this agent,” comparable-job sample size, acceptance and on-time rates, extra cost versus the cheapest available offer, and extra time versus the fastest. Each alternative receives the same tradeoff explanation. Changing priorities recomputes advice and persists the preference without selecting a different supplier or changing an approved contract. Explicit offer selection remains required. Suppliers without history remain selectable with an unknown-history label and a sample-review suggestion; the prototype does not fabricate metrics or automatically recommend them. Production qualification must provide a fair pathway for newcomers rather than permanently excluding them.

All competitor histories, availability and processing rates are fictional. The prototype does not evaluate real agents.

Selection acceptance scenarios must cover: priority changes affecting the recommendation but preserving selection and approval; workload-dependent estimates for all three categories; missing supplier rationale; unknown-history handling; existing-quote preservation; two offers for the same scope; a cheaper alternative winning by buyer choice; offer replacement/withdrawal; expiry while a funding dialog is open; scope-change invalidation; switching suppliers after company approval; duplicate funding; reload persistence; builder privacy; and delivery attributed only to the awarded supplier. Unselected offers cannot later become assignments through stale callbacks. Execution, verification, delivery and payout continue on the original project ID and selected offer record.

### Execution time, elapsed delivery and review waits

Relay should feel appropriate for agent work: new quotes use minutes or hours, rather than defaulting to freelance-style day estimates. A few hours is a useful target for bounded work, not a universal maximum or a validated performance claim. Large datasets, complex websites, rendering, external dependencies and human creative review can require longer. Suppliers must quote the actual scope and capacity honestly.

**Task- and supplier-specific estimates.** Delivery time depends on the agreed workload, acceptance criteria, available inputs, agent capability and tools, current capacity, external dependencies, and required verification. Category alone is insufficient. Suppliers must explain these assumptions with each offer. Distinguish a planning range, a supplier estimate and observed historical performance; never claim an estimate is a measured guarantee.

Store duration in integer minutes plus a separately disclosed start allowance. The local demo scales fictional supplier rates using company count for leads, finished runtime for video, and section count for static websites. Its reference scopes are 50 companies, a 30-second video and five website sections; different supplier profiles use different processing rates. The simple scaling model does not infer creative difficulty, data scarcity or integration complexity. Those require supplier review, and ambiguous scopes require clarification. Quotes retain their recorded duration and explanation; changing assumptions or scope requires a replacement quote and renewed approval. Existing accepted quotes are never silently recalculated. There is no blanket few-hour ceiling; the demo form supports up to seven days as an interface limit, not a product promise.

The builder must provide an estimate rationale (scope size, agent capabilities, capacity and dependencies), shown in the buyer comparison and selected-project timing card. Tool queues, rendering, retries and supplier verification count toward elapsed delivery, not hidden pauses. Buyer-caused input and checkpoint waits are displayed separately. Start allowance is five minutes in the prototype only and must become supplier-specific in production.

**Evidence and validation:** OpenAI’s historical [deep research guidance](https://openai.com/index/introducing-deep-research/) described 5–30 minutes; its [Codex design-tool experiment](https://developers.openai.com/blog/run-long-horizon-tasks-with-codex) ran about 25 hours. Anthropic’s [usage study](https://www.anthropic.com/research/measuring-agent-autonomy) measures turns, not accepted project completion. Bounty’s [under-ten-minute headline](https://trybounty.ai/) measures time to start. These support flexible estimates, not a universal duration or our specific demo numbers. Pilot measurement must capture scope, supplier, estimate, time to start, first submission, acceptance, supplier-side elapsed time and buyer wait. Compare promised versus observed delivery by comparable task and agent, with sample size and recency; use medians and conservative percentiles only when enough observations exist.

Separate five phases in the UI: waiting for company approval, waiting for funding, waiting for required inputs, agent execution, and buyer checkpoint/final review. Funding awards the assignment but does not prove inputs are available. The requester or admin confirms input readiness. The estimated delivery time then includes execution plus the stated start allowance, in the viewer's local time. At a blocking checkpoint, pause the execution clock and resume on the buyer's decision; show the reason visibly rather than silently moving a deadline. Stop the initial clock on submission. Revisions require their own updated estimate and must not reuse a stale first-delivery deadline. Neither an elapsed estimate nor an unanswered review automatically accepts work or releases payout.

The localhost timer records input readiness, active elapsed time, checkpoint pauses and submission timestamps. It demonstrates workflow semantics only; it does not measure an external runtime. Production must use authoritative server timestamps, supplier progress signals and a defined missed-estimate recovery policy. Measure total buyer elapsed time alongside agent execution and review wait so pauses cannot conceal a poor end-to-end experience.

## 12 Outcome specifications and verification

The checkpoints below apply when agreed for guided work. Direct-delivery tasks omit interim gates while retaining the same scoped final artifacts, evidence and acceptance requirements. See Section 8 for review-mode selection.

| Type | Required scope | Guided checkpoints | Final artifacts | Verification and judgment |
| --- | --- | --- | --- | --- |
| Lead/account research | Count, geography, industry, company size, fields, sources, freshness and exclusions | Small representative sample before scaling | CSV/JSON, data dictionary, source/evidence report, missing/duplicate report | Schema/count/uniqueness checks; sampled source validation; buyer judges targeting usefulness |
| Launch video | Product, audience, duration, orientation, tone, claims, assets, rights, captions and editable-source expectations | Script/storyboard, then rough cut | Playable MP4, caption file, source/project files if included, asset provenance | Playback/codec/runtime/aspect checks; caption and rights review; buyer judges creative quality |
| Website | Audience, purpose, sections/pages, interactions, content, brand assets, responsive targets and deployment exclusions | Page plan, then responsive preview | HTML/CSS/JS or agreed source stack, source ZIP/repository snapshot, preview, readme and checks | Link/form/accessibility/security checks; buyer judges design and messaging |

A criterion is either passed, failed, needs judgment or not tested. “File present” must not be presented as “task completed.” Checks store tool/version, timestamp, result and evidence reference. Supplier self-attestation is labeled and cannot substitute for independent checks on material claims.

Lead delivery excludes outbound communication unless separately scoped. A public source does not establish consent to email someone. Website preview is not production deployment. A video preview is not proof of licensing. These boundaries must appear in the scope, not only in terms buried at checkout.

## 13 Delivery desk and artifact contract

**DEL-01 — Versioned manifest.** Every submission includes artifact ID, filename, MIME type, byte size, content hash, scope version, submission version, provenance, preview state and evidence links. The accepted manifest is immutable. Revisions create a new submission; they do not replace files behind an old acceptance record.

**DEL-02 — Secure intake.** Upload bytes to controlled storage using expiring upload permissions. Validate actual file type and size, scan for malicious content, quarantine unsafe files and reject incomplete manifests. A failed upload cannot appear as a downloadable delivery. Storage and processing limits must be disclosed before quoting unusually large jobs.

**DEL-03 — Appropriate previews.** Leads show a table with row count, schema and validation warnings. Video supports browser playback, captions and original download. Websites use an isolated preview origin with restricted capabilities, separate from the app's cookies and privileged connections. Source archives include a reproducible run/readme path.

**DEL-04 — Useful downloads.** Users can download individual originals or a package containing agreed files and handoff notes. Receipts are available separately; billing details are excluded from external delivery payloads by default. A manifest-only JSON download must not be labeled a complete file archive.

**DEL-05 — Separate decisions.** Previewing, downloading, accepting, paying out and exporting are separate events. A user may download a review copy before acceptance. Acceptance identifies the exact submission. Export failure cannot reverse acceptance or trigger another payout.

**DEL-06 — Durable access.** Pilot proposal: accepted originals remain available for at least 90 days, with a reminder before expiry and a visible retention date. Enterprise retention and deletion policies can override this where agreed. Long-term storage pricing and operator artifact access need approval before launch.

The current local library contains genuine downloadable sample files: a ten-row fictional CSV, a twelve-second silent vertical MP4 and an HTML/CSS website ZIP. These demonstrate delivery mechanics; they are not evidence that an external operator fulfilled the corresponding full scope.

## 14 Connected tools and direct delivery

A tool connection grants a bounded capability. It does not authorize every future message, import or transfer. The product separates connecting an account, choosing a destination, reviewing a payload and authorizing execution.

### Connection lifecycle

**CON-01 — Connect.** Show provider, account/workspace, purpose, required permissions and ownership. Use provider-hosted authorization where supported. Tokens remain server-side and encrypted; they never enter agent prompts, browser storage or logs. Verify the returned tenant and granted scopes before marking the connection active.

**CON-02 — Discover destinations.** List only accessible channels, objects, folders or accounts from the connected tenant. Display the destination's readable name and stable ID. A manually typed label alone is insufficient for a production send.

**CON-03 — Authorize a transfer.** Bind authorization to connection/account ID, destination ID, submission version, selected artifacts/records and operation. Replacing an account or changing the payload invalidates pending authorization. An employee may use a preapproved company destination within policy; first-time or restricted destinations require admin approval. The prototype's approval for every employee handoff is a conservative demonstration, not the final friction target.

**CON-04 — Execute and reconcile.** Each transfer has an idempotency key, attempt history, provider reference and final result. Statuses are prepared, awaiting approval, queued, delivering, succeeded, partially succeeded, failed or canceled. “Succeeded” requires provider acknowledgement appropriate to that action; it does not mean a recipient read the message.

**CON-05 — Disconnect.** Revocation blocks new sends, cancels queued operations where possible and marks in-flight work for reconciliation. A success already acknowledged by the provider remains in the audit history. Reconnection cannot silently replay previously approved work into another tenant.

### Destination behavior

| Destination | Required review | Completion evidence | Release priority |
| --- | --- | --- | --- |
| Slack | Workspace/channel, message, files or access-controlled links | Message/file reference and permission outcome | P1 |
| HubSpot or selected CRM | Object/list, field mapping, row validation, create/update choice and duplicate policy | Per-record result, created/updated/skipped counts and error export | P1, select one CRM |
| Microsoft Teams | Tenant/team/channel and payload | Provider reference and delivery result | P2 |
| Email | Sender account, recipients, subject/body and attachments | Provider send receipt; delivery/bounce separately | P2 |
| API or stream | Approved endpoint identity, schema, limits, credentials and batch policy | Cursor/checkpoint acknowledgements and final reconciliation | P2 |

CRM import must include a dry run. For example, “80 records: 62 new, 15 matches, 3 invalid” is reviewed before a write. Retry only failed or unacknowledged records using stable identifiers. Do not infer duplicate handling from an agent's free-form note.

Streaming is a different contract from sending a finished file. A buyer authorizes schema, destination, volume, frequency and side effects before partial data leaves Relay. Each batch needs ordering, resumability, backpressure and a completion manifest. Early data availability does not mean the entire job has been accepted. Recurrent synchronization requires separate ongoing consent and pricing.

## 15 Payments and commercial rules

Quotes are denominated in a stated fiat currency; pilot proposal is USD. Store amounts in integer minor units and specify the rounding rule. Taxes, Relay fee, supplier payout and any buyer-paid network/processing charge must reconcile to the displayed total.

**PAY-01 — Funding confirmation.** Use provider-hosted payment entry and verified server events. Persist payment attempt IDs and reconcile delayed, duplicate and contradictory events. Never start work from a client-side “success” message alone.

**PAY-02 — Separate payment and budget.** Company allocation is permission to commit spend, not stored money. Provider balances, customer charges, reserved budget, operator payables and platform fees are different ledger concepts.

**PAY-03 — Crypto.** Support USDC only through an eligible provider/network in the proposed pilot. Show the token, network, quoted conversion, expiry, fees and confirmation state before payment. No seed phrases, arbitrary tokens or promise that a wallet connection equals payment. Handle underpayment, overpayment and expired quotes through a defined exception queue. Provider eligibility and settlement design remain launch dependencies.

**PAY-04 — Release and refunds.** Acceptance creates a payable; payout requires payment finality and any applicable operational holds. A dispute blocks unsettled payout. Refunds and credits use the original payment context with provider-specific handling and a visible status. Bank arrival is not the same as payout initiation.

### Proposed operating policies for approval

- Quotes expire after 24 hours unless the operator specifies an earlier capacity limit. Expired quotes require reconfirmation before funding.
- One final in-scope revision is included, in addition to the expressly defined checkpoints. Objective nonconformance is corrected under the agreed contract; subjective new direction may require a change request.
- Buyer review receives reminders at 24 and 48 hours. After 72 hours, the pilot sends the job to operations review rather than automatically paying out. Any later automatic acceptance policy must be explicit at purchase and account for disputes and blocked artifacts.
- Before funding, an unassigned request can be closed. After funding, cancellation is adjudicated against work performed and the agreed terms; a full refund is not guaranteed in every case.
- Operator nonresponse triggers an alert after the agreed update deadline and an operations decision on reassignment. Do not silently declare failed verification a refund.

These are proposed commercial rules, not legal conclusions. Rights transfer, privacy obligations, tax treatment, fund custody and refund language require qualified review and provider agreement before real-money launch.

## 16 Unit economics and monetization

**Relay's unit economics are not yet established. We are not confident enough in the current inputs to commit to a take rate, pricing model or profitability target.** Supplier payouts, buyer willingness to pay, payment costs, verification effort, support load, refunds and repeat purchase behavior all require validation with real paid projects.

For sensitivity analysis only, one illustrative scenario assumes a fee equal to 20% of the buyer's pre-tax project subtotal. This is a test assumption—not approved pricing, a validated business model or a forecast. If the buyer subtotal is $100, operator payout is $80 and Relay gross fee is $20. This is equivalent to a 25% markup on the operator payout. It is not the same as adding 20% to an operator bid.

**Project contribution = buyer subtotal − operator payouts − payment costs − verification and coordination costs − variable support − expected refunds, credits and other variable losses.**

Track paid acquisition separately and evaluate recovery across repeat purchases. Do not book a customer tax collection or the full operator payout as Relay fee revenue without the appropriate accounting determination.

The following examples are planning arithmetic, not forecasts or observed cost data:

| Assumed job | Buyer subtotal | Operator payout | Gross fee | Processing | Verification and coordination | Support | Expected loss | Contribution |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Small task | $60 | $48 | $12 | $2 | $3 | $5 | $2 | $0 |
| Routine research | $120 | $96 | $24 | $4 | $5 | $4 | $3 | $8 |
| Larger creative job | $400 | $320 | $80 | $12 | $15 | $12 | $8 | $33 |

These hypothetical calculations illustrate how low-ticket work could fail economically despite cheap model inference; they do not establish Relay’s actual margins. A $400 job with an extra $25 coordination burden would fall from $33 to $8 contribution under the same assumptions. Additional agents cannot be justified by novelty alone.

Potential later revenue includes a company subscription for administration, compliance features, retention or ongoing integrations. Basic access to purchased deliverables should not unexpectedly become a subscription requirement. Operator API access should remain free during supply formation; any later charge needs evidence that it will not reduce useful supply.

No target price, take rate or subscription amount is validated by the prototype. Before selecting a commercial model, the pilot must measure actual operator payouts, payment charges, review and support minutes, revision frequency, refunds, repeat purchases and willingness to pay by category and project size. Compare alternative fee structures and report observed ranges with sample sizes, rather than treating the illustrative table as a baseline forecast. Operator internal costs should be collected where suppliers are willing to share them to assess whether supply is sustainable.

**Review decision:** approve the measurement plan and pricing experiments, not the unit economics. Update this section with measured cohort results before making a scale or profitability commitment.

## 17 State and data model

Keep independent state machines rather than encoding every condition into a single project status.

| Entity | Core states | Key invariant |
| --- | --- | --- |
| Project | Draft, scoping, open, quoted, ready to fund, active, blocked, checkpoint review, submitted, buyer review, revision, delivered, canceled | One authoritative scope and explicit change history |
| Approval | Not required, pending, approved, declined, expired, invalidated | Bound to exact quote and authorized actor |
| Payment | Unfunded, pending, confirmed, failed, refund pending, refunded, partial refund | Provider events reconciled idempotently |
| Assignment | Offered, accepted, active, blocked, submitted, relinquished, completed | One current owner per assigned work unit |
| Submission | Uploading, quarantined, checking, failed checks, needs judgment, ready, superseded, accepted | Accepted manifest never changes |
| Payout | Not eligible, held, payable, processing, paid, failed | No duplicate release; bank completion explicit |
| Transfer | Prepared, approval pending, queued, delivering, partial, succeeded, failed, canceled | Exact connection, destination and payload version |

The primary records are User, Workspace, Membership, Agent, AgentCapability, Project, ScopeVersion, Quote, Assignment, Checkpoint, Message, Artifact, Submission, VerificationResult, Approval, BudgetReservation, Payment, LedgerEntry, Payout, Connection, Transfer and AuditEvent.

Important identifiers include workspace ID on every private record; scope/quote/submission version; provider event ID; actor and role; amount/currency; authorization reference; and correlation ID across project, payment and transfer operations. Agent credentials grant assignment-level rights, not broad workspace browsing.

Each ScopeVersion must record the agreed review mode (`direct` or `guided`), reason, checkpoint definitions and required inputs. A direct scope permits an empty checkpoint list. Quotes and assignments bind to that scope version so buyer, supplier and corporate views cannot disagree about required reviews. Protocol entity names such as `Project` and `project_id` may remain stable even when the interface calls the work a task.

Conversation messages need a durable thread, author, timestamp and any resulting scope-version reference. Distinguish informational answers, proposed changes and confirmed changes; retrying a message must not duplicate a requirement or create a second posting. These are production data requirements, not claims about the browser-only prototype.

## 18 Supplier integration guide and protocol requirements

### Existing API suppliers: onboarding and commercial boundaries (v0.54)

**Learning:** a supplier may already operate a useful request/response API and have
customers using it directly. Relay must bring relevant new demand and simplify
scope, delivery review and administration. API connectivity alone is not a
reason to use Relay. Do not require suppliers to migrate existing customers or
rebuild their services as autonomous marketplace participants.

**Supplier boundary:** one registered worker has an accountable operator, declared
capabilities and an authorized assignment. Its internal models, tools and
subagents remain implementation details subject to the same data and permission
limits. A passive API can participate through an operator-run adapter; it need
not discover or price work itself. Deterministic services must be labeled honestly.

**Onboarding:**
1. Describe outcomes, required inputs, coverage and exclusions in open-ended
   capabilities. One agent can declare multiple capabilities.
2. Choose HTTP API or SDK for an adapter running on the supplier's infrastructure.
   Explain input mapping, credential storage, synchronous/background execution,
   durable provider job IDs, retries, outputs and revisions. Keep provider secrets
   outside Relay profiles, task messages and browser storage.
3. Set quoting rules before connecting: automatic test quotes are opt-in; save a
   minimum quote in integer USD cents and maximum simultaneous tasks. A saved
   preference must not imply an active connection, qualification or paid readiness.
4. Connect using scoped credentials and a fresh heartbeat, then demonstrate each
   supported capability with a test and revision. Unsupported assessment domains
   remain declared/unassessed; a CSV assessment cannot qualify research judgment.

**Quoting contract:** the minimum is a floor, not a universal fixed price or a
promise of net payout. The adapter checks suitability and computes a task-specific
price, deliverables, assumptions and delivery estimate. Relay enforces its saved
floor on automatic offers and capacity on execution. Buyer acceptance, company
approval, funding or explicit local unpaid authorization, and tool permission
remain separate gates. No quote authorizes the provider API to start work.
Changes to an agreed scope require a new explicit commercial agreement.

**Current local implementation:** existing supplier HTTP API and source SDK,
scoped connection credentials, heartbeat status, persisted opt-in/minimum/capacity
controls and capability evidence. The Connect screen includes the adapter guide
and quoting controls; saving them preserves that setup step and survives refresh.
There is no generic paste-an-endpoint/no-code connector, automatic input mapper,
or real-estate qualification evaluator yet. Supplier-specific adapters require
implementation and end-to-end validation. MCP remains deferred. Stripe remains
disconnected; this increment enables no real-money activity.

**Acceptance:** introduce either agent type with open-ended capabilities, save API
or SDK preference, save quoting limits while disconnected, refresh and retain
values with inactive status, then connect and observe actual heartbeat status.
Below-floor automatic quotes and disabled bidding must be rejected server-side;
capacity must prevent excess execution. Keep prior agreements and credentials
unchanged when only editing quoting rules. Validate revisions and provider retry
idempotency for each real supplier adapter before enabling it commercially.

**Commercial hypotheses:** relevant demand, acceptable supplier margin, buyer
repeat usage and willingness to pay Relay's fee require measurement. Unit economics
remain uncertain. Prioritise one real supplier integration over expanding the
icebox; do not treat this discovery conversation as market validation.


### 18.1 Status and architecture boundary

**This is a proposed integration contract for review, not documentation for a working public API.** Endpoint paths, package names, MCP tools, payloads and error codes below are design examples. They must be finalized and implemented before suppliers can use them. All hostnames use the reserved `.example` domain; no example calls a live service. API/SDK/MCP availability follows the release gates in Section 7; the initial concierge pilot may perform these operations through an operator console.

Relay owns workflow transitions, permissions, project metadata, verification records and financial records. Suppliers own their runtime, models, tools, internal execution state and hosting. Relay sends work contracts and receives progress, evidence and deliverables; connecting an agent does not upload its code or grant it work automatically.

HTTP is the canonical contract. SDK methods and MCP tools invoke the same operations with the same authorization, version and idempotency rules. Webhooks notify a supplier that something changed; a durable event feed and authoritative reads allow recovery. Artifact storage holds original bytes, preview workers generate safe derivatives, and queues process checks, notifications and transfers.

### 18.2 Choose a connection method

| Method | Intended supplier | How it connects | Responsibilities |
| --- | --- | --- | --- |
| HTTP API | Any runtime with an HTTP client | Scoped bearer credential against `/v1` | Supplier implements durable state, retries, event handling and uploads |
| SDK | Developers wanting typed helpers | Proposed server-side SDK wrapping HTTP | SDK handles transport conveniences; supplier still owns execution and recovery |
| MCP | Agents running in an MCP-capable host | Remote operator MCP server with delegated authorization | Host discovers tools and invokes them; supplier still controls bidding and execution policy |

These methods can coexist. A supplier could discover work through MCP and upload a large video through the SDK. Switching transport must not create a second assignment or bypass a budget, approval or delivery rule. No public inbound endpoint is required: suppliers can poll when webhooks are unsuitable.

### 18.3 Operator onboarding, credentials and Agent Card

1. Create an operator account and complete the applicable identity, terms and payout onboarding. Connection readiness and eligibility for paid work are separate states.
2. In the operator console, create a development credential. Register an Agent Card describing capabilities and limits. Validate the connection with a sandbox job.
3. Complete production eligibility review and issue a production credential. Development and production credentials, jobs and ledgers are isolated.
4. Subscribe to events or start cursor-based polling. The agent may inspect eligible opportunities and choose whether to quote. Registration does not imply automatic assignment.

The proposed API accepts capability records with open-ended category/task text, not a closed enum. The server assigns stable capability IDs and revisions. Assessment and quote references include the capability ID and revision; editing a capability supersedes only its assessment.

A bootstrap operator credential can register and manage agents within that operator account. Runtime credentials should be restricted to an agent and approved scopes such as `opportunities:read`, `quotes:write`, `assignments:read`, `progress:write`, `artifacts:write` and `submissions:write`. Every request additionally checks access to the particular object; scope names alone never grant access to another supplier or buyer workspace. Credentials must remain server-side, be revocable and rotatable, and never appear in Agent Cards or delivered files.

Proposed connection check: `GET /v1/operator/me` returns operator ID, credential scopes, environment and eligibility blockers. Account and payout secrets are not returned to the runtime.

```http
POST /v1/agents
Authorization: Bearer <operator-bootstrap-token>
Content-Type: application/json
Idempotency-Key: register-research-agent-001

{
  "name": "Account Research Agent",
  "description": "Researches B2B accounts with source evidence",
  "capabilities": [
    {
      "category": "Sales & Marketing",
      "task": "Lead generation",
      "scope": "Company-level prospect CSV with sources; no outreach",
      "required_inputs": ["Target company criteria"]
    },
    {
      "category": "Sales & Marketing",
      "task": "GTM planning",
      "scope": "Positioning and launch plan; no campaign execution",
      "required_inputs": ["Product and market context"]
    }
  ],
  "input_types": ["application/json", "text/plain"],
  "output_types": ["text/csv", "application/json"],
  "supported_currencies": ["USD"],
  "max_concurrent_assignments": 2,
  "data_regions": ["EU"],
  "human_review_available": true
}
```

```json
{
  "id": "agt_research_01",
  "version": 1,
  "connection_status": "registered",
  "eligibility": "pending_review",
  "blockers": ["payout_onboarding_incomplete"]
}
```

Capabilities, region and human-review availability are supplier declarations until verified. Eligibility checks must distinguish self-attested properties from verified ones. An Agent Card contains no executable runtime, customer credentials or private model instructions.

### 18.4 Shared request and response conventions

Proposed base URL: `https://api.relay.example/v1`. All examples below are operator-side unless stated otherwise.

- IDs are opaque. Amounts use integer minor units plus currency: `12000` USD means $120. Timestamps use UTC ISO 8601. No floating-point monetary values.
- Mutable resources expose an integer `version`. Updates and state transitions include `expected_version`; a stale version fails rather than silently overwriting newer state. Creation against a scope references its exact scope version.
- Consequential writes carry an `Idempotency-Key`. Persist the key before sending; reuse it only for retries of the identical operation and body. Reusing a key with a different body fails. Retention must cover the supported retry window and be documented before launch.
- Lists return `items` and `next_cursor`. Errors return `error.code`, `message`, `retryable` and `request_id`; version conflicts also return the current version when authorized.
- Responses and logs carry a request/correlation ID. Secrets and sensitive brief contents must be redacted from operational logs.

Example conflict:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "Scope changed; retrieve current scope before quoting.",
    "retryable": false,
    "current_version": 4
  },
  "request_id": "req_01"
}
```

Handle `401` by checking credentials, `403` by checking eligibility and object permissions, `409` by refetching and reconciling, and `422` by correcting the payload or unmet state prerequisite. Back off with jitter for `429` and transient `5xx` responses, respecting `Retry-After`. Never retry a consequential write with a fresh idempotency key merely because the response was lost.

### 18.5 Proposed endpoint map

| Stage | Method and path | Purpose |
| --- | --- | --- |
| Connection | `GET /v1/operator/me` | Check identity, scopes and eligibility |
| Agent | `POST /v1/agents`; `PATCH /v1/agents/{agent_id}` | Register or update the Agent Card |
| Discovery | `GET /v1/opportunities?agent_id={id}&cursor={cursor}` | List opportunities the agent may access |
| Scope | `GET /v1/opportunities/{opportunity_id}` | Retrieve current authorized brief, criteria and scope version |
| Questions | `POST /v1/opportunities/{opportunity_id}/messages` | Ask a scope question before quoting |
| Quote | `POST /v1/opportunities/{opportunity_id}/quotes` | Offer a supplier commitment for an exact scope |
| Withdraw | `POST /v1/quotes/{quote_id}/withdraw` | Withdraw an unassigned quote with a version check |
| Assignment | `GET /v1/assignments`; `GET /v1/assignments/{id}` | Retrieve supplier assignments and current execution permissions |
| Acknowledge | `POST /v1/assignments/{id}/acknowledge` | Accept execution responsibility after award |
| Progress | `POST /v1/assignments/{id}/updates` | Report progress, a blocker or a recovery estimate |
| Checkpoint | `POST /v1/assignments/{id}/checkpoints/{checkpoint_id}/submissions` | Submit evidence for a defined checkpoint |
| Upload | `POST /v1/assignments/{id}/artifact-uploads` | Obtain a restricted upload URL |
| Upload completion | `POST /v1/artifact-uploads/{upload_id}/complete` | Declare upload complete and trigger validation |
| Artifact status | `GET /v1/artifacts/{artifact_id}` | Check scanning/validation result and usable artifact ID |
| Final delivery | `POST /v1/assignments/{id}/submissions` | Submit an immutable artifact manifest and evidence |
| Review | `GET /v1/submissions/{submission_id}` | Read verification and buyer review outcome |
| Revisions | `GET /v1/assignments/{id}/revision-requests` | Read requested changes against a submission |
| Settlement | `GET /v1/assignments/{id}/settlement` | Read payout eligibility and provider-confirmed status |
| Events | `POST /v1/webhook-endpoints`; `GET /v1/events?cursor={cursor}` | Register notifications and recover missed events |

Buyer acceptance, funding confirmation, checkpoint approval and payout release are not supplier endpoints. The supplier cannot declare its own work accepted or mark a payment paid.

### 18.6 End-to-end example: research brief to accepted delivery

**Step 1 — Discover and inspect.** An eligible agent polls opportunities or receives an `opportunity.available` event. It fetches the current brief, including authorized attachments, required evidence, delivery format, exclusions and deadline. An opportunity response might contain:

```json
{
  "id": "opp_042",
  "scope": {
    "id": "scp_042",
    "version": 3,
    "outcome": "Research 100 UK B2B software companies",
    "review_mode": "guided",
    "review_reason": "Review a representative sample before scaling the research.",
    "deliverables": [{"key": "accounts", "media_type": "text/csv"}],
    "acceptance_criteria": [
      {"id": "crit_count", "rule": "100 unique company domains"},
      {"id": "crit_fit", "rule": "UK B2B software companies with source URLs"}
    ],
    "checkpoints": [{"id": "cp_sample", "rule": "Review 10 accounts before the full list", "blocking": true}],
    "exclusions": ["Personal contact details", "Automated outreach"]
  },
  "quote_currency": "USD"
}
```

For a direct-delivery scope, `review_mode` is `direct` and `checkpoints` is empty. The quote must preserve that scope’s review contract; a supplier may propose changes but cannot invent or remove gates after award. Final evidence and buyer acceptance remain required in both modes.

If requirements are ambiguous, ask a question through the opportunity message endpoint. A material scope change creates a new scope version. The supplier must not silently assume new requirements or reuse an obsolete quote.

**Step 2 — Quote.** The supplier offers its required payout and an execution commitment. Relay computes the buyer-facing quote using the approved pricing policy; the illustrative economics below do not establish that policy.

```http
POST /v1/opportunities/opp_042/quotes
Idempotency-Key: quote-opp042-scope3-v1

{
  "agent_id": "agt_research_01",
  "scope_version": 3,
  "supplier_payout": {"amount_minor": 9600, "currency": "USD"},
  "execution_duration_minutes": 60,
  "estimate_basis": "100 companies; source checks, tool waits and verification included; inputs ready and agent capacity available",
  "start_within_minutes": 5,
  "expires_at": "2026-11-02T12:00:00Z",
  "included_revision_rounds": 1,
  "assumptions": ["Company-level research only"],
  "checkpoint_ids": ["cp_sample"]
}
```

The quote response returns `quote_id`, `version`, `status` and the recorded terms. The delivery clock starts at the contractually defined execution authorization, not merely at quote submission. Expired quotes cannot be accepted without renewal.

**Step 3 — Wait for award and execution authorization.** The buyer selects a quote. Corporate approval, where required, and funding confirmation must complete before billable execution. After `assignment.offered`, fetch the assignment and acknowledge it using `expected_version` and an idempotency key. Acknowledgment alone does not prove funding. Begin only when the authoritative assignment has `execution_authorized: true`, an accepted scope version and a `start_by`/`due_at` contract. The backend derives this permission from approval, funding and assignment state; suppliers cannot set it.

If the supplier cannot accept by `acknowledge_by`, Relay expires or recovers the offer under the operating policy. Connecting, quoting and acknowledging do not independently move money.

**Step 4 — Execute and submit the sample checkpoint.** Send useful updates such as completed work units, remaining work and blockers. Upload the 10-account sample using the artifact flow below, then submit its artifact ID to `cp_sample`. For a blocking checkpoint, stop dependent work until the backend records approval and authorizes continuation. A checkpoint event is a notification to refetch, not permission to ignore the current state.

```json
{
  "expected_version": 7,
  "status": "blocked",
  "summary": "Ten sample accounts are ready for review.",
  "blocker": {"code": "AWAITING_CHECKPOINT_REVIEW", "checkpoint_id": "cp_sample"}
}
```

Progress reports do not change scope, acceptance criteria or commercial terms. Extra work requires the change-order and approval process.

**Step 5 — Upload real files.** Request an upload slot with the filename, declared media type, byte size and SHA-256 digest. The response includes an `upload_id`, reserved `artifact_id`, short-lived `upload_url`, required headers and `expires_at`. Upload bytes to that URL using its returned method/headers; do not forward the Relay bearer token to storage. Call completion only after the upload finishes.

```json
{
  "filename": "qualified-accounts.csv",
  "media_type": "text/csv",
  "size_bytes": 18240,
  "sha256": "<64-character SHA-256 hex digest of the actual file>"
}
```

Relay verifies actual bytes, size, checksum and media type, scans the file and produces safe previews. An artifact remains unusable while uploading or quarantined. Poll artifact status or consume its event; only a `ready` artifact owned by this assignment can enter the final manifest. Failed checks return actionable reasons. Never substitute an arbitrary external URL for a controlled delivery artifact.

**Step 6 — Submit an immutable delivery.** Reference the accepted scope version, ready artifacts and criterion-specific evidence. Create a new submission for each revision; never replace bytes beneath a previously submitted artifact ID.

```http
POST /v1/assignments/asg_042/submissions
Idempotency-Key: asg042-final-attempt1

{
  "expected_version": 12,
  "scope_version": 3,
  "summary": "100 company accounts with qualification sources.",
  "artifacts": [
    {"artifact_id": "art_accounts", "role": "primary", "label": "Qualified accounts CSV"},
    {"artifact_id": "art_evidence", "role": "evidence", "label": "Research evidence JSON"}
  ],
  "criteria_evidence": [
    {"criterion_id": "crit_count", "artifact_id": "art_evidence", "locator": "$.checks.unique_domains"},
    {"criterion_id": "crit_fit", "artifact_id": "art_evidence", "locator": "$.accounts[*].sources"}
  ],
  "usage_notes": "Import company_domain as the deduplication key.",
  "known_limitations": ["Employee counts are estimates where identified in the evidence."]
}
```

The response returns `submission_id`, its immutable manifest version and a review status such as `checking`. Supplier-provided claims are evidence inputs, not proof that Relay's checks passed. Verification records which checks were automated, which require judgment and which remain unresolved.

**Step 7 — Handle review and revisions.** A `submission.revision_requested` event points to a revision request containing the submission ID, criterion IDs, requested changes and commercial classification. Read the actual request, distinguish included fixes from a proposed scope change, and submit new artifacts with a new manifest that references `supersedes_submission_id`. The previous submission stays available for audit. Out-of-scope requests require agreed terms before more billable work.

**Step 8 — Acceptance, delivery and settlement.** Once checks and authorized buyer acceptance complete, Relay records the accepted manifest and enables the approved delivery experience. Download, CRM import and Slack delivery use those exact artifact versions. Customer tool credentials stay in Relay's delivery service; suppliers do not receive CRM tokens to produce a CSV. A failed external transfer can be retried without repeating acceptance or payout.

The supplier receives `submission.accepted` and later settlement events. `payable`, `processing` and `paid` are different states; only reconciled provider confirmation establishes completion. Acceptance does not guarantee immediate bank or wallet settlement. Disputes and holds follow the commercial policy in Section 15.

The same lifecycle applies to video and websites. Video manifests include the playable master, captions when required, and agreed source assets; website manifests include a previewable build, source archive and setup notes. Each category uses its own checkpoints and evidence from Section 12.

### Supplier access to buyer references

Buyer references are inputs, separate from supplier artifact submissions. Opportunity and assignment responses must identify authorized references and their usage notes for the exact scope version. Proposed reference metadata includes `reference_id`, `reference_version`, `scope_version`, `filename`, `media_type`, `size_bytes`, `sha256`, `usage_note` and `validation_status`. Retrieval requires a short-lived download authorization scoped to the supplier and reference; public permanent URLs and customer credentials must not appear in the manifest.

API, SDK and MCP integrations must expose equivalent metadata and controlled retrieval. A supplier checks file availability and permissions before committing to work that depends on it. An unavailable or unreadable required sample produces a clarification or input blocker, not an invented interpretation. The supplier cannot overwrite a buyer reference. Production must log access, honor revocation and retain the versions used for an accepted quote. These are proposed protocol requirements; the localhost prototype provides a human-operated supplier preview, not remote file access for real agents.

### 18.7 SDK integration example

**Illustrative TypeScript interface only.** `@relay-example/operator-sdk` is a placeholder package, not a published dependency or installation instruction. Its final language coverage and API shape remain to be decided.

```ts
import { RelayOperator } from "@relay-example/operator-sdk";

const relay = new RelayOperator({
  baseUrl: "https://api.relay.example/v1",
  token: process.env.RELAY_OPERATOR_TOKEN,
});

// Event delivery may repeat. Refetch the current resource before acting.
const assignment = await relay.assignments.get("asg_042");
if (!assignment.execution_authorized) {
  throw new Error("Wait for execution authorization");
}

// Helpers hash the file, obtain an upload URL, upload and complete it.
const artifact = await relay.artifacts.uploadFile({
  assignmentId: assignment.id,
  path: "./output/qualified-accounts.csv",
  mediaType: "text/csv",
  idempotencyKey: "asg042-accounts-file-v1",
});
await relay.artifacts.waitUntilReady(artifact.id);

// Refetch because uploads/checkpoints may overlap other state changes.
const current = await relay.assignments.get(assignment.id);
const submission = await relay.submissions.create(assignment.id, {
  expected_version: current.version,
  scope_version: current.scope_version,
  summary: "Completed accounts file; evidence is attached separately.",
  artifacts: [
    { artifact_id: artifact.id, role: "primary", label: "Accounts CSV" },
    { artifact_id: "art_evidence", role: "evidence", label: "Evidence JSON" },
  ],
  criteria_evidence: [
    { criterion_id: "crit_count", artifact_id: "art_evidence",
      locator: "$.checks.unique_domains" },
    { criterion_id: "crit_fit", artifact_id: "art_evidence",
      locator: "$.accounts[*].sources" },
  ],
}, { idempotencyKey: "asg042-final-attempt1" });
```

This excerpt assumes the required checkpoint is approved and `art_evidence` has already been uploaded and validated. A real worker must persist assignment IDs, accepted scope versions, artifact IDs, idempotency keys and event cursors outside process memory. SDK helpers should expose timeout/cancellation controls and surface scan failures rather than waiting indefinitely. They cannot make a noncompliant submission valid or bypass authorization.

### 18.8 MCP integration example

Proposed remote endpoint: `https://mcp.relay.example/operator`. The supplier adds it to an MCP-capable host, completes delegated authorization, selects the operator account/agent and approves the requested scopes. Exact host configuration is client-specific and must be documented during implementation; this PRD does not assume every host uses the same JSON configuration.

MCP tool names map to the HTTP contract:

| Proposed tool | Underlying operation |
| --- | --- |
| `relay_get_operator` | Check connection identity and eligibility |
| `relay_list_opportunities` / `relay_get_opportunity` | Discover and inspect eligible work |
| `relay_send_opportunity_message` | Clarify scope |
| `relay_submit_quote` / `relay_withdraw_quote` | Manage supplier offers |
| `relay_get_assignment` / `relay_acknowledge_assignment` | Retrieve and acknowledge an award |
| `relay_report_progress` / `relay_submit_checkpoint` | Report execution and checkpoint evidence |
| `relay_create_artifact_upload` / `relay_complete_artifact_upload` | Initiate and complete controlled uploads |
| `relay_get_artifact` | Inspect validation status |
| `relay_submit_delivery` / `relay_get_submission` | Submit and review a delivery |
| `relay_list_revision_requests` / `relay_get_settlement` | Handle changes and observe payout state |
| `relay_list_events` | Recover notifications with a durable cursor |

Illustrative tool invocation, not a complete MCP transport envelope:

```json
{
  "name": "relay_submit_quote",
  "arguments": {
    "opportunity_id": "opp_042",
    "agent_id": "agt_research_01",
    "scope_version": 3,
    "supplier_payout": {"amount_minor": 9600, "currency": "USD"},
    "execution_duration_minutes": 60,
  "estimate_basis": "100 companies; source checks, tool waits and verification included; inputs ready and agent capacity available",
  "start_within_minutes": 5,
    "expires_at": "2026-11-02T12:00:00Z",
    "included_revision_rounds": 1,
    "assumptions": ["Company-level research only"],
    "checkpoint_ids": ["cp_sample"],
    "idempotency_key": "quote-opp042-scope3-v1"
  }
}
```

The MCP adapter passes that key as the HTTP idempotency key and applies identical object permissions. Tool outputs contain structured resource IDs and state, not only conversational prose. Upload tools return restricted upload instructions; the host or supplier's HTTP client transfers file bytes. Large media should not be embedded as base64 in routine tool responses.

Operator MCP must not expose buyer funding, workspace administration or acceptance tools. Buyer MCP is a separately authorized surface. Suppliers configure their own human-approval policy for quoting and execution; merely connecting MCP does not authorize unlimited bids. Briefs, messages and tool outputs are untrusted data and cannot expand the runtime's permissions.

### 18.9 Events, recovery and operational behavior

Proposed event types include `opportunity.available`, `scope.updated`, `assignment.offered`, `assignment.execution_authorized`, `checkpoint.reviewed`, `artifact.ready`, `artifact.rejected`, `submission.reviewed`, `submission.revision_requested`, `submission.accepted`, `assignment.canceled`, `payout.updated` and `credential.revoked`.

```json
{
  "id": "evt_00125",
  "type": "assignment.execution_authorized",
  "occurred_at": "2026-11-01T12:30:00Z",
  "agent_id": "agt_research_01",
  "resource": {"type": "assignment", "id": "asg_042", "version": 5},
  "cursor": "cur_00125"
}
```

Events contain minimal metadata; fetch the authorized resource for the brief and current state. Delivery is at least once and may arrive out of order. Deduplicate event IDs, persist incoming work before acknowledging receipt, and process through a durable queue. A webhook handler should verify authenticity, enqueue and return promptly rather than running the task inside the request.

Proposed webhook signing uses a timestamp and HMAC-SHA256 over the timestamp plus the exact raw body, with versioned signature headers and rotating secrets. The production specification must freeze byte encoding, timestamp tolerance, rotation overlap and test vectors. Verify signatures before parsing/processing and reject replayed or expired requests. Webhook registration requires HTTPS and endpoint validation that blocks private-network destinations.

After an outage, query the event feed from the last committed cursor, reconcile relevant assignments and advance the cursor only after durable processing. Expired cursors must return an explicit recovery error; clients then list current assignments and reconcile state before obtaining a new feed position. Never rely on webhooks alone or infer authorization from event order.

On cancellation, stop new side effects and refetch assignment state; final submission is rejected when no longer permitted. On token revocation, stop API work and notify the operator. On an ambiguous timeout, reconcile using the existing operation key before retrying. On a scope change, pause affected work until the updated contract is agreed.

### 18.10 Integration certification and later multi-agent support

Before production access, the supplier must demonstrate a sandbox lifecycle: register, inspect, quote, acknowledge, wait for authorization, pass a checkpoint, upload, submit, revise and observe acceptance/settlement. Certification also covers duplicate events, lost responses, stale versions, expired credentials, rejected files, cancellation and cross-tenant access denial. Sandbox settlement is explicitly simulated and excluded from production revenue and reputation.

Supplier-facing documentation must ship with an OpenAPI contract, typed schemas, SDK examples, MCP tool definitions, webhook signing test vectors, error reference, supported upload limits, event retention policy, version/deprecation policy and a sandbox walkthrough. Production credentials are issued only after applicable eligibility and integration checks pass.

P2 multi-agent assignments add dependency edges, input/output artifact contracts and restricted sharing across operators. Each worker sees only its assigned unit and permitted dependencies. Relay coordinates the overall project; individual suppliers cannot inspect unrelated assignments, alter other operators' payouts or access customer tool credentials. The same API/SDK/MCP semantics remain consistent across single- and multi-agent execution.

### 18.11 Multiple agents per supplier and buyer visibility

A supplier can register separate general-purpose and domain-specialist agents, switch the active agent, and quote on the same task from each. Every agent owns its connection state, capability declarations, assessments and work identity. Adding an agent must never replace an existing profile. Agent type is a supplier-described focus, not a certification. Both types support multiple open-ended capabilities.

Offer cards show agent type, the named supporting capability and its version-matching assessment status without expansion. Buyers can expand the full capability roster; unassessed capabilities remain clearly distinguished. Switching the supplier's active agent must not change or hide another agent's buyer-visible qualification. An accepted task remains assigned to its winning agent ID.

Prototype implementation: a browser-local agent registry preserves individual profiles and migrates the existing single profile. This is demonstration persistence, not production multi-user storage or authorization.

### 18.12 Proposed production vetting service: actual execution flow

**Status: proposed architecture, not an implemented backend.** The current prototype simulates connection, submissions and reviewer decisions. It does not execute or evaluate a supplier's runtime. Rubrics, pass thresholds, repeat-run counts, evaluation costs and renewal periods require pilot calibration. Unit economics remain unvalidated.

1. **Register and verify the connection.** An authenticated operator registers an agent and separately versioned capability declarations. Relay issues scoped credentials and verifies endpoint control with a challenge-response. API, SDK and MCP use the same underlying assessment service and permission model. SDK wraps the API; MCP exposes Relay tools to a compatible agent host. The supplier continues running the agent on its own infrastructure. Connection success proves integration, not task quality.
2. **Create an independent challenge.** `POST /v1/agents/{agent_id}/assessments` accepts `capability_id`, `capability_revision` and `runtime_version`. Relay creates an immutable assessment ID, approved rubric version, synthetic inputs, allowed tools, resource limits and deadline. Suppliers declare scope but cannot select their own passing rubric. Unsupported domains go to rubric design/manual review; they are not automatically qualified by a generic test.
3. **Dispatch and execute.** Relay emits a signed `assessment.assigned` webhook; polling `GET /v1/assessments?status=assigned` provides recovery. The runtime acknowledges the assignment, executes the challenge and reports progress with assessment/run IDs. Retries use idempotency keys, event IDs and expected state versions. Credentials permit only that operator's assignments; synthetic data and isolated test integrations avoid exposing buyer accounts.
4. **Collect inspectable evidence.** The supplier obtains a short-lived upload URL and submits an immutable artifact manifest to `POST /v1/assessments/{id}/submissions`: artifact IDs and hashes, criterion-level evidence, runtime version, elapsed time, reported cost, tool receipts when available and human-assistance disclosure. Relay checks storage ownership, MIME type, size and malware risk. Outputs render in isolated previews. Logs must exclude secrets and unnecessary personal data.
5. **Evaluate independently.** A server-side evaluator runs objective checks: CSV schema/duplicates/source samples; video decoding/duration/dimensions; website functional, accessibility and viewport tests in an isolated browser. Hidden cases and multiple runs measure robustness. Model-based judges can score rubric-bound subjective aspects but need calibration against expert review; ambiguous, high-risk or unsupported work goes to a human reviewer. A submitted artifact or successful HTTP response is never sufficient to pass.
6. **Require a revision.** Relay sends specific feedback as a new revision assignment. The agent submits a new artifact version linked to the first, with a change explanation. Evaluators check both the requested change and regressions. Original artifacts and decisions remain immutable for audit and appeal.
7. **Issue a scoped decision.** Only the evaluator service/reviewer role can transition to `passed`, `needs_improvement` or `manual_review`. The qualification binds agent ID, capability revision, runtime/configuration version, rubric version, assessment evidence and review date. Buyers see the named scope, run mode and freshness. Passing one capability does not qualify the agent's other capabilities, every buyer task, or the operator generally.
8. **Monitor real outcomes.** Qualification enables an eligibility review/trial tier, subject to separate operator, payout and policy checks. Accepted work, revisions, disputes and on-time completion contribute separate reliability measures. Material runtime/capability changes trigger reassessment; failed audits can suspend qualification with an appeal path. Renewal cadence and trial limits remain pilot decisions.

Illustrative submission payload (proposed contract, not a live endpoint):

```json
{
  "assessment_id": "assessment_example",
  "run_id": "run_example",
  "capability_revision": 2,
  "runtime_version": "supplier-release-3",
  "submission_kind": "revision",
  "parent_submission_id": "submission_original",
  "artifacts": [{"artifact_id": "artifact_csv", "sha256": "<content hash>"}],
  "evidence": [{"criterion_id": "source_accuracy", "artifact_id": "artifact_csv", "note": "Source URLs included for all records"}],
  "assistance": "autonomous",
  "elapsed_seconds": 240
}
```

**Trust boundary:** supplier credentials can submit evidence, never grant qualification. Relay stores authoritative state server-side and enforces tenant/agent ownership. Supplier-provided logs, cost and autonomy claims are untrusted unless independently corroborated. A remote API alone cannot prove which model ran, that humans did not help, or that a supplier will keep using the same runtime. Signed manifests, repeat challenges, outcome monitoring and optional trusted execution telemetry reduce uncertainty; they do not eliminate it. Qualification is scoped evidence, not a guarantee.

## 19 Trust, safety and operational requirements

Private projects and artifacts are the default. Public case studies require separate explicit consent. Operators receive the minimum inputs needed for their assignment. Sensitive data restrictions, approved regions and retention policies apply before routing, not after work has already been distributed.

Reputation is category-specific and based on completed, genuine work: first-pass acceptance, on-time completion, substantiated disputes and revision burden. Show sample size and recency. Do not rank a new video supplier as proven because it completed unrelated lead tasks. Reviews follow settlement and anti-abuse checks.

Operations needs queues for unmatched requests, stale quotes, missing inputs, unresponsive operators, failed verification, disputed acceptance, payment exceptions, failed transfers and data-access incidents. Every exception needs an owner, evidence and a resolution trail. Pilot operating hours and escalation coverage must be stated before accepting deadlines that require unattended support.

Production safeguards include tenant isolation, least privilege, audit logging without secrets, encrypted credentials, secure preview isolation, upload scanning, rate limits and revocable access. Customer content and supplier outputs are untrusted data; prompt injection cannot authorize purchases, disclose secrets or change the acceptance rules.

## 20 Quality and nonfunctional requirements

Keep one clear next action on conversation, offer comparison, funding, checkpoint and delivery screens. Maintain consistent typography, spacing, status language and restrained motion across buyer and builder views. The conversation composer must remain keyboard-accessible on complete briefs and recaps; sending a message must preserve context and show a recoverable error if it fails. Show review-copy versus accepted-delivery status explicitly. Downloads, acceptance and external sends remain distinct actions.

The following are proposed pilot launch targets, to validate against implementation cost:

- Main authenticated pages usable within 2.5 seconds at the 95th percentile on the agreed test profile, excluding large artifact transfer.
- Ordinary state changes visible to other authorized sessions within five seconds at the 95th percentile, with stale/error state shown if synchronization fails.
- 99.5% monthly availability for core project management during the pilot; publish maintenance expectations rather than implying enterprise SLA coverage.
- Recovery point objective of 15 minutes and recovery time objective of four hours for project metadata; provider reconciliation repairs payment-event gaps. A restore rehearsal is required.
- WCAG 2.2 AA as the accessibility target: keyboard use, visible focus, labeled inputs, readable contrast and reduced-motion support. Automated checks alone do not prove conformance.
- No secret material in browser storage, exported logs or ordinary project messages. Financial actions and cross-tenant access have zero tolerance for authorization-test failures.
- Explicit file size limits, supported codecs and preview processing states. Large uploads must be resumable or fail with a recoverable message.

No availability or performance target above has been demonstrated by the local prototype.

## 21 Metrics and validation plan

**North-star measure:** accepted outcomes from repeat paying buyers with positive contribution, measured by category and customer cohort. Track both the repeat-buyer count and accepted-job count so a few high-volume accounts do not conceal poor retention.

| Metric | Definition | What it tests |
| --- | --- | --- |
| Scope completion | Reviewed scopes / started briefs, excluding known test sessions; split by direct/guided mode and category | Clarification usability |
| Conversation effort | Clarification turns, repeated-question rate, successful corrections and abandonment before posting | Whether Relay understands and preserves intent |
| Review burden | Active buyer review time and number of interim decisions per accepted task, split by mode and complexity | Whether direct delivery reduces friction without hurting acceptance |
| Quote coverage | Eligible scopes receiving a valid quote within the stated response window / eligible scopes | Supply liquidity |
| Quote-to-funding | Funded projects / valid quoted projects | Price and trust |
| First-pass acceptance | Accepted first submissions without requested revision / first submissions reviewed | Quality |
| On-time submission | Jobs submitted within the agreed clock / due jobs | Reliability; report buyer-blocked time separately |
| Buyer effort | Median active review/coordination minutes per accepted outcome | Value of managed coordination |
| Repeat purchase | Buyers funding another project within 30 days / buyers with a full 30-day observation window | Demand durability |
| Contribution | Real project revenue less defined variable costs | Business viability |
| Transfer completion | Acknowledged successful transfers / authorized transfers, with partial results separate | Delivery usefulness |
| Disputes and loss | Disputed jobs, resolution time and loss per funded cohort | Trust and operating burden |

Instrument request_started, clarification_answered, scope_change_confirmed, review_mode_selected, scope_reviewed, quote_received, budget_requested, budget_decided, funding_confirmed, assignment_started, checkpoint_reviewed, submission_uploaded, verification_completed, delivery_accepted, revision_requested, payout_updated, connection_authorized and transfer_completed. Include workspace/category/version and timestamps; exclude raw brief content, personal data and tokens from routine analytics.

Pilot proposal: recruit 10–15 buyers and at least three qualified operators in the first category; aim for 30 paid completed jobs before evaluating expansion. Suggested decision thresholds are at least 80% quote coverage within one business day, 70% first-pass acceptance and positive aggregate contribution before acquisition cost. These are small-cohort learning gates, not statistically established success criteria. Review failures individually and report counts alongside percentages.

Interview buyers who abandon a scope, reject a quote, dispute a delivery or decline to repeat. Interview operators who stop bidding or spend excessive time revising. These findings should determine whether to change scope, fee, supply or the routing model.

## 22 Launch acceptance scenarios

| Scenario | Required result |
| --- | --- |
| Complete brief entered before signup | No repeated questions for supplied details; brief survives onboarding |
| Complete brief followed by an informational or hypothetical question | Composer stays available; answer does not mutate scope or post work, even if the question mentions another quantity |
| User corrects quantity or format in conversation | Only relevant details change; recap and mode are recomputed; unrelated details persist |
| Unsupported requirement | Uncertainty is explicit; no silent interpretation; supplier cannot commit against unresolved ambiguity |
| Bounded company-list task | No interim checkpoints; offer, corporate approval if needed, funding, evidence and final acceptance remain connected |
| Complex launch video | Agreed storyboard and rough-cut gates block dependent work; final delivery still requires separate acceptance |
| Buyer adds checkpoints to a simple task | Scope, quote and builder assignment show the same agreed gates |
| Existing funded work opens after mode rules change | Contracted checkpoints remain unchanged |
| Attach references, post and refresh | Original files and usage notes remain associated with the same scope and available in authorized supplier view |
| Preview image, PDF and video | Correct media displays with its note; PDF page boundaries work; video has controls and does not autoplay |
| Preview fails or bytes are missing | Clear error, retained filename/note and accurate download availability; no fabricated preview |
| Agent downloads reference and notes | Original matches uploaded bytes; separate notes file identifies filename, task, scope version and usage instruction |
| Reference changes after quoting | New scope version; affected quotes and approvals invalidated; funded references cannot be silently replaced |
| Scope changes after quote | Quote and dependent approval become invalid; old amount cannot fund |
| Two funding requests race for remaining budget | At most one succeeds when both exceed allocation together |
| Duplicate payment or acceptance event | One ledger transition and one payout instruction |
| Approver opens another employee's delivery | Can inspect authorized evidence; cannot fund, accept or revise without separate authority |
| Employee leaves company mid-project | Access revoked; admin reassigns owner without losing history |
| Checkpoint requests changes | Dependent work remains blocked; operator receives versioned feedback |
| Unsafe or corrupt uploaded file | Quarantined; no preview/download/acceptance based on an unavailable artifact |
| Video or website preview fails | Clear processing/error state, original availability shown accurately |
| Download before acceptance | Artifact can be reviewed; no payout or external transfer implied |
| CRM import partially succeeds | Exact counts and per-record errors; retry does not duplicate successes |
| Company connection is replaced | Pending transfer needs review against new account; no silent replay |
| External transfer fails after acceptance | Delivery remains accepted; payout is not repeated; transfer is independently recoverable |
| Supplier misses deadline | Operations alerted; buyer sees blocker and recovery options |
| Multi-agent dependency fails | Only dependent work pauses; changed terms require approval |
| Cross-workspace object ID guessed | Server denies access, including artifacts, receipts and connections |

These scenarios must be tested at the API/service boundary in production, not only through visible buttons. Test fixtures should remain separate from real revenue and reputation reporting.

## 23 Current prototype and production gaps

| Area | Working locally | Required before commercial use |
| --- | --- | --- |
| Identity | Demo code, session and role previews | Real identity, invitations, ownership and server authorization |
| Scoping | Continuous composer, pattern-based brief updates, canned price/timing/review responses and explicitly confirmed extra requirements; no connected language model | Evaluated language understanding, conflict handling, durable conversation and supplier validation |
| Request samples | Browser-local attachments and notes survive refresh; image/PDF/video previews; original and usage-note downloads in the shared task | Secure hosted storage, scanning, access control, immutable reference versions, supplier retrieval and broader format/accessibility testing |
| Review cadence | Heuristic direct/guided selection; direct submission or category checkpoints; shared demo state | Validated classification, version-bound review contracts and server-enforced transitions across roles |
| Marketplace | Shared browser project records and sample suppliers | Durable backend, real supply, atomic assignment and operator onboarding |
| Corporate dashboard | Role-specific actions, budget arithmetic and sample scenarios | Multi-user synchronization, privacy scopes, concurrency-safe budgets and audit |
| Payments | Simulated card/USDC funding and payout records | Provider integration, ledger reconciliation, refunds and eligibility |
| Verification | Presence checks and illustrative evidence | Category evaluators, operational review and calibrated quality checks |
| Delivery | Text/JSON exports, real local CSV/MP4/site examples | Secure upload/storage, immutable manifests, actual commissioned artifacts and retention |
| Connections | Demo accounts, destination gating and handoff history | OAuth, token storage, destination discovery, real writes and provider receipts |
| Agent profiles | Multiple saved agents, general-purpose/specialist types, independent capabilities and offer identities | Server-owned operator/agent registry, permissions and concurrency |
| Capability vetting | Simulated test, revision and reviewer decision; per-capability buyer status | Independent challenge service, artifact evaluators, reviewer operations, appeals and reassessment |
| Agent protocol | Contract sketches and local handshake | Versioned endpoints, SDK/MCP implementations, signatures and recovery |

The local conversation remains limited: arbitrary phrasing, multiple conflicting constraints and semantic feasibility need production evaluation. The automated checks exercise simulated browser state and role guards; they do not establish server authorization, real payment settlement, supplier performance or integration security.

The prototype currently provides many of the intended screens. It should be treated as a design reference and testbed; its layered browser scripts and local storage are not the proposed production backend or a finished security model.

## 24 Delivery plan and ownership

| Workstream | Accountable role to appoint | First deliverable | Dependency |
| --- | --- | --- | --- |
| Product and category design | Product lead | Approved scope templates and revision policy | Founder segment decision |
| Supply and fulfillment | Marketplace operations lead | Qualified cohort and escalation playbook | Category and payout policy |
| Identity and workflow | Engineering lead | Tenant model, permissions and canonical transitions | Role contract |
| Billing and ledger | Payments owner | Funding/settlement/refund design | Commercial entity and provider approval |
| Artifact delivery | Engineering and design | Upload, manifest, preview and package flow | Storage/security design |
| Integrations | Integrations owner | First provider authorization and delivery path | Registered provider app and permission design |
| Trust and verification | Quality owner | Criterion evaluators and dispute evidence workflow | Outcome templates |
| Pilot measurement | Product analytics owner | Cohort dashboard with reconciled events | Backend event taxonomy |

Schedule should follow these dependency gates rather than an invented launch date. P0 starts with a narrow category and operationally supported exceptions. P1 begins only when the team can measure repeat use and contribution on genuine paid work. P2 requires evidence that additional orchestration or integrations improve outcomes enough to justify their cost.

## 25 Decisions for founder review

| Decision | Recommended starting point | Consequence of another choice |
| --- | --- | --- |
| Initial paid category | Company/account research | Launching three categories increases supply and verification burden |
| First customer | Small B2B teams plus founders using the same templates | Enterprise-first adds identity, procurement and security dependencies |
| Buyer selection | Relay recommends a qualified quote; alternatives optional | An open bidding inbox makes buyers perform more supplier selection |
| Supply access | Curated pilot, application-based expansion | Fully open supply increases abuse and quality-control costs |
| Operator accountability | One accountable operator per P0 outcome | Multi-operator contracting needs payout allocation and recovery policy earlier |
| Marketplace fee | Test 20% of buyer subtotal | Lower fee requires lower support/review cost or larger tickets |
| Review timeout | Human escalation after 72 hours in pilot | Automatic payout requires a carefully disclosed acceptance policy |
| Corporate approvals | No self-approval above threshold; explicit admin override | Broad admin bypass reduces separation of duties |
| Crypto launch | USDC gated by provider readiness | Parallel card/crypto launch expands payment exceptions and reconciliation scope |
| First tools | Slack and one CRM after downloads | All providers at once expand OAuth review, mapping and support surface |
| Streaming | Later, separately scoped consent | Immediate streaming changes the acceptance and delivery contract |
| File retention | Proposed 90-day minimum, visible expiry | Longer default increases storage and deletion obligations |
| Company subscription | Defer price until recurring admin value is demonstrated | Early subscription may deter initial project purchases |

## 26 Source and decision traceability

- [Bounty AI revenue analysis](chatgpt-conversation://6ad756ee-ab74-83eb-9988-d93a8f2c4393): outcome-based buying, external agents, marketplace/protocol boundary and minimum-agent routing. The available conversation contains the architecture discussion; it does not establish audited revenue.
- Supplied attachment “The agent stays wherever the developer already runs it”: marketplace, routing and verification layers. Treated as product context rather than independent competitor validation.
- [Bounty connection lifecycle](https://docs.trybounty.ai/agents/how-it-works/), [HTTP interface](https://docs.trybounty.ai/agents/raw-interface/) and [buyer MCP](https://docs.trybounty.ai/buyers/mcp/): checked October 22, 2026 for current architecture and workflow descriptions. Public documentation is evidence of published behavior, not an operational audit.
- [Relay project notes](../RESEARCH.md): observations from October 20–22, prototype decisions, financial assumptions and implementation limits.
- [Local prototype](http://127.0.0.1:4173/): review surface for buyer, operator, corporate and delivery interactions. Real sample files demonstrate presentation, local reference previews and download behavior only.

All launch thresholds, proposed timeouts, retention periods and commercial policies in this PRD are review decisions. They should be replaced with approved policy and measured operating evidence as the pilot progresses.

### Simulated supplier account readiness (v0.20)

Within Demonstrate, builders can submit a fictional individual or business operator, simulate pending review, changes requested and approval, then choose a sample bank or USDC payout destination. Payouts require approved operator verification and explicit simulated provider confirmation; failures can retry. No identity documents, bank details, wallet keys or real provider calls are involved. Operator and payout state are shared across this browser’s supplier agents; connection and qualification remain per agent. The readiness panel updates on every transition and persists after refresh. Editing and resubmitting operator verification invalidates payout readiness. “Ready for paid work · simulated” requires a declared capability with a current pass, a checked connection, available capacity, operator approval and a connected payout destination. It grants no real access and creates no earnings. Buyer billing remains separate. Production requires authenticated operator ownership, provider verification and server-enforced eligibility.

### Builder assignment and settlement continuity (v0.21)

Work & earnings filters selected assignments to the active agent ID and uses supplier payout setup, independently of buyer billing. Acceptance creates a payable obligation; a separate explicit simulated provider confirmation records receipt. Confirmation requires released task funding, accepted delivery, the awarded agent, approved operator and connected payout destination. Receipts are idempotent, task-bound and preserve amount/destination at confirmation. Changing the selected agent or future payout destination does not rewrite a receipt. Accepted amounts awaiting confirmation and received payouts display separately. No real money moves.

### Supplier dashboard (v0.22)

Builder workspace opens with a supplier-wide Dashboard, alongside Find work, Your agent, Work & earnings and Protocol. The overview aggregates registered agent IDs only, current unexpired pending offers, active awarded tasks and accepted deliveries/payouts. Counts and amounts derive from existing task records, without seeded revenue or duplicate assignments. Each agent shows its type, capability count, current assessment passes, connection and availability. Task actions reflect waiting for inputs, checkpoints, revision, verification, acceptance or payout; waiting states do not suggest starting unauthorized work. Opening an offer/task restores its owning agent. Completed work shows accepted amounts awaiting payout separately from received receipts. Empty states point to adding an agent or finding work. Work & earnings remains a per-agent view; the dashboard is the account-wide overview. All data remains browser-local and simulated.

### Builder demo portfolio (v0.23)

The prototype seeds three clearly fictional supplier agents (research, video, websites) and eight task records once per browser: pending quote, funded awaiting inputs, active checkpoint submission, buyer checkpoint review, revision requested, delivery awaiting acceptance, accepted awaiting payout, and payout received. Fixtures use the same task, quote, qualification and settlement records and controls as user-created work; no ownership bypass is introduced. Existing agent profiles, account verification, payout setup and tasks are preserved. Reload never overwrites walkthrough progress or repeats portfolio payouts. Illustrative handoff text and preloaded qualifications are explicitly labeled; they do not claim completed work or actual evaluations. Quote fixtures expire after seven days rather than auto-renewing.

### Buyer and builder workspace separation (v0.24)

One demo account may use both sides, through an explicit workspace switch. Builder navigation contains Dashboard, Agents, Find work, Work & earnings, Payout setup and Developer guide. Buyer navigation contains Request work, My tasks, Business workspace, Billing and Connected tools. Supplier payout setup is distinct from buyer funding. The chosen product area persists in this browser. Task records remain shared, but task views identify the current side and replace the always-visible role toggle with an explicit other-side demo preview. Supplier portfolio fixtures are excluded from the personal buyer task list. Production requires authenticated participant permissions; prototype workspace separation is navigation and presentation, not server authorization.

### Agent setup usability (v0.25)

Agent introduction uses selectable general-purpose/specialist cards, plain-language name and purpose fields, a live buyer-facing profile preview, and optional runtime details. Profile drafts persist per agent (or the new-agent draft) as users type, and can be resumed without creating an agent prematurely. Capability setup starts with one concrete deliverable, allows free-text categories, lists saved capabilities, and collapses additional capability entry after the first. Input/assistance requirements are optional disclosures. Connection instructions remain available behind an expandable section. Registration, per-capability qualification and readiness rules remain distinct.

### Qualification-to-quote handoff polish (v0.26)

Connected agents continue from capabilities directly to qualification without repeating connection-method selection. Qualification instructions explain the simulated test, mandatory revision and reviewer-control steps. New offers require explicit selection of a declared supporting capability; no first-capability default is silently applied. Existing offers retain their selected capability when edited. Buyer status remains specific to that capability revision; other skills remain unassessed. Profile edit drafts are distinguished from a newly created agent. Builder product-area restoration takes precedence over corporate demo startup when returning to the builder workspace.

### Automatic marketplace operation (v0.27 direction and demo)

Builders describe arbitrary capabilities; suggestions are optional discovery aids, not eligibility taxonomies. Manual offer previews accept existing or newly described capabilities with outputs/limits; new claims are unassessed. API/SDK/MCP remain transport choices, not limits on tasks. Per-agent operating rules capture automatic mode, minimum payout and concurrency. Production runtimes independently validate fit, cost, capacity, permissions and inputs before bidding. The prototype stores these rules but does not execute a supplier runtime or enforce a production allocator.

Posting now automatically generates explicitly fictional competing offers. The buyer selects and approves the price; funding and corporate approval remain required. A funded automatic demo route progresses without manual builder clicks, submits required checkpoints or an illustrative final handoff, and waits for buyer review. The accelerated demo uses seconds for visibility; it does not produce actual commissioned outputs. Simple direct tasks display illustrative estimates of 8–30 minutes, while complex tasks retain task/agent-specific estimates. There is no universal maximum delivery time. Buyer review and input waits are separate. Real automation, pricing, evaluation and payout services remain unimplemented.

### Time to start and simple-task automation (v0.28)

“Within minutes” describes request-to-agent-start, not time to finished delivery. Track posted_at, first_offer_at, accepted_at, funded_at, inputs_ready_at and started_at separately in production. Target a short platform-controlled dispatch window after buyer acceptance, funding and required inputs; human decision, corporate approval and missing-input delays must be visible. These are proposed targets, not measured SLAs. Supplier delivery estimates remain task/capability/capacity-dependent. The prototype now labels start and delivery separately, and removes the previously introduced 8–30 minute completion presets.

Simple-task cadence is saved before automatic bids are generated, so direct tasks do not inherit guided checkpoints. Self-contained company research starts automatically after explicit demo funding, without an extra inputs-ready click. Work depending on files, access or required approvals still pauses. Automatic offer cards offer Accept & review funding, combining offer selection with the existing explicit funding confirmation and preserving corporate approval checks. No real charge is made. Final buyer acceptance remains separate from automated delivery.

### Builder workspace information architecture (v0.29)

A single primary navigation replaces duplicate workspace tabs and repeated marketing heroes: Dashboard, Agents, Opportunities, Tasks, Earnings, Settings. Dashboard emphasizes actionable exceptions, work and recent offers, with linked summary counts. Agents lists all supplier profiles before entering an individual setup editor. Opportunities shows open buyer briefs; manual quoting is a demo inspection path while operating rules live on agents. Buyer-request creation is tucked into explicit demo tools. Tasks has local stage filters, not another workspace navigation. Earnings aggregates the supplier account rather than silently filtering to the selected agent. Operator verification, payouts and developer reference live in Settings; setup screens return to the relevant context. Every task action preserves owning-agent selection. Existing browser data, approvals, delivery and payout state are preserved.

### Builder automation continuity (v0.30)

Enabling automatic mode checks eligible open demo briefs and creates offers bound to the configured supplier agent and its assessed capability. Eligibility requires available/connected agent, current capability pass, operator verification, payout readiness, minimum payout and free concurrency. Existing offers are not duplicated, replaced or resurrected automatically. The demo uses explicit narrow capability-name matching for research/video/web, not a production semantic matcher. Other capability declarations remain unrestricted. Offer funding rechecks agent readiness, assessment configuration and capacity. Accepted simulated work progresses while the Tasks/Dashboard/Earnings monitor is open, without requiring the buyer to watch the task. Qualification leads to automatic-rule configuration; rule setup links directly to pending quotes. Actual remote bidding/execution, shared multi-user ownership and server scheduling remain production gaps.

### Buyer workspace usability (v0.31)

Signed-in Request work focuses on the request composer and simple examples, with repeated marketing sections removed. My tasks filters to the current buyer personal/team context, excludes supplier portfolio fixtures and labels stage-specific next actions. Offer cards are the single comparison surface; the repeated table is removed. Ranking preferences remain expandable, and alternatives collapse after an offer is selected. Acceptance/funding permissions are unchanged. Delivery review, acceptance and revision requests live directly in the delivery desk alongside submitted content and evidence, removing the review-desk/task-page bounce. Accepted output, downloads, connections and handoffs remain in the same place. Task progress has a clear return to My tasks; automatic-demo explanations are expandable.


### Buyer-to-builder continuity and low-friction operation (v0.32)

For an assignment owned by a registered demo supplier, switching workspaces from task progress or the delivery desk retains the same task ID, selected agent, commercial terms, scope version, conversation and submissions. Returning as buyer opens delivery review directly when a submission is ready or accepted. Other workspace switches retain their normal destinations; unowned fictional suppliers do not become the user's agents. Task rows display stable task IDs, and builder statuses distinguish waiting for buyer acceptance from an action the builder must take. Running automation is excluded from Needs attention, and actionable rows are not repeated in the dashboard's Active work preview. Builder review language and repeated demo banners are simplified. The delivery desk includes the same task conversation, so reviewing files and asking questions do not require switching screens.

The intended buyer experience is conversational: describe an outcome, answer only missing details, choose an offer, explicitly authorize funding, and receive the result in the same task. Simple work requires no intermediate coordination. Exceptions, input requests and agreed checkpoints surface only when needed. Supplier automation handles bidding and execution; financial and acceptance decisions remain explicit. This is still one browser-local simulation, not shared server state between independent logged-in accounts, live agent execution or real payout settlement. Production needs participant authorization, durable task events, live subscriptions, idempotent dispatch/settlement and revision handling by supplier runtimes.


### Conversational buyer workspace (v0.33)

Request, clarification, scope review, competing offers, funding, execution updates, checkpoints, delivery, revision and acceptance appear within one task conversation. The initial request and clarification history remain visible as the current decision card changes. Missing-details parsing reuses the existing deterministic demo, with an editable composer throughout. A complete brief progresses directly to an inline scope card; the buyer explicitly posts it. Offers show total price, start window and task-specific first-delivery estimate; qualifications, recommendation reasoning and tradeoffs are expandable. Selecting an offer reveals inline funding review, and a missing demo payment source can be connected there. Funding, scope changes, checkpoint decisions and acceptance are explicit controls, never inferred from chat messages.

The agreed scope, sample attachments and activity log stay accessible beside the thread, collapsing above it on smaller screens. Delivery previews, evidence, downloads, revisions and tool handoffs appear in the same conversation. Simple tasks skip interim checkpoints; complex work retains agreed approvals without a separate progress screen. Draft messages persist, and refresh reopens the last conversation in the current browser tab; Request work explicitly starts a new conversation. Builder assignment identity and commercial permission checks are preserved. Corporate budget, payment-source and acceptance rules still apply; account management and company approval workspaces remain auxiliary surfaces.

This design is intended to lower navigation and coordination effort, especially for simple tasks. It is a product hypothesis to validate through completion rate, time to first funded assignment, unnecessary clarification rate, comprehension of price/scope and successful delivery/revision. The prototype uses rule-based brief extraction and status replies, browser-local storage, fictional offers and accelerated illustrative output. It does not provide a live general-purpose conversational model, real supplier execution, independent verification, actual payments or shared account synchronization.


### Conversational timing and delivery handoff polish (v0.34)

A timing strip stays with the buyer conversation after funding: Since started (wall-clock time), Agent working time for the initial delivery (excluding recorded pauses), and Current phase. Funding alone is not a start; required-input waits show Not started until a start or inputs-ready timestamp exists. Elapsed time includes waits after start and freezes at buyer acceptance as Total elapsed. First-delivery elapsed is recorded separately from acceptance. Timestamps and accumulated execution time persist across refresh; a lightweight ticker updates just clock text, preserving the message composer. Older records without timestamps show unavailable timing rather than inventing a start. Accelerated simulated runs are explicitly distinguished from measured supplier performance.

Automatic execution waits for a recorded inputs-ready timestamp before starting its accelerated simulation. Automatic checkpoint and final submission transitions accumulate their working interval before pausing. Buyer checkpoint and delivery review remain separate from agent work. Delivery tool connection setup opens over the conversation and returns in place, rather than moving the buyer to another workspace page. Financial and external handoff confirmations retain their existing guards; no live payment or external tool authorization occurs.


### Product color direction (v0.35)

Relay retains its minimal marketplace layout with violet primary actions, lavender conversation surfaces, blue progress and approved-checkpoint treatments, and restrained apricot highlights. Buyer chat, offers, funding, delivery, corporate views and the builder workspace share the same palette. Status remains explicit in text; color is an additional cue. Focus treatments and primary-action contrast remain visible, including disabled states. This is a visual update with no change to marketplace behavior or commercial assumptions.


### Restored marketplace palette (v0.36)

The current visual direction returns to the Upwork-inspired palette: white surfaces, charcoal typography, green primary actions and quiet green selection, recommendation and completion treatments. It replaces the violet, lavender and apricot experiment in v0.35. The conversation layout, timing and marketplace workflows remain unchanged.


### Buyer and builder account access prototype (v0.37)

Registration and sign-in now model one account with buyer and builder workspace access. Passwordless email entry leads to a six-digit verification-code screen, with wrong-code, five-minute expiry, resend cooldown, change-email and recovery-help states. Signup detects an existing demo profile; sign-in detects a missing one and offers seeded sample accounts. Draft identity fields, pending request intent and code challenges persist in session storage across refresh. A saved buyer request resumes after verification and personal/business onboarding. New builders continue to a fresh agent-setup draft; returning builders restore their workspace, rather than always landing on the buyer homepage.

The account menu includes profile settings, workspace navigation and sign-out. Demo sessions have eight-hour expiry checked on interaction/render; an explicit expiration preview demonstrates reauthentication and task resumption. Profile display names and the last workspace are saved per sample email. A simulated Google-provider chooser uses fictional identities only. Builder account registration remains separate from capability qualification, operator verification and payout eligibility.

This is authentication UX, not production authentication. Fixed code 123456, sample profiles, session expiry and provider screens are browser simulations. No password, identity evidence or live provider token is collected, no email is sent, and profiles share the same browser-local tasks, company and agent dataset. Production must implement real identity ownership, secure server sessions, permission and tenant enforcement, rate limits, invitations, provider account linking, terms/privacy handling and verified recovery. The prototype's profile registry must not be used as a production identity store.


### Entry-aware registration and onboarding (v0.38)

Relay keeps one identity and sign-in system for both buyers and builders. Separate entry points personalize the copy and onboarding without creating separate credentials or preventing later workspace switching.

| Signup entry | After verification |
| --- | --- |
| Buyer request or example brief | Personal/business workspace choice, then resume the saved brief; do not ask buyer or builder again |
| Builder “Connect your agent” / “Get started as a builder” | Fresh agent setup draft, then capabilities, connection and qualification; retain existing agent records |
| Generic “Get started” | Ask “Get work done” or “Connect my agents” once, then the corresponding onboarding |

The selected entry survives switching between signup and login, code resend and refresh. The same rule applies to simulated Google sign-in; choosing a fictional provider identity does not override the originating entry. Generic registration still asks for the intended workspace. Buyer personal/business onboarding progress survives refresh and retains the pending request for personal or company continuation. Returning users follow an explicit entry or saved task intent when present, otherwise their last workspace. Builder sign-in returns to the dashboard rather than creating another agent draft.

Acceptance: verify all three entry paths, email and simulated provider routing, saved buyer brief resumption, refresh during verification/onboarding, and returning sign-in. Account registration does not grant operator verification, capability qualification, payout eligibility or corporate permissions. All authentication remains simulated as described in v0.37; production authorization must enforce workspace and organization access independently of navigation.


### Account continuity and workspace switching (v0.39)

The shared returning-login screen explicitly covers buyer tasks, builder agents and earnings. Builder registration cancellation returns to the builder entry. Unfinished buyer onboarding, including its personal/business step and pending brief, resumes after sign-out and a later sign-in rather than silently discarding the request.

Workspace switches and returning login restore the saved context for each side: the buyer conversation, the builder task or operating screen, and an unfinished agent setup draft. Switching does not create another task or agent. Explicit new-request and task intents take priority over saved navigation. A buyer business workspace and its demo role can be restored only when the saved company ID still matches the browser's company record; unrelated profiles default to personal. This is demo navigation continuity, not membership or permission enforcement.

All profile-specific resume pointers remain browser-local simulation data. Production must validate task access, company membership and roles on the server before restoring any view. Signing out removes the active session and open-conversation pointer while preserving saved work for a subsequent authorized login.


### Company knowledge and user-built Relay-operated agents (v0.40)

**Decision:** Extend the buyer workspace with persistent, permissioned company context and private user-configured agents operated by Relay, alongside independent marketplace suppliers. AgentGrid’s shared artifacts, explicit agent identity, scoped permissions and history inform the concept; this does not select AgentGrid as a vendor or promise an integration. Inspiration: https://agentgrid.io/docs/connect-your-agent/how-agents-connect and https://agentgrid.io/docs/artifacts/knowledge-base.

#### Company knowledge experience

Admins connect a Drive account, choose specific folders and assign team access. Employees browse only folders made available to their team; approvers do not acquire connection administration rights. The prototype supplies fictional Brand & marketing, Product library, and Sales & customer research folders. All start unshared. Previewing displays fictional source files; connection, refresh, sync versions, team grants, disconnect and activity history persist locally. No OAuth, real files, tokens, passwords or external API requests occur. Company knowledge is separate from delivery destinations: permission to read a source never implies permission to write to Drive, publish or send externally.

A new task initially includes available shared folders, which the buyer can deselect before posting. This is a convenience assumption to validate; production should recommend the minimum relevant sources and require visible confirmation. The conversation shows selected folders and versions. Posted scope fixes the context selection. Bidders receive the brief and source metadata, never the private contents of every company folder. Only the funded winner receives task-specific read access; a Relay-operated agent’s permitted folders are intersected with the task’s selected folders. An agent may therefore quote without access to all task sources: the buyer must compare that limitation.

Connection changes or changed source versions invalidate an unfunded selected offer; refresh produces new scope-version offers and clears prior selection, budget approval and funding confirmation. Required source changes during automated execution pause future steps. Reconnection alone does not restart a paused task: the buyer reviews and approves updated context to resume. Source-free tasks are unaffected by unrelated connector changes. Revocation blocks future reads and cannot make an external supplier forget already disclosed information. Return-to-task navigation retains the task identity while managing knowledge.

#### Your agents: built by the user, operated by Relay

The buyer’s **Your agents** area is distinct from the supplier **Builder workspace**. Users describe agent capabilities and instructions in open-ended text, choose a simulated Claude-powered worker or OpenClaw adapter, select allowed knowledge folders, set a maximum total per task, and enable or pause automatic quoting. Company admins manage shared agent configuration; individuals manage their own. These agents are private to the workspace and are not automatically listed as marketplace suppliers. Existing independent supplier registration, qualification, operator verification and payout requirements remain intact.

There is no claim that saving instructions proves capability. The prototype demonstrates the existing research, video and website delivery workflows; it does not execute arbitrary custom tasks. Demo fit is unassessed, so enabled private agents appear as unproven alternatives without fabricated ratings. A demo task shortcut is an example brief, not an inference that any configured agent can complete every task. In production, routing must check actual capability fit, tools, data requirements, runtime readiness, capacity and restrictions before issuing a quote.

#### Unified offers and lifecycle

For the same posted task, Relay-operated and marketplace offers appear together, labeled by operating model. Relay-operated cards show runtime preference, company folder grants, no proven history, estimated execution components, Relay fee, fixed simulated total, and configured task budget. They use the same buyer selection, company approval, payment-source confirmation, input readiness, checkpoints, revision, evidence, acceptance and delivery lifecycle. Neither internal status nor cheaper token estimates automatically wins a recommendation. Marketplace ranking continues to use available quality, reliability, price and speed evidence; the private agent carries no fabricated performance record. Explain when a recommendation excludes an unassessed option.

Only the funded offer executes. Quotes above the private agent’s maximum total are excluded. Pausing the agent or modifying its configuration invalidates unfunded offers. The accepted quote locks its price; later settings do not silently increase the task’s budget. Private agent setup does not create supplier earnings or a payout obligation. Delivery and the downloadable JSON package retain the operating model, simulated cost breakdown and approved context metadata. Source attribution indicates simulated access, not proof of real use or output quality.

#### Cost model and unresolved economics

For this prototype, a Relay-operated offer is a **fixed illustrative task quote**: model budget + tools/data + compute/checks + Relay fee. The configured per-task limit is a ceiling for eligibility, not the amount charged. There are no real charges and no authoritative provider-metered costs. Fixed quote components sum to the displayed total. No automatic budget increase or uncapped usage is permitted. Supplier payout fields in the existing demo ledger represent an internal execution budget for Relay-operated quotes, not a payment due to an independent builder; product receipts make that distinction explicit.

Production may adopt fixed outcome pricing, capped usage plus a fee, or a business subscription plus execution usage. These are alternatives requiring validation. If fixed pricing is chosen, Relay bears execution overruns under the agreed terms. If usage pricing is chosen, it needs reservation, stop controls, authoritative provider metering/reconciliation, retry and revision allocation, and a clear treatment of unused reserved funds. Provider SDK cost estimates alone are not billing records. Model usage is only one cost: infrastructure, external tools/data, retries, checks, support and failed jobs also matter. **Unit economics, fee levels, margins and subscription assumptions remain unvalidated; this prototype does not establish profitable pricing.**

#### Technical production requirements

- Store connector grants per company and per folder, with provider identities held server-side. Check membership and file permissions on every retrieval; propagate deletions/revocations to indexes and caches. Do not embed a whole drive in every prompt. Use permission-aware retrieval with source references and version timestamps.
- Issue task-scoped agent identities and short-lived read grants after award. Keep confidential documents and provider credentials out of bidding payloads, browser storage and third-party agent logs. Maintain immutable access/audit records and retention controls. Retrieved documents are data, never authority to expand access or authorize actions.
- Run Claude-powered workers through supported provider APIs or an agent SDK in isolated execution environments. Connect OpenClaw through a controlled private adapter; its gateway operator credential is not a narrow per-task permission. Do not expose a shared gateway token to customers or suppliers. Runtime preference is distinct from model choice: an OpenClaw runtime may itself use Claude.
- Keep business tenant data, personal context and supplier runtime boundaries separate. No browser-local demo role or knowledge setting constitutes production authorization. Enforce tool allowlists, spend stops, idempotent dispatch, cancellation, durable job state, evidence validation and scoped write approvals on the server.

#### Acceptance and prototype limits

Verify admin connection/folder controls, employee restrictions, cross-workspace filtering, refresh persistence, both runtime preferences, open-ended instructions, cap exclusions, mixed offer comparison, stale-quote funding rejection, source-loss pause and explicit resume, and end-to-end funding/delivery acceptance. The deployed prototype remains a shared browser demo with simulated auth, source data, runtime execution, checks and costs. No live Drive, Anthropic or OpenClaw integration has been created.


### Personal buyer navigation (v0.41)

Private Relay-operated agent configuration is a business-workspace feature. Personal buyers do not see Your agents or agent-building calls to action, cannot open its setup routes, and do not receive offers from previously configured personal managed agents. Existing saved demo configurations are retained rather than deleted. Business workspaces retain shared agent setup and quoting. The supplier Builder workspace and its independent agent management are unchanged. This supersedes v0.40's proposal that individuals manage private Relay-operated agents.


### Marketplace-first participation and optional company execution (v0.42)

**Decision:** Relay prioritizes independent builders. Private company agents are an optional business service, not automatic competitors for every task. This supersedes the automatic mixed-offer behavior in v0.40. Personal buyers remain marketplace-only under v0.41.

New tasks request independent marketplace offers by default, even when the company has available private agents. During scoping or offer review, an authorized buyer can explicitly select **Include company agents** for that task. This adds eligible private offers without changing the scope, existing marketplace prices, selection or approval. The choice persists through refresh and scope revisions for that task; it is never inherited by the next request. If no eligible marketplace offers arrive, the product may offer private execution as an explicit fallback, never silently route to it.

The business navigation calls the optional service **Team agents**. Agent setup controls availability on request, not automatic participation. “Request with this agent” is an explicit alternative entry that includes the chosen agent for the new task; marketplace alternatives remain available. Instructions are described as configured by the team and execution as run by Relay. Runtime preference remains an implementation choice and is simulated.

The buyer can remove company agents before funding. Open private offers are withdrawn; if a private offer was selected, its selection, exact-quote approval and pending funding review are cleared. Marketplace offers and an existing marketplace selection/approval are preserved. Funded assignments and accepted deliveries are not cancelled or repriced by this preference or its rollout. Existing unfunded auto-generated private offers are removed unless the buyer explicitly opts in under this policy.

Relay-operated offers remain prominently labeled, carry no invented quality history, and receive no automatic ranking preference. All parties face the same outcome criteria. Private supplier bids, prompts and implementation details must not be used to build a competing Relay service. Production must make operator conflicts visible and measure both incremental demand and displacement: marketplace share of awards, private-agent opt-in rate, unfilled tasks recovered, repeat purchases, supplier retention and contribution after all operating costs. Demo prices demonstrate mechanics only; their large differences do not establish equal quality, real provider costs, profitability or a sustainable pricing advantage. Unit economics remain unvalidated.

Acceptance: new company and personal tasks have no private offers by default; explicit per-task inclusion adds private quotes; removal withdraws only private offers; stale private funding cannot proceed; marketplace approvals survive preference changes; refresh preserves an explicit choice; a subsequent task defaults to marketplace-only; funded legacy assignments remain intact.

### Marketplace and company-agent flow continuity (v0.43)

Both paths remain in one buyer conversation: request, clarify only missing details, review scope, compare offers, select an agent, confirm funding, track execution, review evidence, request revisions and accept delivery. The funding review and funded agreement retain the selected agent identity and whether it is an independent marketplace supplier or a company agent operated by Relay. Company agents remain explicit per-task opt-in.

Automatic demo assignments now return revisions in the same conversation without requiring the buyer to switch into the builder workspace. Revision feedback, delivery versions and the original funded total remain on the same task; acceptance is always explicit. Source-access changes pause initial execution and revisions until the requester approves restored context. Initial working-time measurements are not reset by a revision. Manually operated supplier assignments retain their manual submission flow.

Company-agent acceptance confirms the fixed illustrative task cost; it does not release an independent supplier payout. Actual charges, execution and source access remain simulated. The walkthrough tests workflow continuity, not the quality of a commissioned artifact.

### Corporate approval continuity (v0.44)

Marketplace and explicitly included company-agent offers use the same corporate budget policy. Selecting an offer above the employee threshold requests approval against that exact scope, agent and quote revision. The conversation displays Awaiting budget approval, the task ID, scope version and total; repeated clicks do not create duplicate requests. No funding or execution occurs at approval request or decision.

Approvers see task identity and whether execution is independent or Relay-operated. A decision confirmation links back to the same conversation. Approval changes its next action to funding review for the requester; approvers cannot fund another employee’s assignment or accept its delivery. Funding, progress, revisions, downloads and explicit acceptance continue on the original task. Role previews remain simulated and are not real access controls.

### Declines, revisions and renewed approval (v0.45)

A declined request keeps its reason on the same task, with direct actions to Revise brief or deliberately Resubmit for approval. Merely reviewing the declined offer does not resubmit it. A scope edit clears the selected quote, active budget decision and pending funding review immediately; reposting increments the scope version and obtains fresh offers on the existing task ID.

Changing an offer after approval clears that approval and any pending funding review. The new choice follows the current company approval policy. Switching back to a previously approved offer does not restore the old decision. Funding checks the current scope, selected offer identity and revision, terms, and matching approval; an old funding confirmation cannot fund a different selection or revised scope. Decline reasons and invalidation events remain in the original task history.

Revised supplier briefs identify the current scope as authoritative and retain the original request as context only. The approval inbox summarizes the current title and deliverable, with current acceptance criteria available for review, so earlier quantities cannot be mistaken for the revised scope.

## 27 Architecture review and production sequencing (v0.46)

The current review artifacts are [Product/business/code audit](Relay-Audit.md), [Architecture and design system](Relay-Architecture.md) and [POC/MVP production plan](Relay-Production-Plan.md). They refine implementation sequencing without authorizing a real-money launch. Section 16 remains unchanged in its conclusion: unit economics and take rate are unvalidated.

The public entry is now a working request composer: submission opens buyer signup with a returning-login option; the exact prompt persists through refresh and auth/onboarding. Typing alone does not interrupt the visitor. One account serves both workspaces. The buyer chat and public prompt share an extracted, escaped component and design tokens. Company knowledge controls belong in the company workspace; personal buyers do not see empty company-source controls. Offer history and the composer have separate layout regions to avoid hiding decisions.

Initial production boundaries are frontend, shared presentation, proposed API contracts, server-side business policies, authoritative persistence and durable workers. Package/test separation has begun, but most prototype workflows still run in browser globals and local storage. The new policy package is not a live API, real authentication, database transaction, payment service or an assurance of security. The OpenAPI draft covers only an initial slice; Section 18's additional supplier routes remain to be specified and implemented.

Sequence a technical POC with a real external supplier and sandbox provider events, then an invite-only paid MVP with human security/payment/operations review. Support file-based deliverables across admitted capabilities; do not impose a universal capability ceiling. REST and event recovery come before completing SDK/MCP surfaces. Organization ownership and isolation exist from the start; complex company governance, connected writes, private knowledge, company runtimes, crypto and multi-operator settlement have separate release gates.

The founder approves cohort, operating region, providers, commercial policies and budget. A named technical lead owns implementation and release; independent security, payment/provider and operational reviewers sign off concrete evidence. Passing prototype tests does not satisfy those gates.


## 26 Recurring responsibilities and local conversational scoping

**Added 28 October 2026.** Customers may request one-off work or ongoing responsibilities in ordinary language, such as “Every Monday find 50 new companies matching our ICP.” Preserve the same conversation and reviewed scope; do not require a separate automation-builder product.

**REC-01 — Scope once, verify each run.** Review deliverables, input/context sources, quantity, formats, acceptance evidence, revision policy, schedule, timezone, start/end dates, supplier policy, price per run, currency, fees and monthly spend cap. Unknown terms remain explicitly unresolved. A chat message is not a standing authorization.

**REC-02 — Separate agreement from occurrences.** Store a versioned recurring agreement and separate run records, each bound to the applicable scope, inputs, supplier quote, funding/approval, execution and immutable delivery. Track last/next run, per-run outcome and monthly spend. Idempotency must prevent duplicate runs and charges. Never reuse an approval after material terms change.

**REC-03 — Operational controls.** Buyers can pause, resume or cancel future runs without losing history. Define DST, month-end days that do not exist, missed runs, catch-up, overlapping work, failures, retries and runs in progress at cancellation. Surface actionable exceptions rather than noisy internal logs.

**REC-04 — Supplier continuity.** Reusing a capable supplier is allowed within approved terms. Reassignment requires the same or explicitly approved capability, confidentiality, pricing and verification policy. Do not silently broaden supplier access or change commercial commitments. Use the fewest agents needed; marketplace supply remains the default.

**REC-05 — Commercial assumptions.** Recurring responsibilities may improve retention, but unit economics are not yet confirmed. Measure supplier payout, platform fee, inference/tool cost, review/support burden, refunds, retention and contribution margin. Illustrative take rates or revenue scenarios in concept discussions are not validated results.

**SCOPE-01 — Local production-development increment.** Replace canned interpretation with a free local model, schema-validated proposals and durable assistant messages. Ask only missing material questions, preserve corrections and constraints, and distinguish hypothetical/cost questions from scope changes. Explicit confirmation creates a new scope version and invalidates affected offers. Inference must not hold a database transaction; stale replies and retry/restart behavior must be fenced and evaluated.

**Implementation boundary:** localhost development can capture recurring intent and save an inactive recurring draft. Scheduling, standing payments and automatic future dispatch are not implemented or authorized. Current supplier execution remains one run at a time under explicit unpaid local permission. Published demo and hosted staging are unchanged. See `relay-platform/docs/Conversational-Scoping.md` for implementation and evidence. These additions do not narrow agents to preset task categories or authorize paid service provisioning.


## 27 Local v1 capability qualification implementation

**28 October 2026 — implementation boundary.** A connected supplier can now receive a real synthetic CSV test job for a selected capability, return actual output, complete a required sorting revision and receive a server-evaluated result. Passing one test never qualifies the agent's other capabilities or its full free-form declaration. General-purpose and specialist agents follow the same rule.

The initial `csv-normalize-v1` assessment covers normalization, deduplication, quoting, spreadsheet formula safety and ascending/descending sorting only. Evidence includes the supplied input, both output versions, reports, hashes, checks, timestamps and runtime identity. Buyers can review that evidence in an offer and retain it in the agreed-offer history. Offers snapshot the evidence at quote time and also indicate if it is no longer current.

The current assessment is automated and bounded, not an independent human review or a broad performance guarantee. Arbitrary capability-to-rubric fit is not automatically verified. Other domains remain unverified until suitable assessments exist. Test duration is one hour; successful evidence has a maximum 30-day validity and is tied to the tested connection and reported runtime version. These are initial local policies, subject to review.

Operator verification, funding, payouts and commercial eligibility remain separate gates. The local reference runtime is deterministic file-processing automation; qualification does not turn it into a general AI agent. No real payments, external sends, recurring execution or hosted activation are enabled by this increment.

Production follow-up requires representative held-out challenges, reviewer and appeal workflows, suspension, runtime-change attestation, richer artifact controls and protection against benchmark gaming. The detailed implementation and QA record is in `relay-platform/docs/Capability-Qualification.md`.


## 28 Local operator verification and sandbox settlement integration

The next production-building increment separates operator onboarding from capability qualification and separates funding, accepted delivery, transfer and payout. One operator account covers multiple agents. Verification and payout details are entered through provider-hosted onboarding; returning to Relay is not proof of readiness. Sandbox status must never be represented as production identity verification.

The localhost implementation reserves funding against the exact selected offer, scope version, input hash, operator and amount. Pending funding locks changes to that agreement. An explicitly funded sandbox execution cannot fall back to unpaid execution. Only a workspace owner can fund or refund in this increment; corporate employee approvals remain unimplemented. A full refund is allowed before transfer for unstarted, cancelled or failed work. Accepted delivery makes confirmed funds eligible for operator transfer; a transfer into the operator balance is distinct from a pending or confirmed payout.

Provider mutations use durable operation identifiers and reconciliation. Duplicate responses cannot duplicate settlement, and late responses cannot overwrite newer states. Old uncertain operations and failed refunds/payouts stop for review. No live keys or real-money operations are supported. Existing unpaid local execution remains available separately.

Founder decision: build the Stripe sandbox integration first, connect the account later. Consequently operator verification, Checkout and payouts in the main local app remain disconnected. Automated and browser fixtures exercise the integration without creating provider accounts or moving money. These results are not evidence of a successful Stripe integration or legal/commercial readiness. The published demo and hosted staging remain separate.

Sandbox policy is USD, $0.50–$1,000 per task and zero platform fee solely for testing. Section 16's economic assumptions remain unvalidated. Signed webhooks, scheduled reconciliation, dispute/reversal handling, partial refunds, fees/tax accounting, real provider validation and independent review are still required before real-money launch. See relay-platform/docs/Sandbox-Payments.md for implemented routes, policies and validation boundaries.


## 29. Durable payment events and automatic reconciliation

Local v1 now implements signed sandbox webhook ingestion and durable background reconciliation. Buyers and builders should see payment status update without pressing a check button or keeping the task open. Events are deduplicated and matched to the exact provider object/account; authoritative provider reads, rather than event payload claims, determine settlement transitions.

Jobs persist their lease, retry schedule and review state across restarts. Temporary provider failures back off; unresolved or contradictory financial outcomes require review and block further financial actions. Historical settlement journal entries are not rewritten. Reconciliation resumes previously authorized actions only; accepting a delivery does not itself authorize a payout.

This increment is evaluated with isolated fixtures and native PostgreSQL recovery/concurrency checks. Stripe remains disconnected, all money is simulated, and the published demo and hosted staging remain separate. Actual Stripe sandbox acceptance testing, operations/recovery tooling, disputes and reversals, production accounting and independent review are required before real-money launch. See `relay-platform/docs/Sandbox-Payments.md` for supported events and engineering evidence. Unit economics and production fees remain unvalidated; zero fees are only a sandbox test policy.


## 30. Payment recovery operations

Authorized operations reviewers can inspect delayed checks, provider references and retry history in the Relay workspace. Retrying requires a current snapshot and written reason. Relay queues the existing operation with its original provider identity; it does not create replacement payments or let reviewers assert settlement. Active checks, stale decisions and contradictory provider evidence block retry. Reviews and prior failure evidence are durably audited.

Access is an explicit server-side allowlist in localhost v1, separate from buyer/builder roles. The dashboard follows the prototype’s workspace design. All validation remains fixture-based with Stripe disconnected; hosted demo and staging are untouched. Production recovery still requires step-up access controls, operational runbooks, independent review and actual sandbox validation.


## 31. Local company membership foundation

Company workspaces now support explicit administrator creation, employee/approver invitations, recipient review and acceptance, and revocation. Personal and company task destinations stay separate; the composer identifies the selected workspace. Only administrators manage the member directory and access. Invitations expire after 24 hours and cannot be replayed to restore removed membership.

This is localhost implementation using local identity and PostgreSQL task storage. No invitations are emailed and local email ownership is not independently verified. Approval decisions, exact-agreement budget reservations and corporate funding remain the next increment; approver membership is not a working approval flow yet. Hosted identity parity and independent review remain production gates.


## 32 Local v1 company approvals and exact-offer reservations

Employees submit the chosen offer from the task conversation. Reviewers see its scope, supplier, price, expiry and business reason in the company workspace; they approve and reserve budget or decline with feedback. Resubmission remains on the same task with a new approval identity. Earlier decisions are retained as history and cannot approve a later request. Buyers see pending, declined, approved or stale status without leaving the conversation.

Approval binds the complete offer, scope version and input hash. Changing the offer or scope releases its reservation and requires another decision. Ordinary chat messages do not reset approval. Company owners also request approval; owner self-approval is currently permitted locally and must be reviewed before commercial launch. Employees cannot approve or change allowances, and approvers do not gain unrestricted task/file access.

The local budget is a fixed USD allowance, not a monthly subscription or escrow balance. Approval reserves the exact quoted amount atomically across competing requests. Expired unstarted offers stop holding allowance. Execution/checkout converts a reservation into a commitment. Unpaid local completion/cancellation/failure releases it; sandbox payment commitments remain until confirmed refund or checkout expiry. Failed refunds continue holding the commitment. Limits cannot be lowered below held amounts. No real money is moved and Stripe remains disconnected.

Before funding or execution, Relay checks the current agreement, allocation and approver's current membership. Production requires further review of in-flight revocation across identity and application storage, hosted identity parity, fee/tax treatment, financial accounting, approval thresholds, delegation and monthly budgets. These local checks do not establish real-money readiness. Detailed contracts, evaluation and limits: relay-platform/docs/Company-Workspaces.md. Published demo and staging remain separate and unchanged.

## Recurring responsibilities — local v1 implementation, 29 October 2026

Recurring work is presented as **Scheduled work**, reached from “Do this regularly” on an accepted trial delivery. Setup reviews three things: saved knowledge, calendar, and execution rules. Knowledge initially means the exact accepted brief plus its optional source file and usage notes. It is a versioned snapshot, not live Drive sync; repeat runs reuse those inputs. A company knowledge library with connected, permission-scoped sources remains a separate integration.

The flow is: saved context → fresh quote from the chosen qualified agent → price/access checks → fresh company approval when applicable → execution → file safety checks → buyer review. Each run retains a separate conversation and delivery, linked to the schedule. Personal local runs can start automatically under explicit standing consent and quote limits. No automatic final acceptance or external-tool delivery is implied.

Daily, weekly and monthly schedules include a timezone and explicit calendar policies. Only one unfinished run is allowed. Missed slots over one hour old are skipped; absent month dates and DST gaps are skipped; repeated clock times run once. Pause stops future starts while preserving existing work. Resume uses the next slot, preserves failed-run history and closes unstarted requests. Access-epoch changes require a newly reviewed schedule. Context/agent changes require a new accepted trial rather than silently changing existing permission.

The current implementation is unpaid localhost execution only, using fresh supplier quotes as test-limit accounting. It is not paid subscription billing, a production financial ledger, general agent orchestration, live knowledge retrieval or an always-on hosted service. Marketplace suppliers remain first; company agents do not automatically compete. Unit economics and commercial recurring-work policies remain unvalidated.


## Runnable deliveries and tool permissions — product direction, 29 October 2026

Relay should support two delivery types: downloadable artifacts, and apps or automations that the customer installs and runs inside their workspace. This is an approved product direction, not a working arbitrary-code hosting capability. Current localhost execution runs supported supplier runtimes and scheduled tasks; it does not install uploaded applications or grant live Drive/CRM access.

### Customer experience

Logged-in navigation uses one left sidebar, separately scoped to buyer and builder workspaces, with recent buyer conversations and account/workspace controls. Public landing and authentication remain separate.

For runnable work, the conversation carries the brief, offer, permissions proposal, test evidence and delivery. After reviewing the result, the buyer separately chooses **Install in workspace**. Installation presents the app version, data sources, allowed actions, running costs/limits and responsible owner. A future **Apps & automations** destination lists installed items, next runs, recent results and items needing attention. Users can run manually, configure a schedule, pause, inspect history or revoke access. Do not add a second competing task conversation or require users to draw a technical workflow for ordinary requests.

Setup describes the execution flow in plain language: **When to run → What information to use → What to do → Where results go → What needs approval**. Knowledge may be uploaded snapshots or explicitly connected, selected resources; distinguish snapshots from live sources and show freshness. Missing or revoked inputs pause execution with a clear next action. Each run retains immutable input versions/references, permission version, agent/app version and output evidence.

### Delivery package and runtime boundary

A runnable delivery needs a versioned manifest identifying its entrypoint, supported runtime, inputs/outputs, required connector operations and resource scope, network destinations, dependency lockfile, and time/memory/cost limits. Scan files and dependencies, validate the manifest, run an isolated test with fixtures, and retain results before installation. Antivirus alone is not a sandbox or proof of safe code.

Delivered UI runs on an isolated origin with a restrictive frame policy; it never receives Relay session cookies or connector tokens. Executable work runs in an isolated worker/container with per-run resource and network limits. Never execute supplier code inside the Relay API process or serve arbitrary delivered scripts under Relay's authenticated origin. A tool broker performs authorized external operations; secrets stay server-side. Signed package identity and immutable version/digest link the installed app to reviewed evidence. Expanded permissions require new approval on upgrade. Rollback changes future runs; it cannot undo external effects already committed.

### Permission contract

Connecting a tool does not authorize all agents to use it. A grant binds the workspace, authorizing member, task or installed app, approved version, connection, selected resources, allowed operations and expiry. Every run receives a short-lived identity, not the user's OAuth credentials. The broker rechecks current membership and grant status on every tool call, with deny-by-default cross-workspace isolation. Retrieval, search indexes and caches must enforce the same resource boundaries.

Present permissions as concrete statements: “Read these two Drive folders”, “Create draft leads in this CRM list”, “Ask before sending email”, and “Expires after this task”. Read, create, update, send and delete are separate operations. A builder may request access but cannot grant it. Model instructions, documents and tool outputs cannot expand permissions. Task acceptance, budget approval, operator verification and data-access consent are independent checks.

Recurring execution can use explicit standing grants within agreed scopes, budgets and expiry. Changed resources, broader actions, new app versions that expand access, or membership changes require review. Revocation blocks subsequent calls and future starts; running work is cancelled where possible, and any completed external effects remain visible for recovery. Sensitive or consequential actions require a configured human approval bound to the exact action payload, not a reusable blanket chat message. Retried writes require durable idempotency and provider reconciliation; do not blindly repeat an uncertain send or update.

Audit entries record who authorized access, which app/agent version called which operation on which resource, the decision, and outcome, without logging credentials or unnecessary private content. Workspace admins can review and revoke grants; ownership transfer and employee removal must not leave unattended privileged schedules.

### Build and commercial gates

Implement in order: permission/grant model and audit contracts; a local fixture connector and broker with revocation/replay/isolation tests; one restricted runnable package type; install/review/run UI; then one real OAuth connector and managed isolated execution. Keep Stripe disconnected and hosted demo/staging untouched during local development. Do not present fixture connectors as live integrations.

Separate the price of building the app from future runtime, model, connector and storage costs. Show per-run caps and funding requirements before enabling schedules. Hosting responsibility, maintenance, supplier revenue share, unit economics and subscription pricing remain undecided. Production release requires independent review of sandbox escape resistance, connector scopes, tenant isolation, data retention and external-write recovery.


### Runnable delivery implementation — localhost increment, 29 October 2026

The first working **Apps & automations** increment now installs supported CSV-cleaning and link-organizing recipes from an accepted unpaid trial. Users select a local source and grant bounded read access, run manually or on a calendar, review output, save it in Relay and download it. Each run retains versioned provenance and an input snapshot. These are Relay-reviewed deterministic recipes, not execution of supplier-uploaded code. The original supplier task remains linked; no new supplier bid or payment is implied by running the local recipe. “Scheduled work” separately retains recurring marketplace-agent execution with fresh offers.

Connected tools now supports local text/CSV fixture sources and explicit permissions, with source updates, disconnect, grant expiry, revocation and renewal. Real Drive/CRM/Slack connections remain unavailable. Tool access for an active task binds the assigned agent, current execution lease, assignment/scope, authorizer and requester access epochs, and exact source. The supplier API exposes a read-only local broker; write/send/delete permissions are unavailable. Workspace owners alone manage app installation and sources in this increment.

New output approval is tied to its exact hash and the grant used to create it. Changed permission requires a fresh run; previously saved outputs remain accessible under current workspace authority. Run results and access decisions persist in native PostgreSQL. Backend permission checks do not rely on frontend buttons. Full contract and limitations: `relay-platform/docs/Workspace-Apps.md`.

Next gates are general isolated app packages, explicit app sharing, one real connector, denied-call operational monitoring and independent security review. No real money, external tool access or hosted deployment is enabled by this increment.


## Recurring work correction — 29 October 2026

Recurring responsibilities originate in an explicit user request, such as “Every Monday, prepare a deduplicated links report.” Accepting a one-off delivery never creates or offers to convert it into recurring work. This supersedes the earlier mandatory accepted-trial flow.

The user describes the job and cadence in the conversation, clarifies context and missing details, confirms the recurring scope, compares offers and selects a qualified agent. Relay then presents an explicit calendar, timezone, saved context, per-run/monthly quote limits and execution permission review. Only enabling that reviewed schedule authorizes future local runs. A completed trial is not required. The recurring request itself cannot be executed or funded as a one-off; every occurrence gets its own task, current quote, permission checks, required company approval and delivery.

Scheduled work provides a conversational new-request input and existing schedule history. Daily, weekly and monthly calendars are implemented locally; other timing requirements must remain inactive until represented correctly. The user confirms exact time/day and timezone. Existing schedules and their histories remain intact. Pausing prevents future starts, not work already in progress.

Installing a supported reusable app remains a separate explicit action and does not itself activate any schedule. Local recurring execution remains unpaid, requires Relay and its runtime to be running, and does not imply live Drive/tool synchronization.


### Conversational calendar review — 29 October 2026

Recurring requests use chat plus an inline calendar card after offer selection. Explicit times and single weekdays are suggested from the confirmed schedule description; missing timing stays unfilled. The user can edit day, time and timezone. Server-calculated next-three occurrence previews use the execution calendar engine, including DST and short-month handling. Activation remains explicit and stays in the conversation. Frequency changes return to scope review rather than silently changing an accepted arrangement. Current bounds: daily/weekly/monthly, first upcoming slot, repeats until paused. Custom start/end dates and arbitrary recurrence expressions are not yet implemented.


## Task context and agent-requested permission — 29 October 2026

Draft conversations now expose Add context / @ for explicitly selecting workspace-local sources. Typing @ opens the picker; source-name matches in the brief are suggestions, never automatic sharing. Selection persists source IDs and either latest-data mode or a saved content version. Selection changes the draft scope before offers. Source content is not part of public bids or scoping prompts; the local scoper receives reference metadata only. Selection is separate from permission.

An assigned agent can request read access to selected sources, giving a purpose. The buyer sees the request in the same conversation and an owner can approve up to 24 hours of assignment-bound read access or decline. Scheduled requests copy context references into each run without inheriting grants. Reads enforce current source/credential/membership authority, lease and expiry; revocation remains effective on retries. Requests and decisions are audited. Unsupported permission categories stay blocked.

Implemented scope is local owner-managed sources, saved-version/latest reads, API/SDK requests and the deterministic link runtime demonstration. Live Drive/CRM connectors, semantic cross-tool search, employee source delegation, arbitrary external actions and indefinite execution suspension await later increments. @ is a picker shortcut rather than a full inline autocomplete token editor.

### Local implementation update — permission waiting (29 October 2026)
An agent’s permission request pauses execution time and releases its worker lease. The conversation explains the source, purpose and scope. Declining leaves work blocked without repeated prompts; the user can explicitly approve later or cancel. Once all required requests are approved, the same assignment resumes through a fresh worker claim. Waiting must not be reported as supplier lateness. This is implemented for local read access; live connectors and external write/send approval remain future integrations. No automatic permission expiry reminders or abandoned-wait retention policy is implemented yet.

### Local implementation update — explicit Drive snapshots (29 October 2026)
Workspace owners can configure Google OAuth and choose individual Google Docs, text, CSV or JSON files through Picker. This first connector imports immutable, timestamped Relay snapshots up to 16 KB. New Drive edits require a new explicit import; folders and live synchronization are not implemented. Users select imported sources with @, and assigned agents still request task-specific read permission. Connecting Google alone never grants a supplier access. Google credentials are not sent to suppliers. Disconnecting Google stops imports and removes local credentials; saved copies remain, with separate source-disconnect controls for revoking agent access. The UI must clearly distinguish Google connection, saved copy and agent grant.

Integration code and provider fixtures are tested locally, but real Google consent and Picker acceptance remain pending Google Cloud OAuth setup. Demo and staging remain separate. Live-data scheduled jobs need a subsequent synchronization/versioning design rather than implying that these snapshots remain current.

### 29 October 2026 — authorized live Drive reads

Owners can explicitly choose a saved snapshot or a live selected file. Live sources refresh on authorized task/app reads, including scheduled app runs; saved task context remains pinned. Provider errors never silently serve cached content. Reconnecting requires reselecting the file and renewing the affected grant. Source revisions are retained, buyer task history shows versions read, and app runs preserve their input snapshot. Scope stays limited to selected supported text files of at most 16 KB, with 100-version/read-history safety limits; no folder sync or external writes.

Validation: 143 application/connector/local-HTTP/runtime tests passed, plus 40 frontend and 5 shared UI checks. Tests cover changed content, immutable prior versions, scheduled execution across recreated workers, failure pausing, saved versus latest data, reconnect/relink grant fencing and expiry during a provider read. Disposable native PostgreSQL browser QA exercised the actual local supplier requesting access, resuming and delivering scanned files, with buyer-visible source history. Desktop screenshot reviewed. Google responses were fixtures: real OAuth/Picker/CSP acceptance, mobile QA and independent security review remain outstanding. Localhost only; Google and Stripe remain disconnected; demo and staging unchanged.

### Product clarification — Apps, recurring work and agent conversation (29 October 2026)

An app is a reusable tool explicitly installed by a buyer with a defined input source, permitted operations and output. An ordinary delivered file is not an app. A recurring responsibility is an explicit buyer request for an outcome on a schedule, with context, agent selection, limits and review requirements. Installed apps may separately be scheduled by explicit configuration; installation alone never starts a recurring job. The local product currently executes only supported CSV and link recipes, not arbitrary supplier code or custom dashboards.

The intended buyer-agent communication surface is the existing task conversation, with the selected agent clearly identified. Clarification, progress, questions, evidence and permission requests should remain tied to that task and agreement. A chat message alone must not change scope, authorize spending, grant tool access or accept delivery. Supplier messaging needs authenticated assignment-bound endpoints, durable message IDs, delivery/retry status and capability signalling before an agent is advertised as conversational. Relay coordination messages, supplier-agent replies and human-operator replies must have distinct attribution. The current deterministic local runtimes do not generate conversational replies; this UI increment does not implement that supplier chat protocol.

### Conversation-first requesting — 30 October 2026

A new message starts a private saved conversation, not a marketplace request. Users discuss requirements and selected context in that conversation. Recent conversations retains unfinished chats; My tasks includes only requested work. The buyer explicitly reviews the proposed brief and requests offers. Chat messages, source reading and model replies never authorize posting, assignment, funding or external actions.

Context progress must represent real reads. Local v1 supports an explicit per-response action to read selected saved source copies with their versions shown alongside the response. Imported files are labeled saved copies; fresh external lookups must not be implied. Workspace authority and source revocation are checked before reading and before publishing a reply. Supplier read grants remain separate. The existing internal draft aggregate persists conversations; a dedicated conversation aggregate remains a future storage refactor, not a prerequisite to this user flow.

### Builder-delivered reusable data apps — 30 October 2026

Apps is the home for reusable tools commissioned through Relay and explicitly installed by the buyer. Localhost now supports builder-authored declarative data pipelines delivered as `relay-app.json`: filtering, sorting, selecting fields, deduplicating and limiting flat JSON records. After scan and delivery acceptance, the owner explicitly chooses a source and read-access duration. The installed version is immutable and linked to the accepted submission and supplier. Runs retain source provenance, package digest, per-step record counts and exact output review/download. Installation never schedules work automatically or grants external write access.

This adds custom data tools beyond the earlier fixed CSV/link recipes. It does not host arbitrary supplier code, web app UI bundles or public websites. Current local limits: 16 KiB package, 20 steps, 16 KB source, 1,000 flat records, 64 KiB output; owner administration only. Broader hosting requires an isolated runtime, package upgrades and rollback, quotas, operating/support responsibilities and explicit pricing. Marketplace builder creation fees and potential Relay running fees remain separate commercial decisions; local runs charge nothing. Google/Stripe, hosted demo and staging remain unchanged.

## Multi-builder parent plans — localhost increment, 5 November 2026

The founder explicitly brought a bounded orchestration slice out of the icebox.
One reviewed parent brief owns 2–8 dependent subtasks. Dependencies form an acyclic
graph, not a strict waterfall: independent steps may execute concurrently on
separate builders. Each step has its own supplier brief, acceptance criteria and
fixed quote ceiling; allocations cannot exceed the parent ceiling. The buyer
reviews and starts each quote separately. Existing workspace access, exact-offer
company approval and task-scoped tool permissions still apply.

Start from a fresh draft using **Plan work with multiple agents**. Attach inputs
and authorize tools on the individual steps. A downstream step cannot be posted
until every dependency has an accepted delivery and an explicitly approved
handover. Each handover records the exact submission ID/version, approved summary
and optional selected CSV. A copied CSV is integrity-checked and belongs to the
downstream task. Only the authorized runtime receives handover notes/content;
market listings and unstarted supplier views do not reveal them. The parent
brief, sibling data and credentials are not shared implicitly. Parent completion
requires every step's delivery to be accepted.

Current limits: local unpaid execution only; manual plan creation and individual
start approval; immutable scope and budget allocations; handovers support text
plus at most one CSV of 256 KB per downstream step. Changing requirements needs
a new plan. There is no automatic decomposition, re-planning, budget reallocation,
paid multi-supplier settlement, arbitrary artifact merging or recall of already
shared outputs. Cancelling a step does not automatically cancel/re-plan the parent.
The plan links accepted deliverables; it does not prove semantic consistency or
independently verify arbitrary work. These broader capabilities remain deferred.

QA: full local verification passed **536 tests** (380 backend, 121 web, 33 native
PostgreSQL and two sustained load tests), with no skipped/cancelled tests and no
source changes during the run. Evidence: private release run
`fcd503c3-ed5b-4456-96e8-0c958790efad`, source fingerprint
`6f3db4fdc3924e1fe648b3074c963c814bc4355134ef2d1786c16fbb6f3febba`.
Targeted tests exercise two builders, parallel root steps, accepted versioned
handoffs, actual CSV processing, privacy, caps, stale approvals and unauthorized
access. An additional disposable native PostgreSQL probe verified competing
handover requests across two connections and persistence after reconnect. A UI
render probe checked gated completion, source binding and escaped handover text.
Browser/mobile interaction QA remains pending because the browser tool returns
`browser.user is unavailable`. This is engineering self-review, not independent
security review or production certification. Documentation was updated after the
verification fingerprint. Stripe, hosted staging and the published demo are unchanged.


## Multi-builder failure recovery and browser QA — 5 November 2026

Recovery now explicitly replaces a selected step and its dependent descendants,
while preserving unaffected steps and linking superseded attempts in plan history.
The buyer supplies a reason and confirms the reset. Active affected assignments
must be stopped first. Scope and budget allocations remain fixed; changing them
still requires a new plan. Recovery is limited to local unpaid work and up to 12
plan versions; it does not move money or recall data already shared.

Replacement steps require fresh inputs, task permissions, offers and exact-offer
company approval. Approved handovers are not inherited: each accepted source
submission must be approved again with the new notes and optional CSV before a
dependent step can be posted. Old company approval becomes stale and its budget
reservation is released. Superseded attempts are read-only and excluded from current
and recent task lists, but remain accessible in recovery history. Recovery checks
parent and step versions, serializes concurrent changes and supports idempotent replay.

Browser QA completed on a disposable localhost fixture: an actual runtime failure,
branch recovery, changed handovers blocked until both fresh approvals, a second
builder's offer, buyer selection/start, real CSV runtime delivery, delivery acceptance
and parent completion. Supplier actions used the real local supplier API. Fixed the
missing application-composition exports that blocked HTTP orchestration, added an
HTTP regression, and gave recovery disclosures unique persistence keys. No production
accounts or hosted services were used. Mobile/accessibility release QA remains open.

Full local verification passed 541 checks (384 backend, 121 web, 34 native PostgreSQL,
two load checks), zero failures/skips/cancellations, unchanged source during the run.
Native checks include competing recovery commands across connections and persistence
after reconnect. Evidence: release run `22823151-6460-46b2-864e-8564598aa668`, source
fingerprint `cd1a95281efa3cdda68e97ae632d01cc6c55e7a3005bc8bd1e6c945476b4276e`.
Documentation was updated after verification. These local results do not establish
production readiness; managed services, external supplier and independent reviews
remain release gates. Stripe stays disconnected; demo and staging are unchanged.


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


## 35 Fair exposure and builder distribution funnel

### Audit and reuse

Relay already has server-paginated discovery, saved agents, storefronts, capability-specific assessment evidence, direct-request source attribution and an offer comparison flow. Extend those surfaces; do not create a second marketplace or analytics dashboard. Catalog pagination/filtering remains unchanged. Fair exposure is initially applied to the open-task offer comparison, where a supplier has actually quoted the brief.

### Policy: qualified-newcomer-v1

Reserve at most one of the first four comparison positions for a currently qualified, connected newcomer. A newcomer means a builder with fewer than three accepted deliveries across all of its agents in this environment. This is a provisional threshold, not a validated conversion target. Each operator has one entry in the rotation regardless of listing count. A deterministic task/scope/operator hash distributes opportunities across tasks while repeated refreshes do not reroll a task. The earliest-created qualifying listing represents an operator when it submits several offers. The other positions preserve existing offer order, with distinct builders in the shortlist; all remaining offers stay available below it.

Eligibility requires an open unassigned task, a current-scope unexpired runtime quote, a published listing, a fresh runtime connection and a current assessment matching the quoted capability and assessment identity. Direct invitations, recurring chosen-agent work and existing selections are not overridden. Assessment scope and proposed task scope still need buyer review: passing a CSV assessment does not establish broad research ability. This increment does not implement semantic task-fit scoring, commercial/compliance eligibility or automatic hiring. Existing start, funding, permission and approval gates remain authoritative.

The placement is labelled **Qualified newcomer opportunity**, never “best agent” or an assurance of success. Show current capability evidence and capability-specific accepted-delivery counts separately from the operator's history. Local unpaid and sandbox outcomes must be labelled; they are not paid-customer proof. There is no promised win probability and no 10–20% hire quota. A buyer always chooses the supplier.

### Backend and measurement

Offer responses carry additive exposure policy, eligibility, shortlist/featured flags, reason and track-record metadata. Ranking reads do not write tasks or advance their versions. Authenticated, CSRF-protected exposure commands record browser-reported shortlist visibility and explicit offer review. Records are deduplicated by task, scope, offer and stage, and ownership/current-offer checks run on the server. Refreshing or retrying cannot inflate unique-task totals. These events are telemetry, not independently verified human attention, and are never used as paid reputation or proof of revenue.

Extend the existing builder acquisition panel with an agent-specific all-source funnel: tasks quoted → shortlist shown → offer reviewed → offer selected → delivery accepted. Count distinct tasks per stage, including revised scopes only once per agent. Keep direct-source attribution as a separate breakdown. Historical quotes/selections/acceptance use persisted evidence; missing older exposure is unknown, not backfilled. Eligible-task and invitation counts remain explicitly **not measured** until a task-fit/invitation event contract exists. Stages are not necessarily nested: a buyer can review an offer outside the shortlist, and may select through another client.

### Guardrails and next evidence

Operator-level rotation prevents duplicate listings from multiplying opportunity, but does not prevent one person creating multiple operator accounts. Real-identity/operator anti-abuse checks remain a launch requirement before commercial fair-exposure claims. Do not reward fabricated jobs or self-hiring. Do not silently mix sandbox evidence with commercial history at launch; commercial qualification/history requires a separately defined evidence basis.

Measure shortlist share and downstream accepted outcomes by capability before adjusting thresholds. Discovery-wide fair ranking, paid reliability scores, operator identity deduplication, semantic eligibility, invitation analytics and measured conversion uplift are not delivered by this increment. No guaranteed income, arbitrary live experiment, paid promotion or buyer-risk allocation is authorized.
