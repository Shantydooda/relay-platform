# Spending reports

Localhost implementation; Stripe remains disconnected. Demo and hosted staging are unchanged.

## User behavior

History & spend shows 25 task rows per page, ordered by task reference. Summary totals always cover the complete filtered report, not just the visible page. Refresh totals or applying dates creates a new saved report. Background polling does not replace it. Pending amounts and task statuses describe the snapshot; confirmed ledger movements use the inclusive UTC date range. Opening balances include earlier movements.

Export CSV downloads every page of the displayed snapshot, with one header and one final TOTAL row. All eight monetary columns are calculated as integer minor units. Decimal formatting occurs only at presentation/export. If any page expires, is unavailable or has inconsistent metadata, no partial download is offered; refresh totals and retry.

## API and storage

`GET /api/payments/history?tenantId=...&from=YYYY-MM-DD&to=YYYY-MM-DD` creates a report and returns page zero. `snapshotId`, `pageCount`, `itemCount`, `nextPage`, `expiresAt`, `observedAt`, `totals`, `items` and `csv` describe the result.

`GET /api/payments/history?tenantId=...&snapshot=...&page=1` reads an immutable saved page. Dates are fixed by the snapshot. Each page's CSV field is a chunk: page zero includes the header/BOM; the final page includes TOTAL. Concatenate chunks in page order for a complete export.

Snapshot ownership, workspace membership and membership identity are checked on every request. Changed authority invalidates the old report. Expiry is 30 minutes. Each user retains at most five reports across workspaces; creating another evicts the oldest. Expired records are pruned on that user's next report creation, not by a background retention worker.

Generation uses a serializable PostgreSQL transaction, with up to three attempts on serialization conflicts; SQLite serializes writers. Creation and eviction roll back together on failure. Indexed keyset batches read 25 authorized tasks and their archived settlements. Migration 004 adds workspace/owner and settlement-task indexes. No external provider is called.

## Capacity and limitations

A report accepts up to 10,000 source tasks and 32 MiB of serialized saved rows. Each input batch permits at most 5,000 archived settlements and 10 MiB of source payloads before parsing. Exceeding a bound fails explicitly with no partial financial report. Date filters do not bypass source-history bounds because opening balances require older entries. Generation remains synchronous and exports collect bounded chunks in browser memory. These limits require further profiling before a larger production rollout.

## Verification

- 1,001-task fixtures on SQLite and PGlite: 41 pages, no omitted/duplicate tasks; all eight CSV columns reconcile exactly to global totals, including formula-safe titles.
- Native PostgreSQL: payment changes during generation, reopening the database, competing report refreshes and five-report retention.
- Ownership/role changes, invalid pages, expiry and expired-report cleanup.
- Browser-export tests: exact Blob bytes; all pages included; failure on the final page produces no download.
- Regression run: 356 backend, 33 native PostgreSQL, and 91 web/shared-UI tests passed. Subsequent serializable-retention change passed targeted native and adapter tests.
- Authenticated localhost browser: existing nine-row report renders with exact zero totals and page metadata; Export CSV action exercised. Multi-page/nonzero datasets were checked with automated disposable fixtures, not inserted into the user's workspace. No new physical-device test or hosted CI run was performed.
