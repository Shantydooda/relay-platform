'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { assertUnfunded, paymentView } = require('./payments.cjs');
const { capabilityView } = require('./qualification.cjs');
const { saveTask } = require('./supplier-feed.cjs');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);
const notFound = () => fail(404, 'NOT_FOUND', 'Task or agent not found.');

function positive(value, label, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) fail(400, 'INVALID_INPUT', `${label} is outside the supported range.`);
  return value;
}
function expected(record, version) {
  positive(version, 'Version');
  if (record.version !== version) fail(409, 'VERSION_CONFLICT', 'This record changed. Refresh before trying again.');
}
function membership(actor, tenantId, write = false) {
  if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'An active account is required.');
  const member = actor.memberships.find(item => item.id === tenantId);
  if (!member) notFound();
  if (write && !['owner', 'employee'].includes(member.role)) fail(403, 'FORBIDDEN', 'Your role cannot change this task.');
  return member;
}
function buyer(actor, task, write = false) {
  if (!task) notFound();
  const member = membership(actor, task.tenantId, write);
  if (task.ownerId !== actor.user.id && member.role !== 'owner') notFound();
  return task;
}
function owner(actor, agent) {
  if (!agent || agent.ownerId !== actor?.user?.id || actor.recoveryRequired) notFound();
  return agent;
}
function event(task, actorId, type, now) {
  task.events.push({ sequence: task.events.length + 1, type, version: task.version, createdAt: now, actorId });
}
function touch(task, now) { task.version++; task.updatedAt = now; }
function taskView(task, now) {
  const offer = task.offers.find(item => item.id === task.selectedOfferId);
  const status = task.recurringScheduleId ? 'scheduled' : task.assignment?.status || (offer && offer.expiresAt > now ? 'selected' : task.status);
  const { id, tenantId, title, brief, version, scopeVersion, createdAt, updatedAt, input } = task;
  return { id, tenantId, title, brief, version, scopeVersion, createdAt, updatedAt, status,
    companyApprovalRequired: !!task.companyApprovalRequired,
    approvalStatus: require('./approvals.cjs').approvalView(task, now)?.status || null,
    recurringScheduleId: task.recurringScheduleId || null, scheduleId: task.scheduleId || null, scheduledFor: task.scheduledFor || null,
    workPlan: task.workPlan || null,
    contextReferences: (task.contextReferences || []).map(({content,...ref}) => ref), permissionRequests: task.permissionRequests || [], contextReads: task.contextReads || [],
    scoping: task.scoping?.version === task.version ? (task.scoping.status === 'pending' && task.scoping.expiresAt <= now ? { status: 'failed', error: 'The local reply was interrupted. Try again; your message is saved.' } : task.scoping) : null,
    selectedOfferId: offer && offer.expiresAt > now ? offer.id : null,
    input: input ? { filename: input.filename, size: input.size, sha256: input.sha256, notes: input.notes } : null };
}
function agentView(agent, now) {
  const connected = !!agent.credentialHash && (!agent.credentialExpiresAt || agent.credentialExpiresAt > now) && agent.connectedAt > now - 120000;
  const { id, name, kind, purpose, domain, integration, capabilities, setupStage, createdAt, version } = agent;
  return { id, name, kind, purpose, domain, integration, capabilities: capabilities.map(item => capabilityView(agent, item, now)), setupStage, createdAt, version,
    connection: connected ? 'connected' : 'not_connected',
    rules: { ...agent.rules, version, automaticEnabled: connected && agent.rules.automaticRequested },
    readiness: { profile: !!purpose, connection: connected, capability: capabilities.some(item => capabilityView(agent, item, now).qualification === 'qualified'), operator: false, payout: false,
      canQuoteCommercially: false, canReceivePaidWork: false },
    runtime: { connected, connectedAt: agent.connectedAt || null, kind: agent.runtimeKind || null, transport: agent.runtimeTransport || 'local-csv', expiresAt: agent.credentialExpiresAt || null, name: agent.runtimeName || null, version: agent.runtimeVersion || null } };
}

function createApplication({ repository, now = Date.now, localExecution = false, resolveOperator, resolveActor, objectStore, fileScanner, scopingProvider, paymentProvider, driveProvider, paymentRecoveryUserIds = [], conversationsPerHour, storageLimitBytes, modelAttemptsPerHour, driveOperationsPerHour }) {
  const limits = require('./workspace-limits.cjs').workspaceLimits(conversationsPerHour);
  async function command(actorId, key, input, authorize, execute, lockKey, prepare) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key)) fail(400, 'IDEMPOTENCY_REQUIRED', 'A valid request key is required.');
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const fingerprint = hash(JSON.stringify(canonical(input)));
    // Optional external-I/O admission commits before the business transaction.
    // Successful receipt replay bypasses admission; failed attempts retain usage.
    const admission = prepare ? await repository.transaction(lockKey || `${actorId}:${key}`, async repo => {
      await authorize(repo);
      const previous = await repo.receipt(actorId, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for different content.');
        return null;
      }
      return prepare(repo);
    }) : null;
    return repository.transaction(lockKey || `${actorId}:${key}`, async repo => {
      // Revalidate current access before returning a previous response.
      await authorize(repo);
      const previous = await repo.receipt(actorId, key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', 'This key was used for different content.');
        return previous.result;
      }
      const result = await execute(repo, admission);
      await repo.saveReceipt(actorId, key, fingerprint, result);
      return result;
    });
  }
  const taskFor = async (repo, actor, id, write = false) => {
    const current = resolveActor ? await resolveActor(actor.user.id) : actor;
    return buyer({ ...actor, memberships: current.memberships }, await repo.get('task', id, true), write);
  };
  const agentFor = async (repo, actor, id) => owner(actor, await repo.get('agent', id, true));

  async function createTask(actor, body, key) {
    exactKeys(body, ['tenantId', 'title', 'brief', 'preferredAgentId', 'preferenceMode']);
    membership(actor, body.tenantId, true);
    const title = text(body.title, 'Title', 1, 120), brief = text(body.brief, 'Brief', 1, 10000);
    return command(actor.user.id, key, ['create', body], async () => membership(actor, body.tenantId, true), async repo => {
      const time = now(), id = randomUUID();
      await limits.consumeConversation(repo, body.tenantId, time);
      let preferredAgentId = null, preferredOperatorId = null;
      if (body.preferredAgentId) {
        if (!['agent', 'builder'].includes(body.preferenceMode)) fail(400, 'INVALID_INPUT', 'Choose an agent or builder preference.');
        const preferred = await repo.get('agent', text(body.preferredAgentId, 'Preferred agent', 36, 36));
        const available = preferred && preferred.ownerId !== actor.user.id && preferred.capabilities.some(item => capabilityView(preferred, item, time).qualification === 'qualified');
        if (!available) fail(404, 'NOT_FOUND', 'That agent is not available for direct requests.');
        if (body.preferenceMode === 'agent') preferredAgentId = preferred.id;
        else preferredOperatorId = preferred.ownerId;
      } else if (body.preferenceMode !== undefined) {
        fail(400, 'INVALID_INPUT', 'A routing preference requires an available agent.');
      }
      const task = { id, tenantId: body.tenantId, ownerId: actor.user.id, title, brief, preferredAgentId, preferredOperatorId,
        companyApprovalRequired: !!membership(actor, body.tenantId).company, status: 'draft', version: 1, scopeVersion: 1, createdAt: time, updatedAt: time,
        messages: [{ id: randomUUID(), body: brief, authorId: actor.user.id, authorName: actor.user.name, createdAt: time }],
        scopes: [{ version: 1, title, brief, createdAt: time }], events: [], offers: [], selectedOfferId: null, assignment: null, submissions: [] };
      event(task, actor.user.id, 'task.created', time);
      await saveTask(repo, task);
      return { taskId: id, version: 1 };
    }, `workspace-create:${body.tenantId}`);
  }
  async function mutateTask(actor, id, action, body, key) {
    exactKeys(body, ['scope', 'edit'].includes(action) ? ['expectedVersion', 'title', 'brief'] : action === 'messages' ? ['expectedVersion', 'body'] : ['expectedVersion']);
    return command(actor.user.id, key, [action, id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true);
      expected(task, body.expectedVersion);
      if (task.recurringScheduleId && action !== 'messages') fail(409, 'SCHEDULE_MANAGED', 'Manage this request in Scheduled work.');
      if (task.status === 'cancelled') fail(409, 'TASK_CLOSED', 'This request is closed.');
      if (action !== 'messages') assertUnfunded(task);
      const time = now();
      let type;
      if (['scope', 'edit'].includes(action)) {
        if (task.scheduleId) fail(409, 'SCHEDULE_MANAGED', 'Recurring runs use an immutable brief. Create and test a new task to change it.');
        if (task.assignment) fail(409, 'TASK_ASSIGNED', 'Authorized work requires an agreed change request.');
        if (action === 'edit' && task.status !== 'draft') fail(409, 'INVALID_TRANSITION', 'Only a draft can be edited.');
        task.title = text(body.title, 'Title', 1, 120); task.brief = text(body.brief, 'Brief', 1, 10000);
        task.scopeVersion++;
        task.workPlan = null;
        task.scoping = null;
        task.scopes.push({ version: task.scopeVersion, title: task.title, brief: task.brief, createdAt: time, inputHash: task.input?.sha256 || null });
        task.selectedOfferId = null;
        type = 'scope.updated';
      } else if (action === 'messages') {
        if (task.messages.length >= 500) fail(409, 'CONVERSATION_LIMIT', 'This conversation has reached its message limit.');
        task.messages.push({ id: randomUUID(), body: text(body.body, 'Message', 1, 10000), authorId: actor.user.id, authorName: actor.user.name, createdAt: time });
        type = 'message.added';
      } else if (['post', 'cancel'].includes(action)) {
        if (task.assignment) fail(409, 'TASK_ASSIGNED', 'Authorized work cannot use a pre-award command.');
        if (action === 'post' && task.status !== 'draft') fail(409, 'INVALID_TRANSITION', 'Only a draft can be posted.');
        if (action === 'post' && task.scoping?.status === 'pending' && task.scoping.expiresAt > now()) fail(409, 'SCOPING_BUSY', 'Wait for the local reply or edit the brief manually before posting.');
        if (action === 'post' && task.scoping?.status === 'completed' && ['request', 'change'].includes(task.scoping.proposal.intent) && task.scoping.proposal.cadence !== 'once') fail(409, 'RECURRING_NOT_ENABLED', 'Confirm the recurring scope before requesting offers.');
        if (action === 'post' && task.scoping?.status === 'completed' && ['request', 'change'].includes(task.scoping.proposal.intent) && task.scoping.proposal.questions.length) fail(409, 'SCOPING_INCOMPLETE', 'Answer the missing questions or review the brief manually before posting it.');
        if (action === 'post' && task.workPlan && task.workPlan.cadence !== 'once' && (task.workPlan.openQuestions?.length || !['daily', 'weekly', 'monthly'].includes(task.workPlan.cadence))) fail(409, 'RECURRING_NOT_ENABLED', 'Resolve the missing details and choose a supported calendar before requesting offers.');
        task.status = action === 'post' ? 'posted' : 'cancelled';
        if (action === 'cancel') task.selectedOfferId = null;
        type = action === 'post' ? 'task.posted' : 'task.cancelled';
      } else fail(404, 'NOT_FOUND', 'Action not found.');
      touch(task, time); event(task, actor.user.id, type, time); await saveTask(repo, task);
      return { taskId: id, version: task.version };
    });
  }
  async function addAgent(actor, body, key) {
    exactKeys(body, ['name', 'kind', 'integration', 'capabilities', 'purpose', 'domain']);
    if (!['general', 'specialist'].includes(body.kind) || !['api', 'sdk', 'mcp'].includes(body.integration)) fail(400, 'INVALID_INPUT', 'Choose an agent type and connection method.');
    const name = text(body.name, 'Name', 1, 80), purpose = text(body.purpose, 'Purpose', 1, 1000);
    const domain = body.domain ? text(body.domain, 'Domain', 1, 150) : '';
    if (body.kind === 'specialist' && !domain) fail(400, 'INVALID_INPUT', 'Describe the specialist domain.');
    if (!Array.isArray(body.capabilities) || body.capabilities.length < 1 || body.capabilities.length > 50) fail(400, 'INVALID_INPUT', 'Add 1–50 capabilities.');
    const capabilities = body.capabilities.map(item => {
      exactKeys(item, ['category', 'task']);
      return { id: randomUUID(), category: text(item.category, 'Category', 1, 100), task: text(item.task, 'Capability', 1, 1000), qualification: 'unverified' };
    });
    return command(actor.user.id, key, ['agent', body], async () => {
      if (!actor.memberships.length || actor.recoveryRequired) notFound();
    }, async repo => {
      const agent = { id: randomUUID(), ownerId: actor.user.id, operatorName: actor.user.name, name, purpose, domain, kind: body.kind,
        integration: body.integration, capabilities, status: 'listed', version: 1, setupStage: 2, createdAt: now(),
        rules: { automaticRequested: false, minimumPayout: 100, concurrency: 1 } };
      await repo.save('agent', agent);
      return { agentId: agent.id };
    });
  }
  async function configure(actor, id, body, key) {
    exactKeys(body, ['integration', 'automaticRequested', 'minimumPayout', 'concurrency', 'expectedVersion', 'setupStage', 'name', 'purpose', 'domain', 'kind']);
    if (!['api', 'sdk', 'mcp'].includes(body.integration) || typeof body.automaticRequested !== 'boolean') fail(400, 'INVALID_INPUT', 'Choose method and bidding preference.');
    positive(body.minimumPayout, 'Minimum payout', 10000000); positive(body.concurrency, 'Concurrency', 100); positive(body.setupStage, 'Stage', 3);
    return command(actor.user.id, key, ['configure', id, body], repo => agentFor(repo, actor, id), async repo => {
      const agent = await agentFor(repo, actor, id); expected(agent, body.expectedVersion);
      if (body.name !== undefined) {
        agent.name = text(body.name, 'Name', 1, 80); agent.purpose = text(body.purpose, 'Purpose', 1, 1000);
        if (!['general', 'specialist'].includes(body.kind)) fail(400, 'INVALID_INPUT', 'Choose an agent type.');
        agent.kind = body.kind; agent.domain = body.domain ? text(body.domain, 'Domain', 1, 150) : '';
        if (agent.kind === 'specialist' && !agent.domain) fail(400, 'INVALID_INPUT', 'Describe the specialist domain.');
      }
      if (agent.integration !== body.integration) {
        agent.credentialHash = null;
        agent.connectedAt = 0;
        agent.credentialExpiresAt = null;
      }
      agent.integration = body.integration; agent.setupStage = body.setupStage;
      agent.rules = { automaticRequested: body.automaticRequested, minimumPayout: body.minimumPayout, concurrency: body.concurrency };
      agent.version++; await repo.save('agent', agent);
      return { agentId: id, version: agent.version, automaticEnabled: agentView(agent, now()).rules.automaticEnabled };
    });
  }
  async function quote(actor, id, body, key, runtime = null) {
    exactKeys(body, ['agentId', 'capabilityId', 'expectedVersion', 'amountMinor', 'deliveryMinutes', 'proposal']);
    positive(body.amountMinor, 'Amount', 10000000); positive(body.deliveryMinutes, 'Estimate', 525600);
    if (!localExecution) fail(403, 'COMMERCIAL_NOT_READY', 'Commercial bidding requires connected eligibility and funding services.');
    const proposal = text(body.proposal, 'Proposal', 1, 3000);
    return command(actor.user.id, key, ['quote', id, body], async repo => { owner(actor, await repo.get('agent', body.agentId)); }, async repo => {
      const task = await repo.get('task', id, true), agent = await agentFor(repo, actor, body.agentId);
      if (runtime) {
        await context.credentials.runtimeAgent(repo, runtime, 'offers:write');
        if (agent.connectedAt <= now() - 120000) fail(409, 'RUNTIME_REQUIRED', 'Send a fresh heartbeat before bidding.');
      }
      if (!task || task.status !== 'posted' || actor.memberships.some(member => member.id === task.tenantId) || task.ownerId === actor.user.id) notFound();
      assertUnfunded(task);
      if (task.preferredAgentId && task.preferredAgentId !== body.agentId) fail(409, 'SCHEDULE_AGENT', 'This recurring run is reserved for its chosen agent.');
      if (task.preferredOperatorId && task.preferredOperatorId !== actor.user.id) fail(404, 'NOT_FOUND', 'This direct request is reserved for another builder.');
      if (task.assignment) fail(409, 'TASK_ASSIGNED', 'This task is already assigned.');
      if (task.offers.some(offer => offer.id === task.selectedOfferId && offer.expiresAt > now())) fail(409, 'TASK_SELECTED', 'The buyer has selected an offer.');
      expected(task, body.expectedVersion);
      const capability = agent.capabilities.find(item => item.id === body.capabilityId);
      if (!capability) notFound();
      if (runtime && (runtime.agentId !== agent.id || runtime.credentialHash !== agent.credentialHash || !agent.rules.automaticRequested)) fail(403, 'BIDDING_DISABLED', 'Automatic bidding is disabled.');
      if (runtime && body.amountMinor < agent.rules.minimumPayout) fail(409, 'PRICE_LIMIT', 'Offer is below the configured minimum.');
      if (task.offers.some(offer => offer.agentId === agent.id && offer.scopeVersion === task.scopeVersion && offer.expiresAt > now())) fail(409, 'OFFER_EXISTS', 'This agent already quoted on this scope.');
      const offer = { id: randomUUID(), agentId: agent.id, operatorId: actor.user.id, agentName: agent.name, agentType: agent.kind,
        operatorName: actor.user.name, category: capability.category, capability: capability.task, capabilityId: capability.id,
        qualification: capabilityView(agent, capability, now()).qualification, qualificationEvidence: capabilityView(agent, capability, now()).assessment, taskVersion: task.version, scopeVersion: task.scopeVersion,
        amountMinor: body.amountMinor, deliveryMinutes: body.deliveryMinutes, proposal, currency: 'USD',
        createdAt: now(), expiresAt: now() + 86400000, runtimeBid: !!runtime, runtimeKind: runtime ? agent.runtimeKind : null };
      task.offers.push(offer); event(task, actor.user.id, 'offer.received', now()); await saveTask(repo, task);
      await repo.save('offer-index', { id: offer.id, ownerId: actor.user.id, taskId: id, offerId: offer.id });
      return { taskId: id, offerId: offer.id };
    });
  }
  async function select(actor, id, body, key) {
    exactKeys(body, ['offerId', 'expectedVersion']);
    return command(actor.user.id, key, ['select', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      if (task.scheduleId || task.recurringScheduleId) fail(409, 'SCHEDULE_MANAGED', 'This recurring run selects its chosen agent within the saved limits. Start a new recurring request to change the arrangement.');
      assertUnfunded(task);
      if (task.assignment) fail(409, 'TASK_ASSIGNED', 'This task is already assigned.');
      if (task.status !== 'posted') fail(409, 'INVALID_TRANSITION', 'Post this task before selecting an offer.');
      const offer = task.offers.find(item => item.id === body.offerId);
      if (!offer) notFound();
      if (offer.scopeVersion !== task.scopeVersion) fail(409, 'VERSION_CONFLICT', 'Request a quote for the current scope.');
      if (offer.expiresAt <= now()) fail(409, 'OFFER_EXPIRED', 'This offer expired.');
      task.selectedOfferId = offer.id; touch(task, now()); event(task, actor.user.id, 'offer.selected', now()); await saveTask(repo, task);
      return { taskId: id, offerId: offer.id, version: task.version, status: 'selected', executionAuthorized: false };
    });
  }

  async function detail(actor, id) {
    return repository.read(async repo => {
      const task = await taskFor(repo, actor, id);
      const schedule = task.scheduleId ? await repo.get('schedule', task.scheduleId) : null;
      if (task.scoping?.status === 'pending') {
        const job = await repo.get('scoping-job', task.scoping.id);
        task.scoping = { ...task.scoping, phase: job?.status === 'running' ? 'working' : 'waiting',
          requestedAt: job?.createdAt || task.scoping.expiresAt - 180000 };
      }
      return { schedule: schedule ? { status: schedule.status, reason: schedule.reason || null } : null, task: taskView(task, now()), changeProposals: task.changeProposals || [], agreementHistory: task.agreementHistory || [], messages: task.messages.map(({authorId,...message})=>message), scopes: task.scopes, events: task.events.map(({actorId,...item})=>item),
        approval: require('./approvals.cjs').approvalView(task, now()), execution: publicExecution(task), payment: paymentView(task.settlement, await repo.get('payment-job', `task:${task.id}`)), submissions: task.submissions.map(publicSubmission) };
    });
  }
  async function list(actor, tenantId) {
    membership(actor, tenantId);
    return repository.read(async repo => (await repo.list('task', 'tenant_id', tenantId)).filter(task => task.ownerId === actor.user.id || actor.memberships.some(member => member.id === tenantId && member.role === 'owner')).map(task => taskView(task, now())));
  }
  function opportunityView(task, actor) {
    if (task.assignment ||
      (task.preferredOperatorId && task.preferredOperatorId !== actor.user.id) ||
      actor.memberships.some(member => member.id === task.tenantId) ||
      task.offers.some(offer => offer.id === task.selectedOfferId && offer.expiresAt > now())) return null;
    return { id: task.id, title: task.title, brief: task.brief, version: task.version, scopeVersion: task.scopeVersion,
      input: task.input ? { filename: task.input.filename, size: task.input.size, sha256: task.input.sha256, notes: task.input.notes, operation: task.input.operation } : null,
      context: [], myOffers: task.offers.filter(offer => offer.operatorId === actor.user.id).map(offer => ({ id: offer.id, agentId: offer.agentId, taskVersion: offer.taskVersion, scopeVersion: offer.scopeVersion, expiresAt: offer.expiresAt })) };
  }
  async function opportunities(actor) {
    return repository.read(async repo => {
      const tasks = await repo.list('task', 'status', 'posted');
      const visible = [];
      for (const task of tasks) {
        if (task.preferredAgentId) {
          const agent = await repo.get('agent', task.preferredAgentId);
          if (!agent || agent.ownerId !== actor.user.id) continue;
        }
        const item = opportunityView(task, actor);
        if (item) visible.push(item);
      }
      return visible;
    });
  }
  async function offers(actor, id) {
    return repository.read(async repo => {
      const task = await taskFor(repo, actor, id);
      return Promise.all(task.offers.map(async offer => {
        const agent = await repo.get('agent', offer.agentId);
        const capability = agent?.capabilities.find(item => item.id === offer.capabilityId);
        const current = capability ? capabilityView(agent, capability, now()) : null;
        return { ...offer, qualificationCurrent: current?.qualification === 'qualified' && current.assessment?.id === offer.qualificationEvidence?.id,
          selected: task.assignment?.offerId === offer.id || (task.selectedOfferId === offer.id && offer.expiresAt > now()) };
      }));
    });
  }
  async function supplierTasks(actor) {
    // Supplier grants are explicit index records, not a scan of private task data.
    return repository.read(async repo => {
      const grants = await repo.list('grant', 'owner_id', actor.user.id);
      const tasks = [];
      for (const grant of grants) {
        const task = await repo.get('task', grant.taskId);
        if (task?.assignment?.operatorId === actor.user.id) tasks.push(task);
      }
      // Pre-award selections use separate non-sensitive offer index records.
      const indices = await repo.list('offer-index', 'owner_id', actor.user.id);
      for (const index of indices) {
        const task = await repo.get('task', index.taskId);
        if (task && !task.assignment && task.selectedOfferId === index.offerId && task.offers.find(offer => offer.id === index.offerId)?.expiresAt > now() && !tasks.some(item => item.id === task.id)) tasks.push(task);
      }
      return Promise.all(tasks.map(async task => {
        const offer = task.offers.find(item => item.id === (task.assignment?.offerId || task.selectedOfferId));
        return { ...taskView(task, now()), agentName: offer.agentName, offerId: offer.id, amountMinor: offer.amountMinor, deliveryMinutes: offer.deliveryMinutes, proposal: offer.proposal,
          acceptedAt: task.assignment?.authorizedAt || task.updatedAt, messages: task.messages.map(({authorId,...message})=>message), changeProposals: task.changeProposals || [], payment: paymentView(task.settlement, await repo.get('payment-job', `task:${task.id}`)), execution: publicExecution(task), submissions: task.submissions.map(publicSubmission) };
      }));
    });
  }
  async function quotes(actor) {
    return repository.read(async repo => {
      const indices = await repo.list('offer-index', 'owner_id', actor.user.id);
      const result = [];
      for (const index of indices) {
        const task = await repo.get('task', index.taskId), offer = task?.offers.find(item => item.id === index.offerId);
        if (!offer) continue;
        const status = task.assignment ? (task.assignment.offerId === offer.id ? 'accepted' : 'not_selected') : task.status === 'cancelled' ? 'closed' : offer.scopeVersion !== task.scopeVersion ? 'needs_update' : offer.expiresAt <= now() ? 'expired' : task.selectedOfferId === offer.id ? 'selected' : 'pending';
        result.push({ ...offer, taskId: task.id, title: task.title, status });
      }
      return result;
    });
  }
  // Runtime-specific commands are installed in one place and share task locks,
  // authorization, receipt replay handling and the same immutable task document.
  const context = { driveBudget: require('./drive-budget.cjs').driveBudget(driveOperationsPerHour), modelBudget: require('./model-budget.cjs').modelBudget(modelAttemptsPerHour), storageAdmission: require('./storage-limits.cjs').storageAdmission(storageLimitBytes), driveProvider, objectStore, fileScanner, paymentRecoveryUserIds, sandboxPaymentsEnabled: !!paymentProvider && localExecution, repository, command, taskFor, agentFor, now, localExecution, taskView, agentView, touch, event, hash, positive, expected, copy, resolveOperator, resolveActor, opportunityView };
  context.approvals = require('./approvals.cjs').createApprovals(context);
  context.credentials = require('./supplier-credentials.cjs').createCredentials(context);
  const payments = require('./payments.cjs').createPayments(context, paymentProvider);
  const qualification = require('./qualification.cjs').createQualification(context);
  const scoping = require('./scoping.cjs').createScoping(context, scopingProvider);
  const execution = require('./execution.cjs').createExecution(context);
  const { authorizeWithin, ...executionCommands } = execution;
  const feed = require('./supplier-feed.cjs').createSupplierFeed(context);
  const recurring = require('./recurring.cjs').createRecurring(context, execution);
  const lifecycle = require('./execution-lifecycle.cjs').createLifecycle(context);
  const { refreshSourceWithin, ...driveConnections } = require('./drive-connections.cjs').createDriveConnections(context);
  context.refreshSourceWithin = refreshSourceWithin;
  return { ...require('./operations.cjs').createOperations(context), ...require('./notifications.cjs').createNotifications(context), features: { notifications: localExecution, driveConnections: localExecution && !!resolveActor, unifiedBackend: true, localExecution, scoping: !!scopingProvider, recurring: localExecution && !!resolveActor, workspaceApps: localExecution && !!resolveActor }, ...require('./file-scans.cjs').createFileScans(context), ...context.approvals, ...payments, ...qualification, ...scoping, createTask, mutateTask, detail, list, ...executionCommands, ...feed, ...lifecycle, ...recurring, ...require('./workspace-apps.cjs').createWorkspaceApps(context), ...driveConnections, ...require('./task-changes.cjs').createTaskChanges(context),
    marketplace: {
      agents: actor => repository.read(async repo => (await repo.list('agent', 'owner_id', actor.user.id)).map(agent => agentView(agent, now()))),
      catalog: actor => repository.read(async repo => {
        if (!actor?.user?.id || actor.recoveryRequired) fail(403, 'FORBIDDEN', 'An active account is required.');
        const rows = await repo.catalogAgents();
        return rows.filter(agent => agent.ownerId !== actor.user.id && agent.purpose)
          .map(agent => {
            const capabilities = agent.capabilities.map(item => capabilityView(agent, item, now()));
            const qualified = capabilities.filter(item => item.qualification === 'qualified');
            return { id: agent.id, name: agent.name, kind: agent.kind, purpose: agent.purpose, domain: agent.domain, operatorName: agent.operatorName, availability: qualified.length ? 'available' : 'qualification_pending', capabilities: capabilities.map(({ id, category, task, qualification, assessment }) => ({ id, category, task, qualification, evidence: assessment?.evidence || null })) };
          }).sort((a, b) => (a.availability === 'available' ? -1 : 1) - (b.availability === 'available' ? -1 : 1) || a.name.localeCompare(b.name));
      }),
      addAgent, configure, opportunities, offers, accept: select, work: supplierTasks, quotes,
      quote
    }
  };
}
function publicExecution(task) {
  if (!task.assignment) return null;
  const { id, offerId, agentId, status, authorizedAt, startedAt, heartbeatAt, completedAt, error, progress, attempt, runtimeKind, deadlineAt, endedAt } = task.assignment;
  return { id, offerId, agentId, status, authorizedAt, startedAt, heartbeatAt, completedAt, error, progress, attempt, runtimeKind, deadlineAt, endedAt, paymentStatus: task.assignment.mode === 'stripe-sandbox' ? (task.settlement?.status || 'unknown') : 'not_applicable_local_unpaid' };
}
function publicSubmission(submission) {
  const { id, version, status, createdAt, evidence, files } = submission;
  return { id, version, status, createdAt, evidence, files: files.map(({ id, filename, mime, size, sha256, scan }) => ({ id, filename, mime, size, sha256, ...(scan ? { scan } : {}) })) };
}
module.exports = { createApplication, publicSubmission };
