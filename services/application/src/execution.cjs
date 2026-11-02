'use strict';

const { assertUnfunded } = require('./payments.cjs');
const { randomUUID, timingSafeEqual } = require('node:crypto');
const { saveTask } = require('./supplier-feed.cjs');
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
  const { objectStore, fileScanner, repository, command, taskFor, now, localExecution, hash, expected, touch, event } = context;
  const { runtimeAgent, runtimePrincipal, heartbeat, issueCredential, issueSupplierCredential, revokeCredential } = context.credentials;
  function verifiedBytes(metadata, artifact, taskId) {
    if (!artifact || artifact.taskId !== taskId || (!artifact.objectKey && typeof artifact.base64 !== 'string')) fail(409, 'FILE_UNAVAILABLE', 'File bytes are unavailable.');
    if (metadata.filename !== artifact.filename || (metadata.mime && metadata.mime !== artifact.mime)) fail(409, 'FILE_UNAVAILABLE', 'File metadata does not match this delivery.');
    if (artifact.objectKey && artifact.scan?.status !== 'clean') fail(409, 'FILE_QUARANTINED', artifact.scan?.reason || 'File is quarantined pending scanning.');
    let bytes;
    try { bytes = artifact.objectKey ? objectStore.read(artifact.objectKey) : Buffer.from(artifact.base64, 'base64'); }
    catch { fail(409, 'FILE_UNAVAILABLE', 'File is missing or damaged. Restore its verified object from backup.'); }
    if (bytes.length !== metadata.size || hash(bytes) !== metadata.sha256) fail(409, 'FILE_UNAVAILABLE', 'File integrity check failed.');
    return bytes;
  }
  function localOnly() {
    if (!localExecution) fail(403, 'LOCAL_EXECUTION_DISABLED', 'Unpaid execution is only available in explicit local development mode.');
  }
  async function taskForRuntime(repo, principal, id) {
    const task = await repo.get('task', id, true);
    await runtimeAgent(repo, principal, 'execution:write');
    if (!task?.assignment || task.assignment.agentId !== principal.agentId || task.assignment.operatorId !== principal.actor.user.id) fail(404, 'NOT_FOUND', 'Assignment not found.');
    return task;
  }
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
      if (task.scheduleId || task.recurringScheduleId) fail(409, 'SCHEDULE_MANAGED', 'Recurring inputs are saved snapshots. Start a new recurring request to change them.');
      if (task.assignment || task.status === 'cancelled') fail(409, 'TASK_ASSIGNED', 'Inputs cannot be replaced after authorization.');
      assertUnfunded(task);
      await context.storageAdmission(repo, task.tenantId, bytes.length);
      const artifactId = randomUUID();
      task.input = { filename, size: bytes.length, sha256: hash(bytes), notes, operation: 'csv-normalize-v1', artifactId };
      await repo.save('artifact', { id: artifactId, ownerId: actor.user.id, tenantId: task.tenantId, taskId: id, filename, sha256: task.input.sha256, size: bytes.length, base64: bytes.toString('base64') });
      task.scopeVersion++; task.selectedOfferId = null; touch(task, now());
      task.scopes.push({ version: task.scopeVersion, title: task.title, brief: task.brief, inputHash: task.input.sha256, inputArtifactId: artifactId, notes, filename, createdAt: now() });
      event(task, actor.user.id, 'input.attached', now()); await saveTask(repo, task);
      return { taskId: id, version: task.version, sha256: task.input.sha256 };
    });
  }
  async function authorizeLocal(actor, id, body, key) {
    localOnly(); exactKeys(body, ['expectedVersion', 'mode']);
    if (!['local-unpaid', 'stripe-sandbox'].includes(body.mode)) fail(400, 'INVALID_MODE', 'Explicit unpaid local execution consent is required.');
    return command(actor.user.id, key, ['authorize-local', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      if (task.scheduleId) fail(409, 'SCHEDULE_MANAGED', 'The schedule starts this run automatically after its checks and any company approval.');
      return authorizeWithin(repo, actor, task, body.mode);
    });
  }
  async function authorizeWithin(repo, actor, task, mode) {
    if (task.workPlan && task.workPlan.cadence !== 'once') fail(409, 'SCHEDULE_REQUIRED', 'Review and enable the recurring schedule. Each run gets its own execution.');
    localOnly();
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
    const agent = await repo.get('agent', offer.agentId, true);
    if (!agent?.credentialHash || agent.connectedAt <= now() - 120000 || !offer.runtimeBid) fail(409, 'RUNTIME_REQUIRED', 'Choose an offer from a connected runtime.');
    if (agent.runtimeKind !== 'supplier-hosted' && (agent.runtimeKind !== 'bounded-csv-automation' || !task.input)) fail(409, 'INPUT_REQUIRED', 'The local CSV runtime requires an attached CSV.');
    if (offer.amountMinor < agent.rules.minimumPayout) fail(409, 'PRICE_LIMIT', 'The operator changed its minimum. Request an updated offer.');
    if (offer.runtimeKind && offer.runtimeKind !== agent.runtimeKind) fail(409, 'RUNTIME_CHANGED', 'The agent connection changed. Request a fresh offer.');
    if (task.input) verifiedBytes(task.input, await repo.get('artifact', task.input.artifactId), task.id);
    await context.approvals.requireApproval(repo, actor, task);
    const member = actor.memberships.find(item => item.id === task.tenantId);
    if (member.role !== 'owner' && !task.companyApprovalRequired) fail(403, 'APPROVAL_REQUIRED', 'Corporate execution is not implemented in local unpaid mode.');
    task.assignment = { id: randomUUID(), agentId: agent.id, operatorId: offer.operatorId, offerId: offer.id,
      status: 'queued', authorizedAt: now(), mode, attempt: 0, progress: 'Waiting for the runtime',
      runtimeKind: agent.runtimeKind, queueDeadlineAt: now() + 120000, deadlineAt: now() + 120000 + Math.min(86400000, Math.max(300000, offer.deliveryMinutes * 120000)),
      agreement: { ...offer, title: task.title, brief: task.brief, inputHash: task.input?.sha256 || null } };
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
        if (assignment && ['queued', 'running'].includes(assignment.status)) result.push({ taskId: task.id, assignmentId: assignment.id, status: assignment.status, leaseUntil: assignment.leaseUntil || 0, attempt: assignment.attempt });
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
      if (assignment.status === 'running' && assignment.leaseUntil > now()) fail(409, 'LEASE_BUSY', 'Another worker holds the lease.');
      if (assignment.attempt >= (assignment.attemptLimit || 3)) {
        // Return a durable failure rather than throwing and rolling it back.
        assignment.status = 'failed'; assignment.error = 'RETRY_EXHAUSTED'; assignment.endedAt = now();
        touch(task, now()); event(task, principal.actor.user.id, 'execution.failed', now()); await saveTask(repo, task);
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
        verifiedBytes(task.input, artifact, task.id);
        input = { ...task.input, base64: artifact.base64 };
      }
      return { ...result, leaseToken: token, leaseUntil: task.assignment.leaseUntil, deadlineAt: task.assignment.deadlineAt || null, title: task.title, brief: task.assignment.agreement.brief, input, revisionNotes: task.assignment.revisionNotes || null };
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
          stored.objectKey = objectStore.put(Buffer.from(file.base64, 'base64'));
          delete stored.base64;
          stored.scan = { status: 'quarantined', reason: 'Awaiting malware scan.' };
          file.scan = stored.scan;
        }
        await repo.save('artifact', { ...stored, ownerId: task.ownerId, tenantId: task.tenantId, taskId: id, submissionId });
      }
      const manifest = files.map(({ base64, ...metadata }) => metadata);
      const submission = { id: submissionId, version: task.submissions.length + 1, status: 'ready', createdAt: now(), evidence, files: manifest };
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
  async function reviewDelivery(actor, id, action, body, key) {
    exactKeys(body, ['expectedVersion', 'submissionId', 'notes']);
    if (!['accept-delivery', 'request-revision'].includes(action)) fail(400, 'INVALID_INPUT', 'Unknown review action.');
    return command(actor.user.id, key, [action, id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const task = await taskFor(repo, actor, id, true); expected(task, body.expectedVersion);
      const submission = task.submissions.at(-1);
      if (task.assignment?.status !== 'buyer_review' || submission?.id !== body.submissionId || submission.status !== 'ready') fail(409, 'STALE_SUBMISSION', 'Review the current submission.');
      if (action === 'accept-delivery') {
        for (const file of submission.files) {
          const artifact = await repo.get('artifact', file.id);
          if (artifact?.submissionId !== submission.id) fail(409, 'FILE_UNAVAILABLE', 'Submission bytes are unavailable.');
          verifiedBytes(file, artifact, task.id);
        }
        submission.status = 'accepted'; task.assignment.status = 'accepted'; task.assignment.acceptedAt = now();
        task.assignment.progress = 'The buyer accepted this delivery.';
      } else {
        if (task.submissions.length >= 3) fail(409, 'REVISION_LIMIT', 'This local runtime supports two revisions.');
        const notes = text(body.notes, 'Revision notes', 1, 2000);
        if (task.assignment.runtimeKind !== 'supplier-hosted' && !['Sort rows descending', 'Keep duplicate rows', 'Sort rows ascending'].includes(notes)) fail(422, 'UNSUPPORTED_REVISION', 'Choose a supported CSV revision: Sort rows descending, Keep duplicate rows, or Sort rows ascending.');
        submission.status = 'revision_requested'; task.assignment.status = 'queued'; task.assignment.attempt = 0;
        task.assignment.progress = `Revision queued: ${notes}`; task.assignment.completedAt = null;
        task.assignment.revisionNotes = notes;
        task.assignment.queueDeadlineAt = now() + 120000;
        task.assignment.deadlineAt = now() + 120000 + Math.min(86400000, Math.max(300000, task.assignment.agreement.deliveryMinutes * 120000));
      }
      touch(task, now()); event(task, actor.user.id, action === 'accept-delivery' ? 'delivery.accepted' : 'revision.requested', now()); await saveTask(repo, task);
      return { taskId: id, version: task.version, status: task.assignment.status, paymentStatus: task.assignment.mode === 'stripe-sandbox' ? task.settlement.status : 'not_applicable_local_unpaid' };
    });
  }
  async function download(actor, id, submissionId, fileId) {
    return repository.read(async repo => {
      const task = await repo.get('task', id);
      if (!task) fail(404, 'NOT_FOUND', 'File not found.');
      const supplier = task.assignment?.operatorId === actor.user.id;
      if (!supplier) await taskFor(repo, actor, id);
      const submission = task.submissions.find(item => item.id === submissionId);
      const file = submission?.files.find(item => item.id === fileId);
      if (!file) fail(404, 'NOT_FOUND', 'File not found.');
      const artifact = await repo.get('artifact', file.id);
      if (!artifact || artifact.taskId !== id || artifact.submissionId !== submissionId) fail(409, 'FILE_UNAVAILABLE', 'File is unavailable.');
      const bytes = verifiedBytes(file, artifact, id);
      return { filename: file.filename, mime: file.mime, sha256: file.sha256, bytes };
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
    const file = await download(actor, id, submissionId, fileId);
    return require('./file-preview.cjs').filePreview(file);
  }
  return { authorizeWithin, scanFile, previewFile, issueCredential, issueSupplierCredential, revokeCredential, runtimePrincipal, heartbeat, addInput, authorizeLocal, assignments, claim, progress, submit, failExecution, reviewDelivery, download };
}
module.exports = { createExecution, MAX_FILE_BYTES };
