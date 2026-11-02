'use strict';
const { randomUUID } = require('node:crypto');
const {
  fail,
  text,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');
const { assertUnfunded } = require('./payments.cjs');

function createTaskChanges(context) {
  const { command, taskFor, resolveActor, now, expected, touch, event } =
    context;
  async function supplier(repo, actor, id, principal) {
    if (!context.localExecution || !actor?.user?.id || actor.recoveryRequired)
      fail(403, 'FORBIDDEN', 'Sign in to continue.');
    const current = resolveActor ? await resolveActor(actor.user.id) : actor;
    if (!current?.memberships?.length)
      fail(403, 'FORBIDDEN', 'Operator access changed.');
    const task = await repo.get('task', id, true);
    const offer = task?.offers.find((item) => item.id === task.selectedOfferId);
    if (!offer || offer.operatorId !== actor.user.id)
      fail(404, 'NOT_FOUND', 'Selected work not found.');
    if (principal) {
      await context.credentials.runtimeAgent(
        repo,
        principal,
        'execution:write',
      );
      if (principal.agentId !== offer.agentId)
        fail(403, 'FORBIDDEN', 'This agent is not selected.');
    }
    return { task, offer };
  }
  function changeable(task) {
    assertUnfunded(task);
    if (task.assignment && task.assignment.mode !== 'local-unpaid')
      fail(
        409,
        'FUNDED_CHANGE_UNAVAILABLE',
        'Funded changes need settlement support.',
      );
    if (
      task.scheduleId ||
      task.recurringScheduleId ||
      (task.workPlan?.cadence && task.workPlan.cadence !== 'once')
    )
      fail(
        409,
        'SCHEDULE_MANAGED',
        'Change recurring work through its schedule.',
      );
    if (task.submissions.length || task.status === 'cancelled')
      fail(
        409,
        'DELIVERY_CHANGE_UNAVAILABLE',
        'Review the existing delivery before requesting new work.',
      );
  }
  async function supplierMessage(actor, id, body, key, principal) {
    exactKeys(body, ['expectedVersion', 'body']);
    return command(
      actor.user.id,
      key,
      ['supplier-message', id, body],
      (repo) => supplier(repo, actor, id, principal),
      async (repo) => {
        const { task, offer } = await supplier(repo, actor, id, principal);
        expected(task, body.expectedVersion);
        if (task.messages.length >= 500)
          fail(
            409,
            'CONVERSATION_LIMIT',
            'This conversation has reached its message limit.',
          );
        task.messages.push({
          id: randomUUID(),
          role: 'supplier',
          body: text(body.body, 'Message', 1, 10000),
          authorId: actor.user.id,
          authorName: principal
            ? offer.agentName
            : `${offer.operatorName || 'Builder'} · operator`,
          agentId: offer.agentId,
          createdAt: now(),
        });
        touch(task, now());
        event(task, actor.user.id, 'supplier.message', now());
        await saveTask(repo, task);
        return { taskId: id, version: task.version };
      },
      `task:${id}`,
    );
  }
  async function proposeChange(actor, id, body, key, principal) {
    exactKeys(body, [
      'expectedVersion',
      'title',
      'brief',
      'amountMinor',
      'deliveryMinutes',
      'reason',
      'retainedMinor',
      'kind',
    ]);
    return command(
      actor.user.id,
      key,
      ['propose-change', id, body],
      (repo) => supplier(repo, actor, id, principal),
      async (repo) => {
        const { task, offer } = await supplier(repo, actor, id, principal);
        expected(task, body.expectedVersion);
        changeable(task);
        if (
          !Number.isSafeInteger(body.amountMinor) ||
          body.amountMinor < 1 ||
          body.amountMinor > 10000000 ||
          !Number.isSafeInteger(body.retainedMinor) ||
          body.retainedMinor < 0 ||
          body.retainedMinor > Math.min(body.amountMinor, offer.amountMinor) ||
          !Number.isSafeInteger(body.deliveryMinutes) ||
          body.deliveryMinutes < 1 ||
          body.deliveryMinutes > 10080
        )
          fail(
            400,
            'INVALID_INPUT',
            'Check the revised total, retained work amount and delivery estimate.',
          );
        if (
          !['scope-change', 'correction', 'included-revision'].includes(
            body.kind,
          )
        )
          fail(400, 'INVALID_INPUT', 'Choose the type of change.');
        if (
          body.kind !== 'scope-change' &&
          body.amountMinor !== offer.amountMinor
        )
          fail(
            400,
            'INCLUDED_WORK',
            'Corrections and included revisions cannot change the agreed price.',
          );
        task.changeProposals ||= [];
        if (task.changeProposals.length >= 50)
          fail(
            409,
            'CHANGE_LIMIT',
            'This task reached its change proposal limit.',
          );
        for (const previous of task.changeProposals)
          if (previous.status === 'pending') previous.status = 'superseded';
        const proposal = {
          id: randomUUID(),
          status: 'pending',
          kind: body.kind,
          baseOfferId: offer.id,
          baseScopeVersion: task.scopeVersion,
          agentId: offer.agentId,
          operatorId: actor.user.id,
          previousAmountMinor: offer.amountMinor,
          amountMinor: body.amountMinor,
          retainedMinor: body.retainedMinor,
          deliveryMinutes: body.deliveryMinutes,
          title: text(body.title, 'Title', 1, 120),
          brief: text(body.brief, 'Brief', 1, 10000),
          reason: text(body.reason, 'Reason', 1, 2000),
          createdAt: now(),
          expiresAt: now() + 86400000,
        };
        task.changeProposals.push(proposal);
        touch(task, now());
        event(task, actor.user.id, 'change.proposed', now());
        await saveTask(repo, task);
        return { taskId: id, proposalId: proposal.id, version: task.version };
      },
      `task:${id}`,
    );
  }
  async function reviewChange(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'proposalId', 'decision']);
    if (!['accept', 'decline'].includes(body.decision))
      fail(400, 'INVALID_INPUT', 'Choose accept or decline.');
    return command(
      actor.user.id,
      key,
      ['review-change', id, body],
      (repo) => taskFor(repo, actor, id, true),
      async (repo) => {
        const task = await taskFor(repo, actor, id, true);
        expected(task, body.expectedVersion);
        const proposal = task.changeProposals?.find(
          (item) => item.id === body.proposalId,
        );
        if (
          !proposal ||
          proposal.status !== 'pending' ||
          proposal.expiresAt <= now() ||
          proposal.baseOfferId !== task.selectedOfferId ||
          proposal.baseScopeVersion !== task.scopeVersion
        )
          fail(
            409,
            'CHANGE_STALE',
            'This change is no longer current. Ask for an updated proposal.',
          );
        if (body.decision === 'accept') {
          changeable(task);
          const previous = task.offers.find(
            (item) => item.id === task.selectedOfferId,
          );
          // Keep the original agreement, but revoke the old assignment/lease. Starting
          // the replacement still passes normal funding, permission and approval gates.
          task.agreementHistory ||= [];
          task.agreementHistory.push({
            offerId: previous.id,
            scopeVersion: task.scopeVersion,
            assignmentId: task.assignment?.id || null,
            changedAt: now(),
            proposalId: proposal.id,
          });
          if (task.assignment) {
            task.assignment.status = 'cancelled';
            task.assignment.error =
              'Replaced by an explicitly accepted scope change.';
            task.assignment.endedAt = now();
            delete task.assignment.leaseHash;
            delete task.assignment.leaseCredentialHash;
            task.assignment.leaseUntil = 0;
            touch(task, now());
            event(task, actor.user.id, 'change.execution_stopped', now());
            await saveTask(repo, task);
          }
          for (const request of task.permissionRequests || []) {
            if (
              request.assignmentId === task.assignment?.id &&
              ['pending', 'declined'].includes(request.status)
            )
              request.status = 'superseded';
          }
          task.assignment = null;
          task.scopeVersion++;
          task.title = proposal.title;
          task.brief = proposal.brief;
          task.status = 'posted';
          task.scopes.push({
            version: task.scopeVersion,
            title: task.title,
            brief: task.brief,
            createdAt: now(),
            inputHash: task.input?.sha256 || null,
          });
          const offer = {
            ...previous,
            id: randomUUID(),
            scopeVersion: task.scopeVersion,
            taskVersion: task.version + 1,
            amountMinor: proposal.amountMinor,
            deliveryMinutes: proposal.deliveryMinutes,
            proposal: proposal.reason,
            createdAt: now(),
            expiresAt: now() + 86400000,
            changeProposalId: proposal.id,
          };
          task.offers.push(offer);
          task.selectedOfferId = offer.id;
          await repo.save('offer-index', {
            id: offer.id,
            ownerId: offer.operatorId,
            taskId: id,
            offerId: offer.id,
          });
          proposal.status = 'accepted';
          proposal.offerId = offer.id;
        } else proposal.status = 'declined';
        proposal.reviewedAt = now();
        proposal.reviewedBy = actor.user.id;
        touch(task, now());
        event(task, actor.user.id, `change.${proposal.status}`, now());
        await saveTask(repo, task);
        return {
          taskId: id,
          version: task.version,
          status: proposal.status,
          executionAuthorized: false,
        };
      },
      `task:${id}`,
    );
  }
  return { supplierMessage, proposeChange, reviewChange };
}
module.exports = { createTaskChanges };
