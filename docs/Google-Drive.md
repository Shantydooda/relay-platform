# Google Drive connector — localhost

29 October 2026. Integration code and simulated-provider tests are implemented. A real Google OAuth client is not configured or verified. Stripe, hosted staging and the published demo are untouched.

## This increment

Workspace owners select one supported file through Google Picker and choose **Save a snapshot** or **Use the latest file**. Live mode requires explicit consent to repeated reads. Supported formats are Google Docs exported as text, plain text, CSV and JSON, limited to 16 KB. Folders, PDFs, spreadsheets, videos, background synchronization and external writes are not supported. Contents are untrusted data.

Snapshot imports are immutable. A live source is refreshed on authorized reads by an agent or installed automation, including scheduled execution. Attaching it as a saved task version captures the current content once; attaching the latest version permits later authorized refreshes. Neither importing nor linking creates an agent grant. Suppliers never receive Google credentials.

Live reads check connection, membership and source authorization, then recheck task lease/grant validity after the network read. Provider failures never return cached data as a successful live read. Scheduled app runs pause on failure; supported supplier runtimes can request access recovery in the task. Reconnecting alone does not reactivate the old live source: the owner reselects the file, and a fresh grant is required. Relinking preserves the source identity and advances its access epoch.

Changes preserve immutable prior source versions. Task history records versions and hashes read by the assignment; app runs retain exact input snapshots. These records demonstrate reads, not proof that a language model relied on every source. Safety limits currently stop at 100 source versions and 100 distinct task read records; retention/cleanup administration remains release work.

Disconnecting Google removes local credentials before attempted provider revocation and blocks future live reads. Saved Relay snapshots remain available under their existing source grants; disconnect a source separately to revoke those grants. Failed provider revocation instructs the owner to remove access through Google account permissions.

## Local configuration

Create a dedicated Google Cloud project (or an isolated OAuth client in an existing project). Enable Google Drive API and Google Picker API. Configure the consent screen and authorized test users. Create a Web application OAuth client with:

- JavaScript origin: `http://127.0.0.1:4180`
- Authorized redirect URI: `http://127.0.0.1:4180/drive/callback`
- Requested scope: `https://www.googleapis.com/auth/drive.file`

This scope permits management of the individual files selected through Picker. Relay only implements read/import operations; do not describe the underlying Google scope as read-only. Broader Drive scopes are not requested. External OAuth testing mode can impose refresh-token lifetime limits; real-provider acceptance testing must confirm reconnect behavior before launch.

Create a Picker API key restricted to the relevant Google APIs and website referrers specified by Google's current Picker documentation, including the localhost origin and `https://docs.google.com/*`. Obtain the Cloud project number used by Picker. Store configuration directly in the ignored file `.poc-data/google-drive.json` with owner-only permissions (0600), never in chat or source control:

```json
{
  "clientId": "YOUR_WEB_CLIENT_ID",
  "clientSecret": "YOUR_WEB_CLIENT_SECRET",
  "apiKey": "YOUR_RESTRICTED_PICKER_KEY",
  "projectNumber": "YOUR_PROJECT_NUMBER",
  "encryptionKey": "64_HEX_CHARACTERS_FROM_32_CRYPTOGRAPHICALLY_RANDOM_BYTES"
}
```

The launcher supplies the localhost origin. Keep the encryption key outside database backups and back it up separately with restricted access; losing it requires reconnecting. Production key management/rotation and hosted connector activation remain unimplemented.

## Security and recovery

OAuth state is random, short-lived, one-use and bound to the initiating user/session/workspace membership epoch. PKCE protects the authorization code. The callback only loads a public page; code exchange is an authenticated same-origin CSRF-protected POST. Callback query parameters are removed from browser history immediately. Failed/ambiguous exchanges require restarting connection rather than replaying authorization codes.

Refresh/access tokens and PKCE verifiers are encrypted with AES-256-GCM and connection-specific authenticated context. Refresh tokens never reach browser or supplier. The owner-only Picker page receives a short-lived Google access token, as required by Picker; it is not persisted client-side. A separate page has a narrowly expanded Google CSP; normal workspace pages retain their existing policy. Real Google script/CSP behavior still requires validation.

Provider requests use fixed HTTPS endpoints, reject redirects, have timeouts and bounded bodies, validate supported file metadata and redact provider failures. Imports recheck workspace authority and connection version after download. Imported file IDs/contents are never treated as URLs to fetch. Snapshot creation grants no agent access. No connector secrets are exposed in workspace/source listings or command receipts.

## Validation and remaining gates

SQLite and PostgreSQL-compatible tests cover session mismatch, concurrent callback replay, encrypted credentials, import retry identity, explicit snapshot semantics, refresh after application recreation, immutable imports and failed provider revocation. HTTP tests retain session/origin/CSRF gates while permitting the public callback navigation. Adapter tests cover PKCE, scope, encrypted-context binding, unsupported/oversize files and redacted failures. Browser QA uses disposable native PostgreSQL and fixture provider responses; it cannot validate real consent or Picker selection.

Before calling this a verified live integration: configure Google, complete consent/Picker selection using a controlled document, test revoked/expired Google access and key restrictions, confirm CSP compatibility, review provider verification requirements, and obtain independent security review. Folder authorization and background synchronization remain outside this increment.

## Provider references

- [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Picker web integration](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Picker configuration examples](https://developers.google.com/workspace/drive/picker/guides/web-picker-sample)

## Interactive workspace allowance

Local Drive imports and picker-token requests share a provisional allowance of 120 admitted operations per workspace per fixed one-hour window. Owner access and an active connection are checked before admission. Admission commits separately before credentials/provider work, so provider failures and client retries count; source-write rollback cannot erase an attempted operation. The credential step rechecks access and connection state. Exhaustion returns `DRIVE_WORKSPACE_LIMIT` with a retry interval before fetching credentials or reading a file.

Status, OAuth setup and disconnect are not subject to this allowance. Disconnect still disables the saved connection locally even if provider revocation fails. Automatic live-source reads for tasks/apps are not covered by this interactive allowance yet; they retain existing grant checks, per-response byte bounds, timeout and provider-instance concurrency limits. This is an operation allowance, not an HTTP-request, token, byte or monetary ledger. Picker UI requests made directly by Google's client are outside server-side accounting. Each imported file still requires explicit selection and consent as before.

### Agent-read admission (localhost)

Live `readAgentTool` requests share the durable workspace Drive allowance with picker/import operations. Admission validates the assignment lease, runtime credential, requester membership and grant, then commits the allowance before opening the provider-read transaction. Provider failure or a later access change still consumes that admitted attempt. Snapshot/local reads do not consume provider allowance. Source version and grant version are bound to admission; a concurrent change rejects with `SOURCE_CHANGED` and requires a fresh attempt. The execution transaction rechecks authority before reading and again before returning bytes. Tool contents are never cached in command receipts.

This is deliberately two sequential transactions, not a nested quota transaction while holding execution locks. Scheduled app runs and live refreshes during attachment/grant snapshot preparation remain outside this allowance and are the next coverage gap. Existing provider concurrency limits still apply to those calls.

## 6 November recovery audit

The existing selected-file connector was retained. Token endpoint `invalid_grant` failures now instruct the owner to reconnect and select the file again, without exposing provider details. Fixture tests cover this path. Neither a local Google configuration nor real consent/Picker validation was available during this audit. See Delivery-Integrations.md for the companion Attio destination and remaining provider acceptance steps.
