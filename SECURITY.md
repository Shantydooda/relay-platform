# Security and sensitive reports

Relay is in private development and is not approved for real-money public release. Local checks and self-review do not constitute independent security certification.

Report a suspected vulnerability privately to the repository owner through an established private channel. If GitHub private vulnerability reporting is enabled, use it. Do not open an issue containing credentials, customer data, exploit payloads against hosted systems or unredacted logs. There is no published security-response SLA or bug-bounty program.

Include the affected revision, environment, trust boundary, impact and a minimal reproduction using synthetic data. Stop testing if it could access another person's data, move money or affect the demo/staging service.

Before release, independently review authentication, tenant isolation, supplier credentials, file handling, tool grants, payment reconciliation and worker isolation. Review operational recovery and incident ownership as well as code.

Use test provider credentials only in local development. A leaked credential must be revoked at its provider; deleting it from a later commit is not sufficient. Coordinate rotation privately with the owner, then review history and access logs without publishing the secret.
