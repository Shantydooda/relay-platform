# Documentation map

Start with [current status](Status.md). Component documents retain dated implementation evidence; their earliest paragraphs are not necessarily the latest feature state.

| Need | Read |
| --- | --- |
| Product requirements | [PRD snapshot](Relay-PRD.md) |
| Understand the product and code | [Root README](../README.md), [Architecture](Architecture.md) |
| Understand lifecycle boundaries and transition risks | [State-machine audit](State-Machines.md), [transition contracts and coverage](Transition-Contracts.md) |
| Run locally | [Local development](Local-Development.md), [PostgreSQL](Native-Postgres.md) |
| Connect a supplier | [Supplier API](Supplier-API.md), [SDK](../packages/supplier-sdk/README.md), [qualification](Capability-Qualification.md) |
| Plan builder and buyer acquisition | [90-day distribution plan](Distribution-Plan.md) |
| Start week one outreach | [Sales, creative and web prospects with outreach drafts](Distribution-Prospects-Broader-Categories.md); [earlier research and real estate shortlist](Week-One-Prospects-and-Outreach.md) |
| Understand marketplace distribution | [Distribution audit](Agent-Distribution-Audit.md), [marketplace](Local-Marketplace.md) |
| Company roles and approvals | [Company workspaces](Company-Workspaces.md), [cross-role rehearsal](Cross-Role-Rehearsal.md) |
| Payments and reporting | [Sandbox payments](Sandbox-Payments.md), [spending reports](Spending-Reports.md) |
| Files and tools | [Object storage](Object-Storage.md), [Drive](Google-Drive.md), [delivery integrations](Delivery-Integrations.md) |
| Scoping and runtimes | [Conversational scoping](Conversational-Scoping.md), [model supplier](Model-Supplier.md), [workspace apps](Workspace-Apps.md) |
| Managed identity and recovery | [Identity parity](Managed-Identity-Parity.md), [membership producer](Managed-Membership-Producer.md), [membership feed](Managed-Membership-Feed.md) |
| Prepare a release | [Acceptance](Release-Acceptance.md), [verification](Release-Verification.md), [CI](Continuous-Integration.md) |
| Understand deferred scope | [Icebox](Product-Icebox.md) |
| Investigate implementation history | [V1 readiness log](V1-Readiness.md), [unified backend](Unified-Backend.md) |

Documentation should say whether evidence came from a unit test, local fixture, browser observation, real sandbox provider or independent review. Do not turn a local passing check into a production claim.
