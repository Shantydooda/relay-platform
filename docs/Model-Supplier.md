# Local model-backed supplier

1 November 2026. Localhost only; unpaid execution. No hosted deployment, Stripe connection, or demo changes.

## Purpose and boundaries

This reference supplier exercises real local inference across the existing Supplier API/SDK: heartbeat, capability qualification, automatic quote, buyer award, execution, scanned files, revision and acceptance. It is a separate supplier process, not an automatic competing Relay marketplace agent.

The first capability is deliberately narrow: extract HTTP(S) links from supplied text and deliver `links.json` plus `link-report.txt`. Qwen3 8B extracts the URLs. Code normalizes, deduplicates and sorts that output, then independently checks the complete result against the supplied source. Counts are computed by code. There is no deterministic fallback if inference fails or omits/invents links. This hybrid is intentional: sorting is not a language-model judgment.

This does not qualify web research, link safety/reachability, lead enrichment, general writing, or arbitrary tasks. Source URLs are never visited. The deterministic reference is more efficient for this particular task; the model version validates the integration path, not a business case for using a model for URL extraction.

## Run

1. Start Relay locally and the existing free local model service with `npm run model:local` in another terminal. The model service must have `qwen3:8b` installed; this command does not buy a service or configure a cloud model.
2. In the builder workspace, register a specialist agent with an explicit link-extraction capability, select SDK/API, enable automatic bidding, and create/download its supplier connection file.
3. Make that file private (`chmod 600 /absolute/path/to/supplier.json`) and run:

   ```sh
   node services/model-runtime/src/cli.cjs --config /absolute/path/to/supplier.json
   ```

4. Run the **Offline link inventory** capability qualification from builder setup. The process responds to both the initial test and revision through the SDK. Buyers see the existing per-capability evidence and its narrow limitation. Connection alone is not qualification or operator verification.
5. Post a supported brief as a buyer, using this explicit prefix:

   ```text
   Extract web links from this text:
   https://zeta.example/docs https://alpha.example/docs https://alpha.example/docs.
   ```

6. Compare the offer, select it, and explicitly authorize unpaid local execution. Download/review the resulting files in the existing task conversation. The supported revision is `Sort links descending.` The buyer accepts delivery explicitly.

The credential file contains `origin`, `agentId`, and `token`. Never commit or paste it into chat. CLI accepts only an explicit localhost supplier origin through the existing SDK and refuses public-readable or symlink configuration files. Rotation/revocation uses the existing builder controls. Stop with Ctrl+C.

## Failure and access behavior

- Model endpoint is fixed to loopback port 11435; redirects are refused. Supplier credentials never enter the prompt.
- Input is bounded to 8,000 UTF-8 bytes; model response to 64 KiB; inference to 90 seconds. Oversized briefs are not bid on. Combined supporting sources can exceed the bound and fail execution rather than truncate silently.
- Existing task permission requests are used before reading selected connected sources. The model cannot grant itself access, invoke tools, accept offers or move money.
- During inference, lease progress renews every 10 seconds. Renewal failure aborts inference; server lease fencing remains authoritative. Stop/revocation cannot authorize a late submission.
- Inference/evidence errors mark execution failed and produce no fabricated files. Qualification errors are not reported as passes. Poll-level failures back off 30 seconds. Existing qualification deadlines, assignment attempts, queue deadlines and credential expiry remain in force.
- Only event names and bounded uppercase error codes are logged. Source contents, credentials and model outputs are not routine logs.
- One process executes sequentially. This local supplier shares the installed Ollama server with local scoping; it is not integrated into Relay's internal scoping queue. Separate supplier infrastructure/capacity is required before treating this as a production supplier service.

## Reproducible evaluation

`node --test services/model-runtime/test/*.test.cjs services/link-runtime/test/*.test.cjs` tests validation failures, cancellation, lease loss, SDK delivery, and deterministic-reference compatibility.

With native local PostgreSQL, Qwen3 8B and configured ClamAV running:

```sh
node services/model-runtime/eval/local.cjs
```

The opt-in integration evaluation creates a disposable PostgreSQL database, identity store, private SDK configuration and loopback server on port 4184. A separate CLI process performs actual qualification and revision, bids, executes, submits files and revises. Buyer commands check downloads and accept delivery. Real ClamAV scans the files. Cleanup drops only the generated evaluation database and temporary files. It does not seed the user's application accounts or tasks.

This is self-evaluation of our reference integration, not independent supplier validation or production approval. A third-party AI supplier, hosted identity parity, real connector credentials, real Stripe sandbox, deployment/load testing and independent security/payment review remain separate release gates.
