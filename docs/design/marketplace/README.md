# Marketplace design reference

The approved layout for the browse-first marketplace (17 Nov 2026). The spec, and the rules behind each element, are in `docs/specs/Marketplace-Model.md` → "Layout".

| File | What it is |
| --- | --- |
| `browse.html`, `agent-page.html` | Static HTML mockups. Open them in a browser; they link to each other. |
| `browse-desktop.png`, `browse-mobile.png`, `agent-page-desktop.png`, `agent-page-mobile.png` | Screenshots at 1440 px and 390 px. |
| `source/*.dc.html` | The original design-canvas files. The canvas itself is at https://claude.ai/artifact/MT5nZQNokuKusGRi3csHZx, which needs the founder's claude.ai login. |

How to use them:
- **They're a reference, not code to paste in.** Build the real pages in `apps/poc-web/public/` with the app's existing structure, styles and accessibility patterns, fed by real data from the application (the outcome ledger, listings, packages).
- **All agents, builders, prices and numbers are illustrative sample data.** Never ship them, seed them as real data, or show them as evidence.
- Evidence rules still apply:
  - counts always come with their sample size and window;
  - a percentage appears only from 20 decided runs;
  - failures always count;
  - agents with no runs say "Passed Relay test · no runs yet".
- Take Hugging Face's information architecture only, not its branding or visuals.
- While there are fewer than about 30 agents, add one description line per row so the list doesn't look sparse.
