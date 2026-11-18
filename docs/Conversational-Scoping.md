# Local conversational scoping and recurring responsibilities

28 October 2026. Local development only. The published demo and hosted staging are separate and unchanged.

## Acceptance criteria

A real local language model reads the buyer's saved conversation, preserves supplied constraints, asks only material missing questions and proposes a complete brief. Replies survive refresh. Questions and hypothetical changes do not edit the agreement. Only an explicit current-version confirmation changes scope and invalidates affected offers. Provider failure, stale replies, retries and restarts must preserve user messages and prevent duplicate changes. Recurring intent must never silently authorize schedules or charges.

## Implemented architecture

- `services/scoping/src/ollama.cjs` is an injected provider adapter. It accepts only a loopback HTTP origin, refuses redirects, sends a JSON output schema, limits concurrency/context/output/time and validates the returned object. No cloud API key or paid inference is used.
- `services/application/src/scoping.cjs` owns permission checks, durable jobs, immutable scope history and explicit confirmation. Inference takes place outside database transactions. Task version plus job ID fence stale responses. Retries reuse the same durable job; duplicate in-process or cross-process dispatch is fenced by a persisted running claim.
- An assistant reply has a server-owned role. Jobs, messages and adopted scope snapshots record provider/model settings and prompt/schema hashes for review. A one-off proposal with open questions cannot be confirmed or posted through the AI flow; the buyer must answer or explicitly edit/review the brief manually. Clients cannot mark themselves as Relay. User and assistant text are escaped by the UI; model text never executes tools, charges money, accepts offers or grants access.
- `POST /api/tasks/:id/assist` takes `{expectedVersion,message?}` with a durable idempotency key and returns 202 with `{jobId,taskId,version}`. The buyer reads job state, reply and proposal through the existing authorized task detail endpoint. Omitting `message` reviews existing context without duplicating it.
- `POST /api/tasks/:id/confirm-scope` takes `{expectedVersion,proposalId}` with a durable key. It adopts the exact reviewed proposal, increments the scope version, clears selection and preserves a scope snapshot. Current-assignment changes remain blocked.
- Both persistence adapters use the existing versioned document repository. No existing SQL migration was changed and no additional DDL is needed for these additive document fields/kinds. Native PostgreSQL tests exercise separate connections and competing confirmations.
- Completed/failed jobs drop their temporary context snapshot. The original task conversation remains the source of history. A crash leaves a pending/running claim that expires after three minutes; the user can retry on the same task without duplicating the saved message. There is no automatic model-job recovery daemon or unlimited retry loop.
- Conversation/context limits (30 messages, a bounded UTF-8 snapshot and a conservative provider token budget) fail honestly rather than silently dropping early constraints. A single local inference runs at a time; simultaneous requests may need retry. This is a local single-machine deployment, not a hosted inference queue.

## Local model setup

The official standalone Ollama v0.40.11 release was downloaded from the [vendor repository](https://github.com/ollama/ollama/releases/tag/v0.40.11) into ignored `.poc-data/tools/ollama`, with the published archive SHA256 verified: `aea7d3f2e32371b7644a6e2ec8d4f26820a0e3965918cce8a46cef3e947f6291`. Homebrew installation failed during dependency setup, so it is not the runtime used by Relay. Its partially installed dependencies are not application dependencies.

The selected local-development model is [Qwen3 8B](https://ollama.com/library/qwen3:8b), approximately 5.2 GB, Apache 2.0, with thinking disabled for interactive latency. Earlier Qwen3 4B and Qwen3.5 4B candidates failed accuracy/latency cases and were removed; valid JSON alone was not accepted as sufficient evidence. This Mac has 16 GB memory. Model files stay in ignored `.poc-data/models`. Downloads require network access; task inference uses `127.0.0.1:11435` only. `OLLAMA_NO_CLOUD=1` disables cloud features; the startup log confirms it. Ollama may create its own local identity/config under the user's standard `.ollama` folder. Do not expose this unauthenticated local service to a network.

Check free space before downloading weights, keep at least 4 GiB reserved for the application/OS, and remove rejected test models rather than accumulating them. The local disk filled during candidate evaluation; only newly downloaded test models and the installer archive were removed. Both main/QA PostgreSQL health checks and subsequent checkpoints were healthy after cleanup. No application database or backup was deleted.

Start the model service separately:

```sh
npm run model:local
```

Pull the selected model once with the standalone CLI and `OLLAMA_HOST=127.0.0.1:11435`. Configure ignored `.poc-data/scoping.json`:

```json
{"origin":"http://127.0.0.1:11435","model":"qwen3:8b","thinking":false}
```

Then restart `npm run start:local`. Without that file, Relay keeps manual brief review and does not claim AI understanding. If the service is unavailable, the conversation displays a retry/manual-review state; no fabricated response is substituted. Structured outputs follow the [official schema API](https://docs.ollama.com/capabilities/structured-outputs); [cloud disablement and cache configuration](https://github.com/ollama/ollama/blob/main/docs/faq.mdx) follow vendor documentation.

Run `npm run eval:scoping` against the actual local model. Fixtures contain synthetic data only; output records case pass/failure and latency. Failed outputs are printed for diagnosis, so do not replace fixtures with confidential user material in routine logs.

## Recurring work: product decision and remaining implementation

Relay supports the concept of one-off work and ongoing responsibilities. The conversation can identify daily, weekly, monthly or unclear recurring intent and propose the schedule, explicitly supplied IANA timezone, per-run budget and monthly cap. Missing fields remain missing. Buyers can save that plan as a **draft**, but recurring drafts cannot be posted to the current single-run execution protocol. Editing a brief manually resets the old work plan and requires a fresh scope review.

A recurring production agreement needs a deliverable and verification policy for every run, schedule/timezone/DST and month-end rules, start/end dates, missed-run/catch-up behavior, overlap/concurrency limits, per-run quote/price ceiling, monthly cap/currency/fees, required corporate approval, funding mandate, authorized supplier policy and pause/cancel controls. Each occurrence must create an independently traceable run with input/context snapshot, scope/quote/agreement versions, execution, submission, acceptance and reconciled settlement. Retries must not create another billable occurrence. Reserve the approved per-run amount and fees atomically against the monthly cap before dispatch so concurrent runs cannot overspend. Release reservations through an audited cancellation/refund policy. A corporate standing approval must bind to the exact agreement version and permitted run limits; exceptions need fresh approval.

“New leads each week” requires cross-run deduplication and freshness checks, not merely removing duplicate rows within one uploaded CSV. Automatic acceptance or external sends require an explicit standing verification/destination policy; a model's recommendation alone is insufficient. Each assigned supplier receives only the context and destinations authorized for that run.

Reassignment is not a silent optimization. A replacement supplier must satisfy the buyer's approved capability, data access, price and verification rules. If an agent change expands permissions, price or material terms, ask for approval. Marketplace remains the default; optional company agents do not automatically bid against builders.

Recurring work may improve retention and predictability, but economics remain unvalidated. Per-run pricing, platform fee, inference/tool costs, supplier margin, refunds and review/support effort require measurement. A 15% take rate or any revenue arithmetic in earlier concept discussion is illustrative, not an approved price model or evidence of profitability.

## Evidence and remaining gates

The final raw-model evaluation passed **15 of 16** synthetic cases with Qwen3 8B and thinking disabled. Complete/incomplete one-off requests, holdout constraints, attached input metadata, follow-up answers, corrections, price/hypothetical questions, contradictions, unfamiliar work, daily timezone gaps, weekly budgets, source injection and website output requirements passed. The model missed the short-month ambiguity for a recurring report on the 31st. This known gap remains in the evaluation as a failure; it was not relabeled as success.

The application adds a deterministic calendar-review notice and suppresses the model's unsupported “no additional details needed” readiness statement for recurring requests. Monthly plans explicitly warn about unavailable dates; all recurring plans remain inactive and cannot be posted to the single-run execution protocol. This is safe local advisory behavior, not scheduler acceptance or production model qualification. Broader unseen-data evaluation and recurring-calendar implementation remain required. Passing schema and persistence tests is not proof of conversational accuracy. This increment does not implement a scheduler, standing funding mandate, capability qualification, commercial payments or independent security approval.


### Final local evidence

- `npm test`: 105 passed. Includes real authenticated HTTP scoping, shared SQLite/Postgres behavior, stale/version conflicts, cross-account/CSRF/role spoofing denial, durable job claims across application instances, timeout/retry recovery, no-op scope confirmation, unanswered one-off blocking, calendar notices and model output escaping/validation.
- `npm run test:postgres`: 17 passed on a temporary native PostgreSQL cluster, including separate connections, competing scope confirmations, supplier HTTP execution, app/worker restarts, migration drift detection and paired backup restoration.
- `npm run test:web`: 15 frontend tests passed; 5 shared UI tests also passed (already counted in the core suite).
- Actual browser QA used disposable accounts and a separate native PostgreSQL database on port 4182. It covered a missing-detail conversation, a typed answer surviving the asynchronous reply with focus intact, a complete follow-up without repeated questions, unchanged-scope confirmation, automatic supplier bid, selected offer, explicit unpaid execution, actual CSV/report delivery, buyer acceptance and the builder's matching task/file/status history.
- Recurring monthly draft: saved schedule/unknown fields persisted through refresh, calendar/DST/missed-run notices remained visible, and no posting/start action was available. Desktop visual layout was inspected. Mobile visual emulation was not rerun in this increment.
- Main app restarted at `http://127.0.0.1:4180/`, with native PostgreSQL healthy and `scoping:true`. Existing user records were preserved. A paired recovery backup was saved before restart at `.poc-data/postgres/backup-1793209740801`. The main user was not signed into or modified for QA.
- Only the selected Qwen3 8B model remains in the dedicated model cache (local manifest ID `500a1f067a9f`). Ollama remains loopback-only with cloud disabled. The rejected test models were removed and disk space recovered. The isolated QA server, worker, accounts and database were cleaned up.
- Review covered authorization, claim/lock order, version/idempotency boundaries, no-op changes, model context/output bounds, source/prompt provenance, truthful assistant state, calendar gaps and unchanged migration history. This is engineering self-review, not independent security approval.

This completes the conversational-scoping portion of build-order step 3. Next: real capability assessment/test-job and revision evidence, then operator/commercial eligibility and provider-sandbox funding/ledger work. Broad artifact storage/scanning, SDK/MCP wrappers, a durable hosted inference queue and a real recurring scheduler remain separate implementation work. No hosted deployment or paid provider was enabled.

### Local inference admission update (31 October 2026)

The local provider queues inference fairly by workspace instead of immediately
rejecting whenever busy. One inference runs at a time, with 16 pending globally,
two pending per workspace and a 25-second waiting deadline. The existing 150-second
provider timeout still applies after admission. Queued requests recheck task and
source access before sending context to the model. Expired/full queues surface
retry guidance without deleting the conversation. Pending work is process-local;
durable job expiry remains the recovery mechanism after restart. Multi-process
shared inference admission is not implemented.
