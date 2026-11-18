# Contributing to Relay

Read [AGENTS.md](AGENTS.md), [current status](docs/Status.md) and the affected module guide before editing. Work on a `codex/` branch or an appropriately named review branch. Keep the demo, managed staging and local fixtures separate.

## Change workflow

1. Describe the concrete problem, expected behavior and affected trust boundaries.
2. Reuse authoritative application commands. Keep UI, business rules and provider I/O distinct.
3. Test meaningful failure paths: stale approvals, revoked access, duplicate requests, timeout/retry, cross-tenant access and competing writes when relevant.
4. Run focused checks, then `npm run verify:local` for a release candidate. Do not edit source while that runner fingerprints it.
5. For UI changes, inspect the actual browser flow, keyboard behavior, narrow layout and reduced-motion behavior where relevant. Automated UI contracts are not a browser walkthrough.
6. Review the diff and record exactly what was and was not verified. Open a PR; do not merge or deploy without the release decision.

## Data and credentials

Use disposable fixtures. Do not commit `.poc-data/`, `.env` files, credentials, customer files, database dumps or private logs. Do not put secrets in a PR body or screenshot. Do not force-push over someone else's work.

## Migrations and compatibility

Add forward migrations; never rewrite applied migration files. Document compatibility and recovery. Schema changes and API behavior belong in the same reviewed increment. Existing `poc-*` names are historical; renaming them is not required to ship v1 and must not break launch scripts.

## Verification commands

See [README](README.md#verification) and [release verification](docs/Release-Verification.md). CI runs core and native recovery for PRs; sustained load profiles additionally run on manual dispatch/main. CI does not deploy. Passing checks cannot replace independent security/payment/operational review.

## Performance claims

Record source revision, environment, dataset, concurrency, duration and error rate with every benchmark. Keep raw private reports out of Git. Compare before/after on the same workload; never advertise fixture throughput as customer capacity.
