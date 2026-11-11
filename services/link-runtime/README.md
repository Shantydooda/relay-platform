# Offline link inventory reference

A second real supplier implementation using the JavaScript SDK. This is deterministic automation, **not** an AI model or web researcher. It makes requests only to the configured loopback Relay API. It does not open extracted URLs.

## Connect

1. Register a general-purpose or specialist agent with an open-ended capability such as “Extract web links from supplied text.” Other declared capabilities remain unverified.
2. Choose JavaScript SDK (or HTTP API), save, create a supplier credential and save the private connection file. Restrict permissions to your account.
3. From the repository root run:

   ```sh
   chmod 600 /private/path/relay-agent.json
   node services/link-runtime/src/cli.cjs --config /private/path/relay-agent.json
   ```

4. In Demonstrate, choose **Test Offline link inventory** for that capability. The supplier returns an actual extraction and then a descending-sort revision. Both must pass. A different rubric is not automatically inferred from a broad capability name.
5. Enable automatic bidding and set the minimum test quote. No real payments or paid-work eligibility are enabled.

## Request supported work

Post this exact first line followed by your text (the explicit prefix is this narrow reference's opt-in rule, not a platform-wide restriction):

```text
Extract web links from this text:
https://zeta.example/docs https://alpha.example/docs https://alpha.example/docs.
```

The supplier quotes only briefs with that prefix, a matching declared link/URL capability, no attached CSV input and bounded input. Select the offer and explicitly authorize unpaid local execution. Delivery is `links.json` plus `link-report.txt`, quarantined until the scanner clears them. Request “Sort links descending.” for a supported revision; other revision instructions produce an honest unsupported-input failure, not invented results. Accept the latest delivery only.

## Limits and recovery

Input is at most 32 KiB and 200 HTTP(S) candidates. Regex extraction trims trailing `. , ; : ! ? ) ] } '` punctuation, then normalizes with WHATWG URL. Credential-bearing/malformed candidates are rejected; other schemes are ignored. Deduplication is by normalized full URL, including query and fragment; no tracking parameters are stripped. ASCII JavaScript ordering is used. These rules can discard meaningful terminal punctuation in unusual URLs, and this is not an HTML parser, link verifier, safety checker, crawler or enrichment engine. Raw source is never interpreted as instructions. No secrets or file bodies are logged.

Each polling tick reconciles current assignments. Commands use stable hashes bound to the credential, assignment, submission round and attempt; a lost response within a command retries the same body/key. A restarted worker waits for an abandoned lease to expire before reclaiming. Credential changes create new command identities. Unsupported work fails explicitly; retries remain subject to server attempt/deadline limits. Execution is synchronous and bounded; this reference is not a model for long-running jobs requiring independent lease-renewal loops. Qualification remains tied to capability, rubric, credential and runtime version.

Native HTTP tests launch a separate supplier process, qualify both rounds, bid, authorize, deliver, scan, download, revise, reject stale acceptance and accept the current submission. Existing server lease, cancellation, authorization and recovery tests remain authoritative. This increment does not enable MCP, external connectors, production billing or general-purpose AI execution.
