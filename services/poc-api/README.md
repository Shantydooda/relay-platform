# Relay account + task API — local technical POC

This is a **real local account/session/task service**, not a replacement for the published browser demo. It binds only to `127.0.0.1`, refuses `NODE_ENV=production`, and does not provision hosting. Do not tunnel it or expose it to external users before the gates in [the implementation record](../../docs/poc/Accounts-and-Tasks.md) are met.

From the repository root:

```sh
npm ci --ignore-scripts
npm run start:poc
```

Open `http://127.0.0.1:4180`. Create a **test** account through the UI. No fixed/demo login or shared password exists. Use the exact loopback address; `localhost` is deliberately not an alias for this origin. `RELAY_POC_PORT` changes the port; `RELAY_DATABASE_PATH` overrides the database path. Default: repository `.poc-data/relay.sqlite`, excluded from Git. Keep that directory private. Run only one application process against the local database.

Passwords are scrypt-hashed with individual salts. Session tokens are random, stored as SHA-256 verifiers, and carried in HttpOnly/SameSite cookies. HTTP without Secure is allowed only by the loopback launcher. Sessions expire after 30 minutes idle or 12 hours absolute, and logout revokes them. New sign-in rotates the presented session. This is custom POC authentication, not independently reviewed identity infrastructure. No verification email, recovery, MFA or external identity provider is connected. Account emails are unverified identifiers.

Database migrations are applied on startup. Accounts, memberships, session verifiers, task versions, messages, activity and retry receipts are durable. Prepared queries and a synchronous `BEGIN IMMEDIATE` transaction cover each task command. No task command trusts caller-provided ownership, role, status or financial fields. A personal workspace is created per user. Corporate invitations and memberships cannot be created through this API yet.

No CORS is enabled. Host and mutation Origin must match the configured origin; authenticated mutations also require the session's CSRF token. The service ignores forwarded IP headers. Auth attempt buckets persist in SQLite; simultaneous password hashing is capped at two. JSON bodies are capped at 32 KiB. Content Security Policy forbids inline scripts, frames and third-party resources. The local database is not encrypted at rest; OS/disk protection is required.

## Independently test

```sh
npm test --workspace @relay/poc-api
npm test --workspace @relay/poc-web
npm run test:poc
```

Network tests open ephemeral loopback ports and use disposable databases. They do not touch the running workspace database or send email. Pin Node 24 LTS for the next CI environment; this machine currently runs Node 25.2.1. `node:sqlite` is experimental on that runtime, which is a deployment-review issue. No external npm runtime packages were added.

## HTTP surface

All responses are JSON except the allowlisted UI assets. Errors use `{ "error": { "code", "message", "requestId" } }` without stack traces or database details. Every response is `Cache-Control: no-store`. There is no generic file server or database administration endpoint.

| Method | Path | Behavior |
|---|---|---|
| GET | `/health` | Local service liveness; no private data |
| POST | `/api/auth/register` | `{name,email,password,workspace}` → account, personal tenant, fresh session |
| POST | `/api/auth/login` | `{email,password}` → fresh session |
| GET | `/api/me` | Current account, authorized memberships, CSRF token |
| POST | `/api/auth/logout` | `{}` → revoke current session |
| PATCH | `/api/me/workspace` | `{workspace: "buyer" or "builder"}` → preferred UI only; grants no tenant privileges |
| GET | `/api/tasks?tenantId=…` | Authorized workspace task list |
| POST | `/api/tasks` | `{tenantId,title,brief}` → draft and initial message |
| GET | `/api/tasks/:id` | Authorized task, messages, ordered activity |
| PATCH | `/api/tasks/:id` | `{expectedVersion,title,brief}` → edit draft |
| POST | `/api/tasks/:id/post` | `{expectedVersion}` → posted, **no agent dispatch** |
| POST | `/api/tasks/:id/cancel` | `{expectedVersion}` → terminal cancellation |
| POST | `/api/tasks/:id/messages` | `{expectedVersion,body}` → context message |

Task writes require `Idempotency-Key` (16–128 URL-safe characters) and authenticated writes require `X-CSRF-Token`. A key is scoped to a user. Same key + same request replays the original receipt. Reusing it for another payload returns 409. Receipts and task activity are committed in one transaction. Replays recheck access. A stale `expectedVersion` returns 409 without changing the task; fetch it again and reconcile rather than silently resubmitting. Caller JSON key order is part of the current request fingerprint; adapters must retain an exact request when retrying.

Create response: `{ "taskId": "UUID", "version": 1 }`. Mutation response has the same shape with the resulting version. GET then reads current authoritative state. No plaintext passwords, cookies, email addresses or request bodies are logged. Internal failures log only a random request ID and generic code.

This `/api` is the deliberately small **implemented POC surface**, not a claim that the broader proposed `/v1` marketplace contract is deployed. Align/version the production contract before adding a supplier integration. No pricing, approval, file-upload or payout endpoint is reachable here.

## Backup / restart

Stop the service with Ctrl+C before copying the entire `.poc-data/` directory to a protected backup. WAL and shared-memory files can exist while the service runs; do not copy only a live `.sqlite` file. Restore with the service stopped and retain directory/file access restrictions. Automated encrypted backups, disaster-recovery drills, migration checksums and retention/pruning are still release work. Do not commit database files or backups.
