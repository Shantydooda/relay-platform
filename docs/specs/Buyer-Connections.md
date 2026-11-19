# Spec: buyer connections and access grants

Status: built locally, 19 Nov 2026, branch `claude/enterprise-projects`. Grounded in `reports/ERP buyer readiness for agent projects.md` (least-privilege access, buyer-run loads, OWASP "least agency").

## What it does

Buyers connect the systems their work lives in (an ERP sandbox, later a drive, CRM or SFTP folder) once per workspace. During work an agent asks for read access; the buyer is notified, chooses a system and a duration, and the agent reads through Relay. The agent never receives the buyer's credentials.

## How access works

1. **Connect.** A workspace owner (personal owner or company administrator) enters the system's details. Relay verifies them with the provider, seals them with AES-256-GCM bound to the connection id (key in a private file outside the database, `.poc-data/connections.json` locally; a hosting secret in production), and never shows them again.
2. **Ask.** The assigned agent calls `POST /v1/supplier/tasks/{id}/access-requests` with the kind of system, environment, objects, purpose and days (1–30). Execution time pauses; the request appears on the task and a notification goes to the buyer.
3. **Grant or decline.** A workspace owner picks a matching connection (same kind and environment, providing every object asked for) and a duration. A grant is a record, not a token. Declining keeps the work paused.
4. **Read.** The agent calls `POST /v1/supplier/tasks/{id}/access-read` with its runtime credential, its current work lease, the grant id and an object. On every read Relay re-checks the lease, the grant (active, unexpired, same assignment and agent, object in scope), the connection (active, same epoch, credential present) and the granter's current role and membership epoch; then opens the credential server-side, calls the provider and logs the read (counts shown on the task).
5. **Stop.** Expiry, revoking the grant, disconnecting the system (which deletes the sealed credential and bumps its epoch), or the granter losing owner access stops the next read. Work ending revokes its grants.

All access is read-only. Changes go back as files the buyer reviews and loads with their own import tool.

## Ending as blocked by the buyer

If the buyer declines an access request, or leaves it unanswered for 72 hours, the agent may end the work with `POST /v1/supplier/tasks/{id}/blocked`. The assignment ends as `cancelled` with `endReason: buyer_prerequisite`, which the outcome ledger doesn't count as a decided run, so a buyer-side blocker never lands on the agent's record. Refused while a payment is held (the buyer resolves it through a refund first).

## Connectors

Built: a labelled **Sample ERP (local testing)** with made-up records, implementing the provider contract `verify(credentials) → { account, objects }` and `read(credentials, { object, cursor, limit }) → { rows, nextCursor }`.

Planned, shown as "Coming next", each after a test account and an independent security review: NetSuite (token-based login on a dedicated read-only integration role), SAP S/4HANA (communication arrangement with a read-only business role), Dynamics 365 (app registration with export-only duties), SFTP drop folder.

## Known limits

- A read holds the task's transaction while the provider responds; real connectors should fetch outside the lock and then record the read.
- Grants are per assignment; a new assignment asks again.
- Hosted deployment needs the vault key as a hosting secret and the same review as other credential handling. Not deployed.
