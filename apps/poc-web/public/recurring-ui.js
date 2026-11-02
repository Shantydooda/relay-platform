'use strict';
const RelayRecurring = {
  examples: Object.freeze([
    'Every Monday at 9am, clean our customer list and deliver a CSV.',
    'Every weekday, review new support tickets and prepare a priority summary.',
    'On the first day of each month, create our performance report from the latest approved data.',
  ]),
  time(value, timezone) { return new Date(value).toLocaleString(undefined, { timeZone: timezone, timeZoneName: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); },
  suggestedTiming(plan) {
    const description = plan.schedule || '';
    const weekdays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const days = weekdays.filter(day => new RegExp('\\b' + day + '\\b', 'i').test(description));
    const time = description.match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/i);
    const hourOnly = description.match(/\b(1[0-2]|[1-9])\s*(am|pm)\b/i);
    let hour = time ? Number(time[1]) : hourOnly ? Number(hourOnly[1]) : null;
    const period = time?.[3] || hourOnly?.[2];
    if (period && hour !== null) hour = hour % 12 + (period.toLowerCase() === 'pm' ? 12 : 0);
    const monthDay = description.match(/\b([12]?\d|3[01])(?:st|nd|rd|th)\b/i);
    return { time: hour === null ? '' : `${String(hour).padStart(2, '0')}:${time?.[2] || '00'}`,
      weekDay: days.length === 1 ? weekdays.indexOf(days[0]) + 1 : '', monthDay: monthDay ? Number(monthDay[1]) : '' };
  },
  calendar(form) {
    const data = new FormData(form);
    return { cadence: data.get('cadence'), time: data.get('time'), timezone: data.get('timezone'),
      day: data.get('cadence') === 'weekly' ? Number(data.get('weekDay')) : data.get('cadence') === 'monthly' ? Number(data.get('monthDay')) : 1 };
  },
  async preview(form) {
    const output = form.querySelector('[data-schedule-preview]');
    const calendar = this.calendar(form);
    const signature = JSON.stringify(calendar);
    output.dataset.request = signature;
    if (!calendar.time || !calendar.timezone || !calendar.day) {
      output.textContent = 'Choose the missing time, day and timezone to see your next runs.';
      return;
    }
    output.textContent = 'Checking the calendar…';
    try {
      const result = await api('/api/schedules/preview?' + new URLSearchParams(calendar));
      if (!output.isConnected || output.dataset.request !== signature) return;
      output.innerHTML = `<strong>Next three scheduled dates</strong><ol>${result.occurrences.map(value => `<li>${escape(this.time(value, calendar.timezone))}</li>`).join('')}</ol><small>First run: the first date above. Repeats until you pause. Dates are planned slots; approvals or unfinished work can delay execution.</small>`;
    } catch (error) {
      if (output.dataset.request === signature) output.textContent = error.message || 'Check your calendar settings.';
    }
  },
  setup(task) {
    if (!state.features?.recurring || task.status !== 'selected' || !task.workPlan || task.workPlan.cadence === 'once' || task.scheduleId) return '';
    if (task.recurringScheduleId) return '<p>This task has a saved schedule. <button data-action="buyer-nav" data-tab="scheduled">Manage scheduled work</button></p>';
    const timing = this.suggestedTiming(task.workPlan);
    return `<details class="panel recurring-setup"><summary>Review and enable your schedule</summary><h3>Set up the regular work you requested.</h3><p class="hint">Requested timing: ${escape(task.workPlan.schedule || task.workPlan.cadence)}. Confirm the exact time and timezone below.</p>
      <p>Use your confirmed recurring brief with this agent. Each run gets a fresh quote, its own conversation and a delivery for you to review.</p>
      <form id="schedule-create" class="market-form">
        <fieldset><legend>1 · Saved knowledge</legend><p>${escape(task.brief)}</p><p>${task.input?`Saved file: ${escape(task.input.filename)}. The same file is reused each time.`:'The brief is the saved context. No external data source is connected.'}</p><p class="hint">To change context or instructions, start a new recurring request. There is no live Drive sync.</p></fieldset>
        <section class="schedule-card" aria-label="Schedule review">
          <h3>Your schedule</h3><p>Requested: ${escape(task.workPlan.schedule || task.workPlan.cadence)}</p>
          <input type="hidden" name="cadence" value="${escape(task.workPlan.cadence)}">
          <p><strong>Repeats:</strong> ${escape(task.workPlan.cadence)} · <strong>Ends:</strong> until paused</p>
          <details ${!timing.time || (task.workPlan.cadence === 'weekly' && !timing.weekDay) || (task.workPlan.cadence === 'monthly' && !timing.monthDay) ? 'open' : ''}><summary>Edit time, day or timezone</summary><div class="schedule-fields">
            <label>Time<input type="time" name="time" value="${timing.time}" required></label>
            <label>Timezone<input name="timezone" value="${escape(task.workPlan.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}" required maxlength="80"></label>
            ${task.workPlan.cadence === 'weekly' ? `<label>Day of the week<select name="weekDay" required><option value="">Choose a day</option>${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map((day,index)=>`<option value="${index+1}" ${timing.weekDay===index+1?'selected':''}>${day}</option>`).join('')}</select></label>` : ''}
            ${task.workPlan.cadence === 'monthly' ? `<label>Day of the month<input type="number" name="monthDay" value="${timing.monthDay}" min="1" max="31" required></label>` : ''}
          </div><p class="hint">Change the frequency in the conversation before choosing an offer. Confirm the timezone suggested here.</p></details>
          <div data-schedule-preview aria-live="polite">Choose the missing timing details to see your next runs.</div>
        </section>
        <fieldset><legend>3 · Execution rules</legend><p>Saved brief → fresh offer from the chosen agent → permission checks → execution → file checks → your review.</p><label>Maximum quote per run · USD<input type="number" name="perRun" min="0.01" step="0.01" required></label><label>Maximum quotes per calendar month · USD<input type="number" name="monthly" min="0.01" step="0.01" required></label><p class="hint">Local test limits, not charges. Company runs need fresh approval for each offer. Runs never overlap; a delivery awaiting review holds the next run.</p></fieldset>
        <details><summary>Calendar and recovery rules</summary><p>Relay must be running on this computer. Missed times over an hour old are skipped, without catch-up bursts. Missing month dates and daylight-saving gaps are skipped; repeated clock times run once. Failures pause the schedule. Nothing is automatically sent to external tools.</p></details>
        <label><input type="checkbox" name="consent" required> Allow this saved context to be shared with the chosen agent for automatic unpaid local runs.</label><div class="form-error" role="alert"></div><button class="primary">Enable regular work</button>
      </form></details>`;
  },
  page() {
    const schedules = state.schedules || [];
    const active = schedules.filter(schedule => schedule.status === 'active').length;
    const review = schedules.filter(schedule => schedule.runs.some(run => run.status === 'buyer_review')).length;
    const paused = schedules.length - active;
    const runLabel = status => ({buyer_review:'Ready for review',awaiting_start:'Approval / start checks',finding_offer:'Finding an agent',queued:'Waiting to start',running:'In progress',accepted:'Delivery accepted',failed:'Needs attention',cancelled:'Closed'})[status] || status;
    return `<section class="scheduled-workspace"><header class="scheduled-title"><div><span class="eyebrow">AUTOMATIC WORK</span><h1>Scheduled work</h1><p>Describe the responsibility once. Relay prepares a fresh, reviewable delivery for every run.</p></div><span class="scheduled-local-status"><i></i>Local execution</span></header>
      <section class="scheduled-composer"><div class="scheduled-composer-copy"><span class="scheduled-symbol" aria-hidden="true">↻</span><div><h2>What should happen regularly?</h2><p>Use natural language. You will review the exact brief, agent, budget and calendar before anything is enabled.</p></div></div><form id="request"><label class="sr-only" for="request-text">Describe recurring work</label><textarea id="request-text" name="brief" placeholder="Every Monday at 9am, clean our customer list and deliver a CSV…" maxlength="10000" required>${escape(state.prompt || '')}</textarea><div class="scheduled-prompt-foot"><small>Nothing runs from this message alone.</small><button class="primary" type="submit">Continue</button></div><div class="form-error" role="alert"></div></form><div class="schedule-examples" aria-label="Recurring work examples">${this.examples.map((example,index)=>`<button type="button" data-action="schedule-example" data-example="${index}">${escape(['Weekly data cleanup','Daily support triage','Monthly reporting'][index])}</button>`).join('')}</div></section>
      <div class="scheduled-summary" aria-label="Schedule summary"><div><strong>${schedules.length}</strong><span>Total schedules</span></div><div><strong>${active}</strong><span>Active</span></div><div><strong>${review}</strong><span>Needs review</span></div><div><strong>${paused}</strong><span>Paused</span></div></div>
      <div class="scheduled-section-heading"><div><h2>Your schedules</h2><p>Each run keeps its own quote, approval, progress and delivery.</p></div><span>Localhost · unpaid</span></div>
      <div class="schedule-list">${schedules.map(schedule => `<article class="schedule-item"><header><div class="schedule-item-title"><span class="schedule-icon" aria-hidden="true">↻</span><div><h2>${escape(schedule.title)}</h2><p>${escape(schedule.agentName)} · ${escape(schedule.calendar.timezone)}</p></div></div><span class="schedule-status status-${escape(schedule.status)}"><i></i>${escape(schedule.status)}</span></header><div class="schedule-primary"><div><small>Frequency</small><strong>${escape(schedule.calendar.cadence)} at ${escape(schedule.calendar.time)}</strong></div><div><small>${schedule.status === 'active' ? 'Next run' : 'Status'}</small><strong>${schedule.status==='active'?escape(this.time(schedule.nextAt,schedule.calendar.timezone)):escape(schedule.reason||'Paused')}</strong></div><div><small>Run limit</small><strong>${money(schedule.perRunLimitMinor)}</strong></div><div><small>Monthly limit</small><strong>${money(schedule.monthlyLimitMinor)}</strong></div></div>${schedule.runs[0]?.status==='buyer_review'?'<div class="schedule-attention"><span>Delivery ready</span><strong>The next run waits until you review this one.</strong></div>':''}<div class="schedule-actions"><button class="${schedule.runs[0]?.status==='buyer_review'?'primary':''}" ${schedule.runs[0]?.status==='buyer_review'?`data-action="task" data-id="${schedule.runs[0].taskId}"`:`data-action="schedule-control" data-id="${schedule.id}" data-version="${schedule.version}" data-operation="${schedule.status==='active'?'pause':'resume'}"`}>${schedule.runs[0]?.status==='buyer_review'?'Review delivery':schedule.status==='active'?'Pause':'Resume'}</button><details><summary>Context & rules</summary><div class="schedule-context"><h3>Saved context</h3><p>${escape(schedule.context.brief)}</p><p>${schedule.context.input?`${escape(schedule.context.input.filename)} · ${escape(schedule.context.input.notes)}`:'Text brief only. No live data connections.'}</p><h3>Execution flow</h3><p>Fresh offer from ${escape(schedule.agentName)} → ${schedule.companyApprovalRequired?'company approval → ':''}permission checks → execution → file safety checks → your review.</p><small>One run at a time. New context or another agent requires a new recurring request. Failed runs stay in history and are not automatically retried.</small></div></details></div><details class="schedule-runs" ${schedule.runs[0]?.status==='buyer_review'?'open':''}><summary>Run history · ${schedule.runs.length}</summary><div>${schedule.runs.map(run=>`<div class="schedule-run"><span class="run-state run-${escape(run.status)}"></span><div><strong>${escape(this.time(run.scheduledFor,schedule.calendar.timezone))}</strong><small>${escape(runLabel(run.status))}</small></div><button data-action="task" data-id="${run.taskId}">Open</button></div>`).join('')||'<p>Your first run will appear here at its scheduled time.</p>'}</div></details></article>`).join('')||'<section class="scheduled-empty"><span class="scheduled-symbol" aria-hidden="true">↻</span><h2>No scheduled work yet</h2><p>Start above with the outcome and timing. Relay will clarify anything missing before you choose an agent or approve a schedule.</p></section>'}</div><p class="scheduled-footnote">Automatic execution is local and unpaid. This computer and the selected agent must be running. Missed runs are not silently replayed.</p></section>`;
  },
  queue() {
    const items = state.executionQueue?.items || [];
    if (!items.length) return '';
    const count = status => items.filter(item => item.status === status).length;
    return `<section class="panel"><h2>Execution health</h2><p>${count('queued')} waiting · ${count('running')} running · ${count('buyer_review')} ready for review · ${count('failed')} failed</p><p class="hint">Current visible tasks, up to 100. Updated ${date(state.executionQueue.checkedAt)}.</p>${items.filter(item=>item.overdue||item.status==='failed').map(item=>`<div class="request-row"><div><strong>${escape(item.title)}</strong><p>${escape(item.progress)}</p><small>${item.overdue?'Recovery check due':'Needs attention'} · attempt ${item.attempt}</small></div>${state.account.user.workspace==='buyer'?`<button data-action="task" data-id="${item.taskId}">Review task</button>`:'<span class="tag">Buyer permission needed for a restart</span>'}</div>`).join('')}</section>`;
  },
  recovery(task) {
    if (!state.executionQueue?.items.some(item=>item.taskId===task.id&&item.canRetry)) return '';
    return `<details class="panel"><summary>Recover this execution</summary><form id="execution-retry" class="market-form"><p>Only the same agent and agreed work will restart. An interrupted supplier may already have acted; confirm its work is safe to repeat. Maximum two manual recoveries.</p><label>What was checked or fixed?<textarea name="reason" required minlength="10" maxlength="500"></textarea></label><div class="form-error" role="alert"></div><button>Authorize another local attempt</button></form></details>`;
  }
};
