'use strict';

const { waitingForPermission, pausedByBuyer } = require('../../../packages/domain/src/execution-state.cjs');

const { assertUnfunded } = require('./payments.cjs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { saveTask, assignmentItem } = require('./supplier-feed.cjs');
const { executionWindowMs } = require('./quote-limits.cjs');
const { assertReadyToStart } = require('./start-preflight.cjs');
const { unmetCriteriaInput, revisionRounds, MAX_REVISION_ROUNDS } = require('./acceptance.cjs');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const LEASE_MS = 30000;
const MAX_FILE_BYTES = 256 * 1024;
const safeName = value => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) fail(400, 'INVALID_FILE', 'Use a simple filename without folders.');
  return value;
};
function decode(value, limit = MAX_FILE_BYTES, binary = false) {
  if (typeof value !== 'string' || value.length > Math.ceil(limit / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail(400, 'INVALID_FILE', `File is invalid or exceeds ${limit} bytes.`);
  const bytes = Buffer.from(value, 'base64');
  if (!bytes.length || bytes.length > limit) fail(400, 'INVALID_FILE', `File must contain 1–${limit} bytes.`);
  if (binary) return bytes;
  try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail(400, 'INVALID_FILE', 'Only UTF-8 text files are supported by this runtime.'); }
  if (bytes.includes(0)) fail(400, 'INVALID_FILE', 'Binary data is not supported.');
  return bytes;
}
function createExecution(context) {
  const { objectStore, fileScanner, repository, command, taskFor, taskReader = taskFor, now, localExecution, hash, expected, touch, event, autoAcceptAfterMs = null } = context;
  const { runtimeAgent, runtimePrincipal, heartbeat, issueCredential, issueSupplierCredential, revokeCredential } = context.credentials;
  async function verifiedBytes(metadata, artifact, taskId) {
    if (!artifact || artifact.taskId !== taskId || (!artifact.objectKey && typeof artifact.base64 !== 'string')) fail(409, 'FILE_UNAVAILABLE', 'File bytes are unavailable.');
    if (metadata.filename !== artifact.filename || (metadata.mime && metadata.mime !== artifact.mime)) fail(409, 'FILE_UNAVAILABLE', 'File metadata does not match this delivery.');
    if (artifact.objectKey && artifact.scan?.status !== 'clean') fail(409, 'FILE_QUARANTINED', artifact.scan?.reason || 'File is quarantined pending scanning.');
    let bytes;
    try { bytes = artifact.objectKey ? await objectStore.read(artifact.objectKey) : Buffer.from(artifact.base64, 'base64'); }
    catch { fail(409, 'FILE_UNAVAILABLE', 'File is missing or damaged. Restore its verified object from backup.'); }
    if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) fail(409, 'FILE_UNAVAILABLE', 'File integrity check failed.');
    return bytes;
  }
  context.verifiedBytes = verifiedBytes;
  // Starting work needs the environment to allow it. Unpaid work needs the unpaid
  // capability. Funded sandbox work stays local-only; checkStart then reports a
  // missing sandbox connection with its own code.
  function startAllowed(mode) {
    if (mode === 'stripe-sandbox' ? !localExecution : !context.capabilities.unpaidExecution)
      fail(403, 'LOCAL_EXECUTION_DISABLED', 'Starting work is not enabled in this environment.');
  }
  async function taskForRuntime(repo, principal, id) {
    const task = await repo.get('task', id, true);
    await runtimeAgent(repo, principal, 'execution:write');
    if (!task?.assignment || task.assignment.agentId !== principal.agentId || task.assignment.operatorId !== principal.actor.user.id) fail(404, 'NOT_FOUND', 'Assignment not found.');
    return task;
  }
  // Shared with brokered connection reads (connections.cjs): one lease rule.
  context.checkLease = (task, principal, token) => lease(task, principal, token);
  function lease(task, principal, token) {
    const assignment = task.assignment;
    if (assignment.status !== 'running' || assignment.leaseUntil <= now() || assignment.agentId !== principal.agentId || typeof token !== 'string' || token.length !== 43 || !assignment.leaseHash) fail(409, 'LEASE_EXPIRED', 'Claim the current assignment before updating it.');
    if (assignment.leaseCredentialHash && assignment.leaseCredentialHash !== principal.credentialHash) fail(409, 'LEASE_EXPIRED', 'Reconnect and claim a fresh lease after credential rotation.');
    if (assignment.deadlineAt && assignment.deadlineAt <= now()) fail(409, 'EXECUTION_EXPIRED', 'The execution window has expired.');
    const candidate = hash(token);
    if (!timingSafeEqual(Buffer.from(candidate), Buffer.from(assignment.leaseHash))) fail(409, 'LEASE_EXPIRED', 'This worker no longer owns the execution lease.');
  }
  async function addInput(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'filename', 'base64', 'notes']);
    const bytes = decode(body.base64), filename = safeName(body.filename), notes = text(body.notes, 'Usage notes', 1, 2000);
    if (!filename.toLowerCase().endsWith('.csv')) fail(400, 'INVALID_FILE', 'The local runtime accepts CSV input.');
    return command(actor.user.id, key, ['input', id, { ...body, base64: hash(bytes) }], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      if (task.orchestrationPlan || task.orchestrationStep?.dependencies.length) require('./orchestration.cjs').fixedScope(task);
      if (task.scheduleId || task.recurringScheduleId) fail(409, 'SCHEDULE_MANAGED', 'Recurring inputs are saved snapshots. Start a new recurring request to change them.');
      if (task.assignment || task.status === 'cancelled') fail(409, 'TASK_ASSIGNED', 'Inputs cannot be replaced after authorization.');
      assertUnfunded(task);
      await context.storageAdmission(repo, task.tenantId, bytes.length);
      const artifactId = randomUUID();
      task.input = { filename, size: bytes.length, sha256: hash(bytes), notes, operation: 'csv-normalize-v1', artifactId };
      await repo.save('artifact', { id: artifactId, ownerId: actor.user.id, tenantId: task.tenantId, taskId: id, filename, sha256: task.input.sha256, size: bytes.length, base64: bytes.toString('base64') });
      task.scopeVersion++; task.selectedOfferId = null; touch(task, now());
      task.scopes.push({ version: task.scopeVersion, title: task.title, brief: task.brief, inputHash: task.input.sha256, inputArtifactId: artifactId, notes, filename, createdAt: now(),
        ...(task.package ? { acceptanceCriteria: task.acceptanceCriteria } : {}) });
      if (task.package) require('./packages.cjs').rebindPackageOffer(task);
      event(task, actor.user.id, 'input.attached', now()); await saveTask(repo, task);
      return { taskId: id, version: task.version, sha256: task.input.sha256 };
    });
  }
  async function authorizeLocal(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'mode']);
    if (!['local-unpaid', 'stripe-sandbox'].includes(body.mode)) fail(400, 'INVALID_MODE', 'Explicit unpaid local execution consent is required.');
    startAllowed(body.mode);
    return command(actor.user.id, key, ['authorize-local', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      if (task.scheduleId) fail(409, 'SCHEDULE_MANAGED', 'The schedule starts this run automatically after its checks and any company approval.');
      return authorizeWithin(repo, actor, task, body.mode);
    });
  }
  async function checkStart(repo, actor, task, mode) {
    require('./orchestration.cjs').ready(task);
    if (task.orchestrationStep && mode !== 'local-unpaid') fail(409, 'PLAN_LOCAL_ONLY', 'Orchestration currently supports local unpaid execution only.');
    if (task.workPlan && task.workPlan.cadence !== 'once') fail(409, 'SCHEDULE_REQUIRED', 'Review and enable the recurring schedule. Each run gets its own execution.');
    startAllowed(mode);
    if (mode === 'local-unpaid') assertUnfunded(task);
    else {
      if (!context.sandboxPaymentsEnabled) fail(503, 'SANDBOX_NOT_CONNECTED', 'Connect the Stripe sandbox before starting funded test work.');
      const sync = await repo.get('payment-job', `task:${task.id}`);
      if (sync?.status === 'review') fail(409, 'RECONCILIATION_REQUIRED', 'Payment review must be resolved before starting.');
      const payment = task.settlement;
      if (payment?.status !== 'funded' || payment.offerId !== task.selectedOfferId || payment.scopeVersion !== task.scopeVersion || payment.inputHash !== (task.input?.sha256 || null)) {
        fail(409, 'FUNDING_REQUIRED', 'Confirmed sandbox funding for this exact agreement is required.');
      }
      const operator = await repo.get('sandbox-operator', payment.operatorId, true);
      if (!operator?.ready || !operator.manualPayouts || operator.checkedAt <= now() - 300000) fail(409, 'OPERATOR_NOT_READY', 'Refresh sandbox operator readiness before starting.');
    }
    if (task.assignment) fail(409, 'TASK_ASSIGNED', 'This task is already authorized.');
    const offer = task.offers.find(item => item.id === task.selectedOfferId);
    if (!offer || offer.expiresAt <= now() || offer.scopeVersion !== task.scopeVersion || task.status !== 'posted') fail(409, 'OFFER_UNAVAILABLE', 'Select a valid offer for the current scope.');
    require('./orchestration.cjs').withinBudget(task, offer.amountMinor);
    const agent = offer.agentId ? await repo.get('agent', offer.agentId, true) : null;
    if (task.package?.inputs.includes('csv') && !task.input) fail(409, 'INPUT_REQUIRED', 'This package needs a CSV file. Attach it before starting.');
    if (!agent?.credentialHash || agent.connectedAt <= now() - 120000 || !require('./packages.cjs').runtimeCommitted(offer)) fail(409, 'RUNTIME_REQUIRED', 'Choose an offer from a connected runtime.');
    if (agent.runtimeKind !== 'supplier-hosted' && (agent.runtimeKind !== 'bounded-csv-automation' || !task.input)) fail(409, 'INPUT_REQUIRED', 'The local CSV runtime requires an attached CSV.');
    if ((offer.currency || 'USD') !== (agent.rules.currency || 'USD')) fail(409, 'CURRENCY_UNSUPPORTED', 'The operator changed quoting currency. Request a fresh offer.');
    if (offer.amountMinor < agent.rules.minimumPayout) fail(409, 'PRICE_LIMIT', 'The operator changed its minimum. Request an updated offer.');
    if (offer.runtimeKind && offer.runtimeKind !== agent.runtimeKind) fail(409, 'RUNTIME_CHANGED', 'The agent connection changed. Request a fresh offer.');
    if (task.input) await verifiedBytes(task.input, await repo.get('artifact', task.input.artifactId), task.id);
    await assertReadyToStart(repo, task, agent, now());
    await context.approvals.requireApproval(repo, actor, task);
    const member = actor.memberships.find(item => item.id === task.tenantId);
    if (member.role !== 'owner' && !task.companyApprovalRequired) fail(403, 'APPROVAL_REQUIRED', 'Corporate execution is not implemented in local unpaid mode.');
    return { offer, agent };
  }
  async function authorizeWithin(repo, actor, task, mode) {
    const { offer, agent } = await checkStart(repo, actor, task, mode);
    task.assignment = { id: randomUUID(), agentId: agent.id, operatorId: offer.operatorId, offerId: offer.id,
      status: 'queued', authorizedAt: now(), mode, attempt: 0, progress: 'Waiting for the runtime',
      runtimeKind: agent.runtimeKind, runtimeVersion: agent.runtimeVersion || null, queueDeadlineAt: now() + 120000, deadlineAt: now() + 120000 + executionWindowMs(offer.deliveryMinutes),
      agreement: { ...offer, handoffs: (task.orchestrationStep?.handoffs || []).map(({approvedBy,...item})=>item), title: task.title, brief: task.brief, inputHash: task.input?.sha256 || null, acceptanceCriteria: task.acceptanceCriteria || [], checks: require('./checks.cjs').freeze(task.checks, task) } };
    touch(task, now()); event(task, actor.user.id, 'assignment.authorized_local', now());
    await saveTask(repo, task);
    await repo.save('grant', { id: task.assignment.id, ownerId: offer.operatorId, tenantId: task.tenantId, taskId: task.id, agentId: agent.id });
    return { taskId: task.id, assignmentId: task.assignment.id, version: task.version, paymentStatus: task.assignment.mode === 'stripe-sandbox' ? task.settlement.status : 'not_applicable_local_unpaid' };
  }
  async function assignments(principal) {
    return repository.read(async repo => {
      await runtimeAgent(repo, principal, 'assignments:read');
      const grants = await repo.page('agent-grant', 'tenant_id', principal.agentId, { limit: 100, statuses: ['queued', 'running'] }), result = [];
      for (const grant of grants.filter(item => item.agentId === principal.agentId)) {
        const task = await repo.get('task', grant.taskId), assignment = task?.assignment;
        if (assignment && ['queued', 'running'].includes(assignment.status)) result.push(assignmentItem(task, now()));
      }
      return result;
    });
  }
  async function claim(principal, id, body, key) {
    exactKeys(body, ['assignmentId']);
    // A lease token is a durable retry result, stored only as a hash in receipts.
    // Derive a stable token from the runtime secret's hash and request key via HMAC.
    const { createHmac } = require('node:crypto');
    const token = createHmac('sha256', principal.credentialHash).update(key).digest('base64url');
    const result = await command(`agent:${principal.agentId}`, key, ['claim', id, body], repo => taskForRuntime(repo, principal, id), async repo => {
      const task = await taskForRuntime(repo, principal, id), assignment = task.assignment;
      if (assignment.id !== body.assignmentId || !['queued', 'running'].includes(assignment.status)) fail(409, 'STATE_CONFLICT', 'This assignment cannot be claimed.');
      if (assignment.permissionWait) fail(409, 'PERMISSION_PENDING', 'Wait for the user to approve access before claiming work.');
      if (assignment.buyerPause) fail(409, 'PAUSED_BY_BUYER', 'The buyer paused this work. Keep polling and claim again after it is resumed.');
      if (assignment.status === 'running' && assignment.leaseUntil > now()) fail(409, 'LEASE_BUSY', 'Another worker holds the lease.');
      if (assignment.attempt >= (assignment.attemptLimit || 3)) {
        // Return a durable failure rather than throwing and rolling it back.
        assignment.status = 'failed'; assignment.error = 'RETRY_EXHAUSTED'; assignment.endedAt = now();
        // Relay's retry limit ended the run, not the agent.
        touch(task, now()); event(task, 'system', 'execution.failed', now()); await saveTask(repo, task);
        return { taskId: id, exhausted: true };
      }
      const agent = await runtimeAgent(repo, principal, 'execution:write');
      const active = await assignmentsWithin(repo, principal);
      if (active.filter(item => item.id !== id && item.assignment.status === 'running' && item.assignment.leaseUntil > now()).length >= agent.rules.concurrency) fail(409, 'CAPACITY_LIMIT', 'The agent is at capacity.');
      if (assignment.deadlineAt && assignment.deadlineAt <= now()) fail(409, 'EXECUTION_EXPIRED', 'The execution window has expired.');
      assignment.leaseCredentialHash = principal.credentialHash;
      assignment.status = 'running'; assignment.startedAt ||= now(); assignment.heartbeatAt = now(); assignment.leaseUntil = now() + LEASE_MS;
      assignment.leaseHash = hash(token); assignment.attempt++; assignment.progress = assignment.runtimeKind === 'supplier-hosted' ? 'The supplier started work' : 'Processing supplied CSV';
      touch(task, now()); event(task, principal.actor.user.id, 'execution.started', now()); await saveTask(repo, task);
      return { taskId: id, assignmentId: assignment.id, attempt: assignment.attempt };
    });
    // Validate lease on retry; an obsolete receipt must not restore an old lease.
    return repository.read(async repo => {
      const task = await taskForRuntime(repo, principal, id);
      if (result.exhausted) return result;
      lease(task, principal, token);
      let input = null;
      if (task.input) {
        const artifact = await repo.get('artifact', task.input.artifactId);
        await verifiedBytes(task.input, artifact, task.id);
        input = { ...task.input, base64: artifact.base64 };
      }
      return { ...result, leaseToken: token, leaseUntil: task.assignment.leaseUntil, deadlineAt: task.assignment.deadlineAt || null, title: task.title, brief: task.assignment.agreement.brief, handoffs: task.assignment.agreement.handoffs || [], input, revisionNotes: task.assignment.revisionNotes || null,
        acceptanceCriteria: task.assignment.agreement.acceptanceCriteria || [], unmetCriteria: task.submissions.findLast(item => item.status === 'revision_requested')?.unmetCriteria || [],
        // Read access the buyer granted for this assignment. Never credentials: reads go through Relay.
        accessGrants: context.connections ? await context.connections.grantsForAgent(repo, task) : [],
        // The agreed machine checks, so the agent can test its own output before delivering.
        checks: (task.assignment.agreement.checks || []).map(require('./checks.cjs').checkView),
        // The ERP intake and its files, released now that the buyer has authorized the work.
        intake: task.intake ? require('./intake.cjs').intakeView(task) : null,
        attachments: context.intake ? await context.intake.forAgent(repo, task) : [] };
    });
  }
  async function assignmentsWithin(repo, principal) {
    const tasks = [];
    let after = '';
    // Page through expired as well as live leases; stale running rows must not
    // hide a later live worker from the operator's concurrency limit.
    for (;;) {
      const grants = await repo.page('agent-grant', 'tenant_id', principal.agentId, { after, limit: 100, statuses: ['running'] });
      for (const grant of grants) {
        const task = await repo.get('task', grant.taskId);
        if (task?.assignment?.status === 'running' && task.assignment.leaseUntil > now()) tasks.push(task);
      }
      if (grants.length < 100 || tasks.length >= 100) return tasks;
      after = grants.at(-1).id;
    }
  }
  async function progress(principal, id, body, key) {
    exactKeys(body, ['leaseToken', 'message']);
    return command(`agent:${principal.agentId}`, key, ['progress', id, body], repo => taskForRuntime(repo, principal, id), async repo => {
      const task = await taskForRuntime(repo, principal, id); lease(task, principal, body.leaseToken);
      task.assignment.heartbeatAt = now(); task.assignment.leaseUntil = now() + LEASE_MS;
      task.assignment.progress = text(body.message, 'Progress', 1, 200);
      touch(task, now()); event(task, principal.actor.user.id, 'execution.progress', now()); await saveTask(repo, task);
      return { taskId: id, version: task.version };
    });
  }
  async function submit(principal, id, body, key) {
    exactKeys(body, ['leaseToken', 'files', 'evidence']);
    const evidence = text(body.evidence, 'Evidence', 1, 3000);
    if (!Array.isArray(body.files) || body.files.length < 1 || body.files.length > 3) fail(400, 'INVALID_FILE', 'Submit 1–3 files.');
    const files = body.files.map(file => {
      exactKeys(file, ['filename', 'base64', 'mime']);
      if (!(objectStore ? ['text/csv', 'text/plain', 'application/json', 'application/pdf', 'image/png', 'image/jpeg', 'video/mp4', 'application/zip'] : ['text/csv', 'text/plain', 'application/json']).includes(file.mime)) fail(400, 'INVALID_FILE', 'Unsupported delivery file type.');
      const bytes = decode(file.base64, objectStore ? 8 * 1024 * 1024 : MAX_FILE_BYTES, !!objectStore);
      if (objectStore) require('../../storage/src/types.cjs').validateType(file.filename, file.mime, bytes);
      return { id: randomUUID(), filename: safeName(file.filename), mime: file.mime, size: bytes.length, sha256: hash(bytes), base64: bytes.toString('base64') };
    });
    if (files.reduce((sum, file) => sum + file.size, 0) > 16 * 1024 * 1024) fail(400, 'INVALID_FILE', 'A delivery may contain at most 16 MiB.');
    if (new Set(files.map(file => file.filename)).size !== files.length) fail(400, 'INVALID_FILE', 'Filenames must be unique.');
    return command(`agent:${principal.agentId}`, key, ['submit', id, body], repo => taskForRuntime(repo, principal, id), async repo => {
      const task = await taskForRuntime(repo, principal, id); lease(task, principal, body.leaseToken);
      if (task.permissionRequests?.some(request => request.assignmentId === task.assignment.id && request.status === 'pending')) fail(409, 'PERMISSION_PENDING', 'Wait for the user to decide the pending access request before delivering.');
      await context.storageAdmission(repo, task.tenantId, files.reduce((sum, file) => sum + file.size, 0));
      const submissionId = randomUUID();
      for (const file of files) {
        let stored = { ...file };
        if (objectStore) {
          stored.objectKey = await require('../../storage/src/local-objects.cjs').putWithRetry(objectStore, Buffer.from(file.base64, 'base64'));
          delete stored.base64;
          stored.scan = { status: 'quarantined', reason: 'Awaiting malware scan.' };
          file.scan = stored.scan;
        }
        await repo.save('artifact', { ...stored, ownerId: task.ownerId, tenantId: task.tenantId, taskId: id, submissionId });
      }
      const manifest = files.map(({ base64, ...metadata }) => metadata);
      const submission = { id: submissionId, version: task.submissions.length + 1, status: 'ready', createdAt: now(), evidence, files: manifest };
      // Run the agreed machine checks on the delivered CSV before the buyer reviews it.
      const agreedChecks = task.assignment.agreement.checks || [];
      if (agreedChecks.length) {
        const load = async attachmentId => {
          const file = (task.attachments || []).find(f => f.id === attachmentId);
          const artifact = file ? await repo.get('artifact', file.artifactId) : null;
          if (!artifact || artifact.sha256 !== file.sha256) throw new Error('a request file is unavailable');
          return Buffer.from(artifact.base64, 'base64');
        };
        submission.checks = { ranAt: now(), ...(await require('./checks.cjs').runChecks(agreedChecks, files, load)) };
      }
      task.submissions.push(submission); task.assignment.status = 'buyer_review'; task.assignment.completedAt = now();
      task.assignment.leaseHash = null; task.assignment.progress = 'Files delivered for review';
      touch(task, now()); event(task, principal.actor.user.id, 'submission.received', now()); await saveTask(repo, task);
      return { taskId: id, submissionId: submission.id, version: task.version };
    });
  }
  async function failExecution(principal, id, body, key) {
    exactKeys(body, ['leaseToken', 'code']);
    if (!['CSV_INVALID', 'OUTPUT_TOO_LARGE', 'INPUT_UNSUPPORTED', 'AGENT_ERROR'].includes(body.code)) fail(400, 'INVALID_INPUT', 'Unknown execution failure code.');
    return command(`agent:${principal.agentId}`, key, ['fail', id, body], repo => taskForRuntime(repo, principal, id), async repo => {
      const task = await taskForRuntime(repo, principal, id); lease(task, principal, body.leaseToken);
      task.assignment.status = 'failed'; task.assignment.error = body.code; task.assignment.endedAt = now();
      task.assignment.progress = body.code === 'CSV_INVALID' ? 'The CSV could not be processed. Check headers, quoting and column counts.' : body.code === 'OUTPUT_TOO_LARGE' ? 'The result exceeds the supported file size.' : 'The supplier could not complete this task. Review the input or contact the operator.';
      task.assignment.leaseHash = null;
      touch(task, now()); event(task, principal.actor.user.id, 'execution.failed', now()); await saveTask(repo, task);
      return { taskId: id, status: 'failed', version: task.version };
    });
  }
  async function checkReview(repo, task, action, submissionId) {
    const submission = task.submissions.at(-1);
    if (task.assignment?.status !== 'buyer_review' || !submission || submission.id !== submissionId || submission.status !== 'ready') fail(409, 'STALE_SUBMISSION', 'Review the current submission.');
    if (action === 'accept-delivery') {
      for (const file of submission.files) {
        const artifact = await repo.get('artifact', file.id);
        if (artifact?.submissionId !== submission.id) fail(409, 'FILE_UNAVAILABLE', 'Submission bytes are unavailable.');
        await verifiedBytes(file, artifact, task.id);
      }
    } else if (task.assignment.runtimeKind !== 'supplier-hosted' && task.submissions.length >= 3) fail(409, 'REVISION_LIMIT', 'This local runtime supports two revisions.');
    else if (revisionRounds(task) >= MAX_REVISION_ROUNDS) fail(409, 'REVISION_LIMIT', `This work has had ${MAX_REVISION_ROUNDS} rounds of changes. End it as unmet or accept it.`);
    return submission;
  }
  async function executionActions(repo, actor, task) {
    const { availability } = require('./action-availability.cjs');
    const check = async action => {
      await taskFor(repo, actor, task.id, true);
      const snapshot = structuredClone(task);
      if (action === 'startLocal' || action === 'startFunded') {
        if (task.scheduleId) fail(409, 'SCHEDULE_MANAGED', 'The schedule starts this run automatically after its checks and any company approval.');
        await checkStart(repo, actor, snapshot, action === 'startLocal' ? 'local-unpaid' : 'stripe-sandbox');
      } else {
        await checkReview(repo, snapshot, action === 'accept' ? 'accept-delivery' : 'request-revision', task.submissions.at(-1)?.id);
      }
    };
    const actions = {};
    for (const action of ['startLocal', 'startFunded', 'accept', 'revise']) actions[action] = await availability(() => check(action));
    return actions;
  }
  function acceptSubmission(task, submission, progress) {
    submission.status = 'accepted'; task.assignment.status = 'accepted'; task.assignment.acceptedAt = now();
    task.assignment.progress = progress;
  }
  // Silence counts as acceptance only when the deployment opts in (acceptance.cjs, rule 4).
  async function reconcileAutoAccept(cursor = '') {
    if (!Number.isSafeInteger(autoAcceptAfterMs) || autoAcceptAfterMs <= 0) return { cursor: '', changed: 0, enabled: false };
    const rows = await repository.read(repo => repo.page('execution-index', 'status', 'buyer_review', { after: cursor, limit: 100 }));
    let changed = 0;
    for (const row of rows) {
      changed += await repository.transaction(`auto-accept:${row.id}`, async repo => {
        const task = await repo.get('task', row.id, true), submission = task?.submissions.at(-1);
        if (task?.assignment?.status !== 'buyer_review' || submission?.status !== 'ready' || submission.createdAt + autoAcceptAfterMs > now()) return 0;
        if (task.assignment.mode === 'stripe-sandbox' || task.settlement) return 0; // money release is not automatic
        try { await checkReview(repo, task, 'accept-delivery', submission.id); } catch (error) { if (error.status === 409) return 0; throw error; }
        acceptSubmission(task, submission, 'Accepted automatically: the buyer didn’t respond within the review window.');
        task.assignment.autoAccepted = true;
        touch(task, now()); event(task, 'system', 'delivery.auto_accepted', now()); await saveTask(repo, task);
        return 1;
      });
    }
    return { cursor: rows.length === 100 ? rows.at(-1).id : '', changed, enabled: true };
  }
  async function reviewDelivery(actor, id, action, body, key) {
    exactKeys(body, action === 'request-revision' ? ['expectedVersion', 'submissionId', 'notes', 'unmetCriteria'] : ['expectedVersion', 'submissionId', 'notes']);
    if (!['accept-delivery', 'request-revision'].includes(action)) fail(400, 'INVALID_INPUT', 'Unknown review action.');
    return command(actor.user.id, key, [action, id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      const submission = await checkReview(repo, task, action, body.submissionId);
      if (action === 'accept-delivery') {
        acceptSubmission(task, submission, 'The buyer accepted this delivery.');
      } else {
        const notes = text(body.notes, 'Revision notes', 1, 2000);
        // A failing machine check is unmet whether or not the buyer names it, so fixing it is free.
        submission.unmetCriteria = [...new Set([...unmetCriteriaInput(task, body.unmetCriteria), ...require('./checks.cjs').failing(submission.checks)])];
        require('./packages.cjs').checkPolishRound(task, submission.unmetCriteria);
        if (task.assignment.runtimeKind !== 'supplier-hosted' && !['Sort rows descending', 'Keep duplicate rows', 'Sort rows ascending'].includes(notes)) fail(422, 'UNSUPPORTED_REVISION', 'Choose a supported CSV revision: Sort rows descending, Keep duplicate rows, or Sort rows ascending.');
        submission.status = 'revision_requested'; task.assignment.status = 'queued'; task.assignment.attempt = 0;
        task.assignment.progress = `Revision queued: ${notes}`; task.assignment.completedAt = null;
        task.assignment.revisionNotes = notes;
        task.assignment.queueDeadlineAt = now() + 120000;
        task.assignment.deadlineAt = now() + 120000 + executionWindowMs(task.assignment.agreement.deliveryMinutes);
      }
      touch(task, now()); event(task, actor.user.id, action === 'accept-delivery' ? 'delivery.accepted' : 'revision.requested', now()); await saveTask(repo, task);
      return { taskId: id, version: task.version, status: task.assignment.status, paymentStatus: task.assignment.mode === 'stripe-sandbox' ? task.settlement.status : 'not_applicable_local_unpaid' };
    });
  }
  // Every human preview or download is recorded for the workspace's audit log.
  async function download(actor, id, submissionId, fileId) {
    const file = await readFile(actor, id, submissionId, fileId);
    await context.org?.recordFileAccess(actor, file.access, 'download');
    const { access, ...rest } = file;
    return rest;
  }
  async function readFile(actor, id, submissionId, fileId) {
    return repository.read(async repo => {
      const task = await repo.get('task', id);
      if (!task) fail(404, 'NOT_FOUND', 'File not found.');
      const supplier = task.assignment?.operatorId === actor.user.id;
      if (!supplier) await taskReader(repo, actor, id);
      const submission = task.submissions.find(item => item.id === submissionId);
      const file = submission?.files.find(item => item.id === fileId);
      if (!file) fail(404, 'NOT_FOUND', 'File not found.');
      const artifact = await repo.get('artifact', file.id);
      if (!artifact || artifact.taskId !== id || artifact.submissionId !== submissionId) fail(409, 'FILE_UNAVAILABLE', 'File is unavailable.');
      const bytes = await verifiedBytes(file, artifact, id);
      return { filename: file.filename, mime: file.mime, sha256: file.sha256, bytes,
        access: { tenantId: task.tenantId, taskId: id, taskTitle: task.title, filename: file.filename, fileId } };
    });
  }
  async function scanFile(actor, id, submissionId, fileId, body, key) {
    exactKeys(body, []);
    const access = async repo => {
      const task = await repo.get('task', id, true);
      if (!task) fail(404, 'NOT_FOUND', 'File not found.');
      if (task.assignment?.operatorId !== actor.user.id) await taskFor(repo, actor, id);
      const submission = task.submissions.find(s => s.id === submissionId);
      const file = submission?.files.find(f => f.id === fileId);
      if (!file) fail(404, 'NOT_FOUND', 'File not found.');
      return { task, file };
    };
    return command(actor.user.id, key, ['scan-file', id, submissionId, fileId], access, async repo => {
      const { task, file } = await access(repo);
      const artifact = await repo.get('artifact', fileId, true);
      if (!artifact?.objectKey || !objectStore || !fileScanner) fail(409, 'SCAN_UNAVAILABLE', 'This file is not stored in the scanning workflow.');
      if (artifact.scan?.status === 'blocked') fail(409, 'FILE_BLOCKED', 'Blocked files require a replacement delivery.');
      if (artifact.scanLease?.until > now()) return { taskId: id, scan: artifact.scan };
      delete artifact.scanLease;
      artifact.scan = file.scan = { status: 'quarantined', reason: 'Queued for automatic scanning.', attempts: artifact.scan?.attempts || 0 };
      await repo.save('artifact', artifact);
      touch(task, now()); event(task, actor.user.id, 'file.scan_requested', now()); await saveTask(repo, task);
      return { taskId: id, scan: file.scan };
    });
  }
  async function previewFile(actor, id, submissionId, fileId) {
    const { access, ...file } = await readFile(actor, id, submissionId, fileId);
    const preview = require('./file-preview.cjs').filePreview(file);
    await context.org?.recordFileAccess(actor, access, 'preview');
    return preview;
  }
  return { reconcileAutoAccept, executionActions, authorizeWithin, scanFile, previewFile, issueCredential, issueSupplierCredential, revokeCredential, runtimePrincipal, heartbeat, addInput, authorizeLocal, assignments, claim, progress, submit, failExecution, reviewDelivery, download };
}
module.exports = { createExecution, MAX_FILE_BYTES };
