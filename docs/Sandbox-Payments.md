# Operator onboarding and sandbox settlement

28 October 2026 — local integration, provider connection deferred by the founder.

## Acceptance criteria

- Operator identity/payout onboarding is provider-hosted, separate from per-capability qualification. Relay never collects identity documents or bank credentials.
- No live keys, real money, staging changes, demo changes or synthetic financial records in the user's database.
- Funding binds the selected offer, scope, input hash, USD amount and operator. Scope/input/selection and unpaid execution cannot bypass pending or confirmed funding.
- Reserve every provider mutation durably before network I/O; reuse its provider key on retry; do not hold database locks during network calls. Duplicate or late responses must not double settle or regress state.
- Refund only before transfer for unstarted, cancelled or failed work. Transfer only after the buyer accepts the exact current delivery. Transfer and payout are distinct.
- A return URL never proves verification, payment or payout. Retrieve provider objects and validate identity/amount/status.

## Implementation and boundaries

`services/application/src/payments.cjs` owns application authorization and transitions using the shared transactional repository. Existing JSON document storage needs no schema change. Task locks serialize funding with scope, offer, execution and delivery changes. Operator records use per-owner creation locks. Past expired/refunded settlements are archived before a new funding attempt.

`services/payments/src/stripe-sandbox.cjs` is the outbound adapter: Stripe Connect Express accounts and onboarding links, hosted Checkout, refunds, separate transfers and connected-account manual payouts. API version is pinned to `2025-02-24.acacia`. Only test secret keys and localhost return URLs are accepted. Provider response fields and test-mode markers are checked where the API supplies them. Accounts and refunds do not expose `livemode`; test credentials and matched object references bind those operations. The server does not send keys to agents, browser assets or logs.

The local launcher accepts an optional server-only `RELAY_STRIPE_SANDBOX_KEY`. It is currently unset. There is no fake provider setting, key-entry UI or live-mode switch. Test doubles are dependency-injected only in isolated automated/browser fixtures. Do not put a key in source control, chat or shell history. Configure secure local credentials in a later authorized setup session.

### Local authenticated routes

All mutations use the existing Origin/session/CSRF protection. Consequential commands require an Idempotency-Key. Task commands require expectedVersion.

| Route | Method | Meaning |
|---|---|---|
| `/api/payments/status` | GET | Connection and current operator sandbox readiness; livePayments always false |
| `/api/payments/operator` | POST | Reserve/create operator and return short-lived onboarding link; body country |
| `/api/payments/operator/refresh` | POST | Retrieve provider requirements and payout readiness |
| `/api/tasks/:id/payments` | GET | Participant-visible sandbox status and control journal |
| `/api/tasks/:id/payments/fund` | POST | Reserve exact agreement and create Checkout |
| `/api/tasks/:id/payments/checkout` | POST | Buyer-only pending Checkout link |
| `/api/tasks/:id/payments/reconcile` | POST | Resume uncertain operation or retrieve authoritative status |
| `/api/tasks/:id/payments/refund` | POST | Full refund of eligible funding |
| `/api/tasks/:id/payments/transfer` | POST | Selected operator transfers accepted earnings to connected balance |
| `/api/tasks/:id/payments/payout` | POST | Selected operator requests payout from that balance |

Existing `/authorize-local` accepts explicit `stripe-sandbox` mode only with confirmed funding and fresh operator readiness; `local-unpaid` remains a separate, unfunded path. Commercial eligibility remains false. Sandbox readiness is not real identity verification.

### Policies for this increment

USD only, $0.50–$1,000 per test task. Zero Relay fee is a **test policy**, not validated unit economics. Fresh operator readiness is required within five minutes for funding, starting, transfer and payout. Only workspace owners fund/refund; employee budget approval is still a later increment.

Pending Checkout expires at the provider. Cancellation of a return page does not release the agreement; reconcile expiration before replacing it. Refund pending is not refunded. Transfer confirmed is not bank payout. Failed refunds/payouts remain review states rather than silently generating replacements. A provider mutation with an unknown outcome older than 23 hours stops for manual reconciliation, ahead of Stripe's minimum 24-hour idempotency retention. No unsafe automatic recovery command is supplied.

The append-only task control journal records matched debit/credit amounts and provider references for funding, refund, transfer and payout confirmation. This is **not a complete production general ledger**, fee accounting or bank reconciliation system. It does not model provider fees, disputes, reversals, balance availability by source, outside-dashboard changes or FX.

## Validation and remaining work

Automated tests cover SQLite and PostgreSQL-compatible storage, competing funding commands, duplicate retries, response loss, restart, stale provider responses, stale readiness, foreign actors, employee restrictions, scope locks, unpaid bypass, refund and payout failures, provider amount mismatch and live-key rejection. Native PostgreSQL checks use separate pools and recover funded agreements/control-journal entries after crash and backup restore.

Browser QA uses a disposable native PostgreSQL database and an isolated provider double: buyer posts, real local CSV agent bids, buyer selects, test funding is confirmed, runtime creates real files, buyer accepts, builder transfers, requests payout, reconciles confirmation, and reloads. This validates Relay's orchestration/UI, **not Stripe integration**. No identity or bank data is entered and no actual provider calls are made. Browser viewport checked on desktop; mobile-specific QA remains outstanding.

Before connecting Stripe: validate the pinned API version and Connect platform eligibility, country/currency rules, sandbox identity fixtures, hosted return flow, insufficient balance and asynchronous failures against the actual account. An operator recovery console, post-transfer refunds/reversals, partial refunds, disputes, tax/fees, production accounting, automated payouts and independent human review remain release gates. Automatic reconciliation now supplements the authenticated manual check, as detailed below. Live payments cannot be enabled here.

Sources checked against official documentation: [Connect testing](https://docs.stripe.com/connect/testing), [account links](https://docs.stripe.com/api/account_links/create), [refund object](https://docs.stripe.com/api/refunds/object), [idempotent requests](https://docs.stripe.com/api/idempotent_requests), [payouts](https://docs.stripe.com/api/payouts/create), [webhooks](https://docs.stripe.com/webhooks).

Final local evidence: 118 core tests, 19 native PostgreSQL tests and 17 frontend tests passed; the web command also reran 5 shared UI tests already counted in core. Syntax and whitespace checks passed. Self-review corrected a duplicate response field, separated sandbox labels from unpaid execution labels, and checked provider-field assumptions against Stripe's refund schema. The browser payout confirmation survived reload. The disposable QA database was removed and the main localhost app restarted after an offline paired backup. Independent human review and actual Stripe sandbox validation remain outstanding.


## Signed webhooks and automatic reconciliation — 28 October 2026

Stripe remains disconnected. The local launcher only enables the receiver when a test provider key and `RELAY_STRIPE_WEBHOOK_SECRET` are explicitly configured. `POST /api/webhooks/stripe` accepts bounded raw JSON, verifies the timestamped HMAC signature (five-minute tolerance), rejects live events and commits a minimal durable inbox before acknowledging. No raw event body, identity details or bank information is retained. Duplicate event IDs are idempotent; conflicting identities are rejected.

Supported snapshot events cover connected account updates, Checkout completion/expiration/asynchronous results, refunds and payouts. Events are hints: provider objects are matched to stored settlement references and connected-account scope, then canonical provider state is retrieved. Payload status alone never releases funds. Early events retry until their object reference is saved; unknown references eventually stop as unmatched.

A background worker checks persisted jobs without requiring the browser to remain open. Bounded cursor scans, per-job leases, provider idempotency keys and persisted backoff support competing workers and process restarts. Transient failures retry up to twelve times; ambiguous old mutations and contradictory terminal payout states stop for review. The original journal is preserved. The UI distinguishes automatic updates, retrying and needs-review states. New money actions and task starts are blocked for review-required settlements.

The worker can resume an already-authorized operation; it cannot authorize a new refund, transfer or payout. Delivery acceptance alone still does not initiate payout. Pending states are normally checked every fifteen seconds, with bounded batch scheduling; this is not a production latency guarantee. Disconnected mode performs no provider calls.

Validation: 128 core tests, 19 native PostgreSQL tests and 18 frontend tests passed (the web command also reruns five shared tests counted in core). Coverage includes raw signature tampering and age, live-event rejection, duplicates, account mismatches, out-of-order arrival, lost responses, retry limits, lease recovery, concurrent workers, pagination and backup restoration. An isolated localhost browser walkthrough confirms automatic funding and payout updates around real CSV execution and accepted delivery, without using the manual payment-check button. The fixture provider makes no Stripe calls.

Remaining gates: actual Stripe sandbox and webhook forwarding tests, snapshot/API-version compatibility, provider account eligibility, operational alerting and a reviewed recovery console, inbox retention policy, external-dashboard adjustments, disputes, post-transfer refunds/reversals, production accounting and independent human review. No tunnel, hosted deployment or real payment is enabled.

## Payment recovery dashboard — local operations

The account menu exposes **Payment recovery** only to server-configured operations identities (`RELAY_PAYMENT_RECOVERY_USER_IDS`, comma-separated local user IDs). Default access is empty; neither workspace ownership nor a client-supplied role grants access. No permission is granted to real users by fixture setup. The route `#payment-recovery` survives reload. The screen reuses the prototype-aligned workspace, typography, panels, tags and form controls.

`GET /api/payments/recovery?after=…` lists 25 checks per page, including errors, attempts, last/next check, provider references and review history. `POST /api/payments/recovery/retry` requires CSRF, an idempotency key, exact snapshot and a 10–500-character review reason. Its transaction locks the same job as the worker, rejects a stale snapshot or active lease, records the reviewer and prior failure evidence, then schedules the original operation. Concurrent requests cannot schedule duplicate recovery actions. Retry cooldown is one minute. Unknown old mutations and contradictory provider outcomes cannot be reset through this dashboard; there is no “mark paid” or replacement-payment override.

Stripe stays disconnected in the ordinary localhost app. Recovery was exercised with an isolated provider fixture, not real Stripe. Tests cover SQLite/PGlite, permissions and revoked access, duplicate and competing retries, stale state, blocked discrepancies and leases, plus native PostgreSQL separate-pool races and restoration of audit records. The browser walkthrough queued a retry, observed funding recover automatically and kept a discrepancy blocked. Mobile-specific visual QA, actual provider sandbox validation, step-up auth, global queue prioritization, full audit export/retention and discrepancy-resolution procedures remain production work. Audit history currently shows up to ten entries from a bounded read of 100 records per job.

Recovery increment evidence: 133 core tests, 19 frontend tests (plus five shared UI reruns), and 19 native PostgreSQL tests passed. Self-review and whitespace checks completed. Browser QA verified the guarded retry, automatic confirmation, persisted review note and refresh navigation. These are engineering checks, not independent payment/security certification.

### Funding/refund/payout cross-workspace QA — 28 October 2026

Five isolated browser scenarios cover delayed funding, refund and payout checks, plus provider-declared refund and payout failures. The three delayed checks recover via the operations dashboard, using existing references; buyer conversations and builder earnings show the corresponding confirmed state on the same task. Confirmed failures remain blocked with specific refund/payout review labels. Builder “Needs attention” now links directly to the affected earnings card.

Fixed a shared-state bug where a successfully retrieved failed refund/payout could leave its reconciliation job scheduled. Terminal failures now atomically enter review during indexing and remain in review when the worker finishes. This also backfills previously saved failures. Regression tests exercise recovery through real application commands and compare both participants' payment views, with no new provider mutation calls. Browser fixtures seed payment checkpoints in disposable storage; they do not prove real Stripe behavior or a full execution lifecycle for every seeded task.

Core regression: 138 passed. Frontend: 20 passed, plus five shared UI reruns. Native PostgreSQL checks cover concurrent recovery and backup restoration. Mobile and actual provider validation remain outstanding. No demo/staging changes or real transactions.

## Local Stripe test connection — 5 November 2026

The founder authorized connecting Stripe for localhost testing. The existing
account's **Test mode sandbox** is connected; live business activation and its
country selection were not changed. A CLI-created claimable sandbox was also
provisioned, but Stripe required an activated parent to claim it. It remains
unused, is not connected to Relay, and expires on 12 November 2026. Do not confuse
its temporary credentials with the active account's permanent test credentials.

Local credentials and launch helpers are owner-only files under ignored
`.poc-data/stripe-local/`. No credentials were added to application source, hosted
staging, demo, GitHub or frontend configuration. The existing adapter still rejects
live keys. The existing webhook verifier rejects live events and invalid signatures.

From the repository root, run in separate terminals:

```sh
node .poc-data/stripe-local/run.cjs server
node .poc-data/stripe-local/run.cjs listener
```

Stop the existing server before starting another on port 4180. The helper pins
loopback port 4180 and reads only the local test key/signing secret. The listener
uses official `@stripe/cli` 1.55.8 installed at `/tmp/relay-stripe-cli`; reinstall
that tool in the same location if temporary files are cleared. Its output is
private because Stripe emits the signing secret on startup. No public tunnel or
hosted webhook destination was created. Both processes must be running for local
webhook delivery; plain `npm run start:local` without environment credentials leaves
Stripe disconnected. Review/refresh the signing secret if the CLI identity changes.

Provider smoke QA: actual Stripe test Checkout creation, same-key replay returning
the same session, awaiting-payment and expiry checks through Relay's adapter; a
simulated USD 1.00 PaymentIntent succeeded and was fully refunded through the
adapter; a decline test card failed as expected. Stripe Dashboard shows one failed
and one refunded USD 1.00 test payment. The expiry and refund events reached
`/api/webhooks/stripe` with verified signatures and HTTP 200. These standalone
provider smoke objects are not funded Relay tasks or synthetic ledger records.

29 payment, reconciliation and recovery regression tests passed using isolated
fixtures. Browser evidence: `/tmp/relay-stripe-test-payments.png`. The local Relay
session expired during UI verification, so signed-in Relay UI confirmation remains
pending login. Full buyer funding → execution → delivery → Connect transfer/payout
QA remains open; this connection and provider smoke test do not close that gate.
No real money, real card/bank details, deployment, demo or staging changes.

### Connect and funded delivery rehearsal — 5 November 2026

Using an isolated localhost fixture on port 4183, hosted Stripe test Connect
onboarding completed with Stripe-provided test identity and bank details. Relay
confirmed recipient readiness and manual payouts. A USD 1.00 Checkout payment
succeeded, funding was reconciled, and the connected CSV runtime processed a real
fixture file and delivered it; the buyer accepted that delivery. The builder
earnings view correctly remained pending, with zero paid.

Transfer failed: the German platform settled the charge in EUR, while the current
adapter requests USD transfers. No transfer or payout was completed. The adapter
now blocks funding before Checkout creation unless both accounts have USD default
settlement currency. This is a conservative restriction, not multi-currency or FX
support. A compatible settlement setup or explicit currency-aware settlement is
still required to finish end-to-end payout QA. The earlier funded fixture remains
isolated and unresolved; no ledger state was rewritten to claim success.

New Connect accounts now use Accounts v2 (2026-10-28.endive), with v1 interop for
onboarding links and manual payout settings. Creation and settings use separate,
stable idempotency keys. Unresolved legacy creation operations require reconciliation
before changing API generations, avoiding duplicate recipient creation.

All 34 payment/reconciliation/recovery regression tests passed. The full local
verification run c98a89a5-231d-4968-bd70-21a640cf4793 timed out during its backend
stage and is not green; source also changed during that run. The isolated flow used
explicit canonical reconciliation, not the main port 4180 webhook listener, so an
automatic webhook-driven funded-task/payout rehearsal remains open. Localhost 4180
was restarted with these fixes; demo and staging were not changed.

Browser evidence: `/tmp/relay-test-funded-delivery.png` and
`/tmp/relay-test-builder-payout-pending.png`.

### Currency-aware sandbox settlement (2026-11-05)

Individual one-off offers and runtime quoting rules support explicit USD or EUR.
Legacy records remain USD. The accepted offer fixes the currency for Checkout,
refunds, transfers, payouts and ledger movements. Changing an agent's quoting
currency requires a fresh compatible offer before execution. Company budgets,
recurring work and orchestration remain USD-only; no FX conversion is implemented.
Funding requires matching platform and recipient settlement currencies, and the
transfer adapter also checks the charge's actual settlement currency before writing.

History, CSV snapshots and builder earnings separate currencies. CSV pages must
match the snapshot currency and totals; they cannot be combined across currencies.
A real EUR sandbox Checkout and full refund were reconciled, and a second runtime
EUR task produced and accepted an actual normalized CSV. Transfer/payout completion
and automatic webhook evidence must be recorded separately after provider testing.
The earlier USD fixture is preserved for recovery review, not relabeled as EUR.

The complete backend suite passed 395 tests with concurrency bounded to two test
files (272 seconds). The release-check backend deadline is now ten minutes to
accommodate that measured run; timeouts still fail the check. Focused currency and
recurring regressions also passed. These checks do not establish live-money readiness.

### Automatic webhook rehearsal — 6 November 2026

Used the existing disposable QA database on localhost:4183, a separate Stripe CLI
sandbox listener, the production signature verifier, and the production bounded
payment reconciliation worker. The main PostgreSQL app remains on localhost:4180;
no demo/staging configuration was changed.

- A new EUR 1.00 Checkout produced a real `checkout.session.completed` event.
  Stripe CLI delivered it with HTTP 200. The durable inbox scheduled reconciliation,
  and the background worker confirmed funding with one EUR 100-minor-unit entry.
  No manual reconciliation command was used for this funding transition.
- A normal Relay refund command produced real `refund.created` and `refund.updated`
  events, both delivered with HTTP 200. The worker confirmed the refund; the buyer
  chat changed from “Refund pending” to “Refund confirmed” without a refresh action.
- The actual Checkout event was retrieved from the test API and replayed with the
  local listener secret to exercise duplicates. These are locally signed replays,
  not a claim of provider redelivery. Both replays were deduplicated. Invalid and
  stale signatures, live-mode events, and conflicting event IDs were rejected.
- Repeated the replay after restarting the QA server. The persisted task retained
  exactly one funding and one refund, each EUR 100 minor units, and one inbox record
  for the Checkout event. All 36 payment/reconciliation/recovery regressions passed.

The earlier accepted-delivery payout is still incomplete: the connected test
account has EUR 0 available and EUR 1 pending. Stripe reports availability on
12 November 2026 at 00:00 UTC (01:00 Europe/Berlin). There is no payout object or
confirmed payout ledger entry. Existing bounded recovery retries retain the same
operation; they must not be replaced with a newly invented payout. If recovery
has escalated or the operation's idempotency window has elapsed by then, use the
recovery review procedure and inspect provider state before retrying. No promise
of an unattended payout on that date is made.

Remaining provider gate: actual connected-account payout completion and its
webhook-driven reconciliation. Funding/refund webhook QA is now verified; this
is not evidence that the payout gate is complete.

Browser evidence: `/tmp/relay-webhook-refund-confirmed.png`.
