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
