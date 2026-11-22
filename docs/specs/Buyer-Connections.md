# Spec: buyer connections and access grants

Status: built locally, 19 Nov 2026, branch `claude/enterprise-projects`. Grounded in `reports/ERP buyer readiness for agent projects.md` (least-privilege access, buyer-run loads, OWASP "least agency").

## Where it lives (21 Nov 2026)

**Settings → Integrations** (`/settings/integrations`, and `/settings/integrations/<org id>` for an organization), reached from the account menu. Every account has it: a personal account manages its own systems; an organization's owners manage the organization's and members see them read-only. It's one list in the Hugging Face settings style, grouped by use (agents read during work, files for requests, send results, coming next), one row per integration with its status and one action; setup opens under the row. It replaces the organization's "Connected systems" tab (old `/org/<id>/connections` links land on the new page) and the old "Connected tools" page's Drive, Attio and tool library. Built in `apps/poc-web/public/integrations-ui.js`; server rules are unchanged.

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

Built (provider contract `verify(credentials) → { account, objects }`, `read(credentials, { object, cursor, params }) → { rows, nextCursor }`):
- **Sample ERP (local testing)**: made-up records, labelled as a sample.
- **GitHub** (`services/connectors/src/saas-readers.cjs`): fine-grained tokens only (classic tokens can't be limited to chosen repositories or read-only). Objects: repositories, issues, pull requests, a file (repo and path validated against fixed patterns; no `..`).
- **HubSpot**: a private app token with read scopes; contacts, companies, deals, with paging. Sandbox and production.
- **Attio**: an access token with read scopes; companies and people through the record query (a POST that only reads).

All three use fixed hosts, no redirects, a 10 s timeout and a 2 MB response cap, and are tested against a stubbed network only: **not yet verified against live accounts.**

Planned direct API connections, shown as "Coming next", each after a test account and an independent security review: direct NetSuite (token-based login on a dedicated read-only integration role), direct SAP S/4HANA (communication arrangement with a read-only business role), direct Dynamics 365 (app registration with export-only duties), SFTP drop folder, Salesforce, Jira. Until they ship, ERP data comes through the Relay Connector (below).

## Relay Connector (decided 23 Nov 2026: "bring your own connector")

ERP security teams won't hand a marketplace their ERP login, and each direct ERP connector needs its own test account and review. So for ERP data the buyer runs a small connector inside their own network (`packages/relay-connector`, Node, no dependencies, also a Dockerfile). It holds whatever access it needs locally; Relay holds only a hash of the connector's key. The same pattern as Fivetran's hybrid deployment or Power BI's on-premises gateway. (The alternatives, buyers registering their own OAuth apps, or agents running in the buyer's cloud, were set aside: the first still leaves Relay holding keys, the second is enterprise step 4.)

How it works:
- **Connecting.** Settings → Integrations lists NetSuite, SAP S/4HANA, Dynamics 365 and "Other ERP or database exports" under "ERP systems, through the Relay Connector". Setting one up asks for a name and environment only, never a login, and issues a key `rcn_<connection id>.<secret>`, shown once with the setup steps. Relay stores the secret's SHA-256 hash and compares it in constant time.
- **Checking in.** The connector says hello with the objects it serves, from one fixed vocabulary for every ERP (`vendor, customer, item, account, purchase-order, sales-order, invoice, bill, journal-entry`; payroll and employee records are left out on purpose). A connection serves nothing, so nothing can be granted, until it has checked in. It shows online while it has checked in within the last 60 s; each poll counts.
- **Reading.** Agents ask for access and buyers grant it exactly as for any connection (by system kind, environment and objects). An agent's read runs the same three steps as every read (check, fetch with no transaction open, check again and record); only the fetch changes: Relay queues the read for that connection's connector and waits up to 20 s. The connector long-polls (`GET /api/connector/reads?wait=25`, outbound HTTPS only), reads the export, and posts the rows back (`POST /api/connector/reads/<id>`). The rows are sealed with the connection vault while they wait and deleted when handed over. The connector also learns which agent is reading for which request, for its own log.
- **Failures.** An offline connector fails the read at once (`CONNECTOR_OFFLINE`, never queued). No answer in 20 s withdraws the read (`CONNECTOR_TIMEOUT`) and a late answer is refused. A connector error or malformed answer (rows must be up to 500 flat objects of text, numbers, booleans or empty, at most 2 MB) reaches the agent as `CONNECTOR_ERROR` with a plain message, and isn't counted as a read. Access revoked while the connector answers drops the rows (`GRANT_REQUIRED`), as for any read.
- **Ending it.** Disconnecting voids the key at once, withdraws waiting reads and revokes every grant on the connection. The connector stops with a message.
- **The connector's own rules.** It reads only `.csv` files named in its settings, inside one folder, rechecked on every read so a swapped-in link can't escape. It never writes to them. It refuses an http Relay address except for this machine, refuses a key placed in the settings file, and requires a private key file. It appends every read to a local audit log without the rows.
- **The API** (`services/poc-api/src/app.cjs`): `/api/connector/*`, bearer connector key only; any request with an `Origin` header is refused, so no browser can use it.

Not yet: direct API adapters behind the connector (NetSuite SuiteQL, SAP OData, Dynamics Web API); formats other than CSV; rotating a key without reconnecting; a published package or image (today it runs from this repo); hosted wiring (the pilot's connections are off); **an independent security review before any real buyer data.**


## Known limits

- Reads call the provider outside the task's lock (21 Nov 2026): Relay checks access, calls the system with no transaction open, then checks again and records the read. If access ended meanwhile (revoked, expired, disconnected, lease lost), the rows are dropped and the agent gets `GRANT_REQUIRED`.
- Grants are per assignment; a new assignment asks again.
- Relay Connector reads wait in the request for up to 20 s; a pilot behind a proxy with a shorter timeout needs that changed first.
- Hosted deployment needs the vault key as a hosting secret and the same review as other credential handling. Not deployed.
