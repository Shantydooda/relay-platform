# Workspace apps and agent tool permissions

Implemented locally on 29 October 2026. Hosted demo/staging and Stripe remain disconnected from this increment.

## Working scope

Owners can create bounded local text/CSV/JSON sources, install a supported built-in recipe from an accepted unrevised unpaid task or a builder-delivered data app from an accepted delivery, run it manually or daily/weekly/monthly, inspect and approve its exact output, and download the saved result. Built-in recipes are `csv-normalize-v1` and `link-inventory-v1`; custom packages use `builder-data-app-v1` (see below). A source is live local data: each run reads its current saved version. Runs retain the source version, input snapshot/hash, output hash, recipe version and permission identity. Sources are limited to 16,000 characters; each workspace supports at most 100 sources/apps.

This executes reviewed deterministic operations, not a language model or supplier-uploaded code. Installing a recipe is distinct from scheduling fresh marketplace work with the supplier. It does not pay, impersonate or repeatedly hire that supplier. General custom apps, UI bundles, event triggers, isolated arbitrary-code workers and external writes are not implemented.

## UX and authority

- **Connected tools**: create/edit/disconnect local sources, inspect grants and audit activity.
- **Task conversation**: on a supported accepted delivery, install an automation; on an active assignment, explicitly grant selected-source read access.
- **Apps**: run/pause/resume, configure calendar, inspect result and save/discard, renew/revoke permission, return to original task.
- **Scheduled work**: retains fresh-quote, agent-executed recurring tasks. It does not silently become a local recipe.

Company owners administer this first increment. Employees do not inherit source data or app access just by being in the company; broader sharing needs explicit grants in a future increment. Access is checked server-side, including on downloads. Existing local access boundaries serialize membership revocation against application actions.

## Grants and broker

Each tool grant binds workspace, authorizer and membership epoch, exact source and source-disconnection epoch, subject type/id, operation (`read`) and expiry (1–30 days). Task grants additionally bind assignment, agent, scope version and task requester's membership epoch. An agent needs a valid current supplier credential and active execution lease on every read. Neither task selection nor payment/budget approval creates tool access.

Disconnecting a source invalidates old grants even after reconnect. Demotion/re-promotion does not restore old consent. Renewing app permission creates a new grant and revokes the old one. A result created under the old grant cannot be newly approved under its replacement; discard and rerun. Already saved outputs remain available after connector-grant expiry, subject to current workspace authority.

No cookies or connector credentials are sent to agents. Tool content is untrusted data. The local broker performs no URL fetches, shell execution, sends, deletes or network writes. A read retry rechecks permission and returns current source data; read results are not cached in idempotency receipts. Successful reads, source updates, grants, revocations, runs and output decisions are persisted as audit records. Denied-call operational logging is a remaining production requirement.

## HTTP contract (authenticated localhost)

Browser mutations require normal session/CSRF checks and an idempotency key.

- `GET /api/workspace-apps?tenantId=<workspace>` — owned sources, apps, grants, latest run results and audit entries.
- `POST /api/tool-sources` — `{tenantId, name, content}`; update adds `{id, expectedVersion, action: "save" | "disconnect"}`.
- `POST /api/tasks/<task>/install-app` — `{expectedVersion, sourceId, expiresDays, consent: "local-source-read"}`.
- `POST /api/tasks/<task>/tool-grant` — same payload; requires an authorized queued/running assignment.
- `POST /api/tool-grants/<grant>` — `{expectedVersion}` revokes access.
- `POST /api/workspace-apps/<app>` — `{expectedVersion, action: "run" | "pause" | "resume" | "unschedule"}`; `schedule` adds `{calendar: {cadence, time, timezone, day}}`; `renew` adds `{consent: "local-source-read"}` and grants 30 days.
- `POST /api/app-runs/<encoded-run-id>` — `{expectedVersion, action: "save" | "discard", outputHash}`.
- `GET /api/app-runs/<encoded-run-id>/download` — authenticated attachment, only after approval/save, with integrity check and the configured file scanner; unavailable or non-clean scanning blocks the download.
- `POST /api/workspace-apps/<app>/host` — `{expectedVersion, action: "provision" | "start" | "stop" | "redeploy" | "deprovision"}`. Provision/start/redeploy require a server-owned active Pro or Business entitlement and recheck the installed app plus its current source grant. Stop/deprovision remain available after a subscription lapse so customers can safely shut down or remove a runtime.

Suppliers use their existing scoped bearer credential:

1. `GET /v1/supplier/tasks/<task>` exposes applicable grant metadata alongside assignment status (metadata alone is not permission).
2. Claim the assignment through the existing supplier claim API.
3. `POST /v1/supplier/tasks/<task>/tool-read` with `{grantId, leaseToken}`.
4. Broker checks credential, lease, assignment, scope, authorizer/requester access epochs, source status/epoch and expiry before returning `{sourceId, version, content, untrusted: true}`.

The API only supports read access. Future external write operations must use distinct scopes and exact-payload approvals, durable idempotency and provider reconciliation rather than reusing this read contract.

## Persistence and execution

Uses the existing versioned PostgreSQL document repository and receipts; no new SQL tables or schema migration are required. Record kinds: `tool-source`, `tool-grant`, `workspace-app`, `app-run`, `app-output`, `tool-audit`. No fixture data is imported into the main workspace. A schema-compatible restart loads this increment.

An app run locks the app, permission and source, checks authority, runs one bounded trusted operation, and atomically stores result/audit/app state. Distinct concurrent requests cannot produce another result while one awaits review. Approve/save binds output hash and current grant; duplicate commands use existing receipt semantics. Scheduled workers use the same execution function and database locks. Each schedule slot advances atomically; missed slots over one hour old are skipped. Existing calendar DST/short-month policies apply. A blocked schedule pauses; explicit resume uses the next occurrence. Work runs only while the localhost server is running.

This in-process execution is suitable only for these reviewed bounded operations. It is **not** an isolation boundary for arbitrary delivered code. A general runtime needs independently isolated compute, network/resource limits, package signing/version approval, secrets brokerage, upgrade consent, retention/quotas and independent security review.

## Relay hosting control plane — localhost foundation

Relay hosting is a subscription-gated deployment option for an app the buyer has already accepted and explicitly installed. It is not a second marketplace purchase and does not automatically turn an ordinary file delivery into running software. The intended production sequence is: accepted delivery → reviewed installation → explicit source grant → provision immutable release → start/stop/redeploy within quota. Pro includes two active hosts and Business includes ten; the entitlement is read from server-owned subscription state rather than a browser flag.

The localhost implementation persists that control-plane lifecycle without claiming to create cloud compute. A host binds the installed app, release number, current package digest, bounded runtime type and resource envelope. Provision/start/redeploy fail if the app is paused, the subscription is inactive, the source was disconnected, permission expired or the authorizer lost authority. Subscription lapse presents a previously running host as `subscription_hold`; it cannot restart or deploy, but it can still be stopped or deprovisioned. Deprovisioning releases quota without deleting the installed app, task history or saved outputs.

There is deliberately no public endpoint, arbitrary code execution, shell, inbound traffic, supplier secret access or silent provider write in this localhost foundation. Production hosting still requires isolated workers, signed artifacts, secrets brokerage, egress policy, health/usage metering, backups, incident controls and independent security review. Stripe remains disconnected, so the UI describes plans but cannot purchase or activate one.

## Validation

Tests cover SQLite and PostgreSQL-compatible adapters, native PostgreSQL competing workers/restart, repeated requests, pending-result exclusion, source disconnect/reconnect, expired/revoked grants, membership epochs, cross-tenant access, exact-output approval, downloadable saved results, active agent lease checks and revoked read retries. UI checks cover escaped source/output content, revoked controls and owner-only setup. Browser walkthrough uses an isolated native PostgreSQL fixture with a genuinely accepted link-runtime delivery.

Remaining: mobile visual QA, full HTTP supplier-tool client integration, independently reviewed security and production operations, arbitrary app sandboxing, real connectors and live money. This is a working local foundation, not a production authorization or hosting launch sign-off.

## Builder-delivered data apps — 30 October 2026

In addition to built-in recipes, builders can now deliver **`relay-app.json`** through the existing supplier delivery API (`application/json`). The package is a declarative data pipeline. Relay interprets an allowlist of operations; it does not evaluate code, expressions, templates or SQL. This first runtime supports custom reports and record transformations, not hosted websites or arbitrary application bundles.

```json
{
  "format": "relay-data-app",
  "version": 1,
  "name": "Overdue invoice report",
  "description": "Prioritize overdue invoices by amount.",
  "input": "json-records",
  "steps": [
    {"op": "filter", "field": "daysOverdue", "compare": "gt", "value": 0},
    {"op": "sort", "field": "amount", "direction": "desc"},
    {"op": "select", "fields": ["customer", "amount", "daysOverdue"]}
  ]
}
```

Supported steps: `filter` (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`), `sort` (`asc`/`desc`), `select` (field list), `deduplicate` (one field) and `limit` (record count). Equality is strict; ordered filters require numeric source fields. Sorting compares two numbers numerically, otherwise their string values. Missing required fields fail the run. Names are simple field identifiers, without paths or reserved prototype keys. Only flat scalar JSON records are accepted.

Bounds: package ≤16 KiB, 1–20 steps; source ≤16,000 UTF-8 bytes, ≤1,000 records and ≤30 fields per record; output ≤64 KiB. Network access, credentials, filesystem operations, external writes and arbitrary code are unavailable to the package. This interpreter is not an arbitrary-code security sandbox.

Flow:
1. Supplier submits the package as one of the ordinary delivery files, preferably with sample output and evidence.
2. File scanning must pass; buyer reviews and accepts the exact delivery (including a revised delivery).
3. Buyer separately installs, selecting a workspace source and read-access expiry. Installation validates the package, accepted submission identity, scan state and exact file hash. Unsupported packages cannot fall back to a built-in recipe.
4. Installed app stores its immutable package, digest, submission and original supplier identity. No schedule, future payment or supplier re-hire is implied.
5. Each run checks current permissions, reads the selected source, records source version/hash and per-step input/output counts, and requires output review before another run. Approved output can be downloaded.

An ordinary JSON delivery is not installable unless explicitly named `relay-app.json` with the supported manifest. Installation remains owner-only and unpaid/localhost-only. There is no automatic migration of existing built-in apps. In-place package upgrades, employee delegation, UI bundles, general code isolation, billing and lifecycle support contracts remain separate work. Existing Google Drive support is selected-file read-only and requires independently configured OAuth; no real connector was enabled by this increment.
