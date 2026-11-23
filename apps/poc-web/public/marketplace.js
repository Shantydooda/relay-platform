'use strict';
// Presentation only. Readiness and every state transition come from the API.
const money = (value, currency = 'USD') => new Intl.NumberFormat(undefined, {style:'currency', currency}).format(value / 100);
// Supplier estimates are stored in minutes; buyers read "1 day 2 h", not "1560 min".
// What the buyer pays: the builder's quote plus Relay's fee, frozen on the offer (pricing.cjs).
// Offers made before fees existed have no total; they cost the quote.
function buyerPrice(o){return o?.totalMinor??o?.amountMinor;}
function priceSplit(o){return o?.feeMinor?` (${money(o.amountMinor,o.currency)} to the builder, ${money(o.feeMinor,o.currency)} Relay fee)`:'';}
function deliveryDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const days = Math.floor(total / 1440), hours = Math.floor(total % 1440 / 60), mins = total % 60;
  const parts = [days && `${days} ${days === 1 ? 'day' : 'days'}`, hours && `${hours} h`, mins && `${mins} min`].filter(Boolean);
  return parts.length ? parts.slice(0, 2).join(' ') : '0 min';
}
// The server owns the outcome wording (outcome-ledger.cjs). Older payloads fall back to accepted counts.
function trackRecordText(trackRecord) {
  if (!trackRecord) return 'No delivery history yet';
  if (trackRecord.outcomes?.label) return trackRecord.outcomes.label;
  return `${Number(trackRecord.capabilityAccepted) || 0} accepted deliveries for this capability`;
}
// One statement of what a quote means, matching what checkout actually charges:
// funding collects exactly the quoted amount; no Relay fee or tax is added today.
function priceNote() {
  return state.payments?.configured
    ? 'Quoted price. Funding collects exactly this amount; no Relay fee is added in this environment and taxes are not calculated.'
    : 'Quoted price. No payment is collected in this environment.';
}
// Quotes only come from connected, assessed agents. After a while with none, say so plainly
// instead of implying that matching is still in progress.
const QUOTE_WAIT_NOTICE_MS = 30 * 60000;
function waitingForQuotes() {
  const postedAt = (state.detail?.events || []).find(event => event.type === 'task.posted')?.createdAt;
  if (postedAt && Date.now() - postedAt > QUOTE_WAIT_NOTICE_MS) {
    return '<div class="matching-state" role="status"><div><strong>No qualified quote yet</strong><p>Your request stays open. Only agents that are connected and assessed for this kind of work can quote, and none has so far. You can refine the request here; I’ll show a recommendation if a quote arrives.</p></div></div>';
  }
  return '<div class="matching-state" role="status"><span class="activity-spinner" aria-hidden="true"></span><div><strong>Waiting for quotes from qualified agents</strong><p>Only agents that are connected and assessed for this kind of work can quote. Offers appear here, with a recommendation, as they arrive.</p></div></div>';
}
const scopeMatches = (offer,task) => (offer.scopeVersion ?? offer.taskVersion) === (task.scopeVersion ?? task.version);
const builderLabels = {dashboard:'Overview',agents:'Your agents',opportunities:'Opportunities',quotes:'Your offers',work:'Tasks',earnings:'Earnings',settings:'Settings'};

function offerCard(o, task, trackExposure = true) {
  const available = ['posted','selected'].includes(task.status) && scopeMatches(o,task) && o.expiresAt > Date.now();
  return `<article ${trackExposure ? `data-offer-exposure="${escape(o.id)}" data-shortlisted="${Boolean(o.exposure?.shortlisted)}"` : ''} class="panel offer-card ${o.selected?'chosen':''}">
    <div class="section-heading"><div><span class="eyebrow">${o.agentType==='general'?'General-purpose':'Domain specialist'}</span><h3>${escape(o.agentName)}</h3><small>Operated by ${escape(o.operatorName)}</small></div><strong>${money(buyerPrice(o), o.currency)}<small>${o.feeMinor?'total, including Relay’s fee':'total price'}</small></strong></div>
    <p>${escape(o.capability)}</p><span class="tag">${o.qualification==='qualified'?(o.qualificationCurrent?`Passed Relay test · ${RelaySupplier.assessmentTitle(o.qualificationEvidence)}`:'Relay test expired · retest needed'):'No Relay test for this work yet'}</span>
    ${o.exposure?.featured?`<p class="tag">Qualified newcomer opportunity</p><p class="hint">${escape(o.exposure.reason)}</p>`:''}
    ${o.trackRecord?`<p class="hint">${escape(trackRecordText(o.trackRecord))}. Local and sandbox history, not paid-customer proof.</p>`:''}
    <p class="offer-details">${escape(o.proposal)}</p>
    ${typeof RelayEngagements==='object'?RelayEngagements.planSummary(o):''}
    <div class="offer-facts"><div><small>First delivery estimate</small><strong>${deliveryDuration(o.deliveryMinutes)} after starting</strong></div><div><small>Valid until</small><strong>${date(o.expiresAt)}</strong></div></div>
    <details class="quiet-details"><summary>Capability evidence and price details</summary>${o.feeMinor?`<p>Price: ${money(buyerPrice(o),o.currency)} total${priceSplit(o)}.</p>`:''}${typeof RelaySupplier==='object'?RelaySupplier.evidence(o.qualificationEvidence):''}<p>Qualification is a snapshot at quote time and covers only the displayed rubric.</p><p>${escape(o.currency || 'USD')} · ${escape(priceNote())}</p></details>
    ${o.selected?'<span class="tag posted">Selected · not started</span>':available?(state.reviewOffer===o.id?'':`<button data-action="review-offer" data-id="${o.id}">${task.status==='selected'?'Compare this offer':'Review offer'}</button>`):`<p class="muted">${!scopeMatches(o,task)?'The brief changed. A new offer is required.':o.expiresAt<=Date.now()?'Offer expired.':task.status==='cancelled'?'Request closed.':'Another offer was awarded.'}</p>`}
    ${state.reviewOffer===o.id&&available?`<div class="offer-confirm">${o.milestones?.length&&typeof RelayEngagements==='object'?`<h3>Accept this plan?</h3><p>${RelayEngagements.confirmText(o)}</p><button class="primary" data-action="accept-offer" data-id="${o.id}">Accept plan</button>`:`<h3>Choose ${escape(o.agentName)}?</h3><p>${money(buyerPrice(o), o.currency)} total${priceSplit(o)} · ${deliveryDuration(o.deliveryMinutes)} after work starts. ${state.detail.approval?'Changing the selection releases the previous reservation and requires fresh company approval.':'This saves your selection and opens the start requirements.'} No payment is collected and no execution is authorized.</p><button class="primary" data-action="accept-offer" data-id="${o.id}">Confirm selection</button>`}<button data-action="close-review">Keep comparing</button></div>`:''}
  </article>`;
}
function compactOffer(o, task) {
  const current = scopeMatches(o, task) && o.expiresAt > Date.now();
  const budget = o.recommendation?.preferences?.budget;
  const outsideBudget = budget && (o.currency !== budget.currency || buyerPrice(o) > budget.amountMinor);
  return `<details class="offer-option" ${state.reviewOffer === o.id ? 'open' : ''}>
    <summary data-offer-exposure="${escape(o.id)}" data-shortlisted="${Boolean(o.exposure?.shortlisted)}">
      <strong>${escape(o.agentName)}</strong>
      <span>${money(buyerPrice(o), o.currency)} · ${deliveryDuration(o.deliveryMinutes)} after starting${current ? '' : ' · Needs a fresh quote'}${outsideBudget ? ' · Outside budget preference' : ''}</span>
    </summary>${offerCard(o, task, false)}
  </details>`;
}
function currentRecommendation(task, offers = state.offers || []) {
  return offers.find(offer => offer.recommendation?.recommended &&
    offer.recommendation.scopeVersion === task.scopeVersion &&
    scopeMatches(offer, task) && offer.expiresAt > Date.now());
}

function recommendationInspector(task) {
  const offer = state.offers?.find(item => item.selected) || currentRecommendation(task);
  if (!offer) return '';
  return `<section class="agent-inspector" aria-label="Agent details">
    <span class="eyebrow">Execution partner</span><h2>${escape(offer.agentName)}</h2>
    <p>${escape(offer.capability)}</p>
    <h3>Accountable operator</h3><p>${escape(offer.operatorName || 'Operator not supplied')}</p>
    <h3>Capabilities</h3><div class="agent-card-meta"><span>${escape(offer.agentType === 'general' ? 'General purpose' : 'Specialist')}</span><span>${escape(offer.capability)}</span></div>
    ${typeof RelayAgentMarket === 'object' ? RelayAgentMarket.metadata(offer.capabilityMetadata || {}) : ''}
    <h3>Price & timing</h3><p>${money(buyerPrice(offer), offer.currency)} total${priceSplit(offer)} · ${deliveryDuration(offer.deliveryMinutes)} after starting</p>
    <h3>Performance & trust</h3><p>${offer.qualificationCurrent ? 'Current capability assessment passed' : 'No current capability assessment'}</p>
    <p>${escape(trackRecordText(offer.trackRecord))}. Local and sandbox evidence; paid-work performance is not yet established.</p>
    <details><summary>Review assessment evidence</summary>${typeof RelaySupplier === 'object' ? RelaySupplier.evidence(offer.qualificationEvidence) : ''}</details>
    <h3>Included delivery</h3><p class="offer-details">${escape(offer.proposal)}</p>${offer.selected ? '<button class="quiet" data-action="contact-operator">Message operator</button>' : ''}
    ${offer.recommendation ? `<h3>Why this match</h3><p>${escape(offer.recommendation.limitations)}</p>` : ''}
    <small>${escape(priceNote())} Work begins only after the required approvals.</small>
  </section>`;
}

function recommendedOffers(task, offers) {
  const recommended = currentRecommendation(task, offers);
  if (!recommended) return `<p>${offers.find(offer => offer.recommendation?.blockedReason) ? escape(offers.find(offer => offer.recommendation?.blockedReason).recommendation.blockedReason) : offers.some(offer => offer.recommendation?.preferences?.budget) ? 'No qualified quote meets your current budget preference. You can adjust it in the conversation or inspect the other quotes.' : 'No evidence-backed recommendation yet.'}</p><div class="thread-offers"><details><summary>Inspect ${offers.length} available quotes</summary>${offers.map(offer => compactOffer(offer, task)).join('')}</details></div>`;
  const alternatives = offers.filter(offer => offer.id !== recommended.id);
  const reviewing = state.reviewOffer === recommended.id;
  return `<section class="recommended-execution" aria-label="Relay recommendation" data-offer-exposure="${escape(recommended.id)}" data-shortlisted="${Boolean(recommended.exposure?.shortlisted)}">
    <span class="eyebrow">Recommended execution</span>
    <h2>${escape(recommended.agentName)}</h2>
    <p class="execution-structure">${recommended.agentType === 'general' ? 'One versatile agent' : 'One specialist'} · operated by ${escape(recommended.operatorName || 'the supplier')}</p>
    <ul class="recommendation-reasons">${recommended.recommendation.reasons.slice(0, 3).map(reason => `<li>${escape(reason.replace('Declared capability matches words or related concepts in your brief:', 'Capability matches your request:').replace('Supplier-declared details also match:', 'Declared coverage matches:').replace('This quoted capability has a current assessment and a recently connected runtime.', 'Current capability assessment; recently connected.'))}</li>`).join('')}</ul>
    <div class="recommendation-facts"><div><small>Price</small><strong>${money(buyerPrice(recommended), recommended.currency)}</strong></div><div><small>First delivery</small><strong>${deliveryDuration(recommended.deliveryMinutes)} after starting</strong></div></div>
    <p class="recommendation-trust">${recommended.qualificationCurrent ? '✓ Passed Relay test' : 'Relay test not current'} · ${escape(trackRecordText(recommended.trackRecord))}</p>
    <div class="inline-actions">${!reviewing ? `<button class="primary" data-action="review-offer" data-id="${escape(recommended.id)}">Continue with this agent</button>` : ''}<button class="quiet" data-action="inspect-recommendation">View details</button></div>
    ${reviewing ? `<div class="offer-confirm"><h3>Confirm this execution option</h3><p class="offer-details">${escape(recommended.proposal)}</p>${typeof RelayAcceptance === 'object' ? RelayAcceptance.summary(task.acceptanceCriteria) : ''}<p>${money(buyerPrice(recommended), recommended.currency)}${priceSplit(recommended)} · ${escape(priceNote())} You’ll review permissions before work starts.</p><button class="primary" data-action="accept-offer" data-id="${escape(recommended.id)}">Confirm selection</button><button class="quiet" data-action="close-review">Keep discussing</button></div>` : ''}
  </section>${alternatives.length ? `<details class="thread-alternatives" ${(recommended.recommendation.preferences?.alternatives || alternatives.some(offer => offer.id === state.reviewOffer)) ? 'open' : ''}><summary>See ${alternatives.length} alternative offer${alternatives.length === 1 ? '' : 's'}</summary>${alternatives.slice(0, 3).map(offer => compactOffer(offer, task)).join('')}${alternatives.length > 3 ? `<details><summary>More offers (${alternatives.length - 3})</summary>${alternatives.slice(3).map(offer => compactOffer(offer, task)).join('')}</details>` : ''}</details>` : ''}`;
}
function offerCards(){
 const task=state.detail.task;
 if(state.detail.engagement&&typeof RelayEngagements==='object')return RelayEngagements.panel(state.detail);
 if(task.status==='draft'||task.status==='cancelled')return typeof RelayEngagements==='object'?RelayEngagements.banner(state.detail):'';
 const selected=state.offers.find(o=>o.selected);
 if(state.detail.milestone&&!state.detail.execution&&typeof RelayEngagements==='object')return RelayEngagements.agreement(task,selected);
 if(task.recurringScheduleId)return '<article class="panel"><h3>Your schedule is enabled</h3><p>Each run has its own conversation, offer checks and delivery.</p><button data-action="buyer-nav" data-tab="scheduled">Manage schedule</button></article>';
 if(state.detail.execution&&selected)return `<article class="thread-message relay"><span class="thread-speaker">Relay</span><details><summary>Agreed offer · ${escape(selected.agentName)}</summary><p>${escape(selected.proposal)}</p>${typeof RelayAcceptance==='object'?RelayAcceptance.summary(RelayAcceptance.criteria()):''}<p>${typeof RelayExecution==='object'?RelayExecution.where():'Actual local execution'} · no payment collected.</p>${RelaySupplier.evidence(selected.qualificationEvidence)}</details></article>`;
 if(task.scheduleId)return `<article class="thread-message relay"><span class="thread-speaker">Relay</span><h3>${selected?'Offer selected within your saved rules':'Waiting for your chosen agent'}</h3>${selected?`<p>${escape(selected.agentName)} · ${money(buyerPrice(selected), selected.currency)} test quote · ${deliveryDuration(selected.deliveryMinutes)} after starting</p><details><summary>Offer & capability evidence</summary><p>${escape(selected.proposal)}</p>${RelaySupplier.evidence(selected.qualificationEvidence)}</details>`:'<p>Only the agent chosen for this recurring task can bid. Relay checks each fresh offer against the saved limits.</p>'}<p>${task.workPlan&&task.workPlan.cadence!=='once'?RelayRecurring.setup(task):state.detail.approval&&state.detail.approval.status!=='approved'?'Request company approval below before this run can start.':'The schedule handles authorization. No additional start button is needed.'}</p><button data-action="buyer-nav" data-tab="scheduled">View schedule & context</button></article>`;
 if(task.package)return packageAgreement(task,selected);
 if(!state.offers.length)return waitingForQuotes();
 const others=state.offers.filter(o=>!o.selected);
 return `<article class="thread-message relay offer-section" aria-label="Agent offers"><span class="thread-speaker">Relay</span>
 ${selected?`<section class="panel selected-agreement"><strong>Selected: ${escape(selected.agentName)}</strong><p>${money(buyerPrice(selected), selected.currency)} total${priceSplit(selected)} · ${deliveryDuration(selected.deliveryMinutes)} to first delivery after work starts</p><p class="hint">${selected.runtimeBid?'This is a local test offer. No real money moves. Explicit task permission is required before the runtime starts.':'This agent is selected. Work starts only after confirmed funding, readiness and required inputs.'}</p>${task.workPlan&&task.workPlan.cadence!=='once'?RelayRecurring.setup(task):state.detail.approval&&state.detail.approval.status!=='approved'?'<p class="hint">Company approval is needed. Continue in the approval card below.</p>':state.reviewStart?'':'<button class="primary" data-action="review-start">Review start requirements</button>'}</section><details class="thread-alternatives" ${state.reviewOffer?'open':''}><summary>Compare other offers</summary><div class="thread-offers">${[selected,...others].map(o=>offerCard(o,task)).join('')}</div></details>`:`${currentRecommendation(task, others) ? '<p>Here’s the execution option I’d recommend for your request.</p>' : ''}${recommendedOffers(task,others)}`}
 ${state.offers.length?'<details class="quiet-details"><summary>Recommendation policy</summary><p>One of the first four positions may rotate among currently qualified newcomers. Placement is an opportunity to compare, not a quality recommendation or guaranteed hire. All other offers remain available. Compare the scope of test evidence alongside price and delivery estimates. Paid-work reliability has not been assessed. Agent type alone is not a qualification.</p></details>':'<p class="hint">Connected runtimes can bid automatically when their operator enables it. Manual local offers can also appear here.</p>'}
 </article>`;
}
// A task hired as a package: the terms were fixed when the buyer hired it, so there
// are no quotes to compare and nothing to recommend. Work starts through the same
// start review once the package's required inputs are attached.
function packageAgreement(task,selected){
 const p=task.package,needsCsv=p.inputs.includes('csv')&&!task.input;
 const start=needsCsv?'<p class="hint">Attach your CSV above to start. The package price and checklist stay the same.</p>'
  :state.detail.approval&&state.detail.approval.status!=='approved'?'<p class="hint">Company approval is needed. Continue in the approval card below.</p>'
  :state.reviewStart?'':'<button class="primary" data-action="review-start">Review and start</button>';
 return `<article class="thread-message relay offer-section" aria-label="Hired package"><span class="thread-speaker">Relay</span>
 <section class="panel selected-agreement"><span class="eyebrow">Hired package · v${p.packageVersion}</span><strong class="package-title">${escape(p.title)}</strong>
 <p>${escape(selected?.agentName||'')} · ${money(buyerPrice(selected)??p.priceMinor,p.currency)} package price${priceSplit(selected)} · ${deliveryDuration(p.deliveryMinutes)} to delivery after work starts</p>
 <p>${escape(p.included)}</p>
 <h3>Checklist agreed when you hired it</h3><ul>${p.criteria.map(c=>`<li>${escape(c.text)}</li>`).join('')}</ul>
 <p class="hint">Fixes are free until the checklist is met${p.extraRounds?`, plus ${p.extraRounds} extra round${p.extraRounds===1?'':'s'} for other changes`:''}. Anything beyond the package needs a change request. ${selected?.runtimeBid===false&&typeof RelayExecution==='object'?escape(RelayExecution.where())+' · no payment collected.':''}</p>
 ${start}</section></article>`;
}
function availableAgents(task) {
  return state.agents.filter(a=>!task.myOffers?.some(o=>o.agentId===a.id&&scopeMatches(o,task)&&o.expiresAt>Date.now()));
}
// Builders pick a task from the fixed category list (packages/domain/src/categories.cjs);
// "Other" takes a suggestion for review.
function categoryPicker(c={}) {
  const fields=state.taxonomy||[], chosen=c.categoryId||'';
  if(!fields.length)return `<label>Broad category<input name="category" value="${escape(c.category)}" placeholder="Research, design, operations, or your own category" maxlength="100" required></label>`;
  return `<label>Category<select name="categoryId" required data-category-pick><option value="" ${chosen?'':'selected'} disabled>Choose what this capability does</option>${fields.map(f=>`<optgroup label="${escape(f.label)}">${f.tasks.map(t=>`<option value="${escape(t.id)}" ${chosen===t.id?'selected':''}>${escape(t.label)}</option>`).join('')}</optgroup>`).join('')}<option value="other" ${chosen==='other'?'selected':''}>Other: suggest a category</option></select></label>${chosen==='other'?`<label>Suggested category<input name="category" value="${escape(c.category||'')}" maxlength="100" required placeholder="e.g. Grant writing"></label>`:''}<p class="hint">Buyers filter by category. It doesn’t say anything about evidence: that comes from Relay tests and verified runs.</p>`;
}
function capabilityRow(c={}) {
  return `<fieldset class="capability-row"><legend>Capability</legend>${categoryPicker(c)}<label>What can it deliver?<textarea name="capability" placeholder="Be specific: design pitch decks, reconcile invoices, research companies…" maxlength="1000" required>${escape(c.task)}</textarea></label><details><summary>Matching details · optional</summary><p class="hint">Separate entries with commas. These are public supplier declarations, not verified coverage or tool permissions.</p>${[['industries','Industries'],['regions','Regions served'],['outputs','Output formats'],['tools','Tools supported']].map(([key,label])=>`<label>${label}<input name="cap-${key}" maxlength="970" value="${escape((c.metadata?.[key]||[]).join(', '))}"></label>`).join('')}</details><button type="button" class="quiet" data-action="remove-capability">Remove capability</button></fieldset>`;
}
function agentPreview(d={}) {return `<span class="eyebrow">PROFILE DRAFT</span><span class="profile-initial">${escape((d.name||'Your agent').slice(0,1).toUpperCase())}</span><h3>${escape(d.name)||'Your agent name'}</h3><p>${d.kind==='specialist'?'Domain specialist':d.kind==='general'?'General-purpose':'Choose an agent type'}${d.domain?` · ${escape(d.domain)}`:''}</p><p>${escape(d.purpose)||'Your agent’s strengths and limits will appear here.'}</p><span class="tag">Declared · not assessed</span><p class="hint">Profile details are supplier claims until independently assessed.</p>`;}
function agentForm() {
 const d=state.agentDraft||{},caps=state.agentIntroPart==='capabilities';
 if(caps)return `<form id="agent" class="panel market-form"><span class="eyebrow">WHAT CAN YOUR AGENT DELIVER?</span><h2>Start with one concrete capability.</h2><p>Describe the deliverable, required inputs, coverage and limits. For example: a sourced real-estate market report for a named city, using supplied property details. Add more capabilities now or later.</p>${['name','kind','purpose','domain'].map(key=>`<input type="hidden" name="${key}" value="${escape(d[key])}">`).join('')}<div id="capability-rows">${(d.capabilities?.length?d.capabilities:[{}]).map(capabilityRow).join('')}</div><button type="button" data-action="add-capability">Add another capability</button><div class="form-error" role="alert"></div><div class="inline-actions"><button class="primary" type="submit">Continue to connection</button><button type="button" class="quiet" data-action="edit-introduction">Edit agent details</button></div><p class="hint">Each capability is assessed separately. Saving a declaration does not qualify it.</p></form>`;
 return `<form id="agent" class="panel market-form"><span class="eyebrow">LET’S START WITH THE BASICS</span><h2>Meet your next working agent.</h2><p>Already have an agent or an API service? Keep it running where it is. Tell buyers what outcome it delivers.</p><label>Agent name<input name="name" value="${escape(d.name)}" maxlength="80" required></label><label>What does it help people do?<textarea name="purpose" maxlength="1000" required>${escape(d.purpose)}</textarea></label><p class="hint">This description appears on your agent’s profile.</p><fieldset class="type-cards"><legend>What kind of agent is it?</legend><label><input type="radio" name="kind" value="general" ${d.kind==='general'?'checked':''} required><strong>General-purpose</strong><small>Works across different fields and task types.</small></label><label><input type="radio" name="kind" value="specialist" ${d.kind==='specialist'?'checked':''} required><strong>Domain-specialist</strong><small>Focuses on a particular field or industry.</small></label></fieldset><label>Focus or specialist domain<input name="domain" ${d.kind==='specialist'?'required':''} value="${escape(d.domain)}" maxlength="150" placeholder="Required for a specialist; optional otherwise"></label><p class="hint">Either type can have multiple capabilities. Each capability is assessed separately.</p><div class="form-error" role="alert"></div><div class="inline-actions"><button class="primary" type="button" data-action="continue-capabilities">Continue to capabilities</button><button type="button" class="quiet" data-action="stop-agent">Save draft & leave</button></div><p class="hint">Draft saved in this browser as you type. No agent is created until you continue from capabilities.</p></form>`;
}
function registryToolbar(activeId=''){
 return `<section class="panel registry-toolbar"><label>Your agents<select aria-label="Your agents" id="registry-agent"><option value="" ${!activeId?'selected':''}>New agent</option>${state.agents.map(a=>`<option value="${a.id}" ${a.id===activeId?'selected':''}>${escape(a.name)} · ${a.kind==='general'?'General-purpose':'Domain-specialist'}</option>`).join('')}</select></label><button data-action="add-agent">Add another agent</button><p>Each agent keeps its own connection, capabilities and assessments.</p></section>`;
}
function setupIntroduction(){return '<header class="supplier-intro"><span class="eyebrow">BRING YOUR AGENT TO RELAY</span><h1>Your agent. Ready for its next task.</h1><p>Introduce it, connect your runtime, and demonstrate what it can do.</p></header>';}
function readinessPanel(a) {
  const r=a.readiness||{},rows=[['Profile',r.profile?'Saved':'Needs details',1],['Connection',r.connection?'Connected':'Not connected',2],['Capability assessment',r.capability?'Assessed':'Not assessed',3],['Operator verification',state.payments?.operator?.status==='sandbox_ready'?'Sandbox ready':r.operator?'Verified':'Not started',3],['Payout setup',state.payments?.operator?.status==='sandbox_ready'?'Sandbox configured':r.payout?'Configured':'Not configured',3]];
  return `<aside class="panel readiness"><span class="eyebrow">YOUR NEXT STEP</span><h3>Ready for work?</h3><p class="hint">${escape(a.name)}</p><ul>${rows.map(([label,status,step])=>`<li><div><strong>${label}</strong><small>${status}</small></div><button class="quiet" data-action="${['Operator verification','Payout setup'].includes(label)?'readiness-account':'agent-step'}" data-id="${a.id}" data-step="${step}" aria-label="Review ${label}">Review</button></li>`).join('')}</ul><div class="readiness-state"><strong>${r.canReceivePaidWork?'Ready for paid work':'Not ready for paid work'}</strong><p>Commercial quotes and execution require the relevant checks. Manual local offers are for integration testing.</p></div></aside>`;
}
function agentQuotingRules(agent, step = 3) {
  const rules = agent.rules || {}, currency = rules.currency || 'USD', scoped = !!state.features?.unifiedBackend, limited = rules.automaticScope === 'limited';
  const status = rules.automaticEnabled ? 'On. Your agent is connected and offering within these rules.'
    : rules.automaticRequested ? 'Saved. Automatic offers start once your agent is connected.' : 'Off. You make every offer by hand.';
  return `<form id="agent-rules" class="panel market-form" data-id="${agent.id}" data-setup-stage="${step}">
    <h3>Automatic offers</h3>
    <p>Let your connected agent offer on matching requests by itself. It works out each price; Relay holds it to these limits. An offer never starts work: the buyer still chooses and starts it.</p>
    <label class="check-label"><input type="checkbox" name="automatic" ${rules.automaticRequested ? 'checked' : ''}> Offer automatically when connected</label>
    ${scoped ? `<fieldset class="mk-build-scope"><legend>Which requests</legend>
      <label class="check-label"><input type="radio" name="scope" value="all" ${limited ? '' : 'checked'}> Any matching request</label>
      <label class="check-label"><input type="radio" name="scope" value="limited" ${limited ? 'checked' : ''}> Small requests only. Bigger requests and ERP data requests wait for me to offer by hand.</label>
      <label>Largest automatic offer<input name="limit" type="number" min="0.01" max="100000" step="0.01" value="${limited ? rules.automaticLimitMinor / 100 : ''}" placeholder="e.g. 500"></label></fieldset>` : ''}
    <div class="quote-fields">
      <label>Currency<select name="currency">${['USD','EUR'].map(c=>`<option value="${c}" ${currency===c?'selected':''}>${c}</option>`).join('')}</select></label>
      <label>Lowest offer<input name="minimum" type="number" min="0.01" step="0.01" max="100000" required value="${(rules.minimumPayout || 100) / 100}"></label>
      <label>Jobs at the same time<input name="concurrency" type="number" min="1" max="100" step="1" required value="${rules.concurrency || 1}"></label>
    </div>
    <p class="mk-caption">${status} Hand-made offers aren’t limited by these settings.</p>
    <div class="form-error" role="alert"></div><button type="submit">Save automatic offers</button>
  </form>`;
}
function agentAcquisition(agent) {
  const report = state.acquisitionReport?.agentId === agent.id ? state.acquisitionReport : null;
  const labels = {market:'Agent Market',storefront:'Direct storefront', 'builder-link':'Builder-shared link',unspecified:'Source not supplied','repeat-hire':'Repeat hire'};
  return `<section class="panel"><h2>Acquisition</h2><p>See how this agent reaches buyers and turns offers into accepted work. The marketplace funnel includes all sources; the direct-request breakdown tracks requests from its listing.</p>
    <label>Builder-sharing link<input readonly aria-label="Builder-sharing link" value="${escape(location.origin + '/#storefront=' + agent.id + '?source=builder')}"></label>
    <p class="hint">Opens only for signed-in Relay members. Source labels are reported entry points, not verified referrals or evidence of revenue.</p>
    ${report?.funnel ? `<h3>Your marketplace funnel</h3><div class="dashboard-stats">${[['Tasks quoted','quoted'],['Shortlist shown','shortlisted'],['Offer reviewed','reviewed'],['Offer selected','selected'],['Delivery accepted','accepted']].map(([label,key])=>`<div class="panel"><span>${label}</span><strong>${report.funnel[key]}</strong></div>`).join('')}</div><p class="hint">Unique tasks across all sources, for this agent only. Shortlist shown means a first-four offer card entered a buyer’s viewport; reviewed means they opened its review. ${escape(report.funnel.exposureHistory)} ${escape(report.funnel.limitation)} Eligibility and invitation totals: not measured.</p><h3>Direct-request sources</h3><p class="hint">Listing-origin requests only, including requests for this builder. Drafts and unattributed open-market work are excluded from this breakdown.</p>` : ''}
    ${report ? `<div class="dashboard-stats">${[['Requests','requests'],['Quoted','quoted'],['Offer selected','selected'],['Delivery accepted','delivered']].map(([label,key])=>`<div class="panel"><span>${label}</span><strong>${report.totals[key]}</strong></div>`).join('')}</div>
    <div class="acquisition-table" role="region" aria-label="Acquisition totals by source" tabindex="0"><table><caption>All-time direct requests by reported source</caption><thead><tr><th>Source</th><th>Requests</th><th>Quoted</th><th>Selected</th><th>Accepted delivery</th></tr></thead><tbody>${report.rows.map(row=>`<tr><th scope="row">${labels[row.source]}</th><td>${row.requests}</td><td>${row.quoted}</td><td>${row.selected}</td><td>${row.delivered}</td></tr>`).join('')}</tbody></table></div>
    <p class="hint">Each task counts once per milestone. Quoted and selected count your own agents’ offers. Selected means there is evidence your offer was chosen, not that it was funded. Older selections without supplier evidence are excluded. Cancelled requests remain in history. Local unpaid and sandbox work are included; these are not paying-customer counts. Updated ${escape(date(report.asOf))}.</p>` : '<p>Open or refresh this agent to load acquisition totals.</p>'}
    <button data-action="refresh">Refresh totals</button></section>`;
}
function agentListing(a) {
  const status = a.listingStatus || 'published';
  return `<section class="panel"><h2>Listing</h2><p>Published agents appear on Agents for signed-in buyers. Publishing needs a passed Relay test.</p><form id="agent-listing" data-id="${escape(a.id)}" data-version="${a.version}"><label>Visibility<select name="status">${[['draft','Draft · only you'],['published','Published · buyer market'],['paused','Paused · hidden from new discovery']].map(([value,label])=>`<option value="${value}" ${status===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="mk-caption">Pausing hides it and stops new direct requests. Work already agreed carries on.</p><div class="form-error" role="alert"></div><button type="submit">Save listing</button></form></section>`;
}
// Where the agent processes buyers' data (processing-region.cjs). A declaration, not verified by Relay.
function regionField(value) { return `<label>Where does it process buyers’ data?<select name="processingRegion"><option value="" ${!value?'selected':''}>Not declared</option><option value="eu" ${value==='eu'?'selected':''}>In the EU</option><option value="us" ${value==='us'?'selected':''}>In the US</option></select></label><p class="hint">Count the agent and every model or service it sends data to. Buyers see this as your declaration. Companies that require a region only work with agents that declare it.</p>`; }
function agentProfileForm(a) { return `<form id="agent-profile" class="panel market-form" data-id="${a.id}"><h2>Profile</h2><p class="mk-caption">What buyers see on your agent’s card and page.</p><label>Agent name<input name="name" maxlength="80" required value="${escape(a.name)}"></label><label>Agent type<select name="kind" aria-label="Agent type"><option value="general" ${a.kind==='general'?'selected':''}>General-purpose</option><option value="specialist" ${a.kind==='specialist'?'selected':''}>Domain specialist</option></select></label><label>Focus or specialist domain<input name="domain" maxlength="150" value="${escape(a.domain)}"></label><label>What is your agent good at?<textarea name="purpose" maxlength="1000" required>${escape(a.purpose)}</textarea></label>${regionField(a.processingRegion)}<h3>Declared capabilities</h3><ul>${a.capabilities.map(c=>`<li>${escape(c.category)} · ${escape(c.task)} <small>${c.qualification==='qualified'?`${RelaySupplier.assessmentTitle(c.assessment)} passed`:'No Relay test passed yet'}</small></li>`).join('')}</ul><div class="form-error" role="alert"></div><button class="primary" type="submit">Save profile</button></form>`; }
function agentConnectionForm(a) { return `<form id="agent-connection" class="panel market-form" data-id="${a.id}"><h2>How it connects</h2><p>Your agent keeps running where it is. A small connector you run picks up Relay work, calls your agent and sends the results back.</p><fieldset class="supplier-methods"><legend>Connection method</legend>${[['api','HTTP API','Wrap your existing API in your preferred language.'],['sdk','JavaScript SDK','Use Node.js helpers to connect your existing service.'],...(a.integration==='mcp'?[['mcp','MCP · planned','Not available for connection yet.']]:[])].map(([id,label,desc])=>`<label class="supplier-method"><input type="radio" name="integration" value="${id}" ${a.integration===id?'checked':''} required><span class="eyebrow">${id.toUpperCase()}</span><h3>${label}</h3><p>${desc}</p><strong>Choose ${id.toUpperCase()}</strong></label>`).join('')}</fieldset><div class="connection-explainer" id="connection-explainer">${connectionExplanation(a.integration)}</div><details class="quiet-details"><summary>What counts as connected?</summary><p>Your agent is connected while it checks in with Relay. Passing a Relay test also proves it can take work, return files and handle a revision.</p></details><p class="mk-caption">Changing the method replaces your current key: create a new one and restart your connector.</p><div class="form-error" role="alert"></div><button class="primary" type="submit">Save method</button></form>`; }
function agentSetup(a) {
  if(typeof RelayBuild==='object')return RelayBuild.manage(a,{
    profile:()=>agentProfileForm(a),
    connection:()=>`${agentConnectionForm(a)}${typeof RelaySupplier==='object'?RelaySupplier.connection(a):''}${typeof RelayExecution==='object'?RelayExecution.connection(a):''}`,
    tests:()=>typeof RelaySupplier==='object'?RelaySupplier.qualification(a):'',
    offers:()=>`${agentQuotingRules(a,3)}${agentListing(a)}${typeof RelayPortfolio==='object'?RelayPortfolio.settings(a):''}`,
    results:()=>agentAcquisition(a),
  });
  const step=state.setupStage||a.setupStage||2;
  const nav=`<nav class="setup-steps" aria-label="Agent setup">${[['Introduce',1],['Connect',2],['Demonstrate',3]].map(([label,n])=>`<button class="${step===n?'active':''}" data-action="agent-step" data-id="${a.id}" data-step="${n}" ${step===n?'aria-current="step"':''}><small>0${n}</small> ${label}</button>`).join('')}</nav>`;
  let body;
  if(step===1)body=agentProfileForm(a);
  else if(step===2)body=agentConnectionForm(a);
  else body=`${RelaySupplier.qualification(a)}
    ${agentQuotingRules(a, 3)}`;
  return `<button class="quiet" data-action="close-agent">Back to agents</button>${registryToolbar(a.id)}${setupIntroduction()}${nav}<div class="setup-grid"><div>${body}${agentListing(a)}${agentAcquisition(a)}${typeof RelayPortfolio === 'object' ? RelayPortfolio.settings(a) : ''}${step===2?agentQuotingRules(a, 2):''}${step===2&&typeof RelaySupplier==='object'?RelaySupplier.connection(a):''}${step===2&&typeof RelayExecution==='object'?RelayExecution.connection(a):''}</div>${readinessPanel(a)}</div>`;
}
function connectionExplanation(method) {
  const copy={api:['HTTP API','Use your own HTTP client. Your runtime handles retries, durable context and event recovery.'],sdk:['SDK','Local JavaScript helpers wrap the same HTTP API with bounded retries. Your runtime still owns execution, durable command keys and recovery.'],mcp:['MCP','Connect from a compatible host through scoped Relay tools. The same permissions and workflow rules apply.']}[method]||['Connection','Choose a method.'];
  return `<h3>${copy[0]}</h3><p>${copy[1]}</p><p class="hint">${(state.features?.supplierConnections||state.features?.localExecution)&&['api','sdk'].includes(method)?'Create a supplier key below for your own runtime. Save its connection file privately.':'MCP is not implemented yet. Saving this preference does not establish a connection.'}</p>`;
}
function quoteForm(t) {
  const agents=availableAgents(t);
  if(!state.agents.length)return '<p>Add an agent before testing an offer.</p>';
  if(!agents.length)return '<p class="mk-empty-note">Each of your agents that can do this has made an offer. See Your offers below.</p>';
  return `<details class="manual-quote"><summary>Send a manual local test offer</summary><p class="hint">The normal flow will be runtime-driven. This manual path tests the real local offer records without claiming commercial eligibility.</p><form class="market-form" data-quote="${t.id}" data-version="${t.version}"><label>Agent and supporting capability<select name="capabilityId" aria-label="Agent and capability" required><option value="" selected disabled>Choose an agent and capability</option>${agents.flatMap(a=>a.capabilities.map(c=>`<option value="${c.id}">${escape(a.name)} · ${escape(c.task)}</option>`)).join('')}</select></label><div class="quote-fields"><label>Currency<select name="currency"><option value="USD">USD</option><option value="EUR">EUR · one-off personal task</option></select></label><label>Your price${state.features?.fees?.charging?`<small> · buyers see this plus Relay’s fee (${escape(state.features.fees.rule)}); you receive your price</small>`:''}<input type="number" name="price" min="0.01" max="100000" step="0.01"></label><label>First delivery (minutes after starting)<input type="number" name="minutes" min="1" max="525600" step="1"></label></div>${typeof RelayEngagements==='object'?RelayEngagements.formFields():''}<label>Deliverables, estimate basis and assumptions<textarea name="proposal" maxlength="3000" required></textarea></label><p class="hint">Valid for 24 hours. Any current assessment evidence is attached to the offer. No payment or dispatch is triggered.</p><div class="form-error" role="alert"></div><button type="submit">Send test offer</button></form></details>`;
}
function builderDashboard(){
 const pending=state.quotes.filter(q=>q.status==='pending'),waiting=state.work.filter(w=>['selected','queued','running','buyer_review'].includes(w.status));
 const payments=state.work.map(w=>w.payment).filter(Boolean);
 const grouped = predicate => ['USD', 'EUR'].map(currency => {
  const subset = payments.filter(payment => (payment.currency || 'USD') === currency && predicate(payment));
  if (!subset.length) return null;
  return money(subset.reduce((sum, payment) => sum + (payment.payoutMinor ?? payment.amountMinor), 0), currency);
 }).filter(Boolean).join(' · ') || money(0);
 const stats=[['Agents',state.agents.length,'agents'],['Offers waiting',pending.length,'quotes'],['Active projects',waiting.length,'work'],['Test payout pending',grouped(p=>['creating_transfer','transferred','creating_payout','payout_pending'].includes(p.status)),'earnings'],['Test paid',grouped(p=>p.status==='paid'&&p.reconciliation?.status!=='needs_review'),'earnings']];
 return `<div class="dashboard-stats">${stats.map(([label,value,tab])=>`<button class="panel" data-action="builder-tab" data-tab="${tab}"><span>${label}</span><strong>${value}</strong></button>`).join('')}</div><section class="panel dashboard-section"><h2>Needs attention</h2>${state.work.filter(w=>w.payment?.reconciliation?.status==='needs_review').map(w=>`<article class="supplier-row"><div><strong>${escape(w.title)}</strong><p>Payment paused for operations review. Task history is saved.</p></div><button data-action="builder-payment-review" data-id="${escape(w.id)}">Review payment</button></article>`).join('')}${typeof RelayBuild==='object'?(state.agents.filter(a=>RelayBuild.status(a).id!=='live').map(a=>{const st=RelayBuild.status(a);return `<article class="supplier-row"><div><strong>${escape(a.name)}</strong><p>${escape(st.label)} · ${escape(st.note)}</p></div><button data-action="open-agent" data-id="${a.id}">${['draft','testing'].includes(st.id)?'Continue setup':'Manage'}</button></article>`;}).join('')||(state.agents.length?'<p>Nothing needs you. Every agent is live.</p>':'<p>No agents yet. Add your first agent to get ready for work.</p>')):state.agents.map(a=>`<article class="supplier-row"><div><strong>${escape(a.name)}</strong><p>${a.capabilities.length} capabilities · ${a.runtime?.connected?(a.rules?.automaticEnabled?'Connected · local automatic bidding active':'Connected · configure bidding'):(a.readiness?.profile?'Connection required':'Complete profile details')}</p></div><button data-action="open-agent" data-id="${a.id}">Continue setup</button></article>`).join('')||'<p>No agents yet. Add your first agent to get ready for work.</p>'}</section><section class="panel dashboard-section"><div class="row-heading"><h2>Active work</h2><button class="quiet" data-action="builder-tab" data-tab="work">All projects</button></div>${waiting.map(w=>`<article class="supplier-row"><div><strong>${escape(w.title)}</strong><p>${escape(w.agentName)} · ${escape(typeof builderLabel==='function'?builderLabel(w):taskLabel(w))}</p></div><button data-action="builder-task" data-id="${escape(w.id)}">Open</button></article>`).join('')||'<p>No work is running. Chosen work and finished deliveries are under Projects.</p>'}</section><section class="panel dashboard-section"><div class="row-heading"><h2>Recent offers</h2><button class="quiet" data-action="builder-tab" data-tab="opportunities">All offers</button></div>${pending.slice(0,3).map(q=>`<article class="supplier-row"><div><strong>${escape(q.title)}</strong><p>${escape(q.agentName)} · waiting for the buyer</p></div><strong>${money(q.amountMinor, q.currency)}</strong><button data-action="builder-tab" data-tab="quotes">View offer</button></article>`).join('')||'<p>No pending offers.</p>'}</section>`;
}
function builder() {
  if(typeof RelayAgentMarket === 'object' && RelayAgentMarket.storefrontId())return RelayAgentMarket.storefront(RelayAgentMarket.storefrontId());
  if(state.authMode==='managed'&&!state.features?.unifiedBackend)return '<div class="panel"><h1>Builder workspace</h1><p>The connected marketplace is being developed locally.</p></div>';
  const active=state.agents.find(a=>a.id===state.setupAgentId);
  if(active)return typeof RelayBuild==='object'?RelayBuild.shell('agents',RelayBuild.agentTitle(active),escape(RelayBuild.status(active).label+' · '+RelayBuild.status(active).note),'',`<section class="market-workspace">${agentSetup(active)}</section>`):`<section class="market-workspace">${agentSetup(active)}</section>`;
  if(state.addingAgent&&state.publishing?.allowed===false&&typeof RelayBuild==='object'){const names=state.publishing.blockedBy.map(b=>escape(b.name)).join(', ');return RelayBuild.shell('agents','New agent','','',`<div class="mk-empty"><h2>Publishing is turned off for you</h2><p>${names} doesn’t allow its members to publish agents or send offers. Ask an owner of ${names} if you need this.</p><a class="mk-next" href="/" data-route>Back to Agents →</a></div>`);}
  if(state.addingAgent){const page=`<section class="market-workspace"><button class="quiet" data-action="stop-agent">Back to agents</button>${registryToolbar()}${setupIntroduction()}<div class="setup-steps"><span class="active"><small>01</small> Introduce</span><span><small>02</small> Connect</span><span><small>03</small> Demonstrate</span></div>${`<div class="setup-grid"><div>${agentForm()}</div><aside class="panel readiness" id="agent-preview">${agentPreview(state.agentDraft||{})}</aside></div>`}</section>`;return typeof RelayBuild==='object'?RelayBuild.shell('agents','New agent','Introduce it, connect your runtime, then pass a Relay test to publish it.','',page):page;}
  const tab=state.builderTab||'dashboard';
  let content='';
  if(tab==='dashboard')content=typeof RelayBuild==='object'?RelayBuild.dashboard():builderDashboard();
  if(tab==='agents'&&typeof RelayBuild==='object')content=RelayBuild.agentsPage();
  else if(tab==='agents')content=`<div class="market-list agent-grid">${state.agents.map(a=>`<article class="panel next-action"><div><h2>${escape(a.name)}</h2><p>${a.kind==='general'?'General-purpose':'Domain specialist'}${a.domain?` · ${escape(a.domain)}`:''}</p><p>${a.capabilities.length} capabilities · ${a.integration.toUpperCase()} preference</p><span class="tag">Setup incomplete</span></div><button data-action="open-agent" data-id="${a.id}">Continue setup</button></article>`).join('')||'<div class="empty-box">Add your first agent. Its capabilities can span any category.</div>'}</div>`;
  if(tab==='opportunities'&&typeof RelayBuild==='object')content=RelayBuild.opportunities(quoteForm);
  else if(tab==='opportunities')content=`<div class="blocked-note"><strong>Automatic bidding follows your agent’s rules.</strong><p>Connected runtimes receive eligible briefs and decide whether to quote. Configure each agent’s operating rules in setup.</p></div><div class="market-list">${state.opportunities.map(t=>`<article class="panel"><span class="eyebrow">Open request · scope ${t.scopeVersion??t.version}</span><h2>${escape(t.title)}</h2><p class="offer-details">${escape(t.brief)}</p>${typeof RelayAcceptance==='object'?RelayAcceptance.summary(t.acceptanceCriteria,[],'Buyer’s checklist'):''}${t.context.length?`<details><summary>Buyer conversation</summary>${t.context.map(c=>`<p class="context-note">${escape(c.body)}</p>`).join('')}</details>`:''}${quoteForm(t)}</article>`).join('')||'<div class="empty-box">No open requests from other buyers. Your own buyer workspace is excluded from self-bidding.</div>'}</div>`;
  if(tab==='quotes'&&typeof RelayBuild==='object')content=RelayBuild.offers()||'<div class="empty-box">Your agents’ offers will appear here.</div>';
  else if(tab==='quotes')content=`<div class="market-list">${state.quotes.map(q=>`<article class="panel"><span class="tag">${escape(q.status.replaceAll('_',' '))}</span><h2>${escape(q.title)}</h2><p>${escape(q.agentName)} · ${money(q.amountMinor, q.currency)} · ${deliveryDuration(q.deliveryMinutes)} after starting</p><small>Task ${q.taskId}</small>${['selected','accepted'].includes(q.status)?'<p>Waiting for the remaining start requirements. Selection alone does not authorize work.</p><button data-action="builder-tab" data-tab="work">Open</button>':''}</article>`).join('')||'<div class="empty-box">Your agent’s submitted offers will appear here.</div>'}</div>`;
  if(tab==='work'&&typeof RelayBuild==='object')content=RelayBuild.projects();
  else if(tab==='work')content=`${typeof RelayRecurring==='object'?RelayRecurring.queue():''}<div class="market-list">${state.work.map(w=>typeof RelayExecution==='object'&&w.execution?RelayExecution.builderTask(w):`<article class="panel" data-notification-task="${escape(w.id)}"><span class="tag posted">${typeof RelayWorkState==='object'&&RelayWorkState.known(w)?escape(RelayWorkState.label(w,'builder')):w.status==='selected'?'Selected · awaiting start requirements':'Assigned · not started'}</span><h2>${escape(w.title)}</h2><small>Task ${w.id} · selected ${date(w.acceptedAt)}</small><p>${escape(w.agentName)} · ${money(w.amountMinor, w.currency)} · ${deliveryDuration(w.deliveryMinutes)} after starting</p><p class="offer-details">${escape(w.proposal)}</p><div class="blocked-note"><strong>Do not start yet.</strong><p>Funding, runtime authorization and readiness are not complete. No work has started automatically.</p></div><details><summary>Agreed brief</summary><p>${escape(w.brief)}</p></details>${builderConversation(w)}<div class="delivery-placeholder"><h3>Delivery will stay with this task.</h3><p>Files, criterion-specific evidence and revision history will appear here after authorized execution. No submission has been received.</p></div></article>`).join('')||'<div class="empty-box">Selected tasks and awarded work will appear here. Waiting states never require starting unauthorized work.</div>'}</div>`;
  if(tab==='earnings'&&typeof RelayBuild==='object')content=RelayBuild.earnings();
  else if(tab==='earnings')content='<div class="panel"><h2>No payable earnings yet.</h2><p>A selected offer is not revenue. Accepted delivery, confirmed funding and reconciled settlement must precede a payout.</p><p class="muted">Payment and payout services are not connected locally.</p><button data-action="builder-tab" data-tab="settings">Review payout readiness</button></div>';
  if(tab==='settings'&&typeof RelayBuild==='object')content=RelayBuild.settings();
  if(tab==='tests'&&typeof RelayTests==='object')content=RelayTests.page();
  else if(tab==='settings')content=(state.returnAgentId?`<button class="quiet" data-action="open-agent" data-id="${state.returnAgentId}">Back to agent setup</button>`:'')+'<div class="panel"><h2>Operator account</h2><div class="readiness-row"><strong>Operator verification</strong><span class="tag">Not started</span></div><p>Identity verification service is not connected. Account registration does not verify an operator.</p><div class="readiness-row"><strong>Payout setup</strong><span class="tag">Not configured</span></div><p>Payout onboarding is not available yet. No bank details or wallet keys are collected here.</p></div>';
  // Sandbox payments: the operator form sits in Build → Settings → Payouts; payment records follow Earnings.
  if(typeof RelayPayments==='object'&&typeof RelayBuild!=='object'&&tab==='settings')content=RelayPayments.settings();
  if(typeof RelayPayments==='object'&&tab==='earnings'&&(typeof RelayBuild!=='object'||(state.work||[]).some(task=>task.payment)))content=(typeof RelayBuild==='object'?content:'')+RelayPayments.earnings();
  if(typeof RelayBuild==='object'){const titles={dashboard:['Dashboard','Your agents’ work, offers and earnings at a glance.'],agents:['Agents','Connect, test, publish and manage each agent.'],opportunities:['Opportunities','Open requests your agents can make an offer on.'],quotes:['Opportunities','Open requests your agents can make an offer on.'],work:['Projects','Work your agents were chosen for, from waiting to start through to payment.'],tests:['Relay tests','Propose a test for work Relay doesn’t test yet. Relay staff review every one.'],earnings:['Earnings','What you’ve been paid and what’s on its way.'],settings:['Settings','Your builder account, verification and payouts.']}[tab]||['Build',''];
    return RelayBuild.shell(tab,titles[0],titles[1],tab==='agents'?'<a class="mk-publish" href="/build/new" data-route>New agent</a>':tab==='dashboard'?'':'<button type="button" class="mk-chip" data-action="refresh">Refresh</button>',content);}
  return `<section class="market-workspace"><div class="section-heading"><div><span class="eyebrow">Builder workspace</span><h1>${tab==='dashboard'?'Dashboard':builderLabels[tab]}</h1><p class="muted">${tab==='dashboard'?'Your agents’ work, exceptions and earnings at a glance.':tab==='agents'?'Connect, qualify and configure how each agent works.':'Keep your runtime. Let Relay bring the right work.'}</p></div>${['dashboard','agents'].includes(tab)?'<button class="primary" data-action="add-agent">Add an agent</button>':'<button class="quiet" data-action="refresh">Refresh</button>'}</div>${content}</section>`;
}

// Non-consequential analytics are separate from task commands and never block hiring.
let offerExposureObserver;
const recordedOfferExposure = new Set();
function recordOfferExposure(offerId, stage) {
  const task = state.detail?.task;
  if (!task || !state.account?.user?.id) return;
  const identity = `${state.account.user.id}:${task.id}:${task.scopeVersion}:${offerId}:${stage}`;
  if (recordedOfferExposure.has(identity)) return;
  recordedOfferExposure.add(identity);
  if (recordedOfferExposure.size > 2000) recordedOfferExposure.delete(recordedOfferExposure.values().next().value);
  api(`/api/tasks/${task.id}/offer-exposure`, {method:'POST',body:{offerIds:[offerId],stage},key:crypto.randomUUID()})
    .catch(() => recordedOfferExposure.delete(identity));
}
function observeOfferExposure() {
  offerExposureObserver?.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  offerExposureObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting && entry.intersectionRatio >= .25 && !document.hidden) {
      recordOfferExposure(entry.target.dataset.offerExposure,'shortlisted');
      offerExposureObserver.unobserve(entry.target);
    }
  }, {threshold:.25});
  document.querySelectorAll('[data-offer-exposure][data-shortlisted="true"]').forEach(card => offerExposureObserver.observe(card));
}
