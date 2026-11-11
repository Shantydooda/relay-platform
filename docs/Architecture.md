# Architecture and boundaries

Relay uses a modular application service. The browser presents work; server commands decide whether it is authorized. Local and managed HTTP compositions must call the same business implementation.

## Request and execution flow

1. Buyer conversation becomes a task only after explicit confirmation.
2. Eligible suppliers quote against a brief. Selection, exact-offer approval and funding are distinct transitions.
3. Execution receives only the granted inputs and current assignment. An expired grant or membership change is rechecked at the command boundary.
4. Submission records bind files, hashes, evidence and versions. Acceptance applies to the reviewed submission.
5. Payment operations use durable identities and provider reconciliation. A timeout or UI status does not prove money moved.

## Module ownership

- **Frontend / shared UI:** `apps/poc-web`, `packages/ui`. No authorization or ledger authority.
- **Application:** `services/application`. Commands, policy integration, durable state, quotas, approval, recovery and repository operations.
- **HTTP / identity:** `services/poc-api` for loopback development; `services/staging-api` for managed identity. Local password storage is not production identity.
- **Data:** native PostgreSQL for the established local application; SQLite/PGlite adapters for isolated fixtures and local bootstrap. Migrations are ordered and checksum verified. Never edit an applied migration.
- **Supplier protocol:** `packages/supplier-sdk` and the implemented supplier OpenAPI contract. `services/api` and other contract files include earlier policy/draft surfaces; do not assume every schema is an exposed endpoint. Follow `Supplier-API.md`.
- **Provider adapters:** `services/payments` and `services/connectors`. Credentials stay server-side, responses are bounded/redacted and mutations need scoped authority and retry identity.
- **Execution:** independent reference supplier runtimes; allowlisted local app interpreter in a disposable child. Process separation is not an arbitrary-code sandbox.
- **Operations:** `services/operations`, recovery scripts and CI. No implicit deployment.

## Invariants reviewers must preserve

- Workspace/user access is checked on every protected operation, including retries.
- Changed offers, scopes and handovers cannot reuse stale approvals.
- Supplier-controlled data, files and messages never grant permissions by themselves.
- Funding, refunds and payouts stay separate and use integer minor units with explicit currency.
- A retry cannot duplicate execution, delivery, payment or budget reservation.
- Revocation prevents new access; saved outputs remain available only through their current access rules.
- No fallback from failed paid hosting to a free execution route.
- No local fixture identity, entitlement or success receipt may become production evidence.

## Scaling policy

Measure a bounded workload before changing architecture. Current local limits are guardrails, not an advertised throughput guarantee. Favor paged queries, immutable export snapshots, bounded queues and observable recovery. Introduce a separate service only when there is an independently measured deployment, isolation or scaling need.

## Environment separation

| Environment | Identity/data | Provider boundary |
| --- | --- | --- |
| Local development | Private local accounts and application database | Opt-in test money and configured local fixtures |
| Disposable QA | Separate temporary identities/databases | Fixture or explicitly named sandbox calls |
| Managed staging | Separate Supabase/hosted composition | No implicit promotion from local configuration |
| Published demo | Independent illustrative product | Never an application database or source of financial evidence |

See [Status](Status.md) for what remains before release, and [Native PostgreSQL](Native-Postgres.md) for restoration and explicit cutover procedures.
