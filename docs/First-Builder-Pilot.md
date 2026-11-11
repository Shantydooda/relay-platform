# First independent builder pilot

10 November 2026. Preparation on localhost only. No deployment, live charge,
qualification override or buyer-data sharing is implied by this guide.

## Audit and release gates

Already implemented: agent registration and scoped credential rotation, pull-based
opportunity/assignment feeds, quoting rules, buyer selection and authorization,
fenced execution leases, submissions, scanning, revisions, acceptance and recovery.
The existing CSV/link workers and automated tests are internal reference evidence;
they do not establish that an independent builder can integrate successfully.

The SDK connection checker previously imported the internal reference worker CLI.
It now uses a package-local private-config reader so the source-only SDK can be
handed over without Relay's private repository or application dependencies.

Still needed from the builder: API contract, supported inputs, sample outputs,
provider idempotency/job-status/cancellation semantics, runtime limits and a
supported revision. Keep provider credentials in the builder's environment.
Endpoint mapping remains adapter code; registering an endpoint is not an integration.

Network gate: the SDK now accepts explicit HTTPS as well as loopback HTTP, but no full hosted supplier backend has been deployed. A builder on another
machine still cannot connect to this localhost Relay instance. For the first supervised rehearsal,
review and run the builder-supplied adapter on a designated local machine alongside
Relay, or let the builder run their own local Relay checkout. Neither proves remote
connectivity. A shared hosted pilot needs separate authorization and HTTPS/auth/
network review; do not expose localhost or relax the origin restriction implicitly.

Qualification gate: use an existing rubric only if it actually measures the
capability. Research/design cannot borrow a CSV qualification badge. Define and
implement an appropriate assessment before claiming those capabilities qualified.

## Builder handoff

Create a source-only SDK archive locally (not a registry publication):

```sh
npm pack ./packages/supplier-sdk --pack-destination /tmp
```

Review archive contents before sharing. No connection files, environment files,
customer data or provider credentials belong in it. Extract into a private working
folder. Node.js 22+ is required; the SDK has no external runtime dependencies.
Register the agent in Builder → Agents, declare the actual capability, save HTTP
API or SDK, and create/download its private connection file. Protect it with
`chmod 600`. From the extracted package run:

```sh
node src/check-connection.cjs --config /private/path/relay-agent.json
```

This diagnostic reads three feeds; it does not heartbeat, verify agent identity,
qualify, quote or start work. In the adapter compare heartbeat.agentId with the
configured agent ID. Configure automatic bidding, minimum quote and capacity;
quote only briefs the actual API can fulfill. See Supplier-API.md for schemas and
packages/supplier-sdk/README.md for lease, retry and permission semantics.

## One real task, with explicit acceptance

1. Agree a narrow task with the buyer, using public or deliberately supplied data.
   Record deliverable format, coverage, sources/evidence, deadline, exclusions and
   one revision criterion before posting. Do not use private customer data as a fixture.
2. Connect the builder adapter and verify identity, heartbeat and capability.
   Complete the relevant qualification test and revision if a suitable rubric exists.
3. Post the buyer's brief. Confirm the builder-generated quote uses the correct
   capability, amount and estimate; buyer explicitly selects that exact offer.
4. Use the existing unpaid local execution authorization for the first integration.
   This supplier path does not create earnings. Stripe stays in test mode; test-money
   funding/payout is a separate gate, not proof that this unpaid run is settled.
5. Claim before reading authorized files or calling the provider. Persist command
   keys and provider job IDs; renew the lease during long work. Stop on revoked
   authority. Do not restart a provider job after an ambiguous response.
6. Submit actual files and evidence. Wait for a real clean scanner verdict; never
   bypass quarantine. Buyer downloads and checks contents against the brief.
7. Request the agreed revision. Adapter obtains a fresh lease; buyer reviews and
   accepts the latest submission. Verify the same task and submission in both views.
8. Rehearse a provider failure, adapter restart after uncertain submission, credential
   revocation and a permission denial using disposable data. Confirm no duplicate
   external jobs, no stale-lease delivery and an actionable status for the buyer.

## Evidence and go/no-go

Record task/agent/submission IDs, adapter version, start/finish timestamps, quote,
acceptance criteria, scanner outcome, revision outcome and retry/revocation results.
Record failures and who intervened. Never include secrets or private file contents
in logs. Mark each result observed / failed / not tested; leave independent-provider
acceptance open until a builder-owned API has actually completed this checklist.

No live payments, hosted pilot or independent-provider success is asserted by the
local regression suite. An unresolved connectivity, qualification, scanning or
provider-idempotency gate is a stop condition for that part of the pilot.

## Local preparation evidence — 10 November 2026

The source-only archive allowlist contains README, package metadata and five SDK
source files, with no credentials, tests, databases or internal runtime dependency.
A disposable HTTP fixture runs the checker from an isolated directory and verifies
three authenticated GETs only. Focused SDK/runtime checks: 42 passed. Full backend
regression: 769 passed. Localhost returned HTTP 200 after the checks. No UI changed;
no independent-provider or authenticated buyer/builder browser run was performed
in this preparation increment. Demo, staging and payment configuration were unchanged.
