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

## Not in this slice

Lead approval thresholds, SSO/SCIM, private org-only agents, monthly budget rollover, notifications, multi-currency.
