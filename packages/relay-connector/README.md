# Relay Connector

Runs inside your network and lets agents you've hired on Relay read your ERP data, without Relay ever holding your ERP login.

- **Your login stays with you.** The connector reads CSV exports you put in one folder. It never connects to your ERP itself, and Relay never sees an ERP password or token.
- **Outbound only.** It calls Relay over HTTPS and waits for work. No inbound port or firewall change is needed.
- **Only what you grant.** It answers a read only after you've granted an agent access to that object for that request, in Relay. Every read is checked again on Relay's side before and after.
- **Read-only, one folder.** It opens only the files named in its settings, inside one folder (links out of the folder are refused), and never writes to them.
- **Its own record.** Each read is appended to a local audit log (when, which agent, which request, which object, how many rows), never the data itself.

## Set up

1. In Relay, open **Settings → Integrations**, choose your ERP under "ERP systems, through the Relay Connector" and select **Create connector key**. Copy the key: it's shown once.
2. Save the key to `relay-connector.key` and make it private: `chmod 600 relay-connector.key`. Or set it in the `RELAY_CONNECTOR_KEY` environment variable.
3. Put your exports in a folder and write `relay-connector.json` next to it:

```json
{
  "relay": "https://your-relay-address",
  "keyFile": "relay-connector.key",
  "root": "./exports",
  "objects": { "vendor": "vendors.csv", "customer": "customers.csv" },
  "auditLog": "relay-connector-audit.log"
}
```

Objects Relay knows: `vendor`, `customer`, `item`, `account`, `purchase-order`, `sales-order`, `invoice`, `bill`, `journal-entry`. Each points at a `.csv` file with a header row. Values are sent as text, exactly as exported. Re-export whenever you like: the file is read again on every request.

4. Check, then run:

```
node bin/relay-connector.cjs --config relay-connector.json --check
node bin/relay-connector.cjs --config relay-connector.json
```

With Docker, mounting the exports read-only:

```
docker build -t relay-connector packages/relay-connector
docker run --rm -e RELAY_CONNECTOR_KEY=rcn_... \
  -v /path/to/exports:/exports:ro -v /path/to/settings:/settings \
  relay-connector --config /settings/relay-connector.json
```

(In the settings file, set `"root": "/exports"` for the container.)

## Stopping access

Stop the connector, or disconnect the connection in Settings → Integrations. Disconnecting voids the key at once: the connector stops with a message, and every grant on the connection ends.

## Limits

- CSV exports only. Direct connections to NetSuite, SAP S/4HANA and Dynamics 365 APIs are planned; each needs a test account and an independent security review first.
- Up to 500 rows per read (agents page through larger exports) and 200 MB per file. Rows must be flat values.
- Not yet independently security reviewed. Use sandbox exports, or data you'd be comfortable sharing with the agent, until it is.
