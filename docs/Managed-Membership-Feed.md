# Trusted managed-membership update feed

Local implementation, 1 November 2026. No provider credentials, hosted routes, Stripe, demo or staging configuration are changed.

## Boundary

`createUnifiedManagedStore` optionally accepts `membershipFeed: { issuer, keys }` and returns a separate `feed`. Its `receive` method authenticates raw bytes before applying a snapshot through the durable authority. The HTTP store does not expose snapshot ingestion. The optional `createLocalMembershipFeedServer(feed)` is a separate loopback fixture listener; bind it to `127.0.0.1`, not the public application port.

This is **Relay's adapter protocol**, not a Supabase-native webhook/signature format. A future trusted producer must derive complete, authoritative memberships and monotonically ordered generations. A snapshot is the complete membership set for one user, not a partial patch. An empty set revokes that user's workspace access. An adapter that only observes the current role cannot detect an intervening demotion/re-promotion; the producer must preserve those changes.

## Signed delivery

POST `/internal/access-updates` with exact `Content-Type: application/json` and these headers:

- `X-Relay-Event-Id`: lowercase UUID, retained across retries.
- `X-Relay-Key-Id`: configured key identifier.
- `X-Relay-Timestamp`: Unix seconds, within five minutes of receiver time.
- `X-Relay-Signature`: lowercase hex HMAC-SHA256.

The signed message is the following UTF-8 prefix followed by the **exact raw body bytes**:

```text
relay-membership-v1\n{issuer}\n{eventId}\n{timestamp}\n
```

The `\n` notation above represents actual newline bytes. The body is the authority's `{ userId, revision, expiresAt, memberships }` snapshot. `expiresAt` is Unix milliseconds, at most five minutes ahead. Each membership contains `{ id, role, company, accessEpoch }`. The existing authority validates UUIDs, roles, membership uniqueness and generations.

Configure one or two independently generated 32-byte keys using a private runtime configuration mechanism. Keys confer administrative access-update authority and must never enter frontend code, application records, task text or logs. The receiver copies the configured key material. Rotate by temporarily accepting both key IDs, switching the producer, then removing the retired key from the next receiver configuration. Retired signatures are rejected even for an existing receipt.

## Delivery semantics

- Valid signature and schema are required; raw bodies are capped at 64 KiB.
- Receipt identity is issuer plus event ID. The durable receipt binds the raw-body hash, subject, revision, key ID, status and receive time. It does not store signatures, keys or raw payloads.
- Same event/body returns `replayed: true`. Reusing an event ID with different bytes returns `ACCESS_EVENT_CONFLICT`. A retry may use a fresh timestamp/signature, but must retain the original event ID and body bytes.
- A valid older snapshot returns `status: superseded`; it cannot restore access. A conflicting current revision or reused membership generation is rejected by the authority.
- `status: applied` is an acknowledgment of that revision, not a claim that it is still the current role. Replaying a receipt never renews snapshot expiry or grants access again.
- Membership commit, approval reconciliation and receipt persistence are ordered under the shared access lock. If the process fails after membership commit, retry reuses the authority's revision check and repeats reconciliation before acknowledgment. Receipts survive receiver restart and deduplicate across PostgreSQL pools.
- Late/expired snapshots require a new authoritative refresh with a newer revision. Do not extend an old snapshot's expiry locally or silently change its body under the same event ID. Expiry gaps require fresh membership generations under the authority's existing rules.

HTTP errors include 401 for invalid/expired signatures, 409 for conflicting updates, 413 for oversized requests and 503 for transient processing failures. Internal exception text is not returned. The fixture listener rejects browser Origin requests, limits header/body time, and admits at most eight concurrent requests. Processing at capacity returns `Retry-After: 1`. Oversized streaming requests may have their connection closed. Provider-delivery retries should be bounded, use backoff, and escalate persistent failures rather than bypass access checks.

## Local QA

Tests exercise actual loopback HTTP, tampering, signature age, key rotation, event/body conflict, receiver restart, late delivery, failure after membership commit, body/concurrency bounds and expiry that cannot be revived by replay. A signed demotion invalidates an existing approval and releases its reservation through the unified managed composition. A native PostgreSQL two-pool test admits one receipt for competing duplicate deliveries.

Validation for this increment: all 302 backend tests and the targeted native PostgreSQL managed-access/feed integration passed. Syntax/diff review passed.

Run the backend suite and `node --test services/application/test/native/managed-access.test.cjs`. No live provider is contacted. No UI changed, so browser visual QA is not part of this increment. This is engineering self-review, not independent security approval.

## Remaining work

The real producer/bootstrap and periodic refresh process, signed-source provisioning, durable producer retry/outbox, delivery monitoring and operational key rotation are not connected. Receipt retention/cleanup and hosted load limits also require an operating policy. No hosted listener, real provider change feed or deployment is enabled. Until an authoritative source is integrated, the managed composition remains opt-in and fixture-tested; stale authority data denies access rather than assuming unchanged permissions.

### Producer implementation

The [local authoritative producer](Managed-Membership-Producer.md) now supplies
transactional bootstrap, generation history, an outbox, bounded retries and
periodic refresh. It preserves intervening role changes and fences late workers.
This completes the local producer/receiver path; real provider mutation capture,
bootstrap from that provider and hosted delivery operations remain disconnected.
