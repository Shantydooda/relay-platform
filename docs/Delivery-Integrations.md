# Drive context and Attio delivery — local v1

## Audit and implemented scope (6 November 2026)

Google Drive already had OAuth/PKCE, session and workspace binding, encrypted tokens, selected-file Picker import, immutable snapshots, explicitly authorized latest-file reads, disconnect, concurrency limits and durable admission. We reused that connector rather than adding another one. This increment makes expired/revoked Google grants return an actionable reconnect error. See Google-Drive.md for setup and supported formats (Google Docs/text/CSV/JSON, 16 KB; no folders, Sheets or PDFs).

Attio was previously only a catalogue entry. Local v1 now has a server-held private integration, workspace-owner enable/disconnect controls, and delivery from the existing accepted-task screen. It is a delivery destination, not a CRM context reader. It does not give suppliers an Attio token or general CRM write permission.

## Buyer flow

1. Configure the local private integration, then enable it in Connected tools as the workspace owner.
2. Accept a company CSV delivery. Choose Review beside that file.
3. Review the configured destination, company names and normalized domains. Explicitly confirm creation/updates.
4. Relay sends one company per HTTP request, automatically continuing the reviewed batch in the page. Each confirmation is stored independently. Closing the page stops further requests; reopening Review resumes from durable state.
5. Failures retain confirmed rows. Wait at least one minute before retrying the remaining rows. Five failures of the same row require operator intervention and a new connection/review.

CSV constraints: UTF-8, at most 256 KiB and 50 rows, unique headers and consistent columns. A domain/website/url column is required; company/company_name/name is optional. Only these two mapped values are sent. Paths are discarded, `www.` is removed, duplicate domains and credential-bearing URLs are rejected. Review the resulting mapping before confirming.

The destination uses Attio's assert-company endpoint with `matching_attribute=domains`. A matching company may have its supplied name updated. Relay does not send emails, add people, change deals or map custom fields. Domain matching prevents duplicate company creation during an uncertain-result retry; this is not a claim of exactly-once execution or protection from concurrent edits outside Relay.

## Local setup

Keep credentials out of chat, source control, browser storage and task payloads. Configure the ignored `.poc-data/attio.json` file with mode 0600:

```json
{
  "token": "LOCAL_PRIVATE_INTEGRATION_TOKEN",
  "tenantId": "RELAY_WORKSPACE_ID",
  "workspaceLabel": "Your Attio test workspace"
}
```

The token needs `record_permission:read-write` and `object_configuration:read`. Use a dedicated test workspace. The label is administrator-supplied, not an identity verified by Relay; confirm the token belongs to that destination before enabling. Changing the token or label invalidates the saved connection and requires a fresh enable/review. Only one Relay workspace is configured by this local launcher. Restart the local server after configuring it. This is not production multi-tenant OAuth onboarding.

The server rejects non-localhost origins. No credentials were configured by this increment. Main localhost displays Setup required. No real Google consent, Picker selection or Attio write has been performed.

## Authorization and recovery

All endpoints require a logged-in local account; mutations retain same-origin/CSRF enforcement. Authority is re-resolved for each request. Only the current workspace owner can connect or send. Task ownership/workspace access, the latest accepted submission, verified file bytes and scan status are checked server-side. Each job binds the task, submission, file digest and connection generation. Disconnect/reconnect or credential changes reject old jobs; reselect the file for a fresh review.

Records use the existing versioned document repository (`attio-connection`, `attio-delivery`, `tool-audit`); no schema migration is needed. Writes run under the existing access boundary and repository locks. A request already authorized and dispatched cannot be recalled by disconnect; later requests are blocked. Disconnect does not undo CRM updates. Delete/undo in Attio is outside this increment.

## QA and remaining acceptance

Automated coverage includes provider payloads, bounded responses, malformed CSVs, missing consent, partial failure, concurrent retries, stale connections, role revocation, unaccepted deliveries and HTTP auth/CSRF/workspace boundaries. Storage tests exercise SQLite and PGlite's PostgreSQL implementation, not a real Attio server.

Disposable localhost browser QA exercised enabling the fixture destination, reviewing an accepted CSV, sending two companies, and reloading/reopening the persisted completed delivery. Mobile and desktop layouts were inspected. No fixture data was added to the user's main database.

Still required before live integration acceptance: Google OAuth/Picker setup and real revocation tests; dedicated Attio workspace credentials and one controlled end-to-end write/readback; provider rate-limit acceptance; independent security review; production multi-workspace authorization and operational reconciliation. These are not marked complete by fixture tests.

## Provider contracts

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Attio assert-company API](https://attio.readme.io/reference/put_v2-objects-companies-records)

### Local API surface

- `GET /api/attio/status?tenantId=…`: configured/connected state and administrator-supplied destination label.
- `POST /api/attio/control`: `{ "tenantId": "…", "action": "connect" }` or `disconnect`.
- `POST /api/attio/prepare`: `{ "taskId": "…", "submissionId": "…", "fileId": "…" }`. Repeating returns the same durable job for the same file and connection generation, including its confirmed rows.
- `POST /api/attio/send`: `{ "id": "reviewed-job-id", "consent": "upsert-reviewed-companies" }`. Processes at most one remaining row. Returns `sending`, `failed` or `sent` with confirmed count and record IDs. The browser continues only while that task/workspace remains open. Each request rechecks authorization.

Final checks: full backend regression run 409/409 passed; frontend/shared UI run 127/127 passed. New connector/application/UI focused tests and the new Attio HTTP authorization test passed separately after review fixes. `git diff --check` passed. Main localhost was restarted using its existing test-only payment launcher; `/api/config` confirms both integration features are exposed. These checks do not substitute for live provider verification.

## Delivery receipt recovery — 6 November 2026

Opening an accepted task now loads the latest delivery receipt per file through `GET /api/tasks/:id/delivery-destinations`. This is an authenticated, owner-authorized, read-only endpoint: opening or refreshing never sends companies. Indexed receipt pointers avoid scanning all workspace jobs. Older reviews without a pointer can be read for the current connection generation.

Interrupted batches show confirmed and remaining rows with an explicit resume action. A resumed batch skips persisted confirmations; competing resumes serialize through repository locks. Failed rows respect the existing retry delay and attempt limit. Disconnecting preserves the receipt and removes send controls. Changed connections or access epochs require a fresh review. Historical job records remain stored, but this view shows the latest attempt for each accepted file rather than a full destination audit history.

QA: 128 frontend/shared UI tests passed; application checks passed on SQLite and PGlite; native PostgreSQL restart and competing-resume checks passed, along with HTTP authentication checks. Disposable localhost browser QA reopened a one-of-two confirmed batch, resumed it, disconnected Attio, and reloaded the completed receipt with both confirmations intact. No external provider calls or main-database fixture records were used. Live provider acceptance remains outstanding.

## Integration failure review and full verification — 7 November 2026

Fixed Attio response-stream failures escaping the connector as raw errors after response headers. Interrupted bodies now return a redacted `ATTIO_UNAVAILABLE` error; failed response cleanup cannot replace the intended provider-rejection error. No UI or provider contract changed.

Added local fixtures for Attio 401/403/429/500/503 responses, network and body interruption, malformed/missing confirmation, plus Drive provider rejection and stream interruption with concurrency-slot recovery. Application tests on SQLite and PGlite verify the five-attempt limit, no provider call after exhaustion, preserved confirmed rows, and that reopening a review does not reset the retry budget.

Final `verify:local` run `ea64b28d-6853-4c0e-9684-1a146b9d1332`: **579 checks passed** (412 backend, 128 web, 37 native PostgreSQL, 2 sustained-load checks). Zero failures, skips or cancellations; `sourceChanged: false`. Fingerprint: `0bb7da24f83f6d140c1287f63f1508992e7efc3bcd00f4e454a7baa6c5e3a82b`. Documentation was appended afterward. An earlier run interrupted before formatting was superseded by this final run.

This pass used automated local fixtures; the prior delivery-recovery browser walkthrough was not repeated or relabeled as new browser evidence. No real Google/Attio traffic, real-money actions, demo deployment or staging changes. Live provider acceptance, independent supplier acceptance and independent release review remain open.
