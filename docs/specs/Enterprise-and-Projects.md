# Spec: Enterprise organizations and projects

Status: approved by the founder, 19 Nov 2026. Branch `claude/enterprise-projects` (cut from `claude/one-marketplace`, whose restyle it builds on; merge that first).

Take Hugging Face's Team/Enterprise information architecture (organization page, resource groups, a plan page), never its branding.

## Who it's for

ERP teams (NetSuite, SAP, Dynamics programmes) running data work through Relay: item and vendor master cleanup, migration loads, reconciliations. They work in waves and workstreams, with a lead per workstream and finance holding the purse.

## What already exists (company workspaces, `docs/Company-Workspaces.md`)

Owner / approver / employee roles, invitations, exact-offer approvals, a USD company allowance with reservations, access history, membership epochs and spending reports with CSV export.

## Decisions (founder, 19 Nov 2026)

1. **A project is a folder plus a budget.** A named group of requests and work inside one company. Each task is still quoted, approved and accepted on its own. No milestones, no new money movement. (The Engagements spec stays separate and blocked on its own decisions.)
2. **Project members see all of the project's work**: every request, offer, delivery and file in it. Read-only: only the task's owner (or a company owner) changes a task. Work outside projects stays private as today.
3. **A project budget is a cap inside the company limit.** An approval must fit both the project's remaining cap and the company's available allowance. One reservation counts toward both; project spend is derived from the company allocations tagged with the project, so there is no second ledger.
4. **The project lead and company approvers/owners approve.** The lead can approve quotes on the project's work within its cap. Company approvers and owners can approve anywhere.

## Rules

- Only company owners create projects, set caps, change the lead and add/remove members. Lead and members must be current company members; access is re-checked on every request, so leaving the company removes project access.
- Up to 50 members and 100 projects per company. Caps are USD, $0–$1,000,000, and can't go below what the project already holds (reserved + committed).
- A task's project is part of the approved agreement. Moving a task to another project (or out of one) makes the approval stale and releases its reservation.
- A lead's approval holds only while they are still the project's lead: if the lead changes, starting or funding that work is refused and asks for fresh approval.
- Archived projects keep their history but accept no new requests or approvals.
- Lock order stays task → company budget. Project caps are read after the budget lock, and cap changes take the budget lock, so concurrent approvals can't overbook either level.

## Surfaces

- **Organization page** `/org/<companyId>`: Projects · Work · Members · Spending, plus Settings for owners (allowance, access history).
- **Project page** `/org/<companyId>/projects/<id>`: header (name, lead, status), tabs Work · Budget · Members. "Post a request" from a project files the request into it.
- **`/enterprise`**: Personal · Team · Enterprise comparison. Live features are listed as live; SSO, SCIM, data residency, procurement and invoicing are "Talk to us" (icebox: `docs/Product-Icebox.md`), never claimed as built.

## Planned: members can publish agents (decided 20 Nov 2026)

An organization setting, **"Members can publish agents"**.

**Why:** an employee selling an agent built on company data is a real risk for an enterprise buyer.

**When it's off:**
- The organization's members can still buy, post requests and approve work.
- They can't create or publish agents, or send offers, while that organization is their active workspace.
- The server refuses those commands with a plain reason, and the UI hides Build and "Publish an agent" for them.
- Members can still publish from their personal workspace, unless the company asks Relay to block that through a contract (needs SSO first, so it's later).

**Defaults:**
- Off for organizations on the Enterprise plan.
- On for Team.
- Only company owners can change it, and each change goes into the organization's access history.

Not built yet; it comes with the next enterprise slice.

## Enterprise roadmap (decided 20 Nov 2026)

Benchmarked against Hugging Face Enterprise (huggingface.co/enterprise, read 20 Nov 2026). We take its feature list as a checklist, not its prices or plans. Relay earns from transactions, so these features may become a paid organization plan on top of fees; that's part of the open fee decision.

**Step 1: audit and control (built 20 Nov 2026, branch `claude/builder-flow`)**

How it was built:
- `services/application/src/org-controls.cjs`.
- Routes:
  - `GET/POST /api/teams/<id>/policy`;
  - `GET /api/teams/<id>/audit` (`?format=csv` for the export; spreadsheet formulas are neutralised);
  - `GET /api/me/publishing`.
- Organization Settings shows the switch and the latest 25 log rows.
- A blocked member sees no "Publish an agent" button, and `/build/new` explains why.
1. **Members can publish agents.**
   - Owners can switch this off for their organization. Members of that organization then can't create or publish agents, or send offers, from that account; owners can.
   - The rule is enforced on the account, not just the active workspace, because agents belong to people, not organizations, so the server can't tell which workspace an offer came from.
   - Existing listings stay visible, but they can't publish again or send new offers.
   - It's on by default, because there are no plan tiers yet. When an Enterprise plan exists, it defaults to off there.
2. **Audit log.**
   - Every preview or download of a task file is recorded: input, attachments and deliveries, with who opened it, when and which file.
   - Company owners get one log per organization covering task events and file access, exportable as CSV.
   - Company membership and role changes stay in the existing access history.
3. **File preview.** Delivered text files already preview in the browser. CSV previews show as a table, and every preview is logged.
4. **Deferred: enforced 2FA and joining by email domain.** Both change sign-in. Joining by domain also needs verified email addresses, which local accounts don't have, so it would let anyone with a matching address into a company. Build them together with single sign-on.

**Step 2: builder organizations.** A firm publishes under one handle (`acme-erp/vendor-dedupe`), with several members and roles, connection keys owned by the organization and one payout account.

**Step 3: processing region.**
- Builders declare where their agent runs and processes data (for example EU or US). Buyers can filter on it, and organizations can require it.
- Storage region alone isn't enough, because the data goes to the builder's agent.

**Step 4: when a real enterprise asks.**
- Single sign-on and SCIM (automatic user sync from the company's identity system).
- Private agents visible to one organization only.
- Central approval and revocation of ERP connector credentials.
- Invoice and purchase-order billing.

**Not planned:** IP allow-lists, storage quotas per seat, API rate limits by plan, compute options.

## Not in this slice

Lead approval thresholds, SSO/SCIM, private org-only agents, monthly budget rollover, notifications, multi-currency.
