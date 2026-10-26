# POC slice 01 — real accounts and durable tasks

26 October 2026. Implemented locally on branch `codex/accounts-task-poc`. This begins AUTH-01 and DATA-01; neither ticket is ready for external-user release. No hosted provider or paid service was provisioned and the published `.site` was not changed.

## Scope shipped

- A separate web app (`apps/poc-web`) and HTTP service (`services/poc-api`), with independent package/test commands. The demo's `dist/` and hosting manifest are untouched.
- Real registration and password authentication, account-to-personal-tenant membership, server sessions, logout/revocation and preferred buyer/builder workspace.
- Server-owned tasks, draft editing, posting, cancellation, context messages and ordered activity. No client-side database or fake agent replies.
- SQLite migration, parameterized queries, foreign keys, transactionally recorded activity and idempotency receipts, optimistic concurrency and access checks.
- Same-origin/CSRF controls, password hashing, bounded auth work/rate limits, security headers and explicit local-only launch guard.

This implements the first real vertical slice. It does **not** implement the production marketplace, a deployed Postgres environment, organizational invitation workflows or a real agent runtime.

## Decision record

**Separate local runtime and data.** The public prototype remains available for demos. POC accounts are not synchronized with prototype accounts and no demo records are imported as authoritative data. The local POC starts at `http://127.0.0.1:4180`; it must not reuse demo hosting credentials.

**SQLite for the local proof.** No Postgres service, Docker runtime or hosted database was configured on the machine. A single-process local database proves storage/session behavior without provisioning an external provider. This is a deliberate local adapter, not a replacement for the architecture's proposed managed Postgres + worker setup. Revisit SQL, transaction isolation, migrations and concurrent multi-instance tests during that transition. Do not deploy SQLite to an ephemeral/serverless filesystem.

**Local password authentication for the proof.** Uses Node's asynchronous scrypt with N=131072, r=8, p=1, unique random salts and constant-time comparison. Session cookies contain random 256-bit tokens; only verifiers are stored. Idle/absolute expiry are server enforced. There is no bypass account, plaintext-password record or browser-stored session credential. A managed/auth-library decision and independent review remain open before external use. Unverified email must never grant company/domain access.

**Honest workflow.** A posted task is saved and marked posted; no supplier is notified until JOB-01 is built. There is no fake auction, delivery, funding or acceptance in this app. Drafts can be edited; after posting, additions are messages. Cancellation is terminal for this slice. If later offers depend on scope, introduce immutable scope revisions and require requoting on scope changes.

**Tenant foundation, limited product scope.** Every account gets one personal tenant with owner membership. Buyer/builder is a preferred UI destination, not a security privilege. The schema reserves membership roles, but the UI/API cannot invite employees or change roles. Organization policies and tenant-switching require their own implementation and review.

## Verification

Automated coverage uses disposable memory/disk databases and real loopback HTTP requests:

- Password hashing, wrong-credential behavior, invalid fields and bounded input.
- Session rotation, logout revocation, idle and absolute expiry.
- Persistent auth attempt limits and reset window.
- Two distinct buyer/builder accounts cannot list/read/edit/post/message another tenant's tasks, including forged ownership/tenant fields.
- Server-owned roles; approvers cannot mutate tasks.
- Durable duplicate retries, reused-key rejection, stale versions, invalid transitions and transaction rollback.
- Two concurrent HTTP message commands at the same version yield one success and one conflict.
- Reopening a disk database restores account, session, task, messages, events and idempotency history.
- HTTP Host/Origin/CSRF checks, JSON and body-size controls, no-store/CSP headers, Secure cookies/HSTS under HTTPS configuration.

Browser walkthrough: entering a request before auth → returning login → same saved draft → add context → post → refresh → switch to builder → return to buyer. Stopped and restarted the real service, then reloaded the task: the authenticated session, task ID, posted status, message and activity were restored. Generic signup asks the workspace; buyer/builder-context signup retains its destination. Logout returns to the public surface. Actual account creation/credentials and lifecycle are exercised by integration tests, not only visual mocks.

Validation record: the complete suite passes **120 tests** (106 existing + 14 new backend tests); the POC frontend also passes its independent syntax check. The tests cover the raw HTTP interface and file-backed storage, rather than relying on the prototype's fake DOM/session fixtures. The published prototype source directory and hosting configuration have no changes.

Tests are not a penetration test. Current machine: Node 25.2.1 (`node:sqlite` emits an experimental warning). Node 24 LTS is the intended CI target and must be exercised before hosted staging. No CI runner or hosted environment was provisioned in this slice.

## Required before external accounts

| Gate | Owner to assign | Acceptance evidence |
|---|---|---|
| Hosting/data-region and identity decision | Founder + technical lead | Approved provider/region/cost; separate POC staging credentials |
| Managed identity or independently reviewed auth implementation | Technical lead + security reviewer | Verified email, recovery, session management/revocation, abuse controls, enumeration review, cookie/proxy/TLS review |
| Hosted database and tenant policies | Backend lead | Migrations, concurrent process tests, tenant/role tests, least-privilege credentials and secrets |
| Account/data lifecycle | Product + backend | Retention, account deletion, backup protection, restore drill, log policy, support/recovery ownership |
| Production operations | Technical lead/on-call | TLS, monitoring, health/readiness, backups, migration rollback, dependency/runtime pinning, rate limits across instances |
| Independent security review | Security reviewer | Remediated findings and named human sign-off; this assistant is not the reviewer |

Known limitations: no verified email or recovery/MFA; signup can reveal an existing address; auth throttles can be abused to temporarily lock an address; a single-host synchronous database is not a multi-region service; no encryption of the database itself; task listing and activity are not paginated; no automated retention/pruning; no durable unsent form recovery or automatic conflict reconciliation; no corporate memberships, agent bidding, payments or file uploads. Local custom auth is **not** approved for real external/customer accounts. The launcher deliberately refuses production mode and binds only to loopback.

## Next implementation sequence

1. Choose hosted identity and database/region; keep the demo separate. Replace/adapt local auth and storage, implement verification/recovery and harden for a private staging environment.
2. Verify two independent invited accounts from different devices and restore data from a backup. Audit tenant policies and mutations under concurrency.
3. Add a supplier identity and one external REST agent: opportunity → quote → buyer selection → assignment acknowledgement → progress. Keep dispatch behind explicit sandbox/eligibility gates.
4. Add private artifact storage and a real submission/revision. Then integrate hosted sandbox payments and reconcile provider events before considering paid work.

## References checked

- [Node SQLite API](https://nodejs.org/api/sqlite.html) and [Node crypto](https://nodejs.org/api/crypto.html): verify runtime-specific support before selecting a deployment image.
- [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): basis for the scrypt work factor; independent auth review still required.
- [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html): server-owned session lifetime, cookie protections and verifier storage inform this implementation.
