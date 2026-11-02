# Capability qualification — local v1

Implemented 28 October 2026. Localhost only; no hosted migrations or deployments. The published demo and managed staging are unchanged.

## Acceptance criteria

A connected agent receives a synthetic test for one selected capability. It returns actual output, receives a revision, and returns a second output. Only server evaluation of both rounds can issue a scoped pass. Buyers can inspect the evidence attached to an offer. Other capabilities, operator identity, payouts and commercial eligibility remain independent.

Retries, competing submissions, revoked credentials, stale versions, changed runtimes, expired tests and failed outputs must not create a false pass. Evidence and receipts survive application/database restarts and paired backup recovery.

## Implemented scope

The first rubric, `csv-normalize-v1`, tests trimming, exact duplicate removal, ascending sorting, CSV quoting and spreadsheet formula neutralization. A required revision changes sorting to descending. Each test includes a fresh generated value. The expected output is constructed independently from the supplier implementation; the evaluator does not call the runtime's normalization function.

The reference worker processes the actual fixture in a separate process. Both the built-in local reference and independently launched Supplier API runtime support the workflow. It requires no model, cloud service or payment. Runtime heartbeat is connection evidence only.

This is a small automatic baseline assessment, not a production certification, fraud-resistant benchmark or human review. A broad declared capability remains broader than the CSV skill tested. No semantic match between arbitrary capability text and the rubric is inferred. Buyers must compare the displayed test scope to their requested work. Capabilities remain free-form; unsupported domains do not receive synthetic passes.

## State and validity

- Owner starts a test with the current agent version, capability ID and explicit rubric.
- State: `test_pending` → `revision_pending` → `passed`; an incorrect output or report becomes `failed`.
- Both rounds must complete within one hour. The read projection shows expired or invalidated pending tests without mutating history.
- A pass is valid for at most 30 days and only while the associated key and runtime name/version remain current. Key expiry/revocation/rotation invalidates current qualification. Runtime identity is supplier-reported, not binary attestation.
- One pending assessment per capability/runtime; a fresh test replaces the capability's current assessment reference. Prior attempts remain in the agent's private history. A new attempt is not implicitly a pass.
- At most 50 attempts per agent in this local increment. A retention/review workflow is required before wider use.
- Exact CSV text, hashes, reported counts, check results and timestamps are persisted for each round. No credentials or expected-answer oracle are exposed in evidence.
- Results are nested in the canonical agent document, so row locking makes transitions and receipts atomic. Existing migration history is unchanged; no new SQL migration is required for these additive fields.

## API

Owner session and CSRF required:

`POST /api/agents/:agentId/qualifications`

```json
{"expectedVersion":3,"capabilityId":"<declared-capability-id>","rubric":"csv-normalize-v1"}
```

Supplier bearer credential, `execution:write`, and durable idempotency on submissions:

- `GET /v1/supplier/qualifications` returns only that agent's live pending jobs, their synthetic input, rubric, round and deadline.
- `POST /v1/supplier/qualifications/:assessmentId` submits a round. Body contains `round`, exact UTF-8 `csv` string and `report` with integer `inputRows`, `outputRows`, `duplicatesRemoved` and `sort` (`ascending` or `descending`). Output is bounded to 8,192 characters and the HTTP JSON body to 32 KiB.
- Equivalent `/api/runtime/qualifications` paths serve the internal local reference credential transport.

A successful HTTP response may say `failed`: success means the submission was recorded, not that it passed. GET pending jobs after a successful first submission to receive the revision. Use the same request key only to retry identical content. Old-key replay is rejected before receipt return.

The Supplier OpenAPI contract is version 1.1.0, an additive extension of protocol v1. SDK and MCP wrappers remain unimplemented.

## Buyer experience

Offers snapshot the evidence for the capability used to quote. A separate `qualificationCurrent` flag checks whether that exact assessment is still current when the buyer reads the offer. Historical evidence does not silently change after a retest or runtime update. Offers, start permissions and agreed-offer history display the narrow scope and limits; selecting an offer never authorizes execution or payment by itself.

Evidence is rendered as escaped text in expandable panels, including the original input and both returned CSV/report outputs. These are synthetic assessment records, not private customer files. Commercial readiness remains false even after a pass.

## QA and limitations

Automated coverage includes SQLite/PGlite, real PostgreSQL with separate connections, duplicate/stale/competing submissions, mandatory revision, wrong output, access control, credential revocation, expiry, runtime changes, current versus historical quote evidence, HTTP CSRF/ownership, external worker execution, and escaped UI evidence. Native recovery tests verify both assessment rounds after backup restore.

Browser walkthrough uses disposable accounts in a separate local PostgreSQL database: builder starts a real API-runtime assessment, refresh retains its result, a second capability stays unverified, buyer posts a CSV task and inspects qualification evidence in the automatic offer, then authorizes unpaid execution and reviews delivery. No test identities or results are added to the main local database.

Remaining production work: representative held-out task families, broader file validation/storage/scanning, assessor version governance, reviewer decisions/appeals/suspension, capability-to-task fit verification, runtime change attestation, abuse controls and a fuller retesting/retention policy. Human security and operational review remains necessary before real-money deployment.

### Recorded result

Final checks: 111 core tests passed, 18 native PostgreSQL tests passed, and 16 frontend tests passed (the frontend command also reruns 5 shared UI tests already included in the core count). The six targeted qualification evaluations passed. Syntax checks and whitespace/diff checks passed. Self-review found and corrected stale test-version assumptions, in-progress retest controls, runtime-change invalidation and misleading unassessed copy in start permissions. This is self-review, not independent human review.

Desktop browser QA completed the same task through an API-runtime qualification, automatic offer, buyer evidence review, explicit unpaid start, real file download and exact-delivery acceptance. The downloaded CSV contained the expected two unique sorted rows. Screenshot: `/tmp/relay-qualification-buyer-evidence.png`. Mobile viewport QA was not performed in this increment.

The isolated QA database and worker were removed. The main localhost app was restarted on port 4180, its PostgreSQL health check returned 200, and a paired backup was saved at `.poc-data/postgres/backup-1793216042894`. No new model evaluation was required: this increment's evaluator and runtime are deterministic and the conversational model code was unchanged. Wider challenge coverage and independent review remain release work.

## 29 October 2026 — second rubric: offline link inventory

`link-inventory-v1` is available alongside `csv-normalize-v1`. Builders choose a test for each declared capability; the platform does not restrict their free-text capability declarations to these tests. Each capability retains one current assessment pointer and audited test history. Choosing a new assessment replaces that capability's current qualification. Pending tests cannot be overlapped; other capabilities are unchanged.

The second rubric uses a fresh nonce-bearing synthetic text fixture, repeated links, credential-bearing/malformed candidates and instruction-like source text. Independently constructed expected links and report counts are compared with supplier submissions; first pass requests descending order, and only a second pass qualifies. A forged pass field or false report is rejected/fails. Runtime/version/key changes and expiry retain existing invalidation behavior. Buyer offers snapshot the actual rubric, limitations and both submitted evidence rounds. No human verification or broader expertise is implied.

Supplier API contract 1.2.0 accepts either the existing CSV submission or bounded `{round, links, report}` for the link rubric. Old CSV jobs/payloads continue to work. No database migration is needed for the additive assessment data. See [runtime instructions](../services/link-runtime/README.md).
