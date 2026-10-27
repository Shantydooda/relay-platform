# Managed staging service

**Integration source prepared; the dedicated hosted database and signup hook are configured, but the application is not deployed or verified.** This service replaces local password hashing/SQLite with Supabase Auth and Postgres. The original localhost POC and published demo are unchanged. See the [provisioning record](../../docs/poc/Staging-Setup.md). The current Free dashboard requires custom SMTP to edit the email templates below; default templates are incompatible with this callback, so registration must remain unavailable until the supported email path is configured and tested.

## Runtime and deployment

`render.yaml` describes a new **Free** Node 24 service in Virginia with automatic deploys off. It must not be applied until provider account access, region and exact hostname are confirmed. No paid plan, card, custom domain, add-on or paid overage is authorized. The web service is reachable by HTTPS so auth pages can work; task access is invite-only. Do not confuse a private GitHub repository with private application data.

Required server environment values (configure in Render, never commit):

| Variable | Purpose |
|---|---|
| `RELAY_APP_ORIGIN` | Exact HTTPS staging origin, no path/wildcard. On Render only, may be omitted to use the host-provided `RENDER_EXTERNAL_URL`; request headers are never used. |
| `SUPABASE_URL` | Dedicated staging project's hosted `.supabase.co` URL |
| `SUPABASE_PUBLISHABLE_KEY` | Project public API key used with individual user JWTs |
| `SUPABASE_SECRET_KEY` | Server-only key for invitation checks, opaque session records and auth administration |
| `RELAY_SESSION_KEY` | 32 random bytes encoded as hex/base64; encrypts provider access tokens at rest |
| `PORT` | Supplied by Render; defaults to 10000 |

Start with `npm run start:staging`. Startup validates configuration and checks that the session table is reachable. It never falls back to local auth or SQLite. A liveness response is not proof that signup hooks, RLS or email are configured correctly.

## Provisioning order

1. Create a **Free** Supabase staging project in the agreed region. The human owner sets the database password through the provider UI. Do not import local users or passwords.
2. Apply `supabase/migrations/202610270001_accounts_tasks.sql` once to the dedicated project. It is one transaction. Keep a migration record; never paste it into an unrelated project. Local tests execute this exact SQL on Postgres/WASM with stand-in provider auth tables; those do not replace hosted tests.
3. Add only explicitly authorized tester addresses to `public.relay_invites` through an administrator-controlled path. Do not grant testers provider-organization access just to get around mail restrictions.
4. In Supabase Authentication → Hooks, configure **Before User Created** to call `public.relay_before_user_created`. This prevents direct provider signups outside Relay's UI. The hook is available on Free. Keep **Confirm email** on. Disable unused sign-in methods. Run a direct uninvited-signup negative test before admitting users.
5. Configure the exact site origin and `/auth/confirm` redirect; no broad wildcards. Set the email templates below. Without a verified domain, send only to the provider's permitted recipient addresses; no broad email testing is represented as working.
6. Review and apply the Free Render blueprint. Set the exact app hostname and server secrets in its environment settings. Let the host generate the encryption key; do not rotate it casually because active encrypted sessions will become unreadable.
7. Run the live acceptance matrix in `docs/poc/Staging-Setup.md`: two real identities, verification/resend, recovery, direct API/RLS access, revocation, retry/concurrency and restart. A human tester enters new credentials. Only then share staging with invited testers.

## Email templates

The app consumes one-time hashes only after the user clicks a confirmation button. Link scanners loading the page do not verify a credential. The hash lives in a **URL fragment**, not a server query, and is removed from the visible URL by the client before verification. No provider access/refresh token is delivered to browser code.

Confirm signup:

```html
<a href="{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}&amp;type=email">Verify your email</a>
```

Reset password:

```html
<a href="{{ .SiteURL }}/auth/confirm#token_hash={{ .TokenHash }}&amp;type=recovery">Reset your password</a>
```

Turn off email click tracking for these links. Test the actual rendered emails, not just the template source. Expired or reused links must be rejected by the provider. On confirmation failure, request a new email. The pre-auth request remains in memory in its original tab: return there and log in to save it. Unsent requests do not yet migrate across devices or page refreshes.

## Session and authorization boundaries

- Supabase validates credentials and email. Server calls `getUser` for the access token; caller-supplied identity or metadata cannot grant a tenant/role.
- The browser gets a random HttpOnly/Secure/SameSite cookie and CSRF token. Only a SHA-256 verifier is stored for that cookie. The provider access token is AES-256-GCM encrypted with the session hash as associated data. No refresh tokens are stored. Sessions end after at most one hour or 30 minutes idle; this is an explicit staging simplification, not seamless refresh support.
- Verification/password reset sessions are distinct. Recovery-only sessions have no workspace/task access. After password change, all app session verifiers are deleted and provider global logout is requested. Provider logout failure must not restore app access; it requires an operational retry/reconciliation path before broader release.
- Database eligibility checks current verified provider identity, invitation and existence of the provider's `auth.sessions` row. Revoked sessions do not gain access merely because an old JWT has not expired. All user task operations use user-scoped Data API clients; secret-key access is confined to server session/admin operations.
- Exposed tables have RLS and least-privilege grants. Authenticated users get SELECT only on their permitted rows; command functions own transactional writes. They cannot directly insert tasks, roles, messages, events or retry receipts.
- Task RPCs serialize retry-key handling, lock rows, enforce versions and record task/message/activity/retry receipts together. The direct API has the same capability checks as the BFF. This first slice intentionally supports personal owner-managed tenants only.

## Tests and limits

`npm run test:staging` runs crypto/config/provider-boundary tests, managed HTTP/UI wiring, and real Postgres SQL/grant/RLS tests via development-only PGlite. It does not contact a live provider, send email or provision a service. PGlite uses one connection; true multi-connection race tests remain a hosted-Postgres gate. The full root suite also preserves the local POC/domain/contract tests.

Remaining before a team rollout: actual provider configuration/delivery evidence, multi-connection races, independent auth/security review, restore exercises, session cleanup/retention and revocation retry operations, fuller rate/abuse controls, pagination, durable pre-auth drafts, MFA and longer-lived refresh handling. The one-hour staging session policy is intentionally conservative. Do not call this a completed production authentication system.

Sources checked: [Supabase signup hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [session revocation](https://supabase.com/docs/guides/auth/sessions), [Render blueprint specification](https://render.com/docs/blueprint-spec), [Render host-provided URL](https://render.com/docs/environment-variables). The official Supabase SDK is pinned at 2.118.0; PGlite 0.5.12 is a development-only test engine. All 50 tests passed under Node 24 during staging preparation. The subsequent Render origin fallback passed the 10 managed-auth/config tests, including origin precedence and rejection checks.
