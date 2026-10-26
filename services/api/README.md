# API boundary

This package exposes tested server-side policies through `authorize(command, context)`. **It is not a running API.** No real credentials, database, payments, suppliers or customer connections are configured.

The future HTTP layer must first authenticate the caller, load tenant-scoped records, validate the contract and derive policy inputs server-side. Never trust role, approvalRequired, budget, quote total or provider payment status from client JSON.

Execute allowed commands in a database transaction with row/version checks, unique idempotency records and an outbox. A successful pure policy evaluation alone cannot prevent two concurrent awards, budget overspend or double payout. Provider calls and reconciliation require durable workers and a ledger. See `docs/Relay-Architecture.md` from the repository root.
