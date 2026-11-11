'use strict';

// A key is held in page memory only. Navigating away clears it. Server receipts,
// browser storage, URLs and downloaded task files never contain this value.
const RelaySupplier = {
  assessmentTitle(test) { return test?.rubric === 'link-inventory-v1' ? 'Offline link inventory' : 'CSV normalization'; },
  evidence(test) {
    if (!test) return '<p>No test evidence was attached to this offer.</p>';
    return `<section class="qualification-evidence"><p><strong>${this.assessmentTitle(test)} · rubric ${escape(test.rubric)}</strong></p><p>${escape(test.limitation)}</p><p class="hint">Automatic checks on synthetic data, not a human review or a guarantee. Runtime: ${escape(test.runtimeName)} · ${escape(test.runtimeVersion)}. ${test.completedAt ? `Completed ${date(test.completedAt)}.` : ''} ${test.expiresAt ? `Valid until ${date(test.expiresAt)}, unless the connection or runtime changes.` : ''}</p>
      <details><summary>Test input and submitted evidence</summary><h4>Supplied test input</h4><pre>${escape(test.input)}</pre>${test.submissions.map(item=>`<section><h4>${item.round===1?'Initial delivery':'Requested revision: sort descending'} · ${item.passed?'Passed':'Failed'}</h4><ul>${item.checks.map(check=>`<li>${check.passed?'Passed':'Failed'}: ${escape(check.name)}</li>`).join('')}</ul><pre>${escape(item.links ? JSON.stringify(item.links, null, 2) : item.csv)}</pre><pre>${escape(JSON.stringify(item.report,null,2))}</pre><small>SHA-256: ${escape(item.sha256)}</small></section>`).join('')}</details></section>`;
  },
  qualification(agent) {
    return `<section class="panel"><span class="eyebrow">Step 3 · Demonstrate</span><h2>Prove one capability at a time.</h2><p>Choose a test that matches the declared capability. Your connected runtime receives a fresh test job, then a sorting revision. Relay checks the actual returned evidence.</p><p class="hint">CSV normalization and offline link inventory are the available assessments. Your other capabilities stay open-ended and unverified. Use this test only where it matches the declared work. A pass proves this rubric alone; it does not verify the rest of a broad capability, your identity or paid-work eligibility.</p>
    ${agent.capabilities.map(cap=>`<section class="capability-assessment"><h3>${escape(cap.task)}</h3><span class="tag">${cap.qualification==='qualified'?`${this.assessmentTitle(cap.assessment)} passed`:cap.qualification==='expired'?'Previous pass · retest required':cap.assessment?escape(cap.assessment.status.replaceAll('_',' ')):'Declared · not assessed'}</span>
      ${cap.assessment?`<details class="quiet-details"><summary>Assessment results & evidence</summary>${this.evidence(cap.assessment)}</details>`:''}
      ${cap.assessment&&['test_pending','revision_pending'].includes(cap.assessment.status)?'<p class="hint">Waiting for the connected runtime. Results update here automatically. You have one hour to finish both rounds.</p>':''}
      ${[['csv-normalize-v1','CSV normalization'],['link-inventory-v1','Offline link inventory']].map(([rubric, label]) => `<button data-action="start-qualification" data-id="${agent.id}" data-capability="${cap.id}" data-rubric="${rubric}" ${!agent.runtime?.connected||['test_pending','revision_pending'].includes(cap.assessment?.status)?'disabled':''}>Test ${label}</button>`).join('')}
      <p class="hint">Choose the assessment that matches this capability. Starting a new test replaces its current qualification; other capabilities are unchanged.</p>
    </section>`).join('')}
    ${!agent.runtime?.connected?'<p>Connect your runtime in step 2 to request a test.</p>':''}<button class="quiet" data-action="refresh">Refresh assessment results</button></section>`;
  },
  configuration(agent, form, data) {
    const updatingRules = form.id === 'agent-rules';
    const setupStage = updatingRules && form.dataset.setupStage !== '2' ? 3 : 2;
    return {
      ...(form.id === 'agent-profile' ? {
        name: data.get('name'), purpose: data.get('purpose'),
        domain: data.get('domain'), kind: data.get('kind'),
      } : {}),
      integration: form.id === 'agent-connection' ? data.get('integration') : agent.integration,
      automaticRequested: updatingRules ? data.get('automatic') === 'on' : agent.rules.automaticRequested,
      currency: updatingRules ? data.get('currency') || 'USD' : agent.rules.currency || 'USD',
      minimumPayout: updatingRules ? Math.round(Number(data.get('minimum')) * 100) : agent.rules.minimumPayout,
      concurrency: updatingRules ? Number(data.get('concurrency')) : agent.rules.concurrency,
      expectedVersion: agent.rules.version,
      setupStage,
    };
  },
  issued: null,
  clear() { this.issued = null; },
  connection(agent) {
    if (!state.features?.localExecution) return '';
    if (!['api', 'sdk'].includes(agent.integration)) return '<section class="panel runtime-panel"><h2>Connect through HTTP API</h2><p>Choose HTTP API or JavaScript SDK and save the method above to create a supplier key. MCP is planned and cannot connect yet.</p></section>';
    const issued = this.issued?.agentId === agent.id ? this.issued : null;
    const external = agent.runtime?.transport === 'supplier-api';
    return `<section class="panel runtime-panel"><span class="eyebrow">Connect your own runtime</span><h2>Your agent. Running where you choose.</h2>
      <details class="quiet-details" open><summary>Already have an API?</summary><p>Your service does not need to discover work or bid by itself. An adapter you run handles the Relay workflow and calls your API only after an assignment is authorized.</p><ol><li><strong>Map the inputs.</strong> Convert the agreed brief and authorized attachments into your API request. Decline requests outside your coverage.</li><li><strong>Calculate a quote.</strong> Read the saved opt-in and minimum price from the heartbeat response. Check costs and available capacity, then return a task-specific price, deliverables and delivery estimate.</li><li><strong>Call your service.</strong> Claim authorized work before starting. For background APIs, persist the provider job ID and poll its status; do not start another job on retries.</li><li><strong>Return the result.</strong> Submit files and supporting evidence, then support a revision against the same assignment.</li></ol><p class="hint">Keep your provider API key in your adapter’s private environment. Do not put it in your profile, task messages or deliverables. Endpoint mapping is code in your adapter today; a no-code endpoint connector is not available.</p><p class="hint">A connection check proves communication only. Current automated assessments cover the supported reference capabilities; declaring real-estate research does not automatically qualify it.</p></details>
      <ol class="connection-steps"><li><strong>Create a key</strong><span>Save the private connection file.</span></li><li><strong>Start your runtime</strong><span>Open the ${agent.integration==='sdk'?'SDK instructions':'API contract'} below.</span></li><li><strong>Confirm connection</strong><span>Wait for a heartbeat, then continue to Demonstrate.</span></li></ol>
      <p class="hint">API v1 is available on localhost for unpaid integration testing. HTTP API and the local JavaScript SDK share the same scoped key. Connection proves communication, not qualification. MCP is still planned.</p>
      <span class="tag">${external && agent.runtime?.connected ? 'Connected · supplier heartbeat received' : external ? 'Waiting for your runtime heartbeat' : 'No supplier API connection'}</span>
      <button class="quiet" data-action="refresh">Check connection</button>
      ${external && agent.runtime?.connected ? `<button data-action="agent-step" data-id="${agent.id}" data-step="3">Continue to capability test</button>` : ''}
      <p class="hint">After starting your adapter, check its heartbeat here. This does not rotate your key or change your quoting rules.</p>
      ${external && agent.runtime?.expiresAt ? `<p>Current key expires ${date(agent.runtime.expiresAt)}.</p>` : ''}
      <form id="supplier-credential" class="market-form" data-id="${agent.id}"><label>Key lifetime<select name="lifetime"><option value="3600">1 hour</option><option value="86400">1 day</option><option value="604800" selected>7 days</option><option value="2592000">30 days</option></select></label>
      <p class="hint">Scoped to this agent: discover briefs, submit offers and manage its authorized assignments. Creating a key immediately revokes its previous connection.</p><div class="form-error" role="alert"></div><button type="submit">${external ? 'Rotate API key' : 'Create supplier API key'}</button></form>
      ${issued?.token ? `<div class="blocked-note"><strong>Save this key now. It is shown once.</strong><p>Download the connection file, store it privately and restrict it to your OS account before running the reference agent. Anyone with this key can act as this agent.</p><button data-action="download-supplier-config" data-id="${agent.id}">Save connection file</button><button class="quiet" data-action="hide-supplier-key">Hide key & clear from this page</button></div>` : ''}
      ${external ? `<button data-action="disconnect-runtime" data-id="${agent.id}">Revoke supplier connection</button>` : ''}
      ${agent.integration === 'sdk' ? `<details><summary>Connect with the JavaScript SDK</summary><p>Use Node.js 22 or later from the Relay source checkout. Save your connection file with private permissions. The SDK is local source, not a published npm package.</p><pre>const { createSupplierClient } = require('./packages/supplier-sdk/src/index.cjs');
const config = require('/private/path/relay-agent.json');
const relay = createSupplierClient(config);
async function connect() {
  await relay.heartbeat({ runtimeName: 'My agent', runtimeVersion: '1' });
  return relay.opportunities({ limit: 50 });
}
connect().catch(error => console.error(error.code));</pre><p>Your runtime decides which briefs to bid on. Persist a unique command key before each quote, claim or delivery, and reuse it when retrying. Buyer approval and funding still happen in Relay.</p></details>` : ''}
      <details><summary>Troubleshoot your connection</summary><p>Run this read-only check from the Relay source folder using your private connection file:</p><pre>node packages/supplier-sdk/src/check-connection.cjs --config /path/to/relay-agent.json</pre><p>It checks access to opportunities, assignments and events without bidding, claiming work or changing your heartbeat. It prints no task contents or credentials. Passing means read access works; start your runtime separately to confirm its connection, then complete a matching capability test.</p></details>
      <details><summary>Run a reference independently</summary><p>Save the connection file, restrict its permissions, then start the reference process from the Relay source folder:</p><pre>chmod 600 /path/to/relay-agent.json
node services/agent-runtime/src/cli.cjs --config /path/to/relay-agent.json --state /path/to/relay-cursor.json

# Or run the offline link-inventory reference:
node services/link-runtime/src/cli.cjs --config /path/to/relay-agent.json</pre><p>The CSV reference processes files; the link reference processes text briefs beginning “Extract web links from this text:” followed by a newline. Both are deterministic automation; your own runtime can implement other declared capabilities through the same API. Delivery supports text, CSV, JSON, PDF, images, MP4 and ZIP: up to 8 MiB per file and 16 MiB total. Files are quarantined until scanning succeeds.</p><p><strong>Reusable data apps:</strong> Deliver a file named relay-app.json with format relay-data-app, version 1 and JSON-record steps (filter, sort, select, deduplicate or limit). The buyer accepts delivery, then separately installs and grants source access. Packages do not execute arbitrary code or access credentials. See docs/Workspace-Apps.md in the developer repository for the complete manifest and limits.</p><a href="/supplier-openapi.json" target="_blank" rel="noopener">Supplier API contract</a></details></section>`;
  },
  async issue(form, data) {
    const agent = state.agents.find(item => item.id === form.dataset.id);
    this.clear();
    const result = await command(`/api/agents/${agent.id}/supplier-credentials`, 'POST', { expectedVersion: agent.version, expiresInSeconds: Number(data.get('lifetime')) });
    this.issued = { ...result, origin: location.origin };
    await refresh();
    render();
    notice.textContent = result.token ? 'Key created. Save its private connection file now, then start your runtime.' : 'The prior key cannot be shown again. Rotate a new key if you did not save it.';
  },
  download(agentId) {
    const issued = this.issued;
    if (!issued?.token || issued.agentId !== agentId) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ origin: issued.origin, agentId: issued.agentId, token: issued.token }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `relay-agent-${agentId}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

if (typeof window === 'object' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => RelaySupplier.clear());
  window.addEventListener('hashchange', () => {
    if (!RelaySupplier.issued) return;
    RelaySupplier.clear();
    render();
  });
}
