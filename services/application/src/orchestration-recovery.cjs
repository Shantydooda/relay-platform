'use strict';
const { randomUUID } = require('node:crypto');
const { fail, text, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');

// Replace a branch with fresh task identities. Agreements, grants and handovers
// cannot silently follow an agent replacement or an upstream revision.
function createRecovery(context) {
  const { command, taskFor, expected, now, touch, event, localExecution } = context;
  return async function recover(actor, parentId, body, key) {
    exactKeys(body, ['expectedVersion', 'stepId', 'expectedStepVersion', 'reason', 'confirm']);
    const reason = text(body.reason, 'Recovery reason', 10, 1000);
    if (!localExecution) fail(403, 'LOCAL_ONLY', 'Recovery is local-only.');
    if (body.confirm !== 'reset-affected-steps') fail(400, 'CONSENT_REQUIRED', 'Confirm resetting this step and its dependent steps.');
    return command(actor.user.id, key, ['recover-plan', parentId, body],
      repo => taskFor(repo, actor, parentId, true), async repo => {
        const parent = await taskFor(repo, actor, parentId, true);
        expected(parent, body.expectedVersion);
        const plan = parent.orchestrationPlan;
        if (plan?.status !== 'active' || !plan.steps.includes(body.stepId))
          fail(409, 'PLAN_UNAVAILABLE', 'Choose a current step in an active plan.');
        if (plan.version >= 12) fail(409, 'RECOVERY_LIMIT', 'This plan has reached its revision limit.');
        const tasks = new Map();
        for (const id of [...plan.steps].sort()) tasks.set(id, await taskFor(repo, actor, id, true));
        expected(tasks.get(body.stepId), body.expectedStepVersion);
        const affected = new Set([body.stepId]);
        // The plan is topologically ordered, so one forward pass finds descendants.
        for (const id of plan.steps) {
          if (tasks.get(id).orchestrationStep.dependencies.some(dep => affected.has(dep))) affected.add(id);
        }
        for (const id of affected) {
          const task = tasks.get(id);
          if (task.settlement || (task.assignment && task.assignment.mode !== 'local-unpaid'))
            fail(409, 'PLAN_LOCAL_ONLY', 'Paid work cannot use this local recovery path.');
          if (task.assignment && !['failed', 'cancelled', 'accepted'].includes(task.assignment.status))
            fail(409, 'BRANCH_ACTIVE', 'Stop active work in this step and its dependent steps before recovery.');
        }
        // All task locks precede agent locks, then budget locks in saveTask.
        const agentIds = [...new Set([...affected].map(id => tasks.get(id).assignment?.agentId).filter(Boolean))].sort();
        for (const id of agentIds) await repo.get('agent', id, true);
        const replacements = new Map([...affected].map(id => [id, randomUUID()]));
        const stamp = now(), version = plan.version + 1;
        for (const oldId of plan.steps.filter(id => affected.has(id))) {
          const old = tasks.get(oldId), id = replacements.get(oldId);
          await context.conversationAdmission(repo, parent.tenantId, stamp);
          const step = old.orchestrationStep;
          const fresh = {
            id, tenantId: old.tenantId, ownerId: old.ownerId,
            title: old.title, brief: old.brief, companyApprovalRequired: old.companyApprovalRequired,
            status: 'draft', version: 1, scopeVersion: 1, createdAt: stamp, updatedAt: stamp,
            messages: [], scopes: [{ version: 1, title: old.title, brief: old.brief, createdAt: stamp }],
            events: [], offers: [], selectedOfferId: null, assignment: null, submissions: [],
            orchestrationStep: {
              parentId, planVersion: version, budgetMinor: step.budgetMinor, criteria: step.criteria,
              dependencies: step.dependencies.map(dep => replacements.get(dep) || dep),
              handoffs: [], replacesTaskId: oldId,
            },
          };
          // No input, context, permission, offer or approval is inherited.
          old.orchestrationStep.supersededBy = id;
          old.selectedOfferId = null;
          old.status = 'cancelled';
          if (old.assignment) old.assignment.leaseHash = null;
          touch(old, stamp); event(old, actor.user.id, 'plan.step_superseded', stamp);
          await saveTask(repo, old);
          event(fresh, actor.user.id, 'task.created', stamp);
          await saveTask(repo, fresh);
        }
        plan.history = [...(plan.history || []), { version: plan.version, stepIds: [...plan.steps], reason, changedAt: stamp }];
        plan.steps = plan.steps.map(id => replacements.get(id) || id);
        plan.version = version;
        touch(parent, stamp); event(parent, actor.user.id, 'plan.recovered', stamp);
        await saveTask(repo, parent);
        return { taskId: parentId, version: parent.version, planVersion: version, replacements: Object.fromEntries(replacements) };
      });
  };
}
module.exports = { createRecovery };
