'use strict';
const RelayOrchestration = {
  row(index) {
    return `<fieldset data-plan-step><legend>Step ${index + 1}</legend>
      <label>Title<input name="title-${index}" maxlength="120" required></label>
      <label>Supplier brief<textarea name="brief-${index}" maxlength="3000" required></textarea></label>
      <label>Acceptance criteria<textarea name="criteria-${index}" maxlength="1500" required></textarea></label>
      <label>Maximum quote (USD)<input name="budget-${index}" type="number" min="0.01" step="0.01" required></label>
      <label>Depends on earlier step numbers<input name="dependencies-${index}" placeholder="${index ? 'e.g. 1, 2 — blank runs independently' : 'Leave blank for the first step'}"></label>
    </fieldset>`;
  },
  setup(task) {
    if (task.orchestrationStep || task.orchestrationPlan || task.status !== 'draft') return '';
    return `<details class="panel"><summary>Plan work with multiple agents</summary><p>One parent brief, with separately quoted steps. Independent steps can run in parallel. Dependent steps wait for accepted deliveries and your sharing approval.</p>
      <p class="hint">Use a fresh open draft without attached inputs or tool context. Add those only to the steps that need them. Budgets and scope are fixed once confirmed. This is local unpaid execution; no money moves.</p>
      <form id="orchestration-create" data-id="${task.id}" data-version="${task.version}">
      <label>Total quote ceiling (USD)<input name="total" type="number" min="0.02" step="0.01" required></label>
      <div data-plan-steps>${this.row(0)}${this.row(1)}</div>
      <button type="button" data-action="plan-add-step">Add step</button>
      <p>The sum of step budgets cannot exceed the total. Only each step’s brief is shared for bidding; the parent’s context stays private. Confirm each supplier quote and start permission separately.</p>
      <div class="form-error" role="alert"></div><button type="submit">Confirm plan & create steps</button></form></details>`;
  },
  step(task) {
    const step = task.orchestrationStep;
    if (!step) return '';
    const missing = step.dependencies.filter(id => !step.handoffs.some(h => h.sourceTaskId === id));
    return `<section class="panel"><button data-action="task" data-id="${step.parentId}">Back to parent plan</button><h2>${step.supersededBy ? 'Replaced step — open the parent plan' : missing.length ? 'Waiting for approved handovers' : 'Plan step'}</h2><p>Quote ceiling: ${money(step.budgetMinor)}. ${missing.length ? 'Review upstream delivery and approve sharing from the parent plan before requesting offers.' : 'Review offers and authorize this step independently.'}</p><p class="hint">The reviewed scope is fixed. Tool permissions are granted per task; sibling agents do not share access.</p></section>`;
  },
  page() {
    const parent = state.detail.task, plan = state.detail.orchestration;
    if (!plan) return '<p>Refresh to load the plan.</p>';
    const done = plan.steps.filter(step => step.status === 'accepted').length;
    return `<section class="market-workspace"><header class="builder-page-title"><div><p class="eyebrow">Parent plan · version ${plan.version}</p><h1>${escape(parent.title)}</h1><p>${done} of ${plan.steps.length} deliveries accepted · ceiling ${money(plan.budgetMinor)}</p></div></header>
      <details class="panel"><summary>Agreed parent brief</summary><p class="offer-details">${escape(plan.brief)}</p></details>
      <p>Open each ready step to request offers. Independent steps can run together. Accept upstream deliveries, then approve the exact handover for each dependent step.</p>
      ${plan.steps.map((step,index) => {
        const missing = step.dependencies.filter(id => !step.handoffs.some(h => h.sourceTaskId === id));
        return `<article class="panel"><p class="eyebrow">Step ${index+1} · ${escape(step.status)}</p><h2>${escape(step.title)}</h2><p>${escape(step.criteria)}</p><p>Quote ceiling ${money(step.budgetMinor)} · ${missing.length ? `${missing.length} handover(s) needed` : 'Dependencies satisfied'}</p>
          <button data-action="task" data-id="${step.id}">Open step</button>
          ${plan.status === 'active' ? `<details data-disclosure-key="recovery-${step.id}"><summary>Recover step / change handovers</summary><p>Create fresh versions of this step and every dependent step. Old work stays in history. Reattach inputs, approve every handover and choose fresh offers. No permissions or budget approvals carry over. Stop active affected steps first.</p><form data-plan-recovery="${step.id}" data-version="${step.version}"><label>Reason<textarea name="reason" minlength="10" maxlength="1000" required></textarea></label><label><input type="checkbox" name="confirm" required> Reset this step and its downstream steps; require fresh approvals.</label><div class="form-error" role="alert"></div><button type="submit">Create recovery revision</button></form></details>` : ''}
          ${step.dependencies.map(id => {
            const source = plan.steps.find(s=>s.id===id), handoff = step.handoffs.find(h=>h.sourceTaskId===id);
            if (handoff) return `<details><summary>Approved handover from ${escape(source.title)}</summary><p class="offer-details">${escape(handoff.notes)}</p><small>Submission ${escape(handoff.submissionId)} · version ${handoff.submissionVersion}${handoff.file ? ` · ${escape(handoff.file.filename)}` : ''}</small></details>`;
            if (!source.delivery) return `<p class="hint">Waiting for accepted delivery: ${escape(source.title)}</p>`;
            return `<details><summary>Approve handover from ${escape(source.title)}</summary><p>Review the upstream delivery before sharing. Only these notes and the optional CSV are passed to the selected downstream runtime after start authorization.</p>
              <form data-handover="${step.id}" data-source="${source.id}" data-submission="${source.delivery.id}" data-version="${step.version}">
                <label>Approved summary / instructions<textarea name="notes" maxlength="2000" required></textarea></label>
                <label>Optional CSV input<select name="fileId"><option value="">Text only</option>${source.delivery.files.filter(file=>file.filename.endsWith('.csv')&&file.size<=262144).map(file=>`<option value="${file.id}">${escape(file.filename)}</option>`).join('')}</select></label>
                <p class="hint">One CSV input per downstream step. Its filename and size are visible to bidders; contents and notes require assignment authorization.</p>
                <label><input type="checkbox" name="consent" required> I approve sharing this exact excerpt and selected file with the downstream supplier.</label>
                <div class="form-error" role="alert"></div><button type="submit">Approve handover</button>
              </form></details>`;
          }).join('')}</article>`;
      }).join('')}
      ${plan.status === 'accepted' ? '<p role="status">Parent outcome accepted.</p>' : `<button data-action="plan-complete" data-id="${parent.id}" data-version="${parent.version}" ${done===plan.steps.length?'':'disabled'}>Accept complete outcome</button>`}
      ${plan.history?.length ? `<details><summary>Recovery history · ${plan.history.length} revision(s)</summary>${plan.history.map(item=>`<section><h3>Plan version ${item.version}</h3><p>${escape(item.reason)}</p>${item.stepIds.map(id=>`<button data-action="task" data-id="${id}">View previous step</button>`).join('')}</section>`).join('')}</details>` : ''}<button data-action="refresh">Refresh plan</button><p class="hint">No automatic re-planning or cross-agent credentials. Recover failed steps or reset handovers here. Changing the agreed requirements or budget still needs a new plan.</p></section>`;
  },
};
