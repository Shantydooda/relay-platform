# Continuous integration

Relay's GitHub workflow is intentionally separate from the published demo and
hosted staging environments. It does not deploy, read provider credentials, call
Stripe or mutate Supabase. Every job starts from a clean checkout and the exact
dependency graph in `package-lock.json`.

## Pull requests

Every pull request runs two required job groups:

1. **Core and browser contracts** — backend, policy, SDK, runtime, browser syntax
   and UI contract tests.
2. **Native PostgreSQL and recovery** — production migrations, role boundaries,
   concurrency, restart, backup/restore and recovery tests using an isolated
   PostgreSQL cluster created by the test fixtures.

Both jobs fail if a test rewrites tracked source. The workflow has read-only
repository permission and receives no Relay provider secrets.

## Main and manual runs

Pushes to `main` and manually dispatched runs add the 60-second `limits` and
`steady` load profiles after the two core job groups pass. These profiles are
evidence about bounded local behavior, not a hosted capacity guarantee.

## Repository settings required before release

In GitHub branch protection for `main`, require pull requests, one human approval,
and successful `Core and browser contracts` plus `Native PostgreSQL and recovery`
checks. Do not allow administrators to bypass these requirements for releases.
Keep production deployment in a later, separately approved workflow with an
environment gate; CI must not implicitly become deployment authorization.

Dependabot opens bounded weekly npm updates and monthly GitHub Actions updates.
Each update remains subject to the same review and tests.

## Production dependency advisory gate

The core job runs `npm audit --omit=dev --audit-level=high` after installing the
locked dependency graph. High/critical advisories or an audit-service error fail
the job; fixes must be reviewed rather than automatically forced. Lower-severity
advisories remain visible in output but do not block this gate. The local audit
reported zero known vulnerabilities on 3 November 2026. This new workflow step
has not yet run remotely. Advisory coverage is not an independent security review
and excludes vendored code, application logic and development dependencies.

## Verification status (3 November 2026)

Pull request #2 passed both job groups in run 41542521788 after bounded
object-storage contention retries were added. Manual run 41546654028 was
started to exercise the additional load profiles. Core and recovery passed, but
both load jobs failed before exercising load: their fresh runners lacked local
PostgreSQL configuration. Each load job now installs PostgreSQL and bootstraps its
own isolated cluster, just like the recovery job. Full remote revalidation passed
in run 41548550992 on commit dbd25d1: core, native recovery, limits load and steady
load jobs all succeeded. No deployment or merge was performed.

Local release check 9c48f427-eaaf-417f-b908-b4b4e9aa9e35 passed 350 backend,
85 web/shared UI, 32 native recovery checks and both 60-second load profiles,
with no skips or source mutation. A subsequent mobile alignment adjustment passed
the web suite again and is included in the successful remote run.

Branch protection remains unavailable on the current private-repository plan
(GitHub returned HTTP 403). Passing checks are therefore not an enforced merge
gate. Keep human review and explicit release approval until protection is enabled.

The local personal sidebar now replaces the generated workspace name with the
Relay face. Company names and roles remain visible. All 85 web/shared UI checks
pass; live visual QA is outstanding because browser control is unavailable.
