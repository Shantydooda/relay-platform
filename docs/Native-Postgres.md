# Native PostgreSQL foundation

28 October 2026. Localhost only. No push, Render deployment, Supabase migration, hosted configuration change or demo edit is part of this increment.

## What is implemented

The existing localhost application now uses a dedicated native PostgreSQL 16 cluster for canonical application records: tasks, scopes, conversations, agents, offers, agreements, grants, credentials, retry receipts, submissions and bounded file bytes. It runs on `127.0.0.1:55432`; the web app remains on `http://127.0.0.1:4180`.

Identity remains in the existing local SQLite store. This deliberately preserves accounts, password hashes, memberships and sessions; it does not replace the separately hosted managed identity provider. This is a production-oriented application persistence increment, not a claim that local identity, the runtime or the overall product is ready for public commercial use.

The original canonical SQLite application file is retained as a pre-cutover source, not a second writable backend. PostgreSQL becomes authoritative after verified cutover. New application writes are not mirrored back to SQLite. Do not remove the enablement file to roll back code: that would expose stale application state.

## Boundaries and responsibilities

- `services/application/src/repository.cjs`: one repository interface, parameterized SQL, transaction-scoped idempotency locks and row locks. Native reads use repeatable-read, read-only transactions. Business commands still share the same application service.
- `services/application/src/postgres.cjs`: bounded native connection pool, loopback-only configuration, statement/lock/idle-transaction timeouts and redacted pool errors. Native startup verifies migration history without running DDL. There is no fallback to SQLite when the configured PostgreSQL backend fails.
- `services/application/src/migrations.cjs` and `migrations/*.sql`: ordered, checksum-verified migration history. An advisory lock serializes migration runners. The whole pending batch runs transactionally. Failed SQL rolls back schema changes and history together; unknown, modified or pending history blocks normal app startup. Applied files must never be edited; add a later migration.
- `services/application/scripts/local-postgres.cjs`: explicit local cluster initialization/start/stop, role provisioning and migration commands. It neither reads hosted connection strings nor accepts remote hosts.
- `services/application/src/cutover.cjs`: offline canonical SQLite snapshot import. Requires an empty target, copies retry receipts and records atomically, records a source fingerprint and refuses changed-source reimports. An exact repeat is idempotent.
- `services/application/scripts/recovery.cjs`: paired offline identity/Postgres backups, checksums and isolated restore. Restore never replaces the current database or an existing identity file.

The schema currently uses the existing application document/receipt model, with indexes by owner, tenant and status and basic JSON/version constraints. This avoids changing storage architecture and business behavior simultaneously. It is not a fully normalized financial ledger, object-storage service, pagination implementation or performance certification.

## Access model

The local cluster is separate from any existing system PostgreSQL service. TCP listens only on loopback and uses SCRAM password authentication. Its administrative Unix socket is inside a mode-0700 directory. Same-user local socket trust is a development convenience, not a production authentication configuration.

`relay_migrator` owns the application database/schema and performs explicit schema changes. `relay_app` is a non-superuser with no database creation, role creation or object ownership. It receives schema usage, SELECT on migration history and SELECT/INSERT/UPDATE/DELETE on application records/receipts. It cannot change migration history, create/alter/drop objects or truncate the tables. Public database access and public schema creation are revoked for the main local database.

This server-side role can read application records; cross-account authorization remains enforced by the shared application commands, not browser-side access or newly introduced RLS. Do not expose the role to browsers or suppliers. A future hosted deployment needs its own identity composition, TLS, secrets management and independently reviewed grants.

Local generated configuration and passwords live in ignored mode-0600 files under `.poc-data/postgres/`, with directory mode 0700. The app reads only `runtime.json`, not the migration credential file. They still share a local OS user; this is not OS-level isolation of a compromised process. No secrets are included in source, console output, command arguments or backup manifests.

## Commands

From the repository root:

```sh
npm run db:local:setup
# Stop the local web app before first cutover:
npm run db:local:cutover
npm run start:local
```

Setup initializes free, already-installed PostgreSQL software, creates the dedicated roles/database and applies migrations. Setup alone does not switch application storage. Cutover first backs up both original SQLite stores, imports the canonical application data, verifies every document and receipt, then writes the enablement marker. It preserves the identity store. Starting PostgreSQL after a machine restart is explicit:

```sh
npm run db:local:start
npm run start:local
```

Normal app startup never performs migrations. Before starting code requiring a new migration, stop the local app, take a backup, then run:

```sh
npm run db:local:migrate
```

`RELAY_LOCAL_PG_HOME` can select another isolated local cluster directory; `RELAY_DATABASE_PATH` can select its identity file. The enablement marker binds these paths, so pointing another identity store at the existing backend fails rather than mixing accounts. Ports and hosts are validated. These are local controls, not deployment settings.

`GET /health` checks both local identity and application storage and reports the actual backend. `GET /health/live` is process liveness. Recognized database outages return a redacted 503; retry the same mutation key so a committed response that was lost is not duplicated. No new database is selected during an outage. The local CSV process must be reconnected after an app restart, as before; a database-only outage does not invent completion.

## Backup and recovery procedure

1. Stop the web app and other writers. The CLI refuses backup/cutover while the normal app port is listening. This port check is a local guard, not a distributed maintenance lock; operators must stop custom-port servers and direct database writers too.
2. Run `npm run db:local:backup`. It makes a consistent SQLite identity backup and a custom-format `pg_dump`, records file checksums and document counts, and excludes credentials. Each database snapshot is consistent; the pair requires the offline write pause because identity and application storage are separate.
3. Run `npm run db:local:restore -- <backup-directory>`. It verifies both checksums, creates a new `relay_restore_*` database, restores in one transaction, reapplies restricted grants, verifies the original migration history/counts, applies reviewed forward migrations when the backup is older, and restores identity into a new directory. It refuses existing targets and never flips the main backend.
4. Verify task history, scoped downloads, hashes and existing sessions using the recovered pair before deliberately promoting any recovery. A production recovery would additionally need separately retained credentials and reviewed endpoint/identity routing. Do not silently overwrite the main stores.

Backups are local files with restricted permissions, not encrypted offsite backup or point-in-time recovery. No automatic destructive down migration exists. Failed migrations roll back; recovery from successful incompatible migrations requires a reviewed forward fix or a validated paired restore and an explicit routing decision.

## Acceptance criteria and evidence

The dedicated `npm run test:postgres` suite initializes a disposable native cluster and uses separate connection pools. It covers:

- Concurrent migration runners, checksum drift, missing/pending history and rollback of partially executed DDL.
- Runtime database permissions and rejection of schema/history changes.
- 32 simultaneous same-key requests producing one task, conflicting retry content rejected.
- Multiple agents bidding without lost offers; simultaneous selections producing one winner; idempotent authorization and submission.
- Competing worker leases and capacity limits, including simultaneous claims on different tasks through separate pools; credential revocation.
- Actual submitted CSV bytes and unauthorized-download denial.
- Immediate PostgreSQL shutdown/WAL recovery, new application pools, retained credentials, files and exact-submission acceptance.
- Paired identity/database restore into a separate target, earlier task state recovered while current state remains intact, existing session recovered and corrupted backup refused.
- A separate HTTP server/CSV worker: automatic bid, selection, explicit unpaid execution, actual download, app-process restart, acceptance, database outage/503, reconnection and retained files.
- Canonical SQLite import, preserved retry results, repeat import and changed-source/nonempty-target refusal.

Final test counts and browser walkthrough evidence are recorded after the final review. These tests do not establish throughput limits, multi-host failover, offsite recovery, hosted authentication, commercial payments or independent security approval.

## Verification record

- Fresh regression: 89 core tests passed, including the existing 19 CSV evaluation cases. Frontend: 13 tests passed; the 5 shared UI tests also passed and are already counted in the core suite. Native PostgreSQL: 14 additional tests passed. These counts are separate suites, not a claim of exhaustive coverage.
- Native tests used PostgreSQL 16.13 and separate real network connections/pools. They include forced database shutdown/restart and a separate app-process restart, not only reconstructed in-memory services.
- Main localhost cutover preserved and compared all 2 existing canonical application records and 2 retry receipts. The original identity store and original application SQLite file remain in place. No disposable identities, agents or tasks were inserted into the main database.
- A fresh paired backup of the actual local stores was restored into a new isolated PostgreSQL database and identity directory; migration history and counts were checked. It did not replace the main local stores.
- Browser QA used an isolated PostgreSQL database and disposable identity file on port 4182. It covered builder login, general-purpose agent/capability registration, real runtime connection, automatic bidding, buyer login, reviewed task posting, offer selection, explicit unpaid authorization, actual CSV/report delivery, refresh, acceptance and the builder's matching task state. Source CSV bytes were fixture-provided; the browser file picker was not separately retested.
- The walkthrough found misleading setup text that asked an already-connected builder to connect again. The status guidance now distinguishes connection from enabling automatic bidding. No design redesign was included.
- Review included migration failure/privilege boundaries, transaction and pool cleanup, retry/content preservation, canonical cutover behavior, recovery isolation, redacted database errors and ignored local credentials/data. This was engineering self-review, not independent security review.

Main localhost remains on PostgreSQL. The demo and hosted staging were not changed. Remaining release work includes hosted composition and managed-auth acceptance, versioned external supplier integration, general file storage/scanning, model-backed scoping, qualification/operator services, commercial funding/ledger/payouts, quotas/pagination, monitoring, offsite recovery and independent security/operational review.

The subsequent [Supplier API increment](Supplier-API.md) adds migration 003 for recovery/grant index backfill and tests restore from the prior schema before forward migration. Earlier test counts above record the database foundation increment.

Object storage update (29 October 2026): paired backups use manifest version 2 and include `<identity path>.objects` when present. Restore verifies hashes and restores into a separate object directory; version 1 backups remain supported. See [Object storage and recovery](Object-Storage.md).
