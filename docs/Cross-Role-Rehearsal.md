# Local cross-role release rehearsal

4 November 2026. Disposable native PostgreSQL database, separate identity store and object directory, localhost port 4183. The user's port 4180 data, demo and hosted staging were not used as fixtures. Stripe/provider absent; all execution explicitly unpaid. Icebox scope unchanged.

## Browser walkthrough

- Builder: logged in, registered a general-purpose CSV agent with an open-ended capability, connected the real local deterministic CSV process, completed a fresh qualification test and sorting revision, and enabled automatic bids. Buyer offers displayed the capability's actual qualification. Paid-work readiness stayed blocked.
- Personal buyer: created a conversation, reviewed and posted the brief, uploaded synthetic CSV rows, received an automatic offer, explicitly selected it and authorized unpaid execution. The runtime delivered actual CSV and JSON files; ClamAV checks completed before acceptance. Preview verified exact deduplication and ascending sort. Requested descending sort, verified the second delivery's changed bytes, and accepted that exact submission. Original delivery remained in history.
- Administrator: selected the company and configured a $100 local allowance. Personal and company tasks remained separate.
- Employee: requested work in the named company, attached CSV before posting using the repaired request review, selected the qualified runtime's $1 offer and requested approval. Company name and Employee role remained visible.
- Approver: reviewed the same task/offer/scope and declined with feedback. Employee returned to the same conversation and resubmitted with a new explanation. Approver saw the new pending request separately from the previous decline, approved, and observed $99 available / $1 reserved.
- Execution: employee started the approved unpaid run. Builder dashboard showed the same task and delivered files; operator reply arrived in the employee conversation. Employee downloaded the real output (`name,city`, `Acme,Paris`, `Zeta,London`) and accepted delivery. Company allowance returned to $100 available / $0 reserved / $0 committed with “allowance released.” Builder Earnings correctly showed no earnings/payout for unpaid execution.

## Repairs

1. Source CSV attachment is available during draft request review, not only hidden in a posted task's context. Upload preserves the conversation and makes the reviewed scope current before posting. Draft confirmation no longer incorrectly says existing offers need updating.
2. Business workspace navigation opens a single joined company directly. It preserves an already-selected company and leaves multiple-company selection explicit. Approval/history cursors reset when entering the workspace.
3. Builder dashboard “View task” carries the task ID and scrolls to its delivery card, rather than dropping the builder at the top of all work.
4. Local landing copy now reflects implemented company invitations, roles and approvals while keeping commercial payments disconnected. Hosted/demo feature copy is unchanged by the local feature branch.

## QA and boundaries

357 backend tests and 33 native PostgreSQL tests passed, including permission revocation, changed-offer approval invalidation, budget contention, failed payment/refund/payout fixtures, restart and actual HTTP runtime delivery. Final web/shared UI suite: 95 passed. Added regressions for draft attachment access, company entry selection, per-task builder navigation and local landing claims. Diff whitespace checks passed.

Mobile company dashboard inspected at 390×844: no horizontal overflow (content width 375). Desktop accepted-task screenshot inspected; browser console had no errors. Default viewport restored. This is responsive browser emulation, not physical-device QA.

No real Stripe, bank payout, Google OAuth or external supplier was connected. Conversational model was deliberately absent in the disposable fixture: its honest unavailable-model fallback and explicit manual request review were exercised, not LLM quality. Changed-offer/revocation/failed-settlement branches were automated-test coverage in this pass; the live browser exercised decline/resubmit, qualified bidding, actual processing, revision and acceptance. This is self-review, not independent security or financial sign-off.


## Exceptional-path browser rehearsal — 4 November

A new disposable native PostgreSQL/identity fixture on port 4183 exercised:

- Changed an already-approved $5 offer to $7 in the employee conversation. The UI warned before selection; the old approval became stale and its reservation was released. A funding attempt was rejected by the server. Resubmission stayed on the same task; a later fresh approval reserved exactly $7 ($93 available), retaining the superseded $5 request in history.
- Removed employee membership while a message was being composed. Submission was rejected. Restoring membership did not restore the old approval; a fresh request was required.
- Queued safe retries for failed funding/refund/payout provider checks in the operations dashboard. The local provider fixture confirmed funded/refunded/paid respectively, and buyer conversations and builder earnings showed the matching outcomes. A fixture-server restart retained the task/payment states. No Stripe network calls or real money were involved.
- Separate provider-declared refund and payout failures remained blocked for review in builder earnings, without replacement-payment buttons. Successful bank payout was counted separately from transfer, rather than charging the buyer twice.

Repairs: the funding card now follows current company approval, hiding funding/start actions while approval is missing, stale, declined or pending. Pending approval has appropriate waiting copy. On an access-denied task action, the client rechecks task readability; if access is gone, it clears cached task/offer/preview/draft data and returns to the available workspace with a clear explanation. Ordinary forbidden actions on readable tasks and transient failures preserve the conversation; concurrent navigation cannot be overwritten by an older access recheck.

Fixtures seed commercial states and accepted delivery solely to reach payment exception paths. They do not demonstrate real Stripe, real operator verification or a live supplier. Full physical-device/screen-reader QA and independent release review remain open.

### Agent Market keyboard follow-up — 4 November 2026

Search previously rendered the entire workspace on change and explicitly returned
focus to search; changing agent type also remounted the selector. Filtering now
updates only the cards and a persistent polite result-count status. Search updates
on input, including clearing, and does not force focus or selection changes.
Category navigation retains its existing behavior; this is not a complete
accessibility certification.

QA: 107 web/shared-UI tests pass, including intersection of search/type/category,
empty-result recovery and harmless updates after leaving the market. JavaScript
syntax and diff-whitespace checks pass. Reviewed existing responsive grid selectors
for the new results wrapper; no direct-child layout dependency found. Localhost
health remains PostgreSQL/local-only. Browser automation was unavailable in this
session (`browser.user is unavailable`), so live keyboard, screen-reader and mobile
verification of this increment remains pending. No backend or provider changes.

### Category keyboard follow-up — 4 November 2026

Category selection now updates Agent Market results and selection state in place,
without replacing category buttons, the search field or type selector. Selected
categories expose `aria-pressed`; category headings are assigned as text, and
search/type filters remain applied. The regression test covers category switches,
empty results, Available, custom category text and an event after leaving the view.
All 108 web/shared-UI tests passed; syntax and diff checks passed. The earlier
506-test full release run is separate evidence, not a full rerun of this UI change.
Localhost remains healthy; no backend, Stripe, hosted or icebox changes.

Live verification still required: Tab to categories, activate with Space/Enter,
confirm focus stays on the activated button and Tab continues normally; combine
category/search/type and clear them; inspect narrow mobile layout and screen-reader
selection/result announcements in both themes. Browser tab control again failed
with `browser.user is unavailable`; native app access was also unavailable. Do not
mark these browser or assistive-technology checks complete from the unit tests.

### Distribution-first storefront increment — 4 November 2026

Authenticated buyers can open Agent Market profiles via `#storefront=<agent-id>`.
Profiles use the existing authorized catalog: operator, agent type, purpose,
capabilities and assessment evidence. Direct quote entry retains the selected agent
and existing server-side eligibility rules. There are no fabricated prices, samples,
ratings or traction metrics. Unlisted agents show an unavailable state, and agents
pending qualification cannot receive a direct request through the UI. Removed the
unsupported fallback “Verified builder” in market cards. Profile links are local,
account-gated URLs, not public listings. Refresh recognizes profile links after
identity loads; profile links do not silently switch builder accounts to buying.

112 web/shared-UI tests pass, including profile ID validation, content escaping,
partial qualification, unavailable profiles, quote handoff and hash navigation/Back.
Syntax and diff checks pass; localhost health is PostgreSQL/local-only. Browser tab
control still returns `browser.user is unavailable`; visual, mobile, screen-reader,
login-return and live Back/Forward walkthroughs remain pending. No backend/payment
behavior changed. The 506-test earlier full run is separate evidence, not a new full
run for this frontend increment. Stripe, demo, staging and the icebox stay unchanged.
