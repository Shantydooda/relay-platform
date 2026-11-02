# Local delivery object storage

**Current status — 29 October 2026:** Cisco ClamAV 1.5.4 is installed at `/usr/local/clamav`; the official daily (28167), main (63) and bytecode (339) databases validated successfully. Local config now uses the Cisco scanner and updater. Automatic scanning is operational; the earlier Homebrew installation blocker below is resolved.

Implemented and reviewed 29 October 2026. Localhost only; demo and hosted staging are unchanged. Stripe remains disconnected.

## Current behavior

Delivery bytes use a private content-addressed disk adapter beside the local identity database (`<identity path>.objects`). Database records contain immutable file identity, SHA-256, size and scan verdict; new delivery bytes are not stored as base64 in the database. Source CSV inputs still use the existing 256 KiB path.

Delivery limits are 1–3 files, 8 MiB per file, 16 MiB combined, with a 23 MB JSON request ceiling. Supported formats are CSV, UTF-8 text/Markdown, JSON, PDF, PNG, JPEG, MP4 and ZIP. Extension and basic signature validation is not a malware scan or complete format validation. Binary files are download-only; archives are never unpacked. The local store has a best-effort 1 GiB quota, not a multi-process reservation system.

Every new delivery file starts quarantined. Download, preview and acceptance are denied on the server until its scan verdict is clean. Buyers and assigned operators can retry scanning from the same delivery card. Blocked files require a replacement submission; retry cannot clear the verdict. Scanner failures remain blocked. Scanning updates the shared task version and activity history. Cached previews are hidden when a file becomes quarantined.

Older inline text deliveries remain compatible and are explicitly labeled as not having a recorded malware scan. They are not retroactively marked clean.

## Scanner configuration

The adapter invokes a locally installed ClamAV executable through the absolute `RELAY_CLAMSCAN_PATH` setting, feeds bytes through standard input, uses no shell and enforces a 90-second deadline. Exit zero means clean, one means blocked; other failures/timeouts remain quarantined. Maintain current signatures separately. The first increment did not install an engine. The automatic-scanning follow-up below records the current installation blocker; actual ClamAV threat detection is now verified by the follow-up below. With the setting absent, new deliveries stay quarantined. Browser and HTTP QA use explicitly labeled disposable scanner fixtures only.

Scanning now runs through a background worker as described below. Real-engine detection evaluation has passed; richer scanner version/signature provenance and production isolation remain release work.

## Backup and recovery

The existing offline backup command now includes all hash-addressed objects with identity and PostgreSQL snapshots in manifest version 2. Restore verifies object hashes and sizes, refuses existing destinations and restores into a separate database/identity/object directory. Version 1 backups remain readable. Stop writers during a paired snapshot. Missing or altered bytes fail closed even after a clean verdict. Restore original bytes from a verified backup; never edit file hashes or scan verdicts to bypass an integrity failure.

Tests cover object deduplication/restart, path and symlink rejection, corruption, unavailable scanner, blocked verdicts, authorized retry, unauthorized reads/scans, acceptance gates and byte-identical recovery. Native PostgreSQL tests also restore object bytes alongside database and identity records. The UI walkthrough covers quarantine, failed scan, clean fixture retry and acceptance.

## Remaining production work

This is a real local disk adapter, not hosted S3 infrastructure. Before production: managed private object storage, streaming/resumable uploads and downloads, larger media policy, isolated scanner execution, credential isolation, retention/orphan cleanup, encrypted off-machine backup and recovery drills, multi-process capacity enforcement and independent security review. Failed submissions may leave private unreferenced objects; no automatic deletion is enabled. Current base64 requests and whole-file buffering are deliberately bounded and unsuitable for large videos.

## Verification record

29 October 2026: 160 regression checks, 33 UI checks and 21 native PostgreSQL checks passed. A disposable browser fixture exercised scanner failure, clean retry, in-conversation preview, delivery acceptance and company allowance release. Self-review found and fixed the global busy handler re-enabling policy-disabled controls and a cached-preview exposure after quarantine. These checks are not independent security review or validation of a live malware engine. Main localhost readiness returned HTTP 200 after restart; disposable QA data was removed. An offline backup was taken before restart.

## Automatic scanning increment — 29 October 2026

The local launcher now starts a background scan worker. Quarantined artifacts are the durable queue, so existing unscanned deliveries are discovered as well as new submissions. The worker pages artifacts, claims a two-minute lease in a short transaction, releases database/access locks before running ClamAV, and commits only if it still owns the claim. A crash is recovered after lease expiry; late results cannot replace a newer verdict. Scan errors back off from ten seconds to five minutes. Clean and blocked verdicts are terminal for the automatic worker. Authenticated retry queues a scan; it no longer runs a long scanner operation inside a user request. Blocked files still require replacement.

The UI follows automatic status changes in the existing task conversation. Pending scans say “Checking delivery”; downloads and acceptance remain locked. Retry is available for incomplete scans only. Clean files do not need a manual recheck click.

ClamAV invocation now has a 90-second process deadline and bounded archive work (8 MiB file, 32 MiB expanded scan, ten recursion levels, 1,000 entries). Encrypted content and exceeded limits are flagged rather than silently accepted. A clean result additionally requires an explicit stdin/stream OK report and no diagnostic output. Child processes do not inherit application credentials. No file bytes go to an online scanning service. This process is not an OS sandbox; production isolation and resource limits remain required.

Local config `.poc-data/scanner.json` accepts absolute executable, databaseDirectory, certificatesDirectory, updater and updateConfig paths. Signature updates run at startup and every six hours while Relay is running. Missing or stale signatures fail closed. No launch-at-login service is installed.

### Earlier installation blocker and evidence (resolved by Cisco package)

Homebrew ClamAV 1.5.4 installed successfully. FreshClam downloaded official daily/main databases but rejected them during database load with `cli_loadinfo: Incorrect digital signature` / `Malformed database`. Explicit official certificate configuration did not resolve it. No signature verification or malware gate was disabled. Real clean-file/EICAR evaluation is therefore **pending**; `services/storage/scripts/eval.cjs` contains the integration check to run once valid signatures load.

Cisco's official macOS 1.5.4 package was downloaded and its SHA-256 matched the release (`df7fa753e2f9f67f3bc99b2a40a3be7ef559088c68ad6bdf66b4b5764e965bd6`). Apple package verification confirmed Cisco signing and notarization. It was expanded into private local storage for inspection; its signed executables require the fixed `/usr/local/clamav/lib` installation path. System-wide installation was rejected by automatic approval review; explicit user approval has been requested. It is not yet installed. The vendor build is a diagnostic alternative, not a proven fix.

Automatic-worker tests cover concurrent claims, reads during a running scanner, expired-lease recovery with a new application service, stale clean-result rejection after a blocked result, durable retry timing, and zero-exit/incomplete-report rejection. Native PostgreSQL HTTP tests run automatic fixture scanning with app/database restart. Browser QA against the actual installed engine confirms incomplete scanning remains visible and acceptance stays disabled; it does not demonstrate successful malware detection.

References: [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html), [signature database FAQ](https://docs.clamav.net/faq/faq-cvd.html), [official releases](https://github.com/Cisco-Talos/clamav/releases).

Final automatic-scanning checks: 163 regressions, 33 UI checks and 21 native PostgreSQL checks passed. Self-review completed; this is not independent security review. Real-engine clean/EICAR checks remain pending valid signatures. Disposable browser QA database and accounts were removed.

### Cisco installation completion and real-engine QA

The user approved and completed Cisco's system-wide installer. The vendor build successfully validated all official databases without disabling integrity checks. `.poc-data/scanner.json` selects `/usr/local/clamav/bin/clamscan`, `/usr/local/clamav/bin/freshclam` and `/usr/local/clamav/etc/certs`. Database files remain in Relay's private local data directory. Signature updates run at startup and every six hours while Relay is running.

`node services/storage/scripts/eval.cjs` verifies clean CSV detection, harmless EICAR detection, missing-database errors and process timeout. It additionally submits a clean file and EICAR test file through the application service, runs automatic reconciliation, verifies the clean download and rejects download/acceptance of the blocked file. All test artifacts are disposable. Browser QA on a separate native PostgreSQL database verified both CSV outputs automatically reached a clean verdict, then preview and delivery acceptance succeeded without any scan/retry click. The company allowance was released on acceptance.

The prior 163 regression, 33 UI and 21 native database checks cover the implementation. This follow-up changes local executable configuration and extends the real-engine evaluation; it does not deploy or alter Stripe. Successful malware checks are not a guarantee against every threat or a replacement for independent security review.

## Read-only reconciliation

Run `npm run storage:inspect` from the repository to inspect the configured native localhost database and its paired object directory. The command verifies the local backend/identity pairing and does not create, delete, quarantine, repair or change files or database records. It can run while the application is active. Output contains counts and at most 100 object-key findings, never file contents or user filenames. Treat reports as private operational metadata.

The report distinguishes missing references, unreadable objects, corrupt hashes/size mismatches, verified bytes, unverified objects and unreferenced candidates. Inline database artifacts do not require disk objects. Scans inspect at most 10,000 artifacts and 10,000 directory entries and hash at most 64 MiB per invocation. Partial flags and unverified counts matter: a partial or budget-exhausted report is not a clean bill of health. Reference truncation suppresses orphan inference entirely.

An unreferenced candidate may have been published by a transaction that has not committed yet. The snapshots are not atomic, and a file may disappear/change during inspection. Do not delete candidates based on this report. For missing/corrupt files, use the existing verified backup/isolated restore procedure and review exact object keys before restoration. For candidates, obtain a quiesced database/file snapshot and a retention decision before considering cleanup; automated deletion is not implemented. Completed orphan objects remain counted by the physical quota. Temporary-upload recovery remains handled separately by the writer lock.

## Repeatable local mixed-workload check

Run `npm run test:load` for a 60-second, four-lane workload using two native PostgreSQL pools, two disposable workspaces and a temporary private object directory. The harness creates and drops its own database and never targets the application's database. It needs the existing local PostgreSQL administration configuration; no hosted provider or payment credentials are used. An optional `RELAY_LOAD_SECONDS` value between 5 and 90 supports short smoke checks; only runs of at least 15 seconds assert that both configured test limits were reached.

Each lane alternates new conversations (with exact idempotency replay), 8 KiB artifact writes and file/database reads, with a 100ms pause between operations. Inspection runs every two seconds. The fixture deliberately uses low allowances (30 conversations and 256 KiB per workspace) to exercise rejection as well as success. The test drains all lanes before cleanup, checks final file/reference integrity and reconnects to verify persisted usage. Reports show per-operation success/limit counts, p95/max application-operation latency and event-loop p95. Creation measurements include the replay; latency percentiles include expected limit responses. These are not HTTP latency, peak throughput or model/provider capacity figures.

Use `RELAY_LOAD_MODE=steady npm run test:load` for the complementary 60-second accepted-write workload. It gives disposable workspaces larger allowances (10,000 conversations and 32 MiB each) and asserts no quota rejections. These fixture settings do not change product defaults. Both modes use 8 KiB files and two workspaces; neither establishes large-video upload behavior, many-tenant scale, HTTP responsiveness or provider throughput. The load harness is opt-in rather than adding a minute to every unit-test run.

## Storage profiling

`npm run storage:profile` creates disposable stores containing 100, 1,000 and 5,000 small content-addressed files, then times twenty new writes at each size. It reports p95 write latency and time/call counts for directory enumeration, file metadata reads and disk synchronization. Instrumentation is process-local; existing application storage is never used, and fixtures are removed afterward. This is a small-file microbenchmark, not a realistic provider/HTTP or large-file workload. Compare repeated runs on the same machine and avoid treating a single before/after timing as a guaranteed speedup.

The writer now reuses one locked directory snapshot for temporary cleanup and physical quota calculation, eliminating a duplicate enumeration. It still checks file sizes and synchronizes publication. Metadata checks grow with file count; replacing them requires crash-safe accounting and reconciliation rather than an unverified in-memory cache.
