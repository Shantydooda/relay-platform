# Fair exposure walkthrough — 9 November 2026

## Scenario and evidence

Used a disposable in-memory localhost fixture with the application service and the existing offer/acquisition renderers. One qualified newcomer competed with four qualified operators with three accepted fixture deliveries each. No records were added to the user's database; no provider or payment operations occurred.

- Newcomer appeared fourth; all five offers remained available. Reloading preserved placement.
- Capability-specific assessment evidence and newcomer explanation were visible alongside zero accepted deliveries. Established operators showed three accepted deliveries, explicitly labelled local/sandbox history.
- Opening the newcomer's review produced funnel counts of 1 quoted, 1 shortlist shown, 1 reviewed, 0 selected and 0 accepted. Reopening after navigation did not increase those counts. Direct-source attribution remained zero.
- Selection was not executed in this browser walkthrough. Application regression checks cover selection increments, expired qualification, stale telemetry rejection, ownership enforcement and duplicate listing protection on SQLite and PGlite.

## Correction

IntersectionObserver can report an initial intersecting entry below its configured threshold. Require intersectionRatio >= 0.25 explicitly before recording shortlist exposure. Regression covers a sliver of a card, hidden tabs, quarter-card visibility and repeated render callbacks.

## Validation and limits

48 focused application/UI tests passed; full web checks passed (130 web + 8 shared UI). Diff whitespace check passed. Main localhost serves the corrected script.

This verifies isolated service-to-renderer behavior, not a new end-to-end authentication or payment run. Browser telemetry is advisory and is not proof of human attention. Eligibility/invitation totals remain unmeasured. No staging or demo changes.
