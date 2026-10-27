# Private hosted staging — setup handoff

27 October 2026. **Database provisioned; application deployed; email acceptance testing blocked.** Supabase/Render/Resend are approved. Budget is free services only; no paid resources or domain purchase are authorized. The founder created `relay-staging` on Supabase Free in East US (North Virginia). No domain is owned yet; administrator/tester identities and email delivery configuration remain outstanding. The existing public `.site` stays a separate demo; its hosting identity and audience must not change.

Implementation update: [the managed staging service](../../services/staging-api/README.md), Postgres migration, verification/recovery UI and Free Render blueprint are prepared for review. **50 local tests pass.** Both provider dashboards are accessible. This does not establish that hosted application or email acceptance tests pass.

## Hosted provisioning record

- Supabase project: `pjnhmlhaabjqqifjixio`, `relay-staging`, Free, `us-east-1`; dashboard reports Healthy.
- Executed `supabase/migrations/202610270001_accounts_tasks.sql` in the dedicated project's SQL Editor; result: `Success. No rows returned`. SHA-256: `ff2937144fc5ef89ad7794a897c67cf761101f1f6144e56453f1c8869e0f9b74`.
- SQL Editor query record: `2ab89286-0551-45b7-8318-3c073a977368`. This is a manual application record, not a Supabase CLI migration-history entry. Do not rerun the initial non-idempotent migration.
- `Before User Created` hook visibly ENABLED with `public.relay_before_user_created`. Email confirmation is ON, anonymous sign-ins OFF, and only the Email provider is enabled. The invitation table has no admitted testers yet.
- The current Free dashboard disables email-template editing without custom SMTP; its other option is a Pro upgrade. Our fragment-hash confirmation/reset templates are therefore **not configured**. Do not use default links with the current callback implementation, disable verification, or mark registration ready. Custom SMTP (or a separately reviewed email-hook implementation) is required first.
- Render service `srv-dbfvfcu1egvs73a5l18g`, `relay-staging`, Free ($0/month), Virginia, branch `codex/managed-staging-auth`, Node 24, build `npm ci --omit=dev --ignore-scripts`, start `node services/staging-api/src/server.cjs`, health `/health`, auto-deploy Off. Founder approved transfer of staging Supabase keys directly into Render. Credentials were configured through the browser, never written into source or local files. A 32-byte random session encryption key is held in Render's environment settings.
- First deployment `dep-dbfvfde1egvs73a5l3c0`, commit `6228673`, visibly succeeded. Staging URL: https://relay-staging-j2iy.onrender.com. `/health` returned `status:ok`, `storage:postgres`, `mode:managed-staging`; anonymous `/api/tasks` returned `SIGN_IN_REQUIRED`. The approved landing loaded with managed-staging banner. These checks do not prove authenticated task operations or email flows.
- Supabase Site URL is the exact staging origin; its redirect allowlist contains only `https://relay-staging-j2iy.onrender.com/auth/confirm`. No wildcard redirect.
- Resend account setup is pending. Domainless Resend testing is restricted to the account owner's email; do not represent this as team email readiness. Founder was asked to identify/authorize the first staging tester; no invite was inserted.
- All 50 tests passed on Node 24 before this configuration step. After adding the Render origin fallback, all 10 managed-auth/config tests passed again, including missing/invalid origins and explicit-origin precedence.

## Proposed stack

- Supabase: a dedicated **staging** project for managed email/password authentication and hosted Postgres.
- Render: a separate HTTPS application service connected to a private source repository/approved branch. Never deploy the local SQLite launcher to ephemeral hosted storage.
- Resend: custom SMTP for verification, invitation and password-reset email from an owned, verified sending domain.

The stack is approved, but these are not created resources. Final region, provider plan, backup availability, email sending limits and total cost must be checked against the approved budget during provisioning. If EU residency is required, select a specific EU database region and review the app/email providers too; a broad “Europe” region does not itself guarantee EU residency. [Supabase regions](https://supabase.com/docs/guides/platform/regions)

## Needed from the founder

1. Sign in to the approved provider dashboards yourself; do not paste passwords or secret keys into chat. GitHub CLI was reconnected with explicit founder approval. The private [relay-platform repository](https://github.com/Shantydooda/relay-platform) now contains the tested, sanitized POC source.
2. Confirm the final data region. Free-only is approved; do not upgrade, add a payment method or enable paid add-ons. No provider terms or billing commitments have been accepted in this pass.
3. Supply the administrator/tester email addresses and an owned domain, or approve starting the app on a provider subdomain. The sending domain still needs verification for reliable auth email. Supply the DNS provider/access route when records are ready to review.

Prefer user-owned provider organizations. Secrets belong in their environment/secret managers, not source, browser bundles, screenshots or messages. Use scoped project credentials and a protected deployment branch. The staging app needs its own database, sender settings, callback URLs and secrets; none should be inherited from the public demo or a future production environment.

## What “private” means

Default proposal: invite-only accounts and data. Auth landing, verification and reset pages must remain reachable to invited users; anonymous/uninvited users cannot access tasks or provision a workspace. A hidden URL, robots directive or frontend email check is not access control.

Enforce eligibility server-side **and** at the managed-auth signup boundary, using closed signup/invitations or a reviewed signup hook. Recheck active membership on protected reads and writes. If the entire site must be concealed before login, add a separate approved edge-access layer and test that it does not break auth callbacks. Confirm this distinction before publishing a staging URL.

## Implementation after access is available

1. Provision a dedicated staging project/service/repository path. Store environment configuration in provider secret managers. Do not simply remove the local launcher's production guard.
2. Replace local password/session handling with the managed provider integration. Keep tokens and refresh handling in the server/BFF boundary; preserve secure HttpOnly cookies, CSRF/Origin protections and safe callback allowlists. Do not import local QA passwords or fake prototype identities.
3. Apply versioned Postgres migrations for profiles, personal tenants, memberships, tasks, messages, events and retry receipts. Map users by provider UUID, not mutable email or user-editable metadata. Recreate transactional idempotency/version constraints. Keep business commands server-owned.
4. Establish least-privilege grants and tenant policies. Where the Data API is exposed, enable and test RLS on every exposed table. Never put secret/service-role keys in a frontend. Test access through both the application and the direct exposed API so clients cannot bypass application checks. [Supabase data security](https://supabase.com/docs/guides/database/secure-data)
5. Enable email confirmation, configure exact site/redirect URLs, verify the SMTP domain and sender, and review verification/invitation/recovery templates. Never disable verification to work around mail issues. Supabase's default sender is limited to project-team addresses; use custom SMTP for invited testers. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)
6. Wire registration/verification/resend, returning login, generic password-reset request, recovery callback and new-password completion. Require provider-verified email plus eligible active membership before task access. Unknown reset addresses must get the same public response as known addresses. Restrict recovery sessions, expire/consume links and revoke old sessions according to the provider's supported mechanism. [Supabase password flows](https://supabase.com/docs/guides/auth/passwords)
7. Deploy to an isolated HTTPS app hostname with secure cookies, no-store private responses, no secrets in logs and exact callback origins. Configure secrets through the host, not a checked-in deployment file. [Render secret configuration](https://render.com/docs/configure-environment-variables)
8. Run the acceptance matrix below against the **real hosted providers**, then present evidence and known limitations before external testers are admitted.

## Required staging acceptance evidence

| Scenario | Pass condition |
|---|---|
| Invited buyer registration | Receives real verification email; no task access before verification |
| Invited builder registration | Verification completes into the correct builder destination |
| Uninvited direct signup or API call | Denied, including calls made outside Relay's UI |
| Verification resend/expired or reused link | Clear recovery path; no duplicate accounts or memberships |
| Existing login and refresh | Secure session persists correctly; no raw tokens in browser storage |
| Forgot password for known/unknown address | Same public response; only eligible account receives email |
| Expired/reused/tampered reset link | Cannot change credentials or grant task access |
| Successful password reset | Human tester enters the new credential; verify old-session revocation and returning login |
| Two independent accounts | Cross-tenant reads, writes, messages and direct database/API access denied |
| Duplicate/stale/concurrent task commands | One durable result, stale version conflict, no lost updates |
| Host restart/redeployment | Same task/session behavior restored according to documented policy |
| Membership revoked | Subsequent protected access denied, including existing sessions |
| Malformed callbacks/open redirects | Rejected; tokens absent from logs, error pages and referrers |
| Backup/restore | Protected backup restored into an isolated environment; task history intact |
| Demo isolation | Existing `.site` remains functional with its prior simulated accounts/data |

The original workspace’s 123-test local suite is not evidence that these hosted flows pass. The clean platform repository excludes demo-only tests and records its own independent test count. Provider integration tests, actual email delivery, Postgres/RLS tests, independent security review and a restore exercise remain open. Neither the local custom auth nor a copied prototype screen should be represented as managed staging.

## Visual correction included in this pass

The local POC originally used a simplified green landing page. Its logged-out page now uses the approved ivory landing design, four animated clay characters, original sections and chat-first entry. A presentation-only renderer/CSS live in `packages/ui/src/public-landing.*`; the POC owns copies of the two approved character assets. No demo auth or simulated marketplace scripts are loaded. All events use the POC's delegated handlers; inline script/style permissions were not added to CSP. Saved accounts/task behavior is unchanged.

## Free-only constraints

Render Free services can sleep and lose their local filesystem on restart, so hosted account/task state must live in Supabase, not SQLite. Configure no paid overages; do not assume a Free compute choice is a universal billing cap. [Render Free limits](https://render.com/docs/free)

Without a verified sender domain, use only provider-authorized email recipients during the technical test. Do not add testers as provider-organization members just to bypass email restrictions: that grants infrastructure access, not ordinary product membership. Broader email verification/reset testing waits for approved sender configuration.

Supabase is provisioned in North Virginia; Render Virginia remains the intended matching region. Choosing US infrastructure does not by itself remove obligations tied to the business and its users. [European Commission scope guidance](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en)
