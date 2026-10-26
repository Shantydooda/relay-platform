# Relay POC web

Separate source for the real account + durable task slice. Served by `@relay/poc-api` on a separate loopback origin. Does not load or mutate `dist/`, prototype localStorage, `.openai/hosting.json` or published Site state. The demo remains on its existing `.site` URL.

`public/app.js` handles UI state and same-origin API transport. Ownership, task status, versions and sessions are enforced by the API. User content is escaped for HTML or written with textContent; no user content is evaluated. Tokens come from `packages/ui/src/tokens.css`. No third-party analytics, fonts, scripts or trackers are loaded. Auth/session credentials and task records are never written to browser storage.

The logged-out page reuses the approved ivory marketing design and animated characters through the presentation-only `packages/ui/src/public-landing.cjs` and CSS. It uses the shared composer and the POC's auth handoff, not prototype behavior. Character assets are copied into this app; no prototype script is loaded. Eye-joint origins are CSS classes so the existing strict CSP can remain intact. Marketplace/team sections describe planned product behavior and are marked as unavailable in this POC.

Buyers can enter a request before auth, carry it into a draft, edit/post/cancel, append messages and reopen the task. A single account can switch to the separate builder shell; there are no pretend agents or payouts. Buyer/builder selection is a UI preference, not an authorization role. Context-specific signup chooses the destination; generic signup asks which side. Only personal owner-managed tenants are provisioned in this slice.

Use `npm run start:poc` from the root. `npm test --workspace @relay/poc-web` syntax-checks the frontend; API integration tests live in `services/poc-api/test`. Browser walkthrough evidence and known gaps are tracked in `docs/poc/Accounts-and-Tasks.md`.

Request text is retained in memory through the auth handoff, not across refreshing an unsent form. **Saved** drafts/messages survive refresh and server restarts. Failed writes retain text; retry keys are reused while the page remains open. Automatic conflict merging, background polling, unsent draft recovery, password recovery and richer mobile history controls are not implemented. A version conflict asks the user to refresh rather than silently overwrite newer work.
