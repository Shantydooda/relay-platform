# Private hosted pilot preparation

Updated 12 November 2026. **The separate pilot application is deployed; hosted
buyer-to-builder execution is not activated.** Storage/scanner activation, invited
accounts and the full hosted rehearsal remain pending. Localhost, demo and staging
remain separate. Free-only spending and test-only payments still apply.

Earlier entries below are dated implementation history; see the latest supervised
scanner and acceptance entries for current limitations.

## Completed in this increment

Supplier SDK accepts an exact HTTPS origin while retaining explicit HTTP loopback
compatibility. Canonical origin validation rejects credentials, paths, queries,
fragments and insecure remote HTTP. Redirects are never followed. Authentication
stays in headers; command retries retain the same bytes and idempotency key.
Standard TLS certificate verification remains enabled. Twenty-six SDK checks
passed, including a real TLS server with an untrusted certificate: zero HTTP
requests/credentials reached its handler. Positive HTTPS command/retry cases use
injected transport fixtures; no live pilot endpoint is claimed tested.

## Audit: why the existing staging blueprint must not be reused

- `services/staging-api/src/server.cjs` uses the earlier managed accounts/task store.
  It does not launch the full unified application or its workers.
- `unified-managed.cjs` provides a tested composition but no hosted launcher invokes
  it. Membership production, refresh, startup readiness and shutdown need wiring.
- Supplier credentials/execution currently require `localExecution`; the HTTP app
  deliberately rejects that flag under managed HTTPS. Do not remove this guard as
  a deployment shortcut. Introduce an explicit pilot execution policy, with tests
  for invitation/operator revocation, supplier scoping and test-only settlement.
- The native PostgreSQL opener is loopback-only. Hosted connections need a separate
  TLS-verifying adapter, dedicated database identity and applied migration record.
- Deliveries use local disk and ClamAV. Free Render disks are ephemeral; a hosted
  pilot requires durable private object storage and a real scan worker. Quarantine
  must fail closed through worker outages and restarts.
- Existing staging email used a domainless sender restricted to the account owner.
  A new builder cannot be assumed to receive verification/reset mail. Resolve this
  before admitting a second identity; never disable verification to bypass it.

## Proposed isolated environment

Use distinct `relay-pilot` service/project identifiers, database, object storage,
Supabase Auth project, session encryption key and supplier credentials. No local
or staging users/data are copied. Keep exact HTTPS callback origins, before-user-
created invitation enforcement and database authorization. Publicly reachable
login does not mean public task or supplier access. Keep supplier APIs authenticated,
not gated behind an interactive browser login page.

Configure only Stripe test credentials and a pilot-specific test webhook. Do not
reuse the staging service or local webhook destination. No paid entitlement is
inferred from test funding. Bootstrap only explicitly approved tester addresses.

## Before provisioning

Sign in to Render and Supabase in the prepared tabs. Inspect free resource capacity
without modifying existing projects. Confirm hosting can support durable storage,
scanner and background workers; otherwise present an exact resource/cost proposal
before provisioning anything paid. Render Free sleeps after idle and cannot attach
persistent disks; Supabase Free has two active-project capacity and inactivity
pausing. Sources checked 11 November 2026:
https://render.com/docs/free and https://supabase.com/pricing.

## Hosted acceptance gates

1. Dedicated configuration rejects missing keys, wrong environment and live payment keys.
2. Uninvited signup and direct provider signup fail; verified invited users can log in/reset.
3. Two independent identities cannot read each other's private tasks/files/keys.
4. Builder obtains pilot-only supplier key; HTTPS heartbeat, qualification and quote work.
5. Buyer selection and permission gates precede execution; revocation stops new commands.
6. Actual delivery survives restart, is scanned before download, revised and accepted.
7. Test funding/refund/payout reconciliation uses pilot-only endpoints and ledger evidence.
8. Database/object backup restore and worker outage recovery are rehearsed before invitations.

Current blockers are unfinished hosted composition, durable file/worker hosting, and invitation/email configuration. A
successful SDK HTTPS test or creation of an empty hosting service closes neither.

Verification: full backend regression after HTTPS changes passed **774 tests**, with
zero failures, skips or cancellations. Localhost returned HTTP 200. No browser
buyer/builder pilot walkthrough is claimed because no pilot endpoint exists yet.

## Provider access and database boundary — 11 November 2026

Both provider dashboards are signed in. Supabase lists `relay-staging` and
`NewC24`; neither was modified. A new `relay-pilot` form is prepared in North
Virginia with automatic new-table exposure disabled. Password entry/submission
is handed to the owner. If free project capacity blocks creation, stop without
upgrading or changing existing projects. No new project is yet confirmed created.

Added a separate hosted PostgreSQL opener (not wired into a launcher yet). It
requires an explicit project reference and exclusion list, restricts connections
to matching Supabase direct/session-pooler identities on port 5432, verifies TLS,
bounds the pool/timeouts, and refuses implicit migration at startup. Three local
unit checks passed for options, wrong-environment rejection and sanitized startup
failure/cleanup. These are fixture checks, not a live database/TLS acceptance test.

### Pilot project created and closed to public signup

Verified in the provider UI: `relay-pilot`, project `nnxtpkksvurcrajyjqmn`,
North Virginia (`us-east-1`), Healthy, organization shown as Free. No migrations
or backups were present at inspection. Public signup was disabled and saved;
email confirmation remains enabled and anonymous sign-in remains disabled.
This is a closed setup state, not a verified invitation-only onboarding flow yet.

The provider displayed the free session-pooler connection at
`aws-1-us-east-1.pooler.supabase.com:5432`, database `postgres`, user
`postgres.nnxtpkksvurcrajyjqmn`. Prepared owner-only ignored local connection
metadata and a separate blank password file in `.poc-data/pilot/`. Owner password
entry is pending. Existing projects are explicitly excluded in that metadata.
No database connection, migrations, Render pilot deployment, credential transfer,
email invitation or payment action has been performed in this step.

### Verified pilot database migrations — 11 November 2026

The owner supplied the password through the ignored owner-only file. Connected
successfully through the pilot session pooler with certificate and hostname
verification enabled, using the official Supabase root certificate. SSL enforcement
is enabled in the pilot dashboard. No TLS bypass was introduced.

`node services/pilot-api/scripts/database.cjs migrate` applied four provider and
four unified application migrations. A second live run applied zero migrations;
checksums matched and both anonymous/authenticated browser roles lacked USAGE on
`relay_private`. The command pins the pilot project and excludes staging and NewC24.
Credentials are not logged. Each migration group is transactional and resumable;
the provider and application groups have separate history tables.

Four focused tests passed, including full provider SQL application, replay,
changed-history rejection, failed-batch rollback, browser-role isolation, and
hosted configuration guards. `git diff --check` passed. These checks do not prove
full hosted application operation. No Render pilot service, SDK-to-pilot round
trip, hosted scanning worker, invitation flow or pilot payment flow is live yet.
The database password has not been transferred to Render. Localhost, demo and
staging were not changed by these migrations.

### Application composition prepared — 11 November 2026

Added a separate pilot launcher and strict project/origin configuration. It uses
the existing unified managed application, signed access feed and durable provider
cursor/outbox. Membership capture and conversation recovery run in-process; startup
checks provider availability and captures trusted access before listening. Login
bootstrap waits for membership capture. Shutdown uses the existing HTTP command
drain and closes workers before the database. Supplier execution, scanning,
schedules and payments are not enabled by this launcher.

Render's new-service form is prepared for `relay-pilot-app`, Virginia, Free,
`codex/v1-production-foundation`, `npm ci`, and the pilot launcher. Owner authorized
pilot credential transfer. An ignored owner-only environment file was imported;
the server secret API key is not configured. The service has NOT been deployed.
No invitation hook, callback/email configuration or live signup walkthrough is
claimed complete. Continue from the preserved provider tabs after source review.

Checks: 781 backend tests passed; browser module checks passed; 12 focused tests
passed after final composition review. Tests use local fixtures. The initial
restricted backend attempt could not bind localhost test ports; the authorized
rerun passed. No staging deployment or live-money action was performed.

### Free supervised pilot — 12 November 2026

The earlier prepared-service status above is superseded: the dedicated free
`relay-pilot-app` Render application is deployed at
https://relay-pilot-app.onrender.com using the separate pilot database. The
Supabase Before User Created invitation hook is enabled. Public signup remains
disabled until the authorized pilot identities, email delivery and callback path
are verified. Unauthenticated account/task requests return 401. This does not
prove authenticated end-to-end delivery.

The owner selected free, supervised processing. Do not provision paid workers,
reuse localhost data, or use staging/demo infrastructure. The application may
sleep; hosted execution must wait safely when the supervised scanner is offline.

Prepared in source (not yet deployed):
- Managed supplier connection/qualification/test quoting, independent of the
  localhost execution switch. Runtime execution and payments remain disabled.
- Async object reads through scanning, download, acceptance, handovers, app
  installation and Attio delivery; synchronous localhost storage remains valid.
- A pilot-only private Supabase object adapter with immutable content hashes,
  bounded reads, timeouts, no redirects, and integrity verification on replay.
- `services/pilot-api/scripts/prepare-storage.cjs` provisions only the dedicated
  pilot bucket using private environment credentials. It refuses an existing
  public or incorrectly sized bucket. No browser object-read policies are added.
- Set `RELAY_PILOT_STORAGE=private-bucket` only after preparation. Startup verifies
  the private bucket. This setting alone does not enable execution or payments.

Still required before the first independent task:
1. Provision/verify the private bucket against the actual provider, including
   anonymous read denial and restart/retrieval checks.
2. Connect a separately configured supervised pilot scanner, with durable claims,
   retries and an offline state. Never mark unscanned files clean.
3. Add narrowly scoped hosted execution authorization and qualify the pilot's own
   test-payment webhook before enabling payments. Do not reuse localhost's flags.
4. Configure exact pilot auth callbacks and an email route that can reach both
   invited testers; confirm their identities before granting access.
5. Deploy reviewed source and walk through signup, qualification, offer selection,
   execution, revision, scanned delivery, acceptance and access revocation.

Local fixtures validate async upload/scanning/download, corrupted objects,
unauthorized downloads, oversized streams, concurrent duplicate uploads and
connection revival. Fixture success is not evidence of hosted storage or ClamAV
operation. Provider browser controls were unavailable during this follow-up;
provider configuration and authenticated browser QA remain outstanding.

Validation for this increment: 787 backend checks passed; 174 browser-module and
8 shared UI checks passed. The final storage and pilot-config focused checks each
passed 4 tests. Diff whitespace and launcher syntax checks passed. Localhost was
not listening at the final health check; it was started using its existing local
configuration and reported native PostgreSQL with real-money payments disabled.
No source push or pilot deployment was performed in this follow-up.

### Supervised scanner prepared — 12 November 2026

Use the separate owner-only `.poc-data/pilot/storage-secret.txt` for the pilot
Supabase server key. The supervised launcher loads only the pilot's private files,
not payment or provider credentials inherited from a localhost shell. It rejects
missing keys, symlinks and group/world-readable credentials. The scanner settings
have a separate pilot configuration; the installed ClamAV binary/signature files
may be shared, but application databases and artifact buckets are not.

After credentials are supplied:

```
node services/pilot-api/scripts/prepare-storage.cjs --supervised
node services/pilot-api/scripts/supervised-scanner.cjs
```

The worker verifies private bucket configuration and runs clean/EICAR scanner
self-tests before starting. It runs the existing durable scan-claim reconciler,
opens no HTTP listener, and cannot enable payments or task execution. Shutdown
waits for its current scan before closing the pilot database. A private
`scanner-health.json` includes a timestamp and worker state; an old timestamp is
not evidence of a running worker. Offline processing leaves files quarantined.

Real installed ClamAV evaluation passed when run with the required local process
permissions: clean CSV, harmless EICAR, missing signatures, timeout, application
scanning, blocked downloads and blocked acceptance. The initial restricted run
failed closed. Fixture tests cover startup refusal, async remote storage scanning,
resuming quarantined delivery, unchanged assignment/ownership and private-file
checks. These are not yet a live invited buyer-to-builder walkthrough.

Activation is still pending the pilot storage key, authorized tester emails,
provider configuration/deployment access, and the separately guarded hosted
execution/payment work described above. No hosted bucket or scanner is claimed
active solely because these scripts and fixtures pass.

Validation: 790 backend tests passed, plus the final 3 focused supervised-worker
checks after credential-file read hardening. `git diff --check` passed. No source
push, provider activation, invitation grant or deployment was performed in this
increment; the pilot storage credential file is still empty.

### Unpaid supplier execution switch (added 17 Nov 2026)

The pilot can let buyers start agreed work with builders' supplier-hosted runtimes, with no payment. It is **off** until the operator turns it on in the Render service's environment:

| `RELAY_PILOT_UNPAID_EXECUTION` | Effect |
| --- | --- |
| unset or `disabled` | As before: quotes and selection only. |
| `enabled` | Buyers can start selected work (unpaid); runtimes claim, deliver and receive revision requests; buyers accept, request changes, pause, cancel or end as unmet; the outcome ledger and "try another agent" work. The execution sweeper runs, so deadlines and lost leases end runs. |
| anything else | The pilot refuses to start (`INVALID_PILOT_UNPAID_EXECUTION`). |

What stays closed even when it is enabled: payments (any Stripe setting still stops startup), local CSV processes, same-agent recovery, multi-agent plans, scheduled work, workspace apps, Drive, Attio and notifications. The code is `services/application/src/capabilities.cjs`; the pilot reads the variable in `services/pilot-api/src/config.cjs`.

Before turning it on:
1. Deploy a commit that contains the switch. Setting the variable on an older build does nothing.
2. Decide how delivered files are stored. With `RELAY_PILOT_STORAGE=private-bucket`, deliveries are quarantined until the supervised scanner marks them clean, so the scanner must be running or buyers cannot preview, download or accept. With storage disabled, deliveries are stored inline (text, JSON or CSV, up to 256 KiB per file).
3. Remember that a buyer's brief and attached input reach the selected builder's runtime once work starts. Invite only builders you trust with test data.

Turning it off again stops new starts. Work already running keeps its agreement; the buyer can still review, cancel or end it.
