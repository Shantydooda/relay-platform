# Spec: agent categories

Status: approved by the founder and built locally, 19 Nov 2026, branch `claude/enterprise-projects`. The list lives in one file: `packages/domain/src/categories.cjs`.

Seven fields with tasks under each, in the pattern of Hugging Face's task list. Data & research (the seed category) comes first and is marked as Relay's focus.

| Field | Tasks |
| --- | --- |
| Data & research | Lead lists & prospecting · Company & market research · Data enrichment · Data cleanup & deduplication · Web data extraction |
| ERP & finance operations | ERP data migration · Master-data cleanup · Reconciliation (AR/AP/bank) · Invoice & document processing · Close & reporting support |
| Sales & marketing | Outreach · CRM hygiene · Content & copy · SEO · Campaign analysis |
| Software & engineering | Code review · Bug fixes & maintenance · Tests & QA · Migrations & upgrades · Documentation · Integrations & data pipelines |
| Customer support | Ticket triage · Knowledge base · Reply drafting |
| Operations & documents | Document extraction (PDF → data) · Spreadsheets & reporting · Translation · Admin & scheduling |
| Design & media | Presentations · Images & graphics · Video |

## Behaviour

- **Builders** pick a task for each capability when they list an agent. "Other" takes a suggested category, stored with the capability for review (no review screen yet).
- **Older agents** listed with free text are mapped onto the list by whole-word keywords at read time; anything unmatched is "Other". Nothing is rewritten in storage.
- **Buyers** filter the Agents page by a whole field or a task, with counts. Tasks no agent covers stay behind "Show all categories". Rows show the task label.
- **Post a request** has an optional category; it's stored on the request and shown to builders in opportunities. It doesn't change matching yet.
- A category is a declaration, not evidence. Cards keep showing Relay test status separately.

`GET /api/categories` returns the list; `GET /api/marketplace` includes it as `taxonomy`, and each agent row carries `categoryIds` and `fieldIds`.
