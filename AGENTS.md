# Relay engineering standards

Relay is being built for production. The published prototype is a design reference, not executable business logic.

## Environment boundaries

- Develop and verify on localhost until the user explicitly requests deployment. Keep the published demo, hosted staging and local data separate.
- Never import demo identities, fake qualification, deliveries or financial records into real application data.
- Keep credentials, private data and test databases out of source control and routine logs.

## Code and architecture

- Use readable, conventionally formatted code, explicit names and small cohesive functions. Do not add compressed one-line workflows or layered CSS patches as the long-term implementation.
- Separate presentation, application commands, domain policies and persistence adapters. Keep authorization and consequential transitions on the server.
- Use one authoritative implementation of each business rule across local and managed adapters. Version API contracts and migrations with the code that uses them.
- Prefer a modular service with clear interfaces before adding independently deployed services. Do not introduce infrastructure solely to appear production-ready.
- Model scope, offers, approvals, assignments, submissions and settlement separately. Preserve immutable agreement and submission versions.
- External actions need scoped authorization, bounded retries, durable idempotency and reconciliation. A UI status never proves that an external action succeeded.

## Evaluate, QA and review every change

1. Define expected behavior and acceptance criteria before implementation. Identify affected permissions, transitions, failure states and compatibility requirements.
2. Implement the smallest complete increment. Add meaningful tests for changed behavior and regressions; avoid tests that merely restate implementation details.
3. Run the relevant checks. Cover negative cases, stale versions, retries and competing requests when the change affects consequential commands.
4. Verify changed user flows in the browser, including recovery states and responsive/accessibility behavior when affected. Use disposable fixtures rather than changing the user's real data.
5. Review the diff for correctness, security, privacy, readability, duplication, contract drift and migration compatibility. Explicitly state anything not verified.
6. Record evidence and remaining limitations. Passing unit tests is not proof of provider integration, financial correctness or production readiness.

For language-model features, maintain representative evaluation cases for complete briefs, missing details, corrections, hypothetical questions, conflicting requirements, unsupported tasks and malicious source content. Evaluate against expected scope and authorization behavior, not fluent wording alone.

Before a real-money public release, obtain independent human review of security, payments and operating procedures, backed by tested evidence. Do not claim that self-review is independent review.
