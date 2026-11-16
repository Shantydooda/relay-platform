'use strict';
function taskWaitingForPermission(task) {
  if (typeof task.waitingForPermission === 'boolean') return task.waitingForPermission;
  // Compatibility with older servers; current servers project the live assignment.
  return ['queued', 'running'].includes(task.status) && Boolean(
    task.permissionRequests?.some(request => ['pending', 'declined'].includes(request.status)),
  );
}
const taskLabel = (task) =>
  task.orchestrationPlan ? (task.orchestrationPlan.status === 'accepted' ? 'Completed plan' : 'Plan in progress') :
  task.pausedByBuyer === true
    ? 'Paused'
    : taskWaitingForPermission(task)
    ? 'Permission needed'
    : task.recurringScheduleId
      ? 'Schedule enabled'
      : task.status === 'selected' &&
          task.workPlan &&
          task.workPlan.cadence !== 'once'
        ? 'Schedule review'
        : task.status === 'selected' &&
            task.approvalStatus &&
            task.approvalStatus !== 'approved'
          ? {
              required: 'Approval needed',
              pending: 'Waiting for approval',
              declined: 'Changes requested',
              stale: 'Approval needs updating',
            }[task.approvalStatus] || 'Approval needed'
          : {
              draft: 'Draft',
              posted: 'Getting offers',
              selected: 'Ready-to-start review',
              assigned: 'Start blocked',
              cancelled: 'Closed',
              queued: 'Agent getting ready',
              running: 'In progress',
              buyer_review: 'Delivery ready',
              accepted: 'Delivery accepted',
              failed: 'Execution failed',
              blocked: 'Start blocked',
            }[task.status] || task.status;
// Presentation only: the server still decides permissions and transitions.
function taskNextStep(detail, offers = []) {
  const { task, execution, approval, payment } = detail;
  const latest = detail.submissions?.at(-1);
  if (task.status === 'cancelled')
    return [
      'Request closed',
      'Your conversation and any delivered files are still here.',
    ];
  if (task.status === 'accepted')
    return [
      'All done',
      'Your accepted delivery and earlier versions are saved below.',
    ];
  if (
    taskWaitingForPermission(task)
  )
    return [
      'Your agent needs permission',
      'Execution time is paused. Review the access request below, or cancel the task. Declining keeps access blocked until you reconsider.',
    ];
  if (execution) {
    if (execution.status === 'buyer_review') {
      if (latest?.files.some((file) => file.scan?.status === 'blocked'))
        return [
          'A file needs replacing',
          'A safety check blocked a file. Request a replacement delivery below.',
        ];
      if (
        latest?.files.some((file) => file.scan && file.scan.status !== 'clean')
      )
        return [
          'Checking your files',
          'Safety checks must finish before you can download or accept this delivery.',
        ];
      return [
        'Review your delivery',
        'Open the files below, then accept the result or request changes.',
      ];
    }
    if (execution.status === 'failed' || execution.status === 'blocked')
      return [
        'Work needs attention',
        'Review the agent’s update below. Your brief and work history are saved.',
      ];
    if (
      execution.status === 'queued' &&
      latest?.status === 'revision_requested'
    )
      return [
        'Your revision is queued',
        'The agent has your requested changes. The earlier files remain available below.',
      ];
    if (execution.status === 'queued')
      return [
        'Your agent is getting ready',
        'The task is authorized. We’ll update this conversation when work starts.',
      ];
    if (execution.status === 'running')
      return [
        'Your agent is working',
        'Progress and delivery will appear here. No action needed right now.',
      ];
  }
  if (task.status === 'draft') {
    if (task.scoping?.status === 'pending')
      return [
        'Relay is reading your request',
        'Your message is saved. A scope suggestion will appear here.',
      ];
    if (task.scoping?.proposal?.questions?.length)
      return [
        'A little more detail',
        'Answer Relay’s questions in the conversation to clarify the brief.',
      ];
    if (task.workPlan && task.workPlan.cadence !== 'once')
      return [
        'Review your recurring draft',
        'Confirm what each run should do, then compare agents and review the calendar.',
      ];
    return [
      'Review your brief',
      'Confirm what you need before sharing it with agents.',
    ];
  }
  if (approval && approval.status !== 'approved' && task.selectedOfferId) {
    return approval.status === 'pending'
      ? [
          'Waiting for company approval',
          'Your reviewer has the request. Work has not started.',
        ]
      : [
          'Send for company approval',
          'Review any feedback and submit this offer for budget approval below.',
        ];
  }
  if (payment && !['expired', 'refunded'].includes(payment.status))
    return payment.status === 'funded'
      ? [
          'Ready for your permission',
          'Test funding is confirmed. Review the start controls below.',
        ]
      : [
          'Review test funding',
          'Check the payment update below before starting work.',
        ];
  if (task.scheduleId)
    return detail.schedule?.status === 'paused'
      ? [
          'Schedule paused',
          detail.schedule.reason ||
            'Review Scheduled work to resume future starts.',
        ]
      : [
          'Following your saved plan',
          'Relay is checking a fresh offer from your chosen agent against the saved limits.',
        ];
  if (task.recurringScheduleId)
    return [
      'Schedule enabled',
      'Manage upcoming runs and deliveries in Scheduled work.',
    ];
  if (
    task.status === 'selected' &&
    task.workPlan?.cadence !== 'once' &&
    task.workPlan
  )
    return [
      'Review your schedule',
      'Confirm the calendar, context and limits before enabling automatic runs.',
    ];
  if (task.status === 'selected')
    return [
      'Ready for your permission',
      'Review the selected offer and start requirements below. Work has not started.',
    ];
  const available = offers.filter(
    (offer) => offer.expiresAt > Date.now() && scopeMatches(offer, task),
  );
  return available.length
    ? [
        'Choose an offer',
        'Compare the proposed result, supplier price and delivery estimate below.',
      ]
    : [
        'Finding your agent',
        'Your request is open. Offers will appear in this conversation.',
      ];
}
function scopeRecap(task) {
  const missingHandover = task.orchestrationStep?.dependencies.some(
    id => !task.orchestrationStep.handoffs.some(handoff => handoff.sourceTaskId === id),
  );
  const pendingReply = task.scoping?.status === 'pending';
  const openQuestions = task.workPlan?.openQuestions?.length;
  const canPost = task.status === 'draft' && !missingHandover && !pendingReply && !openQuestions;
  const canEdit = !task.orchestrationStep && ['draft', 'posted', 'selected'].includes(task.status);
  const title = task.title && task.title !== task.brief ? task.title : 'Your request';
  const blocker = missingHandover
    ? 'Approve the required handovers before requesting offers.'
    : pendingReply
      ? 'Waiting for your reply to finish. You can keep editing the brief.'
      : openQuestions
        ? 'Answer the remaining questions before requesting offers.'
        : '';
  return `<section class="scope-recap" aria-label="Request proposal">
    <span class="eyebrow">${canPost ? 'Ready for offers' : 'Your brief'}</span>
    <h2>${escape(title)}</h2>
    <p class="offer-details">${escape(task.brief)}</p>
    ${typeof RelayAcceptance === 'object' ? RelayAcceptance.scope(task) : ''}
    ${recurringPlan(task.workPlan)}
    ${blocker ? `<p class="hint">${blocker}</p>` : ''}
    <div class="inline-actions">
      ${canPost ? '<button class="primary" data-action="post">Find my agent</button>' : ''}
      ${canEdit ? '<button class="quiet" data-action="edit">Edit details</button>' : ''}
    </div>
    ${canPost ? '<p class="hint">Compare prices and timing before choosing an agent.</p><details><summary>What gets shared?</summary><p>Only this brief and file metadata are shared for quotes. Keep confidential details out. Your conversation and file contents stay private until you authorize access.</p></details>' : ''}
  </section>`;
}
function startReview(task) {
  if (
    state.detail.payment &&
    !['expired', 'refunded'].includes(state.detail.payment.status)
  )
    return '';
  const local =
    typeof RelayExecution === 'object' ? RelayExecution.start(task) : '';
  if (local) return local;
  if (!['selected', 'assigned'].includes(task.status)) return '';
  return `<section class="panel start-review"><span class="eyebrow">Before work begins</span><h2>Your choice is saved. Let’s check what’s next.</h2><p>Selecting an offer is separate from funding, supplier acknowledgment and permission to execute.</p><ul class="start-checks"><li><strong>Offer selection</strong><span class="tag posted">Saved</span></li><li><strong>Company approval</strong><span>Not required · personal workspace</span></li><li><strong>Funding</strong><span class="tag">Not connected</span></li><li><strong>Supplier readiness & runtime</strong><span class="tag">Not verified</span></li><li><strong>Required inputs & acknowledgment</strong><span>Not confirmed</span></li></ul><div class="blocked-note"><strong>Work has not started.</strong><p>Funding and runtime services are not connected locally. No charge, execution authorization or delivery countdown has been created.</p></div><button class="quiet" data-action="hide-start">Close start review</button></section>`;
}
function deliveryDesk(task) {
  if (!['selected', 'assigned'].includes(task.status)) return '';
  return `<section class="panel delivery-placeholder"><span class="eyebrow">Delivery · in this conversation</span><h2>Your result will arrive here.</h2><p>Review files and evidence, download originals, request a revision and accept the exact submission—all on this task.</p><div class="delivery-empty">No delivery received. Waiting for authorized work to begin.</div><small>Previews, downloads and acceptance become available when real files are submitted. Nothing has been accepted or paid out.</small></section>`;
}
function repeatHireCard() {
  const repeat = state.detail?.repeatHire;
  if (!repeat) return '';
  if (!repeat.available) return '<section class="panel"><h2>Need something else?</h2><p>This agent is not currently available for a new direct request.</p><a href="#market">Find another agent</a></section>';
  return `<section class="panel"><h2>Work with ${escape(repeat.name)} again</h2><p>Start a new conversation in this workspace. Review a fresh quote and choose the files and tool permissions for the new task. Previous approvals and payments do not carry over.</p><button data-action="repeat-hire" class="primary">Work with this agent again</button></section>`;
}

function retryCard() {
  const retry = state.detail?.retry;
  if (!retry) return '';
  if (!retry.available) return retry.retriedBy ? `<section class="panel"><h2>Another agent is on this</h2><p>You already asked another agent to try this work.</p><a href="#chat=${escape(retry.retriedBy)}">Open the new request</a></section>` : '';
  return `<section class="panel"><h2>Try another agent</h2><p>Start a new request with the same brief. The agent whose run failed won’t be able to quote on it. This run stays on record, and Relay doesn’t move any money: a payment on this task is handled here, not carried over.</p><button data-action="retry-another-agent" class="primary">Try another agent</button></section>`;
}

function taskView() {
  const { task, messages, events } = state.detail,
    posted = task.status !== 'draft';
  if (task.orchestrationStep?.supersededBy) return `<section class="market-workspace"><h1>${escape(task.title)}</h1><p>This attempt was replaced. Its history is preserved; work continues in the parent plan.</p>${RelayOrchestration.step(task)}<details><summary>Previous brief</summary><p>${escape(task.brief)}</p></details><details><summary>Previous updates</summary>${events.map(item=>`<p>${escape(item.type)}</p>`).join('')}</details></section>`;
  const labels = {
    'task.created': 'Brief saved',
    'task.retried': 'Another agent requested · this run stays on record',
    'scope.updated': 'Scope updated · previous offers invalidated',
    'scope.reviewed': 'Scope reviewed · terms unchanged',
    'criteria.updated': 'Acceptance checklist updated · previous offers invalidated',
    'revision.requested': 'Changes requested',
    'delivery.accepted': 'Delivery accepted',
    'delivery.auto_accepted': 'Delivery accepted automatically · no reply within the review window',
    'execution.ended_unmet': 'Work ended · checklist not met',
    'offer.received': 'Offer received',
    'offer.selected': 'Offer selected · work not started',
    'task.posted': 'Brief sent to agents',
    'task.cancelled': 'Request closed',
    'message.added': 'Message saved',
  };
  const renderMessages = (items) =>
    items
      .filter(message => !isAssistantSystemNotice(message))
      .map(
        (m, i) =>
          `<article id="scope-reply-${escape(m.id)}" class="thread-message ${['assistant', 'supplier'].includes(m.role) ? 'relay' : 'buyer'}"><span class="thread-speaker">${m.role === 'supplier' ? escape(m.authorName) : m.role === 'assistant' ? relayCharacter() + 'Relay' : i === 0 || m.authorName === state.account?.user.name ? 'You' : escape(m.authorName)}</span><div><p class="offer-details">${escape(m.body)}</p></div></article>`,
      )
      .join('');
  const postedAt = events.find(
    (event) => event.type === 'task.posted',
  )?.createdAt;
  const isFollowUp = (message) => postedAt && message.createdAt > postedAt;
  const transcript = renderMessages(
    messages.filter((message) => !isFollowUp(message)),
  );
  const followUps = renderMessages(messages.filter(isFollowUp));
  const editor = `<form id="edit" class="panel editor scope-editor"><span class="eyebrow">Confirm a scope change</span><h2>What should the brief say?</h2><p>Only this confirmation changes scope.${posted ? ' Existing offers and selection will need review again.' : ''}</p><label for="title">Task title</label><input id="title" name="title" value="${escape(task.title)}" maxlength="120" required><label for="brief">Current requirements</label><textarea id="brief" name="brief" maxlength="10000" required>${escape(task.brief)}</textarea><div class="form-error" role="alert"></div><div class="inline-actions"><button class="primary" type="submit">Confirm brief change</button><button type="button" data-action="stop-edit">Keep current brief</button></div></form>`;
  return `<section class="buyer-conversation" data-task-id="${task.id}"><header class="conversation-heading"><div><span class="conversation-brand">${relayCharacter()}Relay</span><h1>${escape(posted ? task.title : 'Let’s get it done.')}</h1></div><span class="tag ${task.status}" role="status">${task.status === 'buyer_review' && state.detail.submissions?.at(-1)?.files.some((file) => file.scan && file.scan.status !== 'clean') ? 'Checking delivery' : taskLabel(task)}</span><button type="button" class="quiet conversation-details-trigger" data-action="conversation-context" aria-controls="conversation-details-panel">Details</button></header><div class="thread-layout"><section class="thread-main" aria-label="Conversation and reply"><div class="thread-history" aria-label="Task conversation">${task.scheduleId ? '<article class="thread-message relay"><strong>Scheduled run</strong><p>This task uses its saved context and execution rules.</p><button class="quiet" data-action="buyer-nav" data-tab="scheduled">View schedule & context</button></article>' : ''}${transcript}${task.orchestrationPlan && typeof RelayOrchestration === 'object' ? RelayOrchestration.project(task) : ''}${typeof RelayOrchestration === 'object' ? RelayOrchestration.step(task) : ''}
 ${task.orchestrationPlan ? '' : state.editing ? editor : state.features?.scoping && task.scoping?.status === 'completed' && ['request', 'change'].includes(task.scoping.proposal.intent) ? `<details><summary>Current brief · scope v${task.scopeVersion}</summary><p>${escape(task.brief)}</p></details>${typeof RelayAcceptance === 'object' ? RelayAcceptance.scope(task) : ''}` : posted ? '' : `<article class="thread-message relay"><span class="thread-speaker">${relayCharacter()}Relay</span><p>${task.workPlan && task.workPlan.cadence !== 'once' ? 'Here’s your recurring request. Confirm the work and cadence before requesting offers.' : 'Here’s the brief I’ll send to agents. Does this capture what you need?'}</p>${scopeRecap(task)}</article>`}

 ${!task.orchestrationPlan && !state.editing && !['failed', 'cancelled'].includes(task.scoping?.status) ? scopingReview(task) : ''}
 ${!state.editing && task.status !== 'posted' && typeof RelayExecution === 'object' ? RelayExecution.input(task) : ''}
 ${!state.editing && !task.orchestrationPlan && (state.features?.unifiedBackend || state.authMode === 'local') ? offerCards() : ''}
 ${!(task.workPlan && task.workPlan.cadence !== 'once') && typeof RelayApprovals === 'object' ? (state.detail.execution && state.detail.approval?.status === 'approved' ? `<details><summary>Company approval · recorded</summary>${RelayApprovals.task(task, state.detail.approval)}</details>` : RelayApprovals.task(task, state.detail.approval)) : ''}
 ${!(task.workPlan && task.workPlan.cadence !== 'once') && typeof RelayPayments === 'object' ? RelayPayments.task(task, state.detail.payment, false, state.detail.execution) : ''}
 ${(!task.workPlan || task.workPlan.cadence === 'once') && !state.editing && state.reviewStart ? startReview(task) : ''}
 ${typeof RelayExecution === 'object' ? RelayExecution.delivery(task) : ''}${typeof RelayApps === 'object' ? RelayApps.permissionDecisions(task) : ''}${repeatHireCard()}${retryCard()}
${typeof RelayPortfolio === 'object' ? RelayPortfolio.requests(state.detail.portfolioRequests) : ''}${changeProposalCards(task, state.detail.changeProposals)}${followUps}${state.sendingMessage ? `<article class="thread-message buyer message-enter"><span class="thread-speaker">You · sending</span><p class="offer-details">${escape(state.sendingMessage)}</p></article>${activityCard('Sending your message', 'Waiting for Relay to save it.', true)}` : ''}

 ${task.status === 'cancelled' ? '<article class="thread-message relay"><span class="thread-speaker">${relayCharacter()}Relay</span><p>This request is closed. Your brief and conversation remain available.</p></article>' : ''}
 </div>${!state.editing && ['draft', 'posted'].includes(task.status) ? assistantAvailability(task) : ''}${task.status !== 'cancelled' && !state.editing ? conversationComposer(task) : ''}</section><aside class="thread-context"><details class="conversation-details" id="conversation-details-panel" data-disclosure-key="conversation-details"><summary>Context & details</summary><div class="conversation-details-body"><button class="quiet inspector-close" data-action="close-inspector" aria-label="Close inspector">Close ×</button>${typeof recommendationInspector === 'function' ? recommendationInspector(task) : ''}${!state.editing && task.status === 'posted' && typeof RelayExecution === 'object' ? RelayExecution.input(task) : ''}${typeof RelayApps === 'object' ? RelayApps.contextPicker(task) : ''}
 ${posted ? `<details><summary>${posted ? 'Agreed scope' : 'Your brief'} · v${task.scopeVersion ?? task.version}</summary><p>${escape(task.brief)}</p>${typeof RelayAcceptance === 'object' ? RelayAcceptance.scope(task) : ''}${!task.orchestrationPlan && !task.orchestrationStep && ['draft', 'posted', 'selected'].includes(task.status) ? '<button class="quiet" data-action="edit">Change scope & refresh offers</button>' : ''}</details>` : ''}
 <details><summary>Samples & references</summary><p>CSV task input can be attached in this conversation. Other input formats are not supported yet. Delivery files are scanned separately. Input bytes are shared only after execution is authorized.</p></details>
 <details><summary>Activity & agreement history</summary><ol class="steps">${events.map((e) => `<li>${escape(labels[e.type] || e.type)}<small>${date(e.createdAt)}</small></li>`).join('')}</ol>${state.detail.scopes?.length ? `<details><summary>Previous scope versions</summary>${state.detail.scopes.map((v) => `<p><strong>Scope ${v.version}</strong><br>${escape(v.brief)}</p>`).join('')}</details>` : ''}</details>
 <details><summary>${state.authMode === 'managed' ? 'Pilot environment' : 'Local testing details'}</summary><p class="thread-footnote">${environmentNote()}</p></details>
 ${['draft', 'posted', 'selected'].includes(task.status) ? '<button class="quiet danger" data-action="cancel">Close request</button>' : ''}<button class="quiet" data-action="refresh">Refresh conversation</button>
 </div></details></aside></div></section>`;
}

function scopingReview(task) {
  if (
    !state.features?.scoping ||
    !['draft', 'posted', 'selected'].includes(task.status)
  )
    return '';
  const result = task.scoping;
  if (
    !result &&
    (task.status !== 'draft' ||
      (task.workPlan && task.workPlan.cadence !== 'once'))
  )
    return '';
  if (result?.status === 'pending') {
    const working = result.phase === 'working';
    return (
      activityCard(
        working ? 'Understanding your request' : 'Preparing your reply',
        working
          ? 'Working out the outcome and the details that matter.'
          : 'Your message is saved. You can keep adding details below.',
        true,
      ) +
      `<div class="inline-actions"><small data-reply-start="${Number(result.requestedAt) || Date.now()}">${Math.max(0, Math.floor((Date.now() - (Number(result.requestedAt) || Date.now())) / 1000))}s elapsed</small><button class="quiet" data-action="cancel-reply">Stop reply</button></div>`
    );
  }
  if (result?.status === 'completed') {
    const proposal = result.proposal;
    if (['question', 'hypothetical'].includes(proposal.intent))
      return '<p class="hint">Your question did not change the agreed brief.</p>';
    const recurring = proposal.cadence !== 'once';
    return `<section class="scope-recap" aria-label="Proposed work"><span class="eyebrow">Here’s the plan</span><h2>${escape(proposal.title)}</h2><p class="offer-details">${escape(proposal.brief)}</p>
      ${proposal.assumptions.length ? `<h3>Assumptions to review</h3><ul>${proposal.assumptions.map((item) => `<li>${escape(item)}</li>`).join('')}</ul>` : ''}
      ${proposal.questions.length ? '<p class="hint">Answer the questions in the conversation, or edit the brief yourself before confirming it. A recurring draft can be saved with open questions, but cannot run.</p>' : ''}
      ${recurring ? recurringPlan({ ...proposal, openQuestions: [] }) : ''}
      <div class="inline-actions">${recurring || !proposal.questions.length ? `<button class="primary" data-action="${!recurring && task.status === 'draft' ? 'confirm-and-match' : 'confirm-scope'}">${recurring ? 'Save recurring draft' : task.status === 'draft' ? 'Find the best match' : 'Confirm brief'}</button>` : ''}<button class="quiet" data-action="edit">Edit details</button></div><small>Share this brief with available agents for price and timing. Nothing starts until you approve.</small></section>`;
  }
  return `<section class="panel"><p>${escape(result?.status === 'failed' ? 'Relay couldn’t finish this reply. Your message is saved.' : 'Tell Relay what you need. Your agreed scope stays unchanged until you confirm.')}</p><button data-action="analyze-brief">${['failed', 'cancelled'].includes(result?.status) ? 'Retry reply' : 'Review brief with Relay'}</button></section>`;
}

function recurringPlan(plan) {
  if (!plan || plan.cadence === 'once') return '';
  const fields = [
    ['Schedule', plan.schedule],
    ['Timezone', plan.timezone],
    ['Budget per run', plan.perRunBudget],
    ['Monthly cap', plan.monthlyCap],
  ];
  return `<div class="scope-plan"><h3>Recurring responsibility · draft only</h3><dl>${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${escape(value || 'Needs confirmation')}</dd></div>`).join('')}</dl>${plan.openQuestions?.length ? `<h3>Still to clarify</h3><ul>${plan.openQuestions.map((question) => `<li>${escape(question)}</li>`).join('')}</ul>` : ''}<p class="hint">This draft does not schedule runs or authorize charges. Choose an offer, then review context, timing and limits to enable the schedule.</p><p class="hint">${plan.cadence === 'monthly' ? 'Some months have no 29th, 30th or 31st. Confirm what should happen on unavailable dates before activation.' : 'Calendar rules still need review before activation.'} Daylight-saving changes and missed runs also need an agreed policy.</p></div>`;
}

// Shared conversation identity and honest activity states, not simulated agent output.
function relayCharacter(size = 'small') {
  return `<span class="chat-character ${size}" aria-hidden="true"><svg viewBox="${size === 'face' ? '345 215 260 185' : '60 100 650 610'}" focusable="false"><image href="/assets/relay-assistants.png" width="2172" height="724"/><g class="chat-character-blink"><ellipse cx="460" cy="354" rx="16" ry="19" fill="#c8bdb5"/><ellipse cx="554" cy="353" rx="16" ry="19" fill="#dfd7cf"/></g></svg></span>`;
}
function activityCard(title, description, active = false) {
  return `<section class="live-activity ${active ? 'is-working' : ''}" role="status"><div class="activity-heading">${relayCharacter()}<strong>${escape(title)}</strong>${active ? '<span class="activity-spinner" aria-hidden="true"></span>' : ''}</div><p>${escape(description)}</p></section>`;
}
function taskDashboard() {
  const requestedTasks = state.tasks.filter((task) => !task.orchestrationStep?.supersededBy && (task.status !== 'draft' || task.orchestrationPlan));
  const needsPermission = taskWaitingForPermission;
  const completed = (task) => ['accepted', 'cancelled'].includes(task.status);
  const active = (task) =>
    ['posted', 'queued', 'running'].includes(task.status) &&
    !needsPermission(task);
  const groups = [
    ['Needs you', (task) => !completed(task) && !active(task)],
    ['Under way', active],
    ['Completed', completed],
  ];
  const action = (task) =>
    needsPermission(task)
      ? 'Review permission'
      : task.status === 'draft'
        ? 'Continue brief'
        : task.status === 'posted'
          ? 'View offers'
          : task.status === 'buyer_review'
            ? 'Review delivery'
            : ['failed', 'blocked', 'assigned', 'selected'].includes(
                  task.status,
                )
              ? 'Review next step'
              : 'Open conversation';
  const filter = ['All', ...groups.map(([label]) => label)].includes(
    state.taskFilter,
  )
    ? state.taskFilter
    : 'All';
  const visibleGroups = groups.filter(
    ([label]) => filter === 'All' || filter === label,
  );
  const count = (label) =>
    label === 'All'
      ? requestedTasks.length
      : requestedTasks.filter(groups.find(([name]) => name === label)[1])
          .length;
  const rows = visibleGroups
    .map(([label, match]) => {
      const tasks = requestedTasks
        .filter(match)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (!tasks.length) return '';
      return `<section class="task-section"><h2>${label}<span>${tasks.length}</span></h2><div class="task-table">${tasks
        .map(
          (task) => `<article class="work-index-row">
      <div class="work-index-row-main"><span class="work-index-row-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6M9 12h6M9 16h3"/></svg></span><div><h3><button data-action="task" data-id="${escape(task.id)}">${escape(task.title)}</button></h3><small>${task.updatedAt ? 'Updated ' + date(task.updatedAt) : 'Saved task'}</small></div></div>
      <span class="task-status ${needsPermission(task) || ['failed', 'blocked'].includes(task.status) ? 'attention' : task.status === 'accepted' ? 'complete' : active(task) ? 'active' : ''}"><i aria-hidden="true"></i>${escape(taskLabel(task))}</span>
      <button class="work-index-row-action" data-action="task" data-id="${escape(task.id)}">${action(task)}</button>
    </article>`,
        )
        .join('')}</div></section>`;
    })
    .join('');
  const community = globalThis.document?.documentElement?.dataset.design === 'community';
  const rail = community ? `<aside class="community-task-rail"><h2>Your workspace</h2><article><h3>Work at a glance</h3>${groups.map(([label]) => `<button data-action="task-filter" data-filter="${label}"><span>${label}</span><strong>${count(label)}</strong></button>`).join('')}</article><article class="community-feature"><span>FIND YOUR NEXT SPECIALIST</span><h3>The right agent for the job.</h3><p>Explore capabilities and review evidence before requesting a quote.</p><button data-action="buyer-nav" data-tab="market">Explore agents</button></article><p>Every task keeps its offers, decisions and deliveries together.</p></aside>` : '';
  return `${community ? '<div class="community-task-layout">' : ''}<section class="market-workspace task-dashboard"><header class="builder-page-title"><div><h1>My tasks</h1><p>Everything you’ve requested, in one place.</p></div><button class="primary" data-action="buyer-nav" data-tab="request">Start a conversation</button></header>
    <nav class="task-filters" aria-label="Filter tasks">${['All', ...groups.map(([label]) => label)].map((label) => `<button data-action="task-filter" data-filter="${label}" aria-pressed="${filter === label}">${label}<span>${count(label)}</span></button>`).join('')}</nav>
    ${rows || `<section class="task-empty">${relayCharacter('large')}<h2>${requestedTasks.length ? 'You’re all caught up here.' : 'Your work will live here.'}</h2><p>${requestedTasks.length ? 'Choose another view to find the rest of your tasks.' : 'Start with a conversation. Tasks appear here when you’re ready to request the work.'}</p>${requestedTasks.length ? '<button data-action="task-filter" data-filter="All">View all tasks</button>' : '<button class="primary" data-action="buyer-nav" data-tab="request">Start a conversation</button>'}</section>`}
  </section>${rail}${community ? '</div>' : ''}`;
}

// Historical availability notices are system state, not assistant conversation.
// Match only known system copy; never hide a buyer or supplier message.
function isAssistantSystemNotice(message) {
  return message.role === 'assistant' && [
    'Your message is saved. Conversational replies need the local model to be connected. You can keep notes here or review a request yourself.',
    'Live scoping is unavailable. You can save notes here and review the brief yourself.',
  ].includes(message.body);
}

// Touch-first devices (phones, tablets without a keyboard or mouse) send with the button.
function touchFirst() {
  return typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
}
function sendHint() {
  return touchFirst() ? 'Tap Send when you’re ready' : 'Enter to send · Shift + Enter for a new line';
}
// One place to see what happened across your work in this workspace.
const ACTIVITY_ACTORS = { you: 'You', relay: 'Relay', agent: 'Agent', workspace: 'Workspace member' };
function activityPage() {
  const items = (state.activity?.items || []).filter(item => !state.tenantId || item.tenantId === state.tenantId);
  const rows = items.map(item => `<li class="activity-item"><span class="activity-actor activity-actor-${escape(item.actor)}">${escape(ACTIVITY_ACTORS[item.actor] || 'Update')}</span>`
    + `<div><strong>${escape(item.label)}</strong><a href="#task=${escape(item.taskId)}">${escape(item.taskTitle)}</a></div>`
    + `<time datetime="${new Date(item.createdAt).toISOString()}">${escape(date(item.createdAt))}</time></li>`).join('');
  return `<section class="activity-page" aria-labelledby="activity-title"><h1 id="activity-title">Activity</h1>`
    + `<p class="hint">Everything that happened across your work in this workspace: what each agent did, what you approved, and when.</p>`
    + (rows ? `<ol class="activity-list">${rows}</ol>` : '<p>No activity yet. Updates appear here as your requests move along.</p>')
    + (state.activity?.truncated ? '<p class="hint">Showing the latest 100 updates. Open a task to see its full history.</p>' : '')
    + '</section>';
}
function environmentNote() {
  if (state.authMode === 'managed') {
    const disabled = [!state.payments?.configured && 'payments', !state.features?.localExecution && 'supplier execution'].filter(Boolean);
    return `${state.features?.scoping ? 'Relay suggestions · confirm scope before posting.' : 'Manual brief review · assistant replies are not enabled here yet.'}${disabled.length ? ` ${disabled.join(' and ').replace(/^./, c => c.toUpperCase())} ${disabled.length > 1 ? 'are' : 'is'} disabled in this environment. No money moves.` : ''}`;
  }
  return `${state.features?.scoping ? 'Local model suggestions · confirm scope before posting.' : 'Manual brief review · local model not configured.'} ${state.payments?.configured ? 'Sandbox payments only. Start permission is separate from funding.' : 'Stripe sandbox is not connected. Local execution can run unpaid.'}`;
}

function assistantAvailability(task) {
  if (state.features?.scoping && !['failed', 'cancelled'].includes(task.scoping?.status)) return '';
  const stopped = task.scoping?.status === 'cancelled';
  return `<div class="conversation-system-state" role="status"><span class="availability-dot" aria-hidden="true"></span><span>${stopped ? 'Reply stopped. Your message is saved.' : 'Relay assistant unavailable · your messages are saved.'}</span>${state.features?.scoping ? '<button class="quiet" data-action="analyze-brief">Retry reply</button>' : ''}</div>`;
}

function conversationComposer(task) {
  return composer('message', 'Message Relay…', 'Send', state.messageDrafts[task.id] || '', sendHint())
    .replaceAll('Message about this task', 'Message Relay')
    .replace('<div class="replybox">', '<button type="button" class="composer-context-button" data-action="conversation-context" aria-controls="conversation-details-panel" aria-label="Add files or choose context">+ Files & context</button><div class="replybox">');
}

// Drafts stay conversational: expose a ready proposal without an extra review screen.
function draftProposal(task) {
  const result = task.scoping;
  if (result?.status === 'pending') {
    return scopingReview(task);
  }
  if (result?.status === 'completed') {
    const proposal = result.proposal;
    if (!['request', 'change'].includes(proposal.intent)) return '';
    if (proposal.questions.length) {
      return `<section class="draft-clarifications" aria-label="Details to clarify"><h2>Before I find your agent</h2><ul>${proposal.questions.map(question => `<li>${escape(question)}</li>`).join('')}</ul><p class="hint">Reply below. Nothing has been posted or charged.</p></section>`;
    }
    return scopingReview(task);
  }
  const reviewed = state.detail.events?.some(event => ['scope.reviewed', 'scope.updated'].includes(event.type));
  if (reviewed || state.reviewChatRequest) {
    return `${scopeRecap(task)}${!reviewed ? '<button class="quiet" data-action="keep-chatting">Keep chatting</button>' : ''}`;
  }
  return '<div class="chat-request-action"><span>When you’re ready, review what you’d like done.</span><button data-action="review-chat-request">Review task request</button></div>';
}

function draftConversation() {
  const task = state.detail.task;
  const pending = task.scoping?.status === 'pending';
  const transcript = state.detail.messages
    .filter(message => !isAssistantSystemNotice(message))
    .map(
      (message) =>
        `<article id="scope-reply-${escape(message.id)}" class="thread-message ${message.role === 'assistant' ? 'relay' : 'buyer'}"><span class="thread-speaker">${message.role === 'assistant' ? relayCharacter() + 'Relay' : 'You'}</span><p class="offer-details">${escape(message.body)}</p></article>`,
    )
    .join('');
  const sourceReads = task.scoping?.contextReads || [];
  return `<section class="buyer-conversation draft-conversation" data-task-id="${escape(task.id)}"><header class="conversation-heading"><div><span class="conversation-brand">${relayCharacter()}Relay</span><h1>${escape(task.title || 'New conversation')}</h1></div><span class="tag" role="status">Draft</span><button type="button" class="quiet conversation-details-trigger" data-action="conversation-context" aria-controls="conversation-details-panel">Details</button></header><div class="thread-layout"><section class="thread-main" aria-label="Conversation and reply"><div class="thread-history" aria-label="Conversation">
    ${transcript}
    ${state.sendingMessage ? `<article class="thread-message buyer message-enter"><span class="thread-speaker">You · sending</span><p>${escape(state.sendingMessage)}</p></article>` : ''}
    ${sourceReads.length ? `<section class="live-activity"><strong>${pending ? 'Using your selected context' : 'Context used for this response'}</strong>${sourceReads.map((read) => `<p>✓ Read ${escape(read.name)} · saved version ${read.version}</p>`).join('')}<small>Saved copies in Relay. No live external lookup.</small></section>` : ''}
    ${draftProposal(task)}
  </div>${assistantAvailability(task)}${conversationComposer(task)}</section><aside class="thread-context"><details class="conversation-details" id="conversation-details-panel" data-disclosure-key="conversation-details"><summary>Files & context</summary><div class="conversation-details-body"><button class="quiet inspector-close" data-action="close-inspector" aria-label="Close inspector">Close ×</button>${typeof recommendationInspector === 'function' ? recommendationInspector(task) : ''}${typeof RelayExecution === 'object' ? RelayExecution.input(task) : ''}${typeof RelayApps === 'object' ? RelayApps.contextPicker(task) : ''}${task.contextReferences?.length && state.features?.scoping ? '<p>Use selected saved copies to help Relay respond. This does not grant a builder access.</p><button data-action="read-chat-context">Read selected sources & respond</button>' : ''}<small>Only requested work appears in My tasks. This conversation stays in your recent chats.</small></div></details></aside></div></section>`;
}

function changeProposalCards(task, proposals = [], buyer = true) {
  return proposals
    .map((proposal) => {
      const pending =
        proposal.status === 'pending' &&
        proposal.expiresAt > Date.now() &&
        proposal.baseOfferId === task.selectedOfferId;
      const status =
        proposal.status === 'pending' && !pending
          ? 'no longer current'
          : proposal.status;
      const delta = proposal.amountMinor - proposal.previousAmountMinor;
      return `<section class="work-activity change-proposal"><header><strong>${pending ? 'Proposed change' : 'Change ' + escape(status)}</strong><span class="tag">${delta > 0 ? '+' : delta < 0 ? '−' : ''}${money(Math.abs(delta), proposal.currency)}</span></header><div class="work-activity-body"><h3>${escape(proposal.title)}</h3><p class="offer-details">${escape(proposal.brief)}</p><p>${escape(proposal.reason)}</p><p><strong>${money(proposal.previousAmountMinor, proposal.currency)} → ${money(proposal.amountMinor, proposal.currency)}</strong> total · ${proposal.deliveryMinutes} min after restart</p><p class="hint">${money(proposal.retainedMinor, proposal.currency)} of the total covers work already performed. Local test amounts; no money moves.</p>${pending && buyer ? `<form data-change-review="${escape(proposal.id)}"><input type="hidden" name="taskId" value="${escape(task.id)}"><div class="inline-actions"><button class="primary" name="decision" value="accept">Accept revised terms</button><button name="decision" value="decline">Keep original scope</button></div><p class="hint">Acceptance stops the old run. ${task.companyApprovalRequired ? 'Fresh company approval and ' : ''}Start authorization is required before revised work begins.</p><div class="form-error" role="alert"></div></form>` : ''}</div></section>`;
    })
    .join('');
}
function builderConversation(task) {
  return `<section class="builder-conversation"><h3>Conversation with the buyer</h3><div class="builder-messages">${(task.messages || []).map((message) => `<p><strong>${escape(message.role === 'supplier' ? message.authorName : message.role === 'assistant' ? 'Relay' : message.authorName || 'Buyer')}</strong><br>${escape(message.body)}</p>`).join('')}</div><form data-supplier-message="${escape(task.id)}"><label>Reply to buyer<textarea name="body" maxlength="10000" required placeholder="Clarify, answer a question or explain your progress…"></textarea></label><div class="form-error" role="alert"></div><button type="submit">Send reply</button><small>Sent as the operator. Messages do not change the agreement.</small></form>${changeProposalCards(task, task.changeProposals, false)}${!task.orchestrationStep && !task.submissions?.length && !task.payment && !task.scheduleId && !task.recurringScheduleId && (!task.workPlan?.cadence || task.workPlan.cadence === 'once') ? `<details><summary>Propose a scope or price change</summary><form data-change-propose="${escape(task.id)}"><label>Type of change<select name="kind"><option value="scope-change">Add or remove scope</option><option value="correction">Correction · same price</option><option value="included-revision">Included revision · same price</option></select></label><label>Revised title<input name="title" maxlength="120" required value="${escape(task.title)}"></label><label>Complete revised brief<textarea name="brief" maxlength="10000" required>${escape(task.brief)}</textarea></label><label>Reason for change<textarea name="reason" maxlength="2000" required></textarea></label><div class="quote-fields"><label>Revised total (${escape(task.currency || 'USD')})<input name="total" type="number" min="0.01" max="100000" step="0.01" required value="${task.amountMinor / 100}"></label><label>Included cost of completed work (${escape(task.currency || 'USD')})<input name="retained" type="number" min="0" step="0.01" required value="0"></label><label>Delivery after restart (minutes)<input name="minutes" type="number" min="1" max="10080" step="1" required value="${task.deliveryMinutes}"></label></div><p class="hint">Clarifications, corrections and included revisions should not increase the price. The original agreement stays in effect until the buyer accepts a change.</p><div class="form-error" role="alert"></div><button type="submit">Send change proposal</button></form></details>` : '<p class="hint">For scheduled work, update its schedule. Submitted or funded work needs its delivery and settlement review.</p>'}</section>`;
}

// One listener survives sidebar refreshes. Pointer updates never re-render UI.
(() => {
  if (typeof matchMedia !== 'function' || typeof document === 'undefined') return;
  const motion = matchMedia('(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)');
  let frame = null;
  let pointer = null;
  let current = null;

  function reset() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pointer = null;
    current?.style.removeProperty('transform');
    current = null;
  }

  function update() {
    frame = null;
    if (!motion.matches || document.hidden || !pointer) return reset();
    const face = document.querySelector('.workspace-identity .chat-character.face svg');
    if (face !== current) current?.style.removeProperty('transform');
    current = face;
    if (!face) return;
    // Measure the stationary wrapper, not the transformed face.
    const bounds = face.parentElement.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (pointer.x - bounds.left - bounds.width / 2) / 300));
    const y = Math.max(-1, Math.min(1, (pointer.y - bounds.top - bounds.height / 2) / 300));
    face.style.transform = `translate(${x * 5}px, ${y * 4}px) perspective(180px) rotateX(${-y * 12}deg) rotateY(${x * 18}deg) rotateZ(${x * 8}deg)`;
  }

  document.addEventListener('pointermove', event => {
    if (!motion.matches || event.pointerType === 'touch' || document.hidden) return;
    pointer = { x: event.clientX, y: event.clientY };
    if (frame === null) frame = requestAnimationFrame(update);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', reset);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  motion.addEventListener('change', reset);
})();
