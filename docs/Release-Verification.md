# Local release verification

Run `npm run verify:local` from the repository root. This does not deploy, connect Stripe, change staging/demo, or certify production readiness.

## Prerequisites and sequence

Use the supported local Node environment with dependencies installed and native local PostgreSQL running. Native recovery tests also require the locally installed PostgreSQL utilities. The command runs these checks sequentially to avoid load tests distorting each other:

1. Backend, policy, contract and runtime regressions.
2. Web syntax and UI component regressions (not browser automation).
3. Native PostgreSQL concurrency, restart, recovery and admission tests.
4. A 60-second mixed workload exercising quota exhaustion.
5. A 60-second steady mixed workload.

Native/load suites create disposable databases and temporary fixtures. They do not use buyer records in the running local application. Model inference and ClamAV end-to-end checks remain the separate opt-in `node services/model-runtime/eval/local.cjs` evaluation; this command does not silently download or start a model.

## Evidence and failure behavior

Every run has a private directory under ignored `.poc-data/release-checks/`. Its JSON report includes elapsed times, exit codes, test counts, failures/skips/cancellations, stage log names and a SHA-256 fingerprint of tracked and untracked non-ignored source files. Deleted tracked files and symlink targets affect that fingerprint. Ignored runtime files, databases, secrets and reports are excluded. The same source fingerprint is checked at the end; editing source during verification invalidates the run.

Logs have mode 0600 and the run directory mode 0700. They stay local; do not publish them without reviewing their contents. The summary does not include environment variables, credentials or raw test output. Stripe key variables are removed from child environments. This is not a general network sandbox: suites must continue using only explicit local resources/fixtures.

A successful exit requires every stage to exit successfully, produce test-count evidence, and report no failures, skipped or cancelled tests. A timeout, missing test evidence, source change or cancellation cannot pass. Ctrl+C stops the current process group and records incomplete verification. Stage timeouts first send TERM, then KILL; after forced termination, inspect disposable database/process leftovers before retrying. Unexpected runner or filesystem errors exit unsuccessfully and may prevent report creation. Ordinary failed test stages do not suppress later diagnostic checks.

The exit code indicates **local checks**, not permission to release. Every report explicitly sets `productionReady: false` and lists outstanding external/human gates. These gates are deliberately not auto-cleared by a passing test run.

## What remains outside this check

- Managed-auth/hosted parity, real Google credentials and actual Stripe sandbox reconciliation.
- Independent third-party supplier integration.
- Cross-role browser, mobile and accessibility QA.
- Independent security, payment and operational review.
- Hosted load, production traffic sizing, monitoring/alert delivery and deployment rollback exercises.

These local workloads are regression exercises, not proof of production throughput. This command is a reproducible local release check, not a CI deployment pipeline.
