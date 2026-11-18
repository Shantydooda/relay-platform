# Local authoritative membership producer

Implemented on localhost. Stripe, the demo, deployed staging and the current local application identity mode remain unchanged. This is a local authoritative source and delivery process; it does not poll or modify the real Supabase project.

## Source of truth and bootstrap

`createMembershipProducer` stores source records, membership-generation history, update-command receipts and an outbox in a supplied transactional repository. Use a dedicated source database in the runnable worker. The consumer authority remains a separate database/application boundary.

Trusted integration code calls `update({ userId, expectedVersion, memberships }, requestId)`. Memberships contain only workspace `id`, `role` and `company`. The producer owns generation numbers; callers cannot choose them. Updates use optimistic source versions and UUID request IDs. Idempotent retries return the original result; conflicting reuse is rejected. Source state and its outbox entry commit or roll back together.

`bootstrap(records)` accepts at most 100 explicit users per batch, each with a UUID `requestId`, `userId` and complete `memberships` array. Initial expected version is zero (may be omitted). Each user commits independently; restart/retry the same records and request IDs to resume. Missing users in a batch are not deleted or inferred to have no access. To revoke a known user's workspace access, explicitly update their complete membership set to `[]`.

Role changes and removal/re-entry advance retained membership generations. Intermediate changes are captured even when a newer full snapshot replaces an unsent outbox entry. Demotion and re-promotion cannot collapse back to the old approval generation. Refresh-only revisions do not change the administrative source version.

**Integration requirement:** all authoritative membership changes must enter this transaction path, or a future provider-side transaction/outbox must preserve equivalent history. Periodically reading the current role is not sufficient. This source is not connected to existing company-admin UI writes or Supabase writes yet. Never turn sampled current roles into a claimed complete event history.

## Refresh and delivery

- Snapshots expire after four minutes and refresh every two minutes. The worker scans bounded 100-row pages and cycles its cursors; restart begins scanning again safely.
- One durable current outbox envelope exists per issuer/user. Source updates replace it atomically with a higher revision and new event ID. Older in-flight deliveries remain harmless under receiver revision checks and producer fencing.
- Workers claim a 30-second lease in a database transaction, then send outside that transaction. Competing workers cannot claim the same live lease. Expired claims can be recovered.
- HMAC signing uses the receiver's Relay adapter protocol. Keys are not stored in source/outbox rows. Each retry retains the same event ID and exact body but gets a fresh signature timestamp.
- The loopback transport refuses redirects, limits replies to 8 KiB and times out after eight seconds. Acknowledgments must match event ID and revision. A late worker cannot acknowledge an overwritten or re-leased envelope.
- Failed envelopes retry at most five times with exponential backoff capped at 30 seconds. They then remain blocked until a periodic fresh snapshot replaces them. Ongoing receiver outages therefore continue at a bounded refresh/retry rate; they do not extend consumer access.
- If acknowledged freshness has expired, the next snapshot advances active membership generations. The receiver's `ACCESS_EPOCH_REQUIRED` response also generates a fresh revision/generation. This deliberately requires fresh approvals after an access gap. A lost acknowledgment can conservatively cause extra generation changes; it cannot revive access.
- A `superseded` acknowledgment for the current envelope, revision conflict or event conflict blocks the source for reconciliation. The producer does not guess a higher revision to overwrite a receiver it no longer agrees with.
- Delivery errors persist only a generic diagnostic, never keys, signatures or arbitrary exception text. There is no automatic financial action.

## Runnable local worker

The command is `npm run membership:producer -- --config /absolute/private/config.json`, optionally followed by `--bootstrap /absolute/private/bootstrap.json`. The worker runs until SIGINT/SIGTERM, then aborts delivery and closes its pool. Source/receiver data and pending jobs survive process restart.

The config must be a regular, non-symlink file with no group/other permissions (`chmod 600`), at most 64 KiB, and exactly these fields:

```json
{
  "endpoint": "http://127.0.0.1:4186/internal/access-updates",
  "issuer": "relay-local",
  "keyId": "current",
  "keyBase64": "<32 random bytes generated and stored locally as canonical base64>",
  "sourceDatabase": "relay_membership_source_local"
}
```

Match the issuer/key to the separate local receiver. Do not paste keys into chat, source control or a browser. Bootstrap files follow the same private-file requirements.

Provision and migrate the separate source database using the existing local PostgreSQL utilities and roles before starting the worker. Its name must start with `relay_membership_source_`; the CLI refuses the normal application database. It reads the existing **local** PostgreSQL connection configuration, overrides only the database name, and verifies migrations through `openLocalPostgres`. It neither creates a hosted service nor automatically creates/migrates a database. The receiver must already be running on loopback; this CLI does not expose a listener or switch application auth mode.

Trusted source updates belong in the adapter API, not a public HTTP endpoint or editable user document. The worker CLI is deliberately not a command for assigning arbitrary production roles.

## QA and remaining work

Tests cover atomic rollback, bootstrap retry, unchanged refresh, unseen-between-deliveries role changes, lost acknowledgment, expired leases, late-worker fencing, refresh after access expiry, bounded retries, private config and actual signed HTTP delivery. Native PostgreSQL tests use independent pools and reopen a connection to verify source/outbox persistence and competing-worker admission.

Verification: all 312 backend tests passed, along with the native PostgreSQL multi-pool/restart integration test. `git diff --check` passed and the existing localhost health endpoint returned HTTP 200.

No UI changed; browser visual QA was not repeated. This is engineering self-review, not independent security certification. The executable CLI's configuration and worker components are tested; no long-running producer has been attached to user accounts.

Remaining integrations: provider-backed mutation capture/bootstrap, producer status and refresh-lag monitoring, a reviewed reconciliation workflow for blocked divergent sources, audit/outbox retention, hosted transport/security, and load/capacity sizing. Large backlogs or slow delivery can exceed refresh windows; the receiver then denies expired access. Never bypass that expiry to hide lag.

## Operator health and conflict recovery

`npm run membership:producer -- --config /absolute/private/config.json --status <user-uuid>` reads one source and its current delivery record, then exits without ticking, refreshing or sending. It reports source/revision versions, observation time, acknowledged freshness remaining, refresh overdue duration, delivery attempts, lease/retry times and generic error codes. It does not print membership contents, envelopes, signing keys or signatures. `current` means acknowledged snapshot freshness, not that a user has any granted memberships. This is a private operator CLI, not a buyer-facing health endpoint or aggregate monitoring service.

The trusted producer API also exposes `reconcileRevocation(input, requestId)`. Input contains user ID, expected source version and revision, reviewed receiver revision and operator ID. The host must authenticate/authorize the operator; a supplied operator ID is an audit attribution, not authentication. A trusted `readReceiverRecord(userId)` adapter must read the receiver's actual durable record, including retained history. No browser input or user-supplied snapshot may implement that adapter. The CLI deliberately does not offer arbitrary reconciliation commands.

Only a conflicting source can be reconciled. Reviewed versions must still match. Recovery preserves the highest observed generation for every workspace, creates an empty-membership snapshot above both observed revisions and atomically records an audit receipt. Retries with the same command return its original result; changed input is rejected. The result is **revocation pending**, not recovered access. New grants are blocked until signed delivery of the empty snapshot is acknowledged. Restoring memberships requires a separate trusted source update, with fresh generations, afterward.

Source and receiver cannot share an atomic transaction across databases. If the receiver advances after observation, its monotonic checks still reject or supersede the recovery envelope; the producer returns to conflict and does not overwrite it blindly. Existing receiver access can remain valid until revocation is delivered or its snapshot expires. Operators must inspect actual delivery status, not infer revocation from accepting the recovery command.

QA for this increment: 314 backend tests passed; the final additional receiver-advancement race passed in the 13-test producer suite; native PostgreSQL access/concurrency/restart regression passed. Tests include stale review, idempotent recovery, audit attribution, blocked pre-ack grants, fresh post-recovery generations and redacted health output. `git diff --check` passed. No visual UI changed. Self-review is not independent security review.

Remaining: provider mutation capture, an authorized operator UI/adapter for reconciliation, aggregate lag monitoring/alerts and retention. No real user source was reconciled or attached to a running producer.

## Trusted provider capture and aggregate monitoring (local integration)

The prepared `supabase/migrations/202611010001_membership_changes.sql` adds a durable provider change log. It has been exercised only in disposable local databases; it has **not** been applied to hosted Supabase, staging or the demo. Existing membership rows produce bootstrap events under a table lock. Subsequent membership inserts/updates/deletes (including cascade deletes) and tenant `company` changes emit full per-user snapshots in the mutation transaction. A transactional global counter serializes capture and commit ordering; rollback consumes no cursor position. Per-user revisions preserve intervening role changes, removals and re-entry. Truncation is rejected. Administrative changes that disable triggers or rewrite capture tables are outside this trust boundary and must never be used operationally.

The new tenant `company` field defaults to false; existing tenants are not silently reclassified as businesses. Provider authentication, invitation eligibility and session revocation retain their existing independent checks. This stream captures workspace membership, not arbitrary auth metadata or user-editable claims.

`membership-provider-stream.cjs` consumes up to 100 ordered events per poll, applies each through the producer's trusted API, and commits a durable cursor. A crash between application and checkpoint safely retries the same event. Missing sequence numbers, changed replay content, unavailable reads or unfinished backlog prevent access refresh. Existing receiver snapshots expire normally; the consumer does not pretend an unavailable provider is current. An explicit empty recovery snapshot can still revoke during a blocked poll. New grants remain blocked until recovery completes. Provider-bound sources reject manual updates and cannot refresh through a worker without a capture hook.

The local CLI accepts an optional `providerDatabase` in its private config. It must match `relay_provider_fixture_<suffix>` and use the existing local runtime credentials at 127.0.0.1. It cannot connect to a hosted provider. Prepare the provider schema and migration separately in this dedicated fixture database, granting the runtime role read-only access to capture tables (including RLS read policies). The native test demonstrates this mapping without creating cluster roles. The source/outbox database remains separate. Manual `--bootstrap` cannot be combined with provider mode: capture owns bootstrap. Provider pool connections and queries have bounded timeouts. No worker was attached to real user records during this increment.

Run `npm run membership:producer -- --config /absolute/private/config.json --summary` for read-only JSON aggregate monitoring. It reports source counts, conflicts, pending recovery, unacknowledged/expired snapshots, overdue refreshes, maximum lag, pending/failed/blocked delivery, abandoned leases and provider polling age/backlog. It emits no user IDs, role contents, event payloads or credentials. Counts can overlap. The scan is capped at 10,000 source rows across issuers and explicitly reports `complete:false` at the cap; partial, empty, disconnected, stale or failed observations never report healthy. This is a bounded operational observation, not a transactionally frozen cross-service snapshot. Provider backlog is the last observed high-water mark, not a live queue count during an outage. External alert routing and a dashboard are not connected.

Verification: all 323 backend tests passed on the final code, including capture-blocked revocation recovery, migration permissions, truncate rejection and existing managed SQL behavior. Native PostgreSQL verified competing writer commit order, rollback without gaps and a read-only runtime capture reader. The localhost health endpoint returned HTTP 200 and `git diff --check` passed. No browser UI changed. Remaining work includes hosted provider rollout approval, deployment/migration procedure, capture retention and capacity testing, operator alert delivery, and independent security review.

## Durable local operator incident feed

The running producer now evaluates aggregate health after each cycle, including failed capture/delivery cycles, and persists incident openings and resolutions. `npm run membership:producer -- --config /absolute/private/config.json --alerts` reads active codes and the latest 50 transitions without ticking or changing access. Stale/no observations are explicitly flagged. No external email, Slack, webhook or payment action is sent.

Conditions include conflicts, pending recovery, expired/unacknowledged snapshots, overdue refresh, delivery failure/abandoned leases, unavailable/stale provider capture, partial monitoring and empty sources. A transition is persisted only when a condition opens or resolves; repeat polls and restarted/competing workers do not repeat unchanged incidents. Observation timestamps fence older or equal observations. Event history and current state commit together. Read output contains codes, status, timestamps and sequence numbers only, not identities, role details, credentials or raw errors.

Failed monitoring preserves known active incidents and opens MONITOR_UNAVAILABLE. Incomplete scans likewise preserve prior incidents until a complete observation proves recovery. Monitoring exceptions do not stop the producer loop. The feed is evaluated in the worker process: if the process stops, an operator must observe its stale timestamp; this is not an independent availability monitor. No acknowledgment/suppression workflow or external alert routing is connected. Incident history currently has no retention policy; only the read response is capped.

QA: 328 backend tests passed, plus native PostgreSQL competing-connection and restart incident deduplication. Tests cover recovery history, stale observations, invalid summaries, monitoring failure, incomplete scans, and worker-cycle isolation. Localhost health returned HTTP 200; `git diff --check` passed. No visual UI changed, so no browser interaction QA was needed. Engineering self-review does not replace independent security review.

## Independent local watchdog and retention

Run a separate process with `npm run membership:watchdog -- --config /absolute/private/watchdog.json`. Its private JSON contains exactly `issuer` and `sourceDatabase`; the database must have the `relay_membership_source_` prefix. It uses existing loopback-only local database credentials and needs no signing key or provider connection. It checks every 15 seconds. SIGINT/SIGTERM stops the process and closes the pool. Nothing automatically starts or attaches this process to user records.

`--once` performs one check: exit 0 means no active watchdog condition, 2 means an active condition, and 1 means configuration/database/check failure. The observer persists its own deduplicated transitions separately from producer incidents. The producer's durable completed-cycle monitoring timestamp is the heartbeat: missing observations, an age of at least two minutes, or a future timestamp are distinct conditions. The watchdog never updates that heartbeat. This measures issuer-level service progress, not every replica individually; a live but failing producer remains visible in producer incidents. A single long cycle can also become stale, intentionally surfacing stalled progress. Database unavailability emits only a sanitized diagnostic and never claims health. The watchdog itself still needs an external supervisor in a hosted deployment.

Capacity reporting covers source records, outbox records, source replay receipts, reconciliations, provider cursor and incident/watchdog state/history in the source database, scoped to the issuer. Defaults alert at 100,000 event rows, 200,000 total tracked records or 100 MiB of serialized payload. These are operating thresholds, not measured production throughput limits. Bytes exclude indexes, WAL, table overhead and the separate provider change log. Database statement/lock timeouts bound SQL operations; exhausted checks report failure rather than a partial healthy result.

`--prune` explicitly executes one transactional retention batch, rather than starting monitoring. Only producer/watchdog incident events older than 30 days are eligible; the newest 100 events per issuer per stream always remain. At most 100 events per stream (200 total) are removed per invocation. Current incident state, source history, access generations, provider change logs, pending work and all replay receipts are never deleted by this command. Other issuers are untouched. Repeated calls safely drain eligible history. This command is not automatically scheduled and was not run against current user data.

QA: all 332 backend tests passed on the final code, including cleanup rollback and rejection from read-only transactions in SQLite and PostgreSQL. A final guard test found and corrected SQLite reads not passing the read-only repository flag. Native PostgreSQL verified competing observer deduplication, bounded retention and separate CLI process execution/exit codes against a disposable source database. Worker stop/recovery and clock cases use controlled timestamps rather than waiting two minutes. No application UI changed. Remaining: provider-log watermark/retention design, physical storage/throughput capacity measurement, external supervision/notification routing and independent security review before hosted rollout.

## Provider change-log retention and backlog evidence

Prepared migration `202611020001_membership_retention.sql` adds a persistent provider stream identity, a retained-history boundary and explicitly registered consumers. This migration is tested locally only. A trusted operator registers every required consumer with `relay_register_membership_consumer(text)` before enabling cleanup. Registration starts at zero; a missing or lagging registered consumer blocks retention. Consumers never expire automatically. Retiring a consumer requires a separately reviewed operational procedure, not a timeout.

The producer config optionally accepts `providerConsumer` alongside `providerDatabase`. It acknowledges only the durable source cursor after a fully drained poll, through `createLocalProviderRetention`. Caller-supplied sequence numbers are not accepted by this adapter. Acknowledgments only advance and cannot exceed the provider's current log position. The producer and acknowledgment adapter both check persistent provider stream identity; switching databases or restoring an incompatible cursor fails closed. Existing nonzero cursors without the new identity binding require reviewed migration/bootstrap rather than automatic adoption.

Only a privileged operator can execute `relay_prune_membership_changes()` (also exposed by the local retention adapter's `prune` method). The runtime role may acknowledge but cannot register consumers or prune. Cleanup uses the minimum registered acknowledgment, removes only a contiguous prefix older than 30 days, always keeps the latest 100 changes, and deletes at most 100 per transaction. The retained boundary and deletion commit atomically under the provider clock lock. No source/receiver replay receipts or access histories are deleted. A restored cursor below the retained boundary receives PROVIDER_BOOTSTRAP_REQUIRED: restore a consistent backup or perform reviewed bootstrap; never skip straight to the newest position.

Acknowledgment means the producer has durably applied provider changes to its source/history/outbox, not that the receiver has acknowledged delivery. The durable outbox is therefore part of the required consistent backup/recovery unit. Multiple independent consumers must each register; replica workers sharing one source database share one consumer identity. The trusted SQL acknowledgment function is not a public/browser API. Its privileged caller must use the durable-cursor adapter rather than inventing positions.

Local evidence: a 1,001-change fixture drained in 11 bounded batches across consumer restart boundaries while preserving all intermediate generations. Native PostgreSQL captured 1,000 changes in 67–105 ms in the measured runs. These small local measurements exclude hosted network latency and do not certify production throughput. A controlled slow-backlog test advances time beyond snapshot expiry, verifies old access is denied, then verifies recovery uses a fresh generation. Tests also cover lagging consumers, bounded/concurrent pruning, rollback, privilege denial, stale restores and database identity mismatch.

No real-data pruning, registration, hosted migration or configuration change was performed. Remaining: reviewed bootstrap/restore/consumer-retirement tooling, sustained multi-tenant load and physical disk/WAL capacity measurements, then the full buyer-to-builder release rehearsal.

Final verification for this increment: all 336 backend tests passed, plus the native PostgreSQL capture/concurrent-prune/rollback test. `git diff --check` passed and localhost health returned HTTP 200. No product UI changed; no browser visual QA was required. This was engineering self-review, not independent security certification.

## Reviewed restore assessment and consumer retirement

Prepared migration `202611020002_membership_retirement.sql` adds soft retirement and an immutable request/result audit table. Only the database operator may retire consumers. Runtime acknowledgment and registration reject retired identities; they cannot be resurrected by restarting a worker. Cleanup excludes retired consumers, but retirement requires a distinct, active replacement acknowledged through the current provider sequence. A lagging consumer cannot simply be removed without that replacement.

`createLocalMembershipRecovery` is a trusted operator adapter with two separate operations. `review()` reports the provider stream, current sequence, retained boundary, consumer acknowledgment and local cursor. It classifies missing/invalid cursor, mismatched stream, pruned history, provider-behind-source, retired/unregistered consumer, or replay-required. Replay-required is not certification of a consistent backup: source history, outbox and receipts must come from the same backup. Assessment performs no cursor rebasing, automatic bootstrap or access restoration. Rebuilding from pruned history still needs a reviewed bootstrap procedure; this increment intentionally provides no skip-to-latest operation.

`retire()` requires the reviewed stream/sequence/boundary/consumer acknowledgment, replacement identity, operator UUID, a 10–500 character reason and unique request UUID. SQL locks the stream clock and checks all reviewed values before acting. New provider changes or acknowledgments require a new review. The retirement and audit record commit together. Retrying the same request returns its original result; changed contents conflict. The result records retirement, not proof that the old process was shut down. Stop/decommission that worker separately. Its configured acknowledgment path will fail closed afterward.

Local CLI: `npm run membership:recovery -- --config /absolute/private/recovery.json --review`. The private config has exactly `issuer`, `consumerId`, `sourceDatabase` (`relay_membership_source_…`) and `providerDatabase` (`relay_provider_fixture_…`). It uses local runtime credentials to read source state and local migration/operator credentials for provider operations; that role must own or have explicit operator permission on the prepared provider schema. No signing key is required.

For an intentional retirement, use `--retire /absolute/private/command.json`. The command contains `review` (the review result), `replacement`, `operatorId`, `reason` and `requestId`. Both files require private-file permissions. Database credentials provide authority; the operator UUID is audit attribution, not an authentication mechanism. This is a private local CLI, not a browser API. No retirement or provider schema change was applied to real records.

Tests cover stale review, required current replacement, replay conflicts, rollback, runtime permission denial, retired acknowledgment/registration, concurrent native PostgreSQL retries and read-only restore classification. Native SQL and adapter paths were exercised; the new recovery CLI was not run against a configured operator-owned provider database. Next: consistent-backup/bootstrap rehearsal and sustained multi-tenant load, followed by the full buyer-to-builder release rehearsal. Hosted services, demo and Stripe remain unchanged.

Verification for reviewed recovery: 338 backend tests passed; the final 15-test focused provider suite passed with the additional restore classification regression. Native PostgreSQL concurrent retirement retries passed. `git diff --check` passed and localhost health returned HTTP 200. No UI changes or browser visual QA; engineering self-review is not independent security review.

## Actual local backup and restore rehearsal

`services/application/scripts/membership-backup.cjs` now takes coordinated native PostgreSQL custom-format dumps of three distinct isolated provider/source/receiver databases. It acquires SHARE table locks in a fixed order across all authoritative tables before dumping any store, with a five-second lock timeout. This freezes writes for the bundle; it is an offline/local operator workflow, not a nonblocking hosted backup. Backup files are private and their hashes are recorded in a private manifest. Credentials and signing keys are not included.

CLI: `npm run membership:backup -- backup /absolute/private/databases.json /absolute/new/bundle` or `... restore /absolute/private/restore-targets.json /absolute/existing/bundle`. Both maps have exactly `provider`, `source`, `receiver`. Backup names are restricted to isolated provider/source/receiver fixture prefixes; restore names must be fresh `relay_restore_…` databases. Existing databases are never overwritten. All archive hashes are verified before creating targets. Only restore bundles created by this trusted local tool: a PostgreSQL archive executes database definitions, and an unsigned hash manifest detects corruption rather than authenticating an untrusted sender.

Restores remain operator-only and isolated: database public-connect privileges are revoked and archive ACLs are not copied. They do not change app configuration or activate a worker. Before promotion, operator-reviewed role grants, private key configuration and appropriate stream binding must be restored separately. A failure can leave isolated partial targets for investigation; the utility does not silently delete them or point an app at them. The backup scope is managed membership state, not task artifacts or the full buyer application; the existing paired application/identity/object backup workflow remains separate.

`npm run test:membership-backup` performs actual pg_dump/pg_restore into disposable native databases. It verifies initial provider bootstrap capture, a pending source delivery at backup time, restored receiver access generations, idempotent replay and subsequent demotion/re-promotion after recovery. It also rejects a corrupted archive and an existing destination. This is consistent-bundle bootstrap/resume; reconstructing a lost source from already-pruned history remains intentionally blocked rather than inventing generations or moving a cursor forward.

QA: 339 backend checks, 79 web/UI checks, and the actual native restore/bootstrap rehearsal passed. `git diff --check` passed. Current user databases, staging, demo and Stripe were not changed by the backup work.
