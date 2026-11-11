# Private hosted pilot preparation

11 November 2026. Deployment requested; **not deployed**. Localhost, the published
demo and existing staging remain separate. The prior free-only spending constraint
still applies; no paid resources or additional recipients have been authorized.

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
