'use strict';

const RelayExecution = {
  clock(startedAt, completedAt, label = 'delivered') {
    if (!startedAt) return '';
    const elapsed = Math.max(0, (completedAt || Date.now()) - startedAt);
    const seconds = Math.floor(elapsed / 1000);
    const duration =
      seconds < 1
        ? 'under 1s'
        : seconds < 60
          ? `${seconds}s`
          : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return completedAt
      ? `${label} ${duration} after starting`
      : `${duration} since starting`;
  },
  updateClock() {
    document.querySelectorAll('[data-execution-clock]').forEach((element) => {
      element.textContent = this.clock(
        Number(element.dataset.started),
        Number(element.dataset.completed) || null,
        element.dataset.endLabel || 'delivered',
      );
    });
  },
  enabled() {
    return !!state.features?.localExecution;
  },
  connection(agent) {
    if (!this.enabled() || agent.integration !== 'api') return '';
    const connected =
      agent.runtime?.connected && agent.runtime?.transport !== 'supplier-api';
    return `<details ${connected ? 'open' : ''}><summary>Try the built-in CSV reference</summary><section class="panel runtime-panel"><span class="eyebrow">A real local connection</span><h2>Try the CSV runtime.</h2>
      <p>A separate process can bid automatically, clean supplied CSV data and deliver actual files. It uses deterministic automation, not an AI model. No external browsing, tools or payments.</p>
      <p class="hint">Add a capability that explicitly mentions CSV. Choose HTTP API, connect here, then enable automatic bidding in stage 3. Reconnect after restarting Relay.</p>
      <span class="tag">${connected ? 'Connected · local reference heartbeat received' : 'Local reference not connected'}</span>
      <div class="inline-actions"><button class="primary" data-action="connect-runtime" data-id="${agent.id}">${connected ? 'Reconnect local CSV runtime' : 'Connect local CSV runtime'}</button>
      ${connected ? `<button data-action="disconnect-runtime" data-id="${agent.id}">Disconnect</button>` : ''}<button class="quiet" data-action="refresh">Check connection</button></div>
      <p class="hint">Starting this reference replaces the agent’s current API key and connection. Commercial qualification and operator verification stay incomplete.</p></section></details>`;
  },
  input(task) {
    if (!this.enabled() || task.scheduleId) return '';
    if (task.input)
      return `<article class="thread-message relay"><span class="thread-speaker">${relayCharacter()}Relay</span><p><strong>${escape(task.input.filename)}</strong> · ${task.input.size} bytes<br>${escape(task.input.notes)}</p><p class="hint">CSV cleanup input saved with this scope. Normalization trims cells, removes blank and exact duplicate rows, sorts ascending and protects spreadsheet formulas.</p></article>`;
    if (!['draft', 'posted', 'selected'].includes(task.status)) return '';
    return `<article class="thread-message relay"><span class="thread-speaker">${relayCharacter()}Relay</span><details><summary>Optional source file · CSV supported</summary>
      <form id="task-input" class="market-form"><p>Attach a CSV only if your task needs it. Text-only tasks can use the brief directly.</p>
      <label>Source CSV<input type="file" name="file" accept=".csv,text/csv" required></label><label>Usage notes<textarea name="notes" maxlength="2000" required placeholder="Describe what these rows represent. Notes are context, not executable instructions."></textarea></label>
      <p class="hint">UTF-8 CSV, up to 256 KiB. Attaching changes the scope and invalidates prior offers. Exact transformations are confirmed in the runtime’s offer.</p><div class="form-error" role="alert"></div><button type="submit">Attach CSV & update scope</button></form></details></article>`;
  },
  start(task) {
    if (task.scheduleId)
      return '<p class="hint">This scheduled run starts automatically after a fresh offer and any company approval. Its saved rules remain in Scheduled work.</p>';
    const offer = state.offers.find((item) => item.selected);
    if (
      !this.enabled() ||
      !offer?.runtimeBid ||
      state.detail.execution ||
      (state.detail.payment &&
        !['expired', 'refunded'].includes(state.detail.payment.status))
    )
      return '';
    if (state.detail.approval && state.detail.approval.status !== 'approved')
      return '<p class="hint">Company approval is needed before this task can start. Use the approval card in this conversation.</p>';
    return `<section class="panel start-review"><span class="eyebrow">Local execution permission</span><h2>${offer.runtimeKind === 'supplier-hosted' ? 'Ready to start this task?' : 'Ready to process your CSV?'}</h2>
      <p>This authorizes the selected runtime to work on your agreed brief and return files here. The quote is a test offer: no money is collected or paid. ${offer.qualificationCurrent ? 'This runtime passed the specific assessment shown on its offer; other capability claims remain unverified.' : 'No current capability assessment is attached to this offer.'}</p>
      <p>Only this task’s agreed brief and attached input are shared with the selected runtime. No Drive, CRM or external destinations are connected.</p>
      <button class="primary" data-action="authorize-local">Run locally · no payment</button><button class="quiet" data-action="hide-start">Keep reviewing</button></section>`;
  },
  async requestRevision(form, notes) {
    const task = state.detail.task;
    const submissionId = form.dataset.id;
    try {
      await command(`/api/tasks/${task.id}/request-revision`, 'POST', {
        expectedVersion: task.version, submissionId, notes,
      });
    } catch (error) {
      if (error.code !== 'VERSION_CONFLICT') throw error;
      await refresh();
      render();
      const currentForm = root.querySelector('#delivery-revision');
      if (currentForm?.dataset.id === submissionId) {
        currentForm.querySelector('[name=notes]').value = notes;
        currentForm.closest('details').open = true;
        showError({message:'Delivery status updated. Your notes are saved here. Review the latest files, then submit your revision again.'}, currentForm);
      } else {
        notice.textContent = 'The delivery changed. Review the latest result before requesting another revision. Your previous request was not submitted.';
      }
      return;
    }
    state.followExecution = true;
    await refresh();
    state.scrollTarget = '.delivery-submission:last-of-type';
    render();
  },
  file(taskId, submissionId, file) {
    const key = `${taskId}:${submissionId}:${file.id}`;
    const preview = state.filePreview?.key === key ? state.filePreview : null;
    const blocked = file.scan && file.scan.status !== 'clean';
    const textPreview = ['text/csv', 'text/plain', 'application/json'].includes(
      file.mime,
    );
    return `<div class="delivery-file"><strong>${escape(file.filename)}</strong><span>${file.size < 1024 ? `${file.size} bytes` : `${(file.size / 1024).toFixed(1)} KB`}</span>
      <details class="file-check-details"><summary>${blocked ? (file.scan.status === 'blocked' ? 'File blocked · view details' : file.scan.status === 'scan_error' ? 'Safety check delayed' : 'Checking file') : file.scan ? 'Safety check passed' : 'File details'}</summary><p class="hint">${file.scan ? `${escape({ scanning: 'Scanning automatically', quarantined: 'Queued for scanning', scan_error: 'Scan incomplete', blocked: 'File blocked', clean: 'Scan passed' }[file.scan.status] || 'Awaiting scan')} · ${escape(file.scan.reason)}` : 'Legacy text delivery · malware scanning was not recorded.'}</p><p>${escape(file.mime)}</p></details>
      <div class="inline-actions">${!blocked && textPreview ? `<button class="quiet" data-action="preview-file" data-task="${escape(taskId)}" data-submission="${escape(submissionId)}" data-file="${escape(file.id)}" data-file-key="${escape(key)}">Preview ${escape(file.filename)}</button>` : ''}
      ${!blocked ? `<a class="file-download" aria-label="Download ${escape(file.filename)}" href="/api/tasks/${taskId}/submissions/${submissionId}/files/${file.id}" download>Download</a>` : ''}${file.scan && ['scan_error', 'quarantined'].includes(file.scan.status) ? `<button class="quiet" data-action="scan-file" data-task="${escape(taskId)}" data-submission="${escape(submissionId)}" data-file="${escape(file.id)}">Retry file scan</button>` : ''}</div>
      ${
        preview && !blocked
          ? `<section class="delivery-preview" id="delivery-preview-${escape(file.id)}" aria-label="Preview of ${escape(file.filename)}"><div class="row-heading"><h4>File preview</h4><button class="quiet" data-action="close-file-preview">Close preview</button></div>
        <p class="hint">${escape(preview.notice)}</p><pre tabindex="0" aria-label="File contents">${escape(preview.text)}</pre>
        ${preview.truncated ? `<p>Showing the first ${preview.limit.toLocaleString()} characters. Download the file to review it in full.</p>` : ''}
        <details><summary>File integrity</summary><p>SHA-256 of the original file</p><code>${escape(preview.sha256)}</code><p>${preview.formatted ? 'JSON is formatted here for readability. The download preserves the original bytes.' : 'The download preserves the original file.'}</p></details></section>`
          : ''
      }</div>`;
  },
  files(taskId, submissions) {
    return submissions
      .map(
        (
          submission,
        ) => `<article class="delivery-submission"><div class="row-heading"><h3>Delivery ${submission.version}</h3><span class="tag">${escape(submission.status === 'ready' && submission.files.some((file) => file.scan && file.scan.status !== 'clean') ? 'Checking files' : submission.status.replaceAll('_', ' '))}</span></div>
      <div class="delivery-files">${submission.files.map((file) => this.file(taskId, submission.id, file)).join('')}</div><details class="quiet-details"><summary>What the agent delivered & evidence</summary><p>${escape(submission.evidence)}</p></details></article>`,
      )
      .join('');
  },
  delivery(task) {
    const execution = state.detail.execution;
    if (!execution) return '';
    const submissions = state.detail.submissions || [],
      current = submissions.at(-1);
    const checking = current?.files.some(
      (file) => file.scan && file.scan.status !== 'clean',
    );
    return `<article class="thread-message relay execution-update"><span class="thread-speaker">${relayCharacter()}Relay</span>
      <div class="execution-progress-card"><p class="activity-heading"><strong>${escape(checking && execution.status === 'buyer_review' ? 'Files received · safety checks pending' : taskLabel(task))}</strong>${execution.startedAt ? ` · <span data-execution-clock data-started="${execution.startedAt}" data-completed="${execution.completedAt || execution.endedAt || ''}" data-end-label="${execution.completedAt ? 'delivered' : 'ended'}">${this.clock(execution.startedAt, execution.completedAt || execution.endedAt, execution.completedAt ? 'delivered' : 'ended')}</span>` : ''}</p>
      ${['queued', 'running'].includes(execution.status) && !task.permissionRequests?.some((item) => ['pending', 'declined'].includes(item.status)) ? '<span class="activity-spinner" aria-hidden="true"></span>' : ''}<p>${escape(execution.status === 'accepted' ? 'The buyer accepted this delivery.' : execution.progress || 'Waiting for the runtime')}</p></div><details class="quiet-details"><summary>Execution details</summary><p class="hint">Actual local execution · ${execution.paymentStatus === 'not_applicable_local_unpaid' ? 'unpaid' : 'sandbox funded'} · attempt ${execution.attempt || 0}</p></details>
      <ol class="execution-milestones" aria-label="Task progress"><li class="done">Authorized</li><li class="${execution.startedAt ? 'done' : ''}">${execution.startedAt ? 'Started' : 'Waiting to start'}</li><li class="${current ? 'done' : ''}">${current ? 'Files received' : 'Delivery pending'}</li><li class="${execution.status === 'accepted' ? 'done' : ''}">${execution.status === 'accepted' ? 'Accepted' : 'Your review'}</li></ol>
      ${current ? this.files(task.id, [current]) : ''}
      ${submissions.length > 1 ? `<details class="delivery-history"><summary>Earlier deliveries (${submissions.length - 1})</summary>${this.files(task.id, submissions.slice(0, -1))}</details>` : ''}
      ${
        execution.status === 'buyer_review' && current
          ? `<div class="delivery-review"><p>Preview or download the files before accepting this exact delivery. Quarantined files must pass scanning first. No payout is triggered.</p><button class="primary" ${current.files.some((file) => file.scan && file.scan.status !== 'clean') ? 'disabled' : ''} data-action="accept-delivery" data-id="${current.id}">Accept delivery ${current.version}</button>
      <details class="revision-request"><summary>Request changes</summary><form id="delivery-revision" class="market-form" data-id="${current.id}">${execution.runtimeKind === 'supplier-hosted' ? '<label>Describe the revision<textarea name="notes" maxlength="2000" required></textarea></label>' : '<label>Request a supported CSV revision<select name="notes"><option>Sort rows descending</option><option>Keep duplicate rows</option><option>Sort rows ascending</option></select></label>'}<div class="form-error" role="alert"></div><button type="submit">Request revision</button></form></details></div>`
          : ''
      }
      ${['queued', 'running', 'buyer_review'].includes(execution.status) ? '<details><summary>Cancel execution</summary><form id=\"execution-cancel\" class=\"market-form\"><label>Reason<textarea name=\"reason\" maxlength=\"1000\" required></textarea></label><p>Relay will reject further submissions. A supplier must stop its own tools; actions already taken cannot be undone here.</p><div class=\"form-error\" role=\"alert\"></div><button type=\"submit\">Cancel execution</button></form></details>' : ''}
      ${typeof RelayApps === 'object' ? RelayApps.taskControls(task) : ''}
      ${typeof RelayRecurring === 'object' ? RelayRecurring.recovery(task) : ''}
      ${typeof RelayApps === 'object' ? RelayApps.attioDelivery(task, current) : ''}
      ${execution.status === 'accepted' ? '<p>Your delivery is accepted. Original files and prior revisions remain available on this task.</p>' : ''}</article>`;
  },
  builderTask(task) {
    if (!task.execution) return '';
    return `<article class="panel" data-notification-task="${escape(task.id)}"><span class="tag">${escape(taskLabel(task))}</span><h2>${escape(task.title)}</h2><p>${escape(task.agentName)} · actual local execution · ${task.execution.paymentStatus === 'not_applicable_local_unpaid' ? 'unpaid' : 'sandbox funded'}</p><p>${escape(task.execution.status === 'accepted' ? 'The buyer accepted this delivery.' : task.execution.progress || '')}</p>
      <details><summary>Agreed brief</summary><p>${escape(task.brief)}</p></details>
      ${builderConversation(task)}${this.files(task.id, task.submissions || [])}<p class="hint">The buyer accepts or requests revisions from their conversation. ${task.payment ? 'Accepted delivery becomes eligible for sandbox settlement in Earnings.' : 'No earnings or payout is created by this unpaid local run.'}</p></article>`;
  },
};

async function csvFileBase64(file) {
  if (!file || !file.size || file.size > 262144)
    throw new Error('Choose a CSV of 1–262144 bytes.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
