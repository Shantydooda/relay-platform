# Relay v1: local development

Decision, 27 October 2026: develop the real v1 product locally before deploying further changes. The published prototype remains the demo; the existing managed staging environment remains available but is not the development database.

## Start

From this repository, run `npm run start:local`, then open http://127.0.0.1:4180. The existing `start:poc` command is retained as an alias for compatibility. Only one process should use this checkout's database at a time.

The service binds to loopback only. After the verified PostgreSQL cutover, accounts persist in the ignored `.poc-data/relay.sqlite` identity store and application data persists in the dedicated localhost PostgreSQL cluster. Restarting preserves them. See [native PostgreSQL operations](Native-Postgres.md) for start, migration, backup and recovery commands. Create a separate local test account; a hosted staging login will not work here. Do not copy hosted credentials, sessions or customer records into local storage.

Local authentication is functional but has no outgoing verification or reset emails. The managed Supabase/Resend flow remains a distinct environment. Local tests cannot demonstrate hosted email delivery or production identity readiness.

## Change and release boundaries

- Edit, test and review locally. Push source only when explicitly requested. A source push does not authorize a merge, Render deployment, Supabase migration or provider configuration change.
- Keep database migrations and service contracts versioned alongside implementation. Prepare managed-database changes without applying them remotely.
- Keep the `.site` demo independent. Never copy its simulated qualification, delivery or financial records into the real application.
- Continue on free services only. Going live and enabling paid services require a separate decision.

## Building v1

The target is the connected marketplace: supplier agent registration and capabilities; automatic quotes; buyer selection; authorized execution; files and evidence; acceptance, revisions and payment reconciliation. Corporate permissions and approvals must bind to the current task scope and selected offer.

Implement these in complete, tested increments. The current implementation also includes a shared task/marketplace backend and an independent bounded CSV runtime, with automatic bids, explicit unpaid local authorization, actual file delivery, revisions and acceptance. See [the shared backend guide](Unified-Backend.md) for data cutover, connection steps and boundaries. Capability qualification and Stripe test-mode funding/refund/reconciliation are implemented. Actual connected-account payout acceptance remains open; real-money operation is not approved. Agent qualification must be evidence-backed and scoped to each capability; registration alone does not qualify an agent. The fee structure and unit economics remain undecided.

Before deployment, review the implemented features, migration compatibility, authorization and operational readiness. The SQLite application adapter remains available for isolated development/tests; the main local app now uses native PostgreSQL. Hosted production composition remains a separate reviewed release step.


For free local-model setup, conversational scope review and explicit scheduled-work permissions and limits, see [Conversational scoping](Conversational-Scoping.md). The local model service is separate from the deterministic file-processing supplier runtime.
