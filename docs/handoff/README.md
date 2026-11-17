# Handoff: acceptance criteria and exits (work in progress)

The server side of the acceptance policy, drafted 17 Nov 2026 and **not yet applied to the branch**. `acceptance-wip.patch` is a `git format-patch` commit. It applies cleanly on the branch as of `8dd6d42`.

```
git am docs/handoff/acceptance-wip.patch
```

With it applied, all existing poc-api and web tests passed (247). It adds no tests of its own yet.

## Policy (founder, 16 Nov 2026)

1. **Acceptance criteria:** a checklist of up to 12 items on the scope. Changing it is a scope change: the scope version goes up, existing offers are invalidated, and authorized work keeps the copy frozen in its agreement.
2. **Free fixes until the criteria are met.** A revision request can name unmet criterion ids. Supplier-hosted runtimes get up to 10 rounds as a safety cap; local CSV runtimes keep 2.
3. **Exit:** after 2 rounds of changes, the buyer can end the work as unmet (`BUYER_ENDED_UNMET`). It counts as a failed run in the ledger and makes "try another agent" available. It's refused when a payment is held, because refunds aren't connected to it yet.
4. **Auto-accept on buyer silence:** the `autoAcceptAfterMs` option, off unless configured. No deployment passes it and no worker calls `reconcileAutoAccept` yet. It skips anything with a payment.

## What the patch contains

- `services/application/src/acceptance.cjs` (new): normalizeCriteria, checkEnd, acceptanceView, and the setCriteria and endUnmet commands.
- Routes:
  - `PUT /api/tasks/:id/acceptance-criteria` with body `{expectedVersion, criteria: string[]}`
  - `POST /api/tasks/:id/end-unmet` with body `{expectedVersion, reason, unmetCriteria?}`
- `acceptanceCriteria` on the task view, opportunity view, agreement and supplier assignment state. `unmetCriteria` on submissions. The OpenAPI contract is updated.
- `request-revision` accepts `unmetCriteria`. Lifecycle actions include `end`. The detail response includes `acceptance`.
- execution.cjs: an `acceptSubmission` helper and `reconcileAutoAccept`. `autoAcceptAfterMs` is passed through createApplication, the unified local store and the test helper.

## Still to do

1. **End-to-end test** (`services/poc-api/test/acceptance-flow.test.cjs`, using `recommendationFlow`):
   - setting criteria invalidates offers; a stale version gets 409;
   - builders see criteria in opportunities and the assignment;
   - submit, then request a revision naming unmet ids, twice; end is refused before 2 rounds (`END_NOT_YET`);
   - end works after 2 rounds; failed in the ledger; retry available;
   - replaying a request is idempotent; another tenant gets 404;
   - auto-accept is off by default; turned on with an injected `now`, it accepts only after the window.
2. **Unit tests** for acceptance.cjs.
3. **UI:**
   - a checklist editor on the request (and on packages once they exist);
   - criteria shown on offers and the agreement;
   - unmet-criteria checkboxes in the revision form;
   - an "End as unmet" button when `actions.execution.end.allowed`;
   - activity labels for `criteria.updated`, `execution.ended_unmet` and `delivery.auto_accepted`.
4. **Builder views** of the criteria, and the SDK README.
5. **Docs:** "Acceptance and exits" in Decisions-Needed §2 and docs/State-Machines.md.
6. **Run the full suite with Postgres on Node 24.**

Delete this folder once the work is merged into the branch.
