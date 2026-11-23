# Spec: agent cards and the public hub (Layer 1)

Status: proposed, 16 Nov 2026. Governed by `docs/Product-Thesis.md`. Publishing anything publicly needs the approvals listed at the end.

## Goal

The moat: the place where builders publish agents first, because their reputation there is **verified and public**, as on Hugging Face. Buyers trust it because the evidence is real.

## The agent card

A versioned, public description of one agent version. Builders write the descriptive fields; Relay writes the evidence fields. The two are never mixed.

| Field | Written by | Notes |
| --- | --- | --- |
| name, summary, operator display name | Builder | Operator identity is shown only with the builder's consent |
| capabilities (category, task, inputs, outputs, industries, regions, tools) | Builder | Already modelled as capability metadata; labelled "declared by the builder" |
| required permissions (sources, tools, write access) | Builder | Shown to buyers before any grant |
| runtime version | Relay | Stamped on every assignment since `1a1bd6f` |
| assessment results (rubric, date, rounds) | Relay | Already produced by qualification |
| **outcome ledger** per version: runs, accepted first time, after revision, failed, refunded, cancelled; window; environment | Relay | `outcome-ledger.cjs`. A rate only from 20+ runs; never self-reported |
| open evaluation results on public task suites | Relay | New; see below |
| discussion | Community | New; moderated |

## Rules

1. **Evidence is verified, never self-reported**, and always shows its sample size and window. Pilot and sandbox evidence are labelled as such and never presented as paid-customer proof.
2. **No pay-to-rank.** Ranking uses fit, verified outcomes and fair exposure for qualified newcomers (`fair-exposure.cjs`). Paid verification buys an evaluation run, never a result.
3. **Publishing is free.** Charge for hosting, observability and private hubs (thesis revenue model), never for being listed.
4. **Buyers' data never appears on a card.** Ledger entries are counts; no task content, buyer names or files.

## Open evaluations

- Public task suites per capability category, starting with the seed category, with fixed inputs, a rubric and an automatic check where possible. The existing `csv-normalize-v1` rubric is the template.
- Runs are re-executable, and results are tied to the agent version and suite version.
- Shadow runs on real, buyer-sampled inputs (with buyer consent) feed the ledger as a separate, labelled source. This answers the kill test "can the ledger get past small numbers?".

## Distribution (built into developers' code)

- A public agent-card JSON format, versioned in `packages/contracts`.
- Read-only endpoints: `GET /hub/agents`, `GET /hub/agents/:id/versions/:version`.
- An SDK and MCP endpoint, so a buyer's own tools can call a Relay agent by id under Relay's agreement, payment and review.

## Delivery order

1. Card format and a read-only signed-in view (extends the existing Agents browse view and inspector). No public exposure yet. **Evidence half built (16 Nov 2026):** `services/application/src/agent-card.cjs` adds a verified track record to the signed-in storefront: overall, per runtime version (newest first, current marked, at most 10) and per capability. The JSON format in `packages/contracts` comes with step 3.
2. Builder consent and controls: what is public, operator display name, unpublish.
3. Public read-only hub pages and endpoints.
4. Open evaluation suites for the seed category. **First slice built (22 Nov 2026, branch `claude/eval-suites`):** company research and lead list suites, public inputs with hidden answers, field-level automatic checks, scores on the agent page with their sample; no ranking effect (`Decisions-Needed.md` §9).
5. SDK / MCP calling.

## Approvals needed

- **Public exposure:** the pilot is invite-only. Making builder or agent data public needs your decision on when, and builder consent terms.
- **Seed category:** decides the first evaluation suites.
- **Community moderation:** who moderates discussions, and with what policy, before discussion opens.
