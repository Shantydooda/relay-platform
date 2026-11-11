# Managed identity: local composition checks

1 November 2026. This is a local implementation and fixture evaluation. The hosted launcher, deployed staging, published demo and localhost identity configuration are unchanged. Stripe remains disconnected.

## Implemented boundary

`createManagedStore({ application, ... })` now composes the shared application through `application-access.cjs`. Browser commands reload the opaque session, verify the provider identity and eligibility, and read current profile/workspace membership before invoking domain logic. Previously loaded roles and caller-mutated membership objects do not authorize a new command. Authentication failure occurs before replaying an application receipt.

Only actor objects issued by that managed store can be refreshed. A private WeakMap binds each actor to its opaque session and original subject; the token is not added to browser payloads or stored in application records. Cloned/constructed actors are rejected. The second session read after provider lookups detects logout/reset while identity or memberships are being loaded. Expired or malformed session timestamps fail closed.

Recovery sessions cannot call shared task or marketplace operations. Provider outages deny work rather than falling back to cached access. Supplier operations retain their existing agent-key authorization. Quote/message/change commands can use the supplier alternative only with a runtime principal minted by the same store, paired with its exact actor. Domain checks still enforce current credential, scope and ownership. Worker/event methods remain explicitly classified; new public application methods default to browser-session validation.

## Evaluation

Local tests cover:

- Cached/forged actor state, role refresh and marketplace access.
- Logout/reset, invitation removal, expiry and provider failure.
- Session deletion during the provider lookup.
- Shared task creation, idempotent replay and read denial after workspace removal, using SQLite and PostgreSQL-compatible PGlite.
- Minted supplier credentials remaining separate from browser sessions.
- Actual loopback HTTP routing with a role change between route authentication and the domain command; no task is written.

Validation for this increment: all 289 backend tests passed, including the new managed composition and loopback HTTP checks. Syntax and diff checks passed. This was engineering self-review.

Run `node --test services/staging-api/test/*.test.cjs` or the backend suite. No real Supabase calls or emails are needed by these fixtures. PGlite coverage does not establish native multi-process/provider behavior. No UI changed; browser visual QA was not repeated.

## Entry-only composition limitations

The direct `createManagedStore({ application })` path above is an entry authorization check, **not a transactional revocation guarantee**. The newer unified composition below adds ordering for ingested access changes. A provider-side change can still occur after the final check and while a domain operation is running. Persisted membership generations and access-change ordering are implemented by the unified composition below, including demotion/re-promotion and stale approval invalidation. It must also provide current actor resolution for background jobs without retaining browser sessions.

Hosted application database composition/migrations, session lifecycle races against a real provider, cross-process revocation, reset/logout browser walkthroughs and independent security review remain open. Do not enable the shared managed application in the hosted launcher on the strength of these tests alone. Local and managed policies must converge without silently replacing the existing hosted task store.

## Durable membership authority and ordered revocation (next local increment)

`createUnifiedManagedStore` is now an opt-in composition with a durable membership authority, shared application services and one database access boundary. Its return value separates `{ store, access }`: only `store` belongs in the HTTP router. `access.apply(...)` is a trusted adapter interface, not a browser endpoint. Neither the localhost launcher nor hosted launcher switches identity modes automatically.

An authoritative snapshot contains a user UUID, strictly ordered revision, expiry (at most five minutes ahead), and memberships with workspace UUID, role, company flag and positive `accessEpoch`. Applying the same revision/content is idempotent regardless of object key ordering. Older revisions and conflicting replays are rejected. A role change, removal/re-entry or expired-access gap requires a higher membership epoch; tombstones preserve the old epoch after removal. Renewal before expiry may retain the epoch if access is unchanged, but requires a newer snapshot revision. The trusted source must record intervening role changes even if the final role looks the same.

The authority persists snapshots, history and audit fingerprints in the existing versioned document repository. No new SQL schema or hosted migration is required. Expired/missing authority records deny access and background actor resolution. It does not manufacture permission from provider metadata or a browser form.

Application actions, supplier work and trusted access updates acquire the same database advisory lock. An admitted action may finish; a completed revocation precedes subsequent authorization. This is ordering, not rollback of work already committed. Browser-session validation still runs at command entry. Background application services resolve actors from the same durable authority rather than retaining a browser session.

Approval reconciliation is shared with the local identity path. Changed requester/reviewer epochs make pending/approved requests stale, release uncommitted reservations and preserve existing work/financial commitments under the existing rules. Re-promotion cannot revive an approval. If membership persistence commits but reconciliation is interrupted, the next guarded action reconciles before authorizing work.

The access boundary now supports authorization reads inside its current transaction/read scope. This avoids nesting a second queued database operation and deadlocking. Detached asynchronous work reacquires access after the original scope ends. Native PostgreSQL requires a real multi-connection pool; the single-connection embedded PostgreSQL test engine is not suitable for the separate advisory-lock connection used by this composition.

### Limits and next integration

These guarantees apply to changes **applied through this authority**. A provider change that has not been ingested is not magically ordered with Relay's database. The managed provider update feed, trusted provenance, complete membership bootstrap, refresh/expiry operations and production monitoring still need integration. There is deliberately no public snapshot ingestion endpoint. Provider-side account/session revocation after command admission and atomic coordination with a real managed provider remain distinct release checks. Hosted activation and independent security review remain pending.

Local tests exercise the full shared approval flow, stale receipt denial, demotion/re-promotion, expiry, replay and interrupted reconciliation. A real native PostgreSQL test uses two independent pools to verify active-action ordering, revocation, restart persistence and competing revision rejection. The existing local access tests also remain in the backend suite. No UI changed; browser visual QA was not repeated.

Validation: 294 backend tests and 30 native PostgreSQL tests passed, plus focused canonical replay/expiry and nested-read tests. This was engineering self-review, not independent security approval.

## Signed adapter boundary

The optional [managed membership feed](Managed-Membership-Feed.md) now authenticates
raw signed updates, persists event receipts, handles duplicate/out-of-order
delivery, and applies updates through this authority. Local HTTP and native
PostgreSQL tests cover it. This adds the receiving side; the actual managed-provider
producer, bootstrap/refresh and monitoring remain disconnected. Do not equate the
custom Relay adapter signature with a provider's native webhook format.
