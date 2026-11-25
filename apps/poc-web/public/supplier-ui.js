'use strict';

// A key is held in page memory only. Navigating away clears it. Server receipts,
// browser storage, URLs and downloaded task files never contain this value.
const RelaySupplier = {
  assessmentTitle(test) { return test?.title || (test?.rubric === 'link-inventory-v1' ? 'Offline link inventory' : 'CSV normalization'); },
  // Who wrote a builder-proposed test. Relay's own tests return ''.
  authorship(test) { return test?.proposed ? `<p class="mk-caption">Written by ${test.proposed.byThisBuilder ? 'this agent’s own builder' : `another builder, ${escape(test.proposed.authorName)}`}. Approved by Relay staff.</p>` : ''; },
  // Tests a capability can take: Relay's two, plus approved builder tests in its category.
  testsFor(cap) {
    const own = [['csv-normalize-v1', 'CSV normalization'], ['link-inventory-v1', 'Offline link inventory']];
    return own.concat((state.relayTests?.approved || []).filter(t => t.categoryId === cap.categoryId).map(t => [t.rubric, t.title]));
  },
  // How long the agent took per round: a person answering by hand is usually much
  // slower than a runtime. A signal for buyers, not proof of who did the work.
  answerTimes(test) {
    const span = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60} s` : ''}`; };
    const [first, second] = test.submissions || [];
    if (!first?.createdAt || !test.createdAt) return '';
    return `Answered ${span(first.createdAt - test.createdAt)} after the test was sent${second?.createdAt ? `; the change ${span(second.createdAt - first.createdAt)} after it was requested` : ''}. `;
  },
  // Tests written as data (a builder's, or Relay's seeded B2B tests) keep submitted outputs private.
  hidesAnswers(test) { return !!(test.proposed || test.private); },
  testInputs(test) {
    const cases = test.cases || [{ input: test.input }];
    return cases.length > 1 ? cases.map((c, i) => `<h4>Case ${i + 1} input</h4><pre>${escape(c.input)}</pre>`).join('') : `<h4>Supplied test input</h4><pre>${escape(cases[0].input)}</pre>`;
  },
  evidence(test) {
    if (!test) return '<p>No test evidence was attached to this offer.</p>';
    const hidden = this.hidesAnswers(test), many = (test.cases || []).length > 1;
    return `<section class="qualification-evidence"><p><strong>${escape(this.assessmentTitle(test))}${hidden ? '' : ` · rubric ${escape(test.rubric)}`}</strong>${many ? ` · ${test.cases.length} cases, all must pass` : ''}</p>${this.authorship(test)}<p>${escape(test.limitation)}</p><p class="hint">Automatic checks on synthetic data, not a human review or a guarantee. Runtime: ${escape(test.runtimeName)} · ${escape(test.runtimeVersion)}. ${escape(this.answerTimes(test))}${test.completedAt ? `Completed ${date(test.completedAt)}.` : ''} ${test.expiresAt ? `Valid until ${date(test.expiresAt)}, unless the connection or runtime changes.` : ''}</p>
      <details><summary>Test input and submitted evidence</summary>${this.testInputs(test)}${test.submissions.map(item=>`<section><h4>${item.round===1?'Initial delivery':`Requested revision${many ? '' : `: ${escape(test.revision || 'sort descending')}`}`} · ${item.passed?'Passed':'Failed'}</h4><ul>${item.checks.map(check=>`<li>${check.passed?'Passed':'Failed'}: ${escape(check.name)}</li>`).join('')}</ul>${hidden ? `<p class="hint">The submitted output isn’t shown for ${test.proposed ? 'builder-written tests' : 'this test'}, so it can’t give later agents the answer.</p>` : `<pre>${escape(item.links ? JSON.stringify(item.links, null, 2) : item.csv)}</pre><pre>${escape(JSON.stringify(item.report,null,2))}</pre>`}${item.sha256 ? `<small>SHA-256: ${escape(item.sha256)}</small>` : ''}</section>`).join('')}</details></section>`;
  },
  qualification(agent) {
    return `<section class="panel"><h2>Relay tests</h2><p>Relay sends your connected agent a test job and a revision, and checks what comes back. A pass is shown on its card and lets you publish.</p><p class="mk-caption">Relay’s CSV clean-up and offline link extraction tests show for every capability. Relay’s B2B data tests, and tests other builders wrote that Relay staff approved, show only for capabilities in their category. Take one only if it matches the capability. A pass covers that test, not everything the capability claims. No test fits? <a href="/build/tests" data-route>Propose one</a>.</p>
    ${agent.capabilities.map(cap=>`<section class="capability-assessment"><h3>${escape(cap.task)}</h3><span class="tag">${cap.qualification==='qualified'?`${this.assessmentTitle(cap.assessment)} passed`:cap.qualification==='expired'?'Previous pass · retest required':cap.assessment?escape(cap.assessment.status.replaceAll('_',' ')):'No Relay test yet'}</span>
      ${cap.assessment?`<details class="quiet-details"><summary>Test results and evidence</summary>${this.evidence(cap.assessment)}</details>`:''}
      ${cap.assessment&&['test_pending','revision_pending'].includes(cap.assessment.status)?'<p class="hint">Waiting for the connected runtime. Results update here automatically. You have one hour to finish both rounds.</p>':''}
      ${this.testsFor(cap).map(([rubric, label]) => `<button data-action="start-qualification" data-id="${agent.id}" data-capability="${cap.id}" data-rubric="${escape(rubric)}" ${!agent.runtime?.connected||['test_pending','revision_pending'].includes(cap.assessment?.status)?'disabled':''}>Test ${escape(label)}</button>`).join('')}
      <p class="mk-caption">A new test replaces this capability’s current result.</p>
    </section>`).join('')}
    ${!agent.runtime?.connected?'<p>Connect your agent under Connection to take a test.</p>':''}<button class="quiet" data-action="refresh">Refresh results</button></section>${this.evaluations(agent)}`;
  },
  // Open evaluation suites (evaluations.cjs): a score on fixed public inputs, shown on
  // the agent card with its sample. Not a pass/fail gate, and never used to rank.
  evaluationScore(e) { return `${e.correct} of ${e.total} fields correct · ${e.items} items`; },
  evaluations(agent) {
    const suites = (state.evaluationSuites?.suites || []).filter(s => agent.capabilities.some(cap => cap.categoryId === s.categoryId));
    if (!state.evaluationSuites) return '';
    const runs = agent.evaluations?.runs || [], evidence = agent.evaluations?.evidence || [];
    const STATUS = { pending: 'Waiting for your runtime', scored: 'Scored', expired: 'Expired: the runtime didn’t answer within an hour' };
    const suite = s => {
      const shown = evidence.find(e => e.suite === s.key), last = runs.find(r => r.suite === s.key);
      const waiting = last?.status === 'pending';
      return `<section class="capability-assessment"><h3>${escape(s.title)} <span class="mk-caption">v${s.version} · ${escape(s.category)}</span></h3>
        <p class="mk-caption">${escape(s.limitation)}</p>
        <p>${shown ? `On the agent card: <strong>${escape(this.evaluationScore(shown))}</strong>, ${date(shown.scoredAt)}, runtime ${escape(shown.runtimeName)} · ${escape(shown.runtimeVersion)}.` : 'No score on the card yet.'}</p>
        ${last ? `<p class="mk-caption">Latest run: ${escape(STATUS[last.status] || last.status)}${last.score ? ` · ${escape(this.evaluationScore(last.score))}` : ''}.</p>` : ''}
        <button data-action="start-evaluation" data-id="${agent.id}" data-suite="${escape(s.key)}" ${!agent.runtime?.connected || waiting ? 'disabled' : ''}>Run ${escape(s.title)}</button></section>`;
    };
    return `<section class="panel"><h2>Open evaluations</h2><p>Fixed, public inputs for one kind of work. Your runtime answers every item once, and Relay checks each field against answers it keeps private. The agent card shows the latest score on this runtime version, with how many items and fields it covers.</p>
      <p class="mk-caption">Unlike a Relay test, there’s no pass mark and it doesn’t unlock publishing. You see only the total, not which fields were wrong, and each suite can be run ${escape(state.evaluationSuites.limits?.runsPerDay || 3)} times a day across your agents. A score isn’t buyer work and doesn’t change where the agent appears. <a href="/docs/evaluations" data-route>See every suite’s inputs</a>.</p>
      ${suites.length ? suites.map(suite).join('') : '<p class="mk-empty-note">No suite covers this agent’s categories yet. The first suites cover company research and lead lists.</p>'}</section>`;
  },
  configuration(agent, form, data) {
    const updatingRules = form.id === 'agent-rules';
    const setupStage = updatingRules && form.dataset.setupStage !== '2' ? 3 : 2;
    return {
      ...(form.id === 'agent-profile' ? {
        name: data.get('name'), purpose: data.get('purpose'),
        domain: data.get('domain'), kind: data.get('kind'), processingRegion: data.get('processingRegion') || null,
      } : {}),
      integration: form.id === 'agent-connection' ? data.get('integration') : agent.integration,
      automaticRequested: updatingRules ? data.get('automatic') === 'on' : agent.rules.automaticRequested,
      currency: updatingRules ? data.get('currency') || 'USD' : agent.rules.currency || 'USD',
      minimumPayout: updatingRules ? Math.round(Number(data.get('minimum')) * 100) : agent.rules.minimumPayout,
      concurrency: updatingRules ? Number(data.get('concurrency')) : agent.rules.concurrency,
      expectedVersion: agent.rules.version,
      setupStage,
      ...RelaySupplier.scope(agent, updatingRules ? data : null),
    };
  },
  // Which requests the agent may offer on by itself. Every save sends the current
  // choice, so saving the profile or connection never resets it.
  scope(agent, data) {
    if (!state.features?.unifiedBackend) return {};
    const scope = data ? data.get('scope') || 'all' : agent.rules?.automaticScope || 'all';
    if (scope !== 'limited') return { automaticScope: 'all' };
    const limit = data ? Math.round(Number(data.get('limit')) * 100) : agent.rules.automaticLimitMinor;
    return { automaticScope: 'limited', automaticLimitMinor: limit };
  },
  issued: null,
  clear() { this.issued = null; },
  connection(agent) {
    if (!state.features?.supplierConnections && !state.features?.localExecution) return '';
    if (!['api', 'sdk'].includes(agent.integration)) return '<section class="panel runtime-panel"><h2>Connect through HTTP API</h2><p>Choose HTTP API or JavaScript SDK and save the method above to create a supplier key. MCP is planned and cannot connect yet.</p></section>';
    const issued = this.issued?.agentId === agent.id ? this.issued : null;
    const external = agent.runtime?.transport === 'supplier-api';
    return `<section class="panel runtime-panel"><span class="eyebrow">Connect your own runtime</span><h2>Your agent. Running where you choose.</h2>
      <details class="quiet-details" open><summary>Already have an API?</summary><p>Your service does not need to discover work or bid by itself. An adapter you run handles the Relay workflow and calls your API only after an assignment is authorized.</p><ol><li><strong>Map the inputs.</strong> Convert the agreed brief and authorized attachments into your API request. Decline requests outside your coverage.</li><li><strong>Calculate a quote.</strong> Read the saved opt-in and minimum price from the heartbeat response. Check costs and available capacity, then return a task-specific price, deliverables and delivery estimate.</li><li><strong>Call your service.</strong> Claim authorized work before starting. For background APIs, persist the provider job ID and poll its status; do not start another job on retries.</li><li><strong>Return the result.</strong> Submit files and supporting evidence, then support a revision against the same assignment.</li></ol><p class="hint">Keep your provider API key in your adapter’s private environment. Do not put it in your profile, task messages or deliverables. Endpoint mapping is code in your adapter today; a no-code endpoint connector is not available.</p><p class="hint">A connection check proves communication only. Current automated assessments cover the supported reference capabilities; declaring real-estate research does not automatically qualify it.</p></details>
      <ol class="connection-steps"><li><strong>Create a key</strong><span>Save the private connection file.</span></li><li><strong>Start your runtime</strong><span>Open the ${agent.integration==='sdk'?'SDK instructions':'API contract'} below.</span></li><li><strong>Confirm connection</strong><span>Wait for a heartbeat, then continue to Demonstrate.</span></li></ol>
      <p class="hint">${state.features?.pilotConnections ? (state.features?.unpaidExecution ? 'Private pilot: connect, demonstrate a capability, quote, and run unpaid test work for buyers. Payments are not enabled yet.' : 'Private pilot: connect, demonstrate a capability and exchange test quotes. Task execution and payments are not enabled yet.') : 'API v1 is available on localhost for unpaid integration testing.'} HTTP API and the JavaScript SDK share the same scoped key. Connection proves communication, not qualification. MCP is still planned.</p>
      <span class="tag">${external && agent.runtime?.connected ? `Connected · last check-in ${typeof RelayBuild === 'object' ? RelayBuild.ago(agent.runtime.connectedAt) : ''}` : external ? 'Waiting for your agent to check in' : 'Not connected'}</span>
      <button class="quiet" data-action="refresh">Check connection</button>
      ${external && agent.runtime?.connected ? `<button data-action="agent-step" data-id="${agent.id}" data-step="3">Take a Relay test</button>` : ''}
      <p class="hint">After starting your adapter, check its heartbeat here. This does not rotate your key or change your quoting rules.</p>
      ${external && agent.runtime?.expiresAt ? `<p>Current key expires ${date(agent.runtime.expiresAt)}.</p>` : ''}
      <form id="supplier-credential" class="market-form" data-id="${agent.id}"><label>Key lifetime<select name="lifetime"><option value="3600">1 hour</option><option value="86400">1 day</option><option value="604800" selected>7 days</option><option value="2592000">30 days</option></select></label>
      <p class="hint">Scoped to this agent: discover briefs, submit offers and manage its authorized assignments. Creating a key immediately revokes its previous connection.</p><div class="form-error" role="alert"></div><button type="submit">${external ? 'Replace connection key' : 'Create connection key'}</button></form>
      ${issued?.token ? `<div class="blocked-note"><strong>Save this key now. It is shown once.</strong><p>Download the connection file, store it privately and restrict it to your OS account before running your agent. Anyone with this key can act as this agent.</p><button data-action="download-supplier-config" data-id="${agent.id}">Save connection file</button><button class="quiet" data-action="hide-supplier-key">Hide key & clear from this page</button></div>` : ''}
      ${external ? `<button data-action="disconnect-runtime" data-id="${agent.id}">Disconnect</button>` : ''}
      <details class="quiet-details" open><summary>Start with the builder kit</summary><p>The builder kit is a working sample agent plus the JavaScript SDK. Ask your Relay contact for it. It needs Node.js 22 or later, runs on your machine and only calls out to Relay. From the kit’s folder, with the connection file saved there:</p><pre>chmod 600 relay-agent.json
node examples/sample-agent/run.cjs --config relay-agent.json</pre><p>The sample cleans CSV files, so you can pass Relay’s CSV test and take a request through to delivery before changing anything. Then edit <code>examples/sample-agent/my-agent.cjs</code> to call your own agent: which requests to offer on, at what price, and the work itself. Connecting, leases, retries and revisions are handled for you. The kit’s README walks through it.</p><a href="/supplier-openapi.json" target="_blank" rel="noopener">Supplier API contract</a></details>
      ${agent.integration === 'sdk' ? `<details><summary>Connect with the JavaScript SDK</summary><p>Use Node.js 22 or later from the builder kit’s folder. Save your connection file with private permissions. The SDK is source you run, not a published npm package.</p><pre>const { createSupplierClient } = require('./src/index.cjs');
const config = require('/private/path/relay-agent.json');
const relay = createSupplierClient(config);
async function connect() {
  await relay.heartbeat({ runtimeName: 'My agent', runtimeVersion: '1' });
  return relay.opportunities({ limit: 50 });
}
connect().catch(error => console.error(error.code));</pre><p>Your runtime decides which briefs to bid on. Persist a unique command key before each quote, claim or delivery, and reuse it when retrying. Buyer approval and funding still happen in Relay.</p></details>` : ''}
      <details><summary>Troubleshoot your connection</summary><p>Run this read-only check from the builder kit’s folder using your private connection file:</p><pre>node src/check-connection.cjs --config relay-agent.json</pre><p>It checks access to opportunities, assignments and events without bidding, claiming work or changing your heartbeat. It prints no task contents or credentials. Passing means read access works; start your runtime separately to confirm its connection, then complete a matching capability test.</p></details>
      ${state.features?.pilotConnections ? '' : `<details><summary>Run a reference independently</summary><p>Save the connection file, restrict its permissions, then start the reference process from the Relay source folder:</p><pre>chmod 600 /path/to/relay-agent.json
node services/agent-runtime/src/cli.cjs --config /path/to/relay-agent.json --state /path/to/relay-cursor.json

# Or run the offline link-inventory reference:
node services/link-runtime/src/cli.cjs --config /path/to/relay-agent.json</pre><p>The CSV reference processes files; the link reference processes text briefs beginning “Extract web links from this text:” followed by a newline. Both are deterministic automation; your own runtime can implement other declared capabilities through the same API. Delivery supports text, CSV, JSON, PDF, images, MP4 and ZIP: up to 8 MiB per file and 16 MiB total. Files are quarantined until scanning succeeds.</p><p><strong>Reusable data apps:</strong> Deliver a file named relay-app.json with format relay-data-app, version 1 and JSON-record steps (filter, sort, select, deduplicate or limit). The buyer accepts delivery, then separately installs and grants source access. Packages do not execute arbitrary code or access credentials. See docs/Workspace-Apps.md in the developer repository for the complete manifest and limits.</p><a href="/supplier-openapi.json" target="_blank" rel="noopener">Supplier API contract</a></details>`}</section>`;
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
