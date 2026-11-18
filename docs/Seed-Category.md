# Seed category: B2B data & research

Decided 16 Nov 2026 (founder): B2B data & research first, plus whatever else is in highest demand. This note records the evidence and how it shapes the product.

## What the market data says (2026)

| Signal | Finding | Source |
| --- | --- | --- |
| Main jobs agents do today | Customer service (26.5% of agent builders) and research & data analysis (24.4%) are nearly tied as the most common main use cases | Hostinger summary of the LangChain agent survey |
| Enterprise deployment | Customer support (54% of enterprises) and sales & marketing (47%) are the most common production use cases | Agent Atlas enterprise survey, May 2026 |
| Freelance demand for AI work | AI video generation/editing +329% year over year, the fastest-growing AI skill; AI data annotation +154%; demand for AI-related skills more than doubled | Upwork In-Demand Skills 2026 |
| Paid research work | General research services and market research remain top-ten admin-support skills on Upwork; AI integration +178%, AI chatbot development +71% | Upwork 2026 marketplace data, via market scans |
| Where demand is moving | Of 63 work categories, 43 saw activities common in ChatGPT lose share of Upwork postings while less common activities gained | OpenAI × Upwork research, 10 Nov 2026 |

The last row is the most important one for Relay. Work a general assistant already does well is leaving paid marketplaces. Work that needs access, tools, accountability or ongoing operation is where budgets are moving. That matches the thesis: sell handled outcomes, not generic agents.

## Decision

1. **Seed: B2B data & research.** Company research, market and competitor research, lead lists and contact sourcing, enrichment, CSV cleanup and CRM delivery.
   - Demand is high (research is the #2 agent job).
   - Output is checkable: rows, fields, sources.
   - The work repeats (weekly lists, monitoring).
   - It needs the buyer's data and tools, where general assistants are weakest.
   - The code is already built for it (CSV normalization, company research, Attio delivery).
2. **Adjacent, and the natural expansion: sales & marketing.** Outbound and prospect lists, enrichment and CRM hygiene. Buyers describe these in the same breath as research, and they're the #2 enterprise use case.
3. **Highest demand, but later: customer support.** It's the most deployed agent category, but it's an always-on system that writes to customers. It belongs in managed recurring workflows once actions that touch customers are behind buyer approval (today agents can't write to customer systems at all).
4. **Watch: AI video.** It's the fastest-growing freelance AI demand, and the landing page already shows it. Output quality is a matter of taste and hard to verify automatically, which makes it a weak first category for a ledger built on verified outcomes.

## What changed in the product

- Matching vocabulary (`capability-matching.cjs`) now covers how buyers phrase seed-category work:
  - market and competitor research, due diligence;
  - contacts, lead lists, outbound;
  - enrichment and firmographics;
  - CRM names;
  - startups and firms.
  A support group is added for later. Regression tests also check that these additions don't match unrelated work.
- Next for the seed category, per `docs/specs/Agent-Cards-and-Public-Hub.md`:
  - open evaluation suites for company research and lead lists (fixed inputs, rubric, automatic field checks), following the `csv-normalize-v1` template;
  - builder outreach to 20 seed-category builders.

## Caveats

- The surveys skew toward technical and enterprise respondents. Treat percentages as direction, not market size.
- Several market scans are secondary summaries of Upwork data; the Upwork report is the primary source.

## Sources

- [AI agent for business: who uses agents, what they do (Hostinger, Nov 2026)](https://www.hostinger.com/au/tutorials/ai-agent-for-business/)
- [Enterprise agent adoption survey 2026 (Agent Atlas)](https://agentatlas.pages.dev/news/enterprise-agent-adoption-survey-2026.html)
- [Upwork In-Demand Skills 2026](https://upwork.com/research/in-demand-skills-2026)
- [Demand is rising for these AI skills in 2026 (Quartz)](https://qz.com/demand-is-rising-for-these-ai-skills-in-2026)
- [Where AI agent work is getting real in 2026 (DEV, market scan)](https://dev.to/arlana_reyna_7dffb39ff1d1/where-ai-agent-work-is-getting-real-in-2026-ten-high-demand-task-categories-with-live-market-2a41)
- [Work at the frontier: AI's effect on freelance work (OpenAI, Nov 2026)](https://openai.com/index/ai-effect-on-freelance-work?type=AI)
