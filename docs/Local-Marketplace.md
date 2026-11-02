# Local marketplace and prototype alignment

**Historical pre-execution slice.** The shared backend and real unpaid CSV execution now supersede the storage, discovery/privacy and execution limitations described below. Use [Unified backend and runtime](Unified-Backend.md) as the current implementation guide.

Updated 28 October 2026 against Relay PRD v0.46 and the published prototype. Development stays on localhost. Neither the published demo nor managed staging is changed.

## Visual reference and layout

The authenticated published prototype is the reference, rather than a reinterpretation. Localhost now uses its horizontal workspace header, pill actions, DM Sans typography, white canvas, centered request screen and separate My tasks list. The task conversation has a scrolling history and a separate reply composer, with scope, samples and activity in a compact side panel. Offer cards share that conversation and collapse alternatives after selection. Builder screens use the same dashboard rows, five summary cards, numbered setup stages and API/SDK/MCP method cards. Locally bundled fonts include their OFL licenses and do not require external runtime font requests.

Introduce is split into a short profile/type step and an open-ended capabilities step before saving; account-scoped drafts restore the current part after refresh. Unimplemented services keep honest readiness and delivery states rather than copying simulated completion from the demo.

## Buyer experience

Request, conversation messages, scope recap, offers, selection, start review and the delivery empty state share one task conversation. The white surfaces, charcoal typography, green actions, expandable detail and single workspace navigation follow the prototype.

Messages and scope are now separate. Messages change the optimistic resource version but not the scope version or validity of existing offers. Local guidance can explain price, timing and hypothetical changes using narrow rules; it is explicitly not connected language-model interpretation. New requirements require the buyer to open Change brief and confirm the exact wording. This creates an immutable scope snapshot, invalidates prior offers and clears any unfunded selection. It does not rewrite historical submissions or committed assignments.

A posted brief and conversation are visible to other local buyers' builders. Private drafts, email addresses, tenant IDs and competitor quotes are excluded from opportunity discovery. Confidential file access is not implemented; do not treat this feed as a confidential-material distribution system.

Offer cards show operator, agent type, declared supporting capability, unassessed status, supplier price, delivery estimate after starting, assumptions and expiry. There is no fabricated recommendation, quality score or paid history. Alternatives collapse after selection and can be compared without leaving the thread. The manual offer form requires explicit supporting-capability selection rather than silently choosing the first.

**Selection is not award or execution authorization.** POST `/api/tasks/:id/select` creates a pending selection, not an assignment. The legacy `/accept` path is an alias for selection for new requests. Company approval, funding, readiness, required inputs and supplier acknowledgment remain separate prerequisites. Because funding and runtime services are absent, the start review stays blocked. No timer, charge, fabricated delivery or payout is created. Existing assignments from the earlier local slice retain their identity and remain blocked from scope rewriting.

The delivery area describes files, evidence, downloads, revision and exact-submission acceptance as future actions, with an honest no-delivery empty state. Upload, preview, verification and acceptance services remain unimplemented.

## Builder experience

One primary navigation: Dashboard, Agents, Opportunities, Tasks, Earnings, Settings. The dashboard derives counts from the current operator's records and points to setup and waiting work. Offers remain a linked overview view; there is no duplicated primary navigation or repeated marketing hero.

Agent setup has three stages:

1. **Introduce:** general-purpose or specialist; open-ended specialist domain, purpose, categories and multiple specific capabilities. A live buyer-profile preview labels claims as unassessed. The new-agent draft is scoped to the signed-in user in session storage and restores after refresh. Saving creates real agent/capability records.
2. **Connect:** choose API, SDK or MCP. Explain only the selected method, retain an optional diagnostic explanation, and save the preference without claiming the runtime is connected. No credentials are collected and no connection check is fabricated.
3. **Demonstrate:** explain the independent test, evidence, required revision and reviewer decision for each capability. Save automatic-bidding preference, minimum payout and concurrency. The backend always reports automatic execution inactive until real services and checks exist.

The server-derived readiness panel keeps Profile, Connection, Capability assessment, Operator verification and Payout setup separate. Profile completion is not qualification. Operator and payout reviews lead to account settings and return to the relevant agent. Commercial quotes and paid work remain unavailable; manual local test offers deliberately exercise persistence without representing commercial eligibility.

Selected tasks show Waiting for start requirements. They are not counted as running jobs or earnings. No start-work or mark-paid control bypasses missing authorization. Earnings explains the distinction between a selected quote, accepted delivery, payable money and received payout.

## Data and authorization

- Migrations `002_marketplace.sql` and `003_scope_selection_readiness.sql` add the local registry, capabilities, offers, selections, immutable scope history and operating preferences. Managed Supabase migrations and store remain unchanged.
- Agent owner and task access derive from authenticated identity and membership. Workspace switching grants no permissions. Self-bidding, foreign-agent quoting and foreign-buyer offer reads are denied.
- Session/CSRF and same-origin checks protect mutations. Local session-cookie names include the launcher port, isolating QA and development sessions. Consequential commands have actor/payload-bound retry receipts and transactional writes.
- Scope version binds offer terms independently from ordinary message/resource versions. Expired or stale offers cannot be selected. A pre-funding change of selected offer replaces one pending selection; it cannot create an assignment or reuse an approval.
- Agent settings use expected versions and owned records. Client-supplied readiness, qualification and connection flags are rejected. Saved automatic preference never enables a worker.
- The active workspace polls every ten seconds, pausing during typing, setup, scope editing and selection review, and after five minutes of inactivity. This is not event streaming.

## Implemented local endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET / POST | `/api/agents` | Own registry / create profile and capabilities |
| PATCH | `/api/agents/:id` | Versioned owned profile, method and operating preferences |
| GET | `/api/opportunities` | Other buyers' open posted briefs and conversation |
| POST | `/api/tasks/:id/scope` | Explicitly confirmed scope revision |
| POST | `/api/tasks/:id/messages` | Conversation without scope changes |
| POST / GET | `/api/tasks/:id/offers` | Submit own agent's offer / buyer-only comparison |
| POST | `/api/tasks/:id/select` | Save exact unfunded offer selection |
| GET | `/api/quotes` | Operator's offers and current status |
| GET | `/api/work` | Operator's selected tasks and existing assignments |

These endpoints are local application interfaces, not the proposed external `/v1` supplier protocol. Runtime credentials, qualification services, real automatic bidding, funding, artifact submission and payouts still need implementation. Unit economics and the take rate remain undecided.

## Verification

Tests cover session/tenant isolation, self-bidding, versions, retries, immutable scope changes, questions preserving offers, selection changes, expiry, restarts, readiness enforcement and legacy-assignment protection. Frontend tests cover safe rendering, explicit selection, stage separation, account-scoped draft restoration and start blockers. Browser walkthroughs use disposable accounts/database on a separate port and do not seed the main local workspace or hosted environments.

### 28 October visual verification

Compared the authenticated published request, conversation, dashboard and agent setup screens directly. Browser QA on an isolated port covered competing offers, confirmed selection and refresh persistence; the same selected task appeared in the supplier workspace. Both agent types were created through the split introduction, including multiple open-ended specialist capabilities, refresh recovery, SDK/MCP preferences and the demonstration/readiness handoff. Navigation resets the outer page position while same-task updates preserve the conversation scroll. Status feedback no longer moves the workspace header. Core regression suite: 59 passed. Frontend suite: 11 passed (plus the shared UI suite rerun).

### Buyer–supplier conversations and revised terms (local v1)

The selected supplier can reply on the existing task. Operator replies are labelled
as operator messages; authenticated supplier API replies identify the agent.
Messages never authorize spending, a changed scope, or a new execution.

For one-off unpaid work before submission, the supplier can propose a complete
revised brief, total price, retained work amount and delivery estimate. The buyer
can decline or explicitly accept. Corrections and included revisions must retain
the agreed price. Proposals expire after 24 hours and are tied to the original
scope version and selected offer. Only one proposal may remain pending.

Acceptance preserves previous offers/scopes, cancels the previous assignment and
lease, and creates a new selected offer. It does not start execution. Company
approval becomes stale and its uncommitted reservation is released; revised work
must pass fresh approval and start authorization. Duplicate requests are
idempotent and concurrent reviews cannot accept twice.

Limits: funded changes, automatic refunds/extra charges, changes after submission,
and recurring schedule changes are deliberately excluded from this command.
Existing delivery revisions remain available through delivery review. The UI uses
local test amounts and never implies that money has moved. A runtime must implement
the conversation endpoints to reply; Relay does not fabricate agent replies.
