# Relay platform

Production-bound Relay POC source, separated from the published browser demo. It includes real local accounts/tasks and a **managed Supabase/Postgres staging environment deployed on free services**. Hosting/database connectivity and anonymous task denial are verified; email delivery, authenticated acceptance tests and security review remain open. [Current provisioning record](docs/poc/Staging-Setup.md).

The approved ivory public landing design, animated assistants and chat-first signup entry are included. Marketplace bidding, external agents, payments and delivery are not simulated in this app. A posted task is a durable request, not a dispatched job.

## Local development

Use Node 24 LTS (`.nvmrc`). The source has been exercised on Node 25.2.1 on the development machine; repeat in the target LTS/CI environment. Its built-in SQLite API emits an experimental warning there.

```sh
npm ci --ignore-scripts
npm run start:poc
```

Open `http://127.0.0.1:4180`. If the original POC is already running on that port, stop it or run this copy with `RELAY_POC_PORT=4181 npm run start:poc`. Each checkout has its own `.poc-data/relay.sqlite`; no accounts or task records were copied into this repository.

This local launcher intentionally accepts only loopback requests and refuses production mode. Do not deploy it to Render or remove the guard. The separate `services/staging-api` launcher uses managed auth and Postgres and requires verified provider configuration. [Managed staging setup and security boundaries](services/staging-api/README.md).

## Packages

| Path | Responsibility |
|---|---|
| `apps/poc-web` | Current account/task frontend |
| `services/poc-api` | Real local HTTP auth, sessions and task storage |
| `services/staging-api` | Managed Supabase auth, encrypted opaque sessions and Postgres adapter; deployed to isolated staging |
| `supabase/migrations` | Postgres tenant policies, signup hook and transactional task commands |
| `packages/ui` | Presentation components, public landing and design tokens |
| `packages/domain` | Marketplace money/approval/acceptance policy primitives; not live payments |
| `packages/contracts` | Draft production transaction contract; not the implemented POC API |
| `services/api` | Tested policy boundary; not a hosted HTTP service |

```sh
npm test
npm run test:web
npm run test:api
npm run test:policy
npm run test:contracts
npm run test:staging
```

API tests open ephemeral loopback ports and use disposable databases. They do not send emails or mutate the running app. [Implemented API and runbook](services/poc-api/README.md).

Validation: **50 backend/domain/contract/UI/Postgres tests pass**, plus the independent frontend syntax check. This count excludes the old workspace's simulated-marketplace and static-demo-output tests. Managed provider responses are fixtures; SQL/grant/RLS tests execute the actual migration on embedded Postgres with stand-in auth tables. Real hosted delivery, recovery and multi-connection tests remain open; hosting/database connectivity alone does not validate those flows.

## Staging decisions

- Approved providers: **Supabase** for managed auth/Postgres, **Render** for hosting, **Resend** for SMTP when a verified domain is available.
- Budget: **free services only**. No paid plan, payment method, domain purchase or paid add-on is authorized.
- Region: Supabase North Virginia and Render Virginia are provisioned on Free plans; location alone is not a compliance conclusion.
- Domain: none owned yet. Start the app on its provider hostname; auth email testing must respect the provider's authorized-recipient restrictions until a sender domain is verified.
- Access: proposed invite-only membership with verified email. A hidden URL or frontend-only allowlist is insufficient.

[Hosted staging setup, account prerequisites and acceptance checks](docs/poc/Staging-Setup.md).

## Demo isolation and source provenance

Initial source extracted from the reviewed Relay workspace at commit `0f3fa55`. Included only the POC, UI/domain/contract packages and policy boundary. Excluded `dist/`, legacy simulated-workflow tests, `.openai/`, Site Git credentials, environment files, database files, node_modules and Git history. Character artwork is included as a product asset; demo runtime code is not.

The existing published `.site` remains the demo and is not connected to this repository's deployment. No local QA account is a production account. Do not import prototype passwords, profiles, fake qualification results or financial records into staging.
