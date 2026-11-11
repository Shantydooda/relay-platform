'use strict';
const { randomUUID } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');

function managed(task) { return !!(task?.orchestrationPlan || task?.orchestrationStep); }
function ready(task) {
  if (task.orchestrationStep?.supersededBy) fail(409, 'STEP_SUPERSEDED', 'This step has been replaced.');
  if (task.orchestrationPlan) fail(409, 'PLAN_PARENT', 'Request offers on the individual steps.');
  const step = task.orchestrationStep;
  if (step && step.dependencies.some(id => !step.handoffs.some(item => item.sourceTaskId === id)))
    fail(409, 'HANDOVER_REQUIRED', 'Approve all upstream handovers before posting this step.');
}
function withinBudget(task, amount) {
  if (task.orchestrationStep && amount > task.orchestrationStep.budgetMinor)
    fail(409, 'STEP_BUDGET', 'This offer exceeds the step’s allocated budget.');
}
function fixedScope(task) {
  if (managed(task)) fail(409, 'PLAN_SCOPE_FIXED', 'This reviewed plan has fixed scope and budgets. Create a new plan for changed requirements.');
}
function createOrchestration(context) {
  const { repository, command, taskFor, now, expected, touch, event, hash, localExecution } = context;
  async function create(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'budgetMinor', 'steps']);
    if (!localExecution) fail(403, 'LOCAL_ONLY', 'Orchestration is local-only.');
    if (!Number.isSafeInteger(body.budgetMinor) || body.budgetMinor < 1 || body.budgetMinor > 10000000)
      fail(400, 'INVALID_INPUT', 'Set a positive total budget in cents.');
    if (!Array.isArray(body.steps) || body.steps.length < 2 || body.steps.length > 8)
      fail(400, 'INVALID_INPUT', 'Add 2–8 steps.');
    const steps = body.steps.map((step, index) => {
      exactKeys(step, ['title', 'brief', 'criteria', 'budgetMinor', 'dependencies']);
      if (!Number.isSafeInteger(step.budgetMinor) || step.budgetMinor < 1 ||
          !Array.isArray(step.dependencies) || new Set(step.dependencies).size !== step.dependencies.length ||
          step.dependencies.some(n => !Number.isInteger(n) || n < 0 || n >= index))
        fail(400, 'INVALID_INPUT', 'Dependencies must reference earlier steps; every step needs a positive budget.');
      return { title: text(step.title, 'Step title', 1, 120), brief: text(step.brief, 'Step brief', 1, 3000),
        criteria: text(step.criteria, 'Acceptance criteria', 1, 1500), budgetMinor: step.budgetMinor, dependencies: step.dependencies };
    });
    if (steps.reduce((sum, step) => sum + step.budgetMinor, 0) > body.budgetMinor)
      fail(400, 'PLAN_BUDGET', 'Step allocations exceed the parent budget.');
    const tenantId = await repository.read(async repo => (await taskFor(repo, actor, id, true)).tenantId);
    return command(actor.user.id, key, ['orchestration', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const parent = await taskFor(repo, actor, id, true); expected(parent, body.expectedVersion);
      if (managed(parent) || parent.status !== 'draft' || parent.assignment || parent.offers.length || parent.settlement ||
          (parent.workPlan && parent.workPlan.cadence !== 'once') || parent.input || parent.contextReferences?.length || parent.scoping?.status === 'pending' || parent.scheduleId || parent.recurringScheduleId || parent.preferredAgentId || parent.preferredOperatorId)
        fail(409, 'PLAN_UNAVAILABLE', 'Use a new open draft without inputs, tool context, offers or scheduled work. Attach inputs to the individual steps.');
      const ids = steps.map(() => randomUUID()), stamp = now();
      for (let i = 0; i < steps.length; i++) {
        await context.conversationAdmission(repo, parent.tenantId, stamp);
        const step = steps[i];
        const brief = `${step.brief}\n\nAcceptance criteria:\n${step.criteria}`;
        const child = { id: ids[i], tenantId: parent.tenantId, ownerId: parent.ownerId, title: step.title, brief,
          companyApprovalRequired: parent.companyApprovalRequired, status: 'draft', version: 1, scopeVersion: 1,
          createdAt: stamp, updatedAt: stamp, messages: [], scopes: [{ version: 1, title: step.title, brief, createdAt: stamp }],
          events: [], offers: [], selectedOfferId: null, assignment: null, submissions: [],
          orchestrationStep: { parentId: id, planVersion: 1, budgetMinor: step.budgetMinor, criteria: step.criteria,
            dependencies: step.dependencies.map(n => ids[n]), handoffs: [] } };
        event(child, actor.user.id, 'task.created', stamp); await saveTask(repo, child);
      }
      parent.orchestrationPlan = { version: 1, brief: parent.brief, budgetMinor: body.budgetMinor, currency: 'USD',
        steps: ids, createdAt: stamp, status: 'active' };
      touch(parent, stamp); event(parent, actor.user.id, 'plan.created', stamp); await saveTask(repo, parent);
      return { taskId: id, stepIds: ids, version: parent.version };
    }, `workspace-create:${tenantId}`);
  }
  async function handover(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'sourceTaskId', 'submissionId', 'notes', 'fileId', 'consent']);
    const notes = text(body.notes, 'Approved handover', 1, 2000);
    if (body.consent !== 'share-with-step-supplier') fail(400, 'CONSENT_REQUIRED', 'Approve sharing this handover with the downstream supplier.');
    if (typeof body.sourceTaskId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.sourceTaskId) || body.sourceTaskId === id)
      fail(400, 'INVALID_INPUT', 'Choose an upstream step.');
    // Lock all tasks in ID order for concurrent diamond-graph handovers.
    async function access(repo) {
      for (const taskId of [id, body.sourceTaskId].sort()) await taskFor(repo, actor, taskId, true);
    }
    return command(actor.user.id, key, ['handover', id, body], access, async repo => {
      const target = await taskFor(repo, actor, id, true), source = await taskFor(repo, actor, body.sourceTaskId, true);
      expected(target, body.expectedVersion);
      const step = target.orchestrationStep;
      if (!step || !step.dependencies.includes(source.id) || source.orchestrationStep?.parentId !== step.parentId || source.tenantId !== target.tenantId ||
          target.status !== 'draft' || target.assignment || step.handoffs.some(item => item.sourceTaskId === source.id))
        fail(409, 'HANDOVER_UNAVAILABLE', 'This handover is not available for this step.');
      const submission = source.submissions.find(item => item.id === body.submissionId);
      if (source.assignment?.status !== 'accepted' || submission?.status !== 'accepted' || source.submissions.at(-1)?.id !== submission.id)
        fail(409, 'DELIVERY_NOT_ACCEPTED', 'Accept the current upstream delivery first.');
      const handoff = { sourceTaskId: source.id, submissionId: submission.id, submissionVersion: submission.version,
        notes, approvedAt: now(), approvedBy: actor.user.id, planVersion: step.planVersion };
      if (body.fileId) {
        const file = submission.files.find(item => item.id === body.fileId);
        if (!file || !file.filename.endsWith('.csv') || file.size > 256 * 1024 || target.input)
          fail(409, 'HANDOVER_FILE', 'Choose one CSV up to 256 KB for a step without an input file.');
        const bytes = context.verifiedBytes(file, await repo.get('artifact', file.id), source.id);
        await context.storageAdmission(repo, target.tenantId, bytes.length);
        const artifactId = randomUUID();
        target.input = { artifactId, filename: file.filename, sha256: hash(bytes), size: bytes.length, notes: 'Approved upstream CSV for this step only.', operation: 'csv-normalize-v1' };
        await repo.save('artifact', { id: artifactId, ownerId: target.ownerId, tenantId: target.tenantId, taskId: id,
          filename: file.filename, sha256: hash(bytes), size: bytes.length, base64: bytes.toString('base64') });
        handoff.file = { filename: file.filename, sha256: hash(bytes), size: bytes.length };
      }
      step.handoffs.push(handoff);
      target.scopeVersion++; target.selectedOfferId = null;
      target.scopes.push({ version: target.scopeVersion, title: target.title, brief: target.brief, createdAt: now(), inputHash: target.input?.sha256 || null });
      touch(target, now()); event(target, actor.user.id, 'handover.approved', now()); await saveTask(repo, target);
      return { taskId: id, version: target.version };
    }, `handover:${id}`);
  }
  async function view(repo, actor, parent) {
    if (!parent.orchestrationPlan) return null;
    const steps = [];
    for (const id of parent.orchestrationPlan.steps) {
      const task = await taskFor(repo, actor, id);
      const latest = task.submissions.at(-1);
      steps.push({ id, title: task.title, status: task.assignment?.status || task.status, version: task.version,
        ...task.orchestrationStep, handoffs: task.orchestrationStep.handoffs.map(({ approvedBy, ...item }) => item),
        delivery: latest?.status === 'accepted' ? { id: latest.id, version: latest.version,
          files: latest.files.map(({ id, filename, size }) => ({ id, filename, size })) } : null });
    }
    return { ...parent.orchestrationPlan, steps };
  }
  async function complete(actor, id, body, key) {
    exactKeys(body, ['expectedVersion']);
    return command(actor.user.id, key, ['plan-complete', id, body], repo => taskFor(repo, actor, id, true), async repo => {
      const parent = await taskFor(repo, actor, id, true); expected(parent, body.expectedVersion);
      if (parent.orchestrationPlan?.status !== 'active') fail(409, 'PLAN_UNAVAILABLE', 'This plan cannot be completed.');
      for (const childId of [...parent.orchestrationPlan.steps].sort()) {
        const child = await taskFor(repo, actor, childId);
        if (child.assignment?.status !== 'accepted') fail(409, 'PLAN_INCOMPLETE', 'Accept every step’s delivery first.');
      }
      parent.orchestrationPlan.status = 'accepted'; parent.status = 'accepted';
      touch(parent, now()); event(parent, actor.user.id, 'plan.accepted', now()); await saveTask(repo, parent);
      return { taskId: id, version: parent.version };
    });
  }
  return { create, handover, view, complete };
}
module.exports = { createOrchestration, managed, ready, fixedScope, withinBudget };
