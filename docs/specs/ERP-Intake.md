# Spec: ERP data intake, typed files and sample pairs

Status: built locally, 19 Nov 2026, branch `claude/enterprise-projects`. Requirements M1–M3 of `reports/ERP buyer readiness for agent projects.md`.

## What the buyer provides

"Post a request" has a second kind, **ERP data** (migration or master-data cleanup). It asks for the target ERP (NetSuite, SAP S/4HANA, Dynamics 365, other), the data (vendor, customer, item master, chart of accounts, BOMs, open AR/AP, opening balances), the source system, a record count and as-of date, and a confirmation that dependent setup (subsidiaries, currencies, terms, tax codes) exists in the target. The poster is the data owner by default; the API accepts any member of the workspace.

The request page then collects typed files (CSV, XLSX, JSON, TXT, Markdown or PDF; 5 MB each, 25 MB and 30 files per request):

| Required | Recommended |
| --- | --- |
| Source extract, target import template (from the buyer's own ERP), field mapping | Code cross-walks (except chart of accounts), data rules |
| A reconciliation baseline for open AR, open AP and opening balances | 5 sample pairs, one edge case, one "should not change" case |
| At least 3 sample pairs: a sample input and its expected output | |

## Rules

- **Offers stay closed until the intake is complete.** Posting is refused with `INTAKE_INCOMPLETE` and the list of what's missing; the page shows the same checklist and an "Open for offers" button.
- **A draft refines scope v1 in place.** Once posted, every intake or file change is a new scope version: earlier offers need a fresh quote and any approval goes stale.
- **Pairs stay together.** An expected output must name an existing sample input; removing an input removes its output.
- **Builders see the intake and file names before quoting, never file contents or the data owner.** The assigned agent receives the files at claim, after the buyer authorizes the work.
- Only the poster (or a company owner) edits; project members see it read-only.

## Not yet

Machine-run acceptance checks against the pairs and tolerances (M4), the pilot stage (M6), data-owner sign-off on the buyer's load (M7), masking of sensitive columns (M8), and showing the intake in the builder workspace's opportunity list.
