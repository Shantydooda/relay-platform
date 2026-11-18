'use strict';

const {
  claimCapacity,
  ownsCapacity,
  releaseCapacity,
} = require('./model-capacity.cjs');
const { assertUnfunded } = require('./payments.cjs');
const { randomUUID } = require('node:crypto');
const {
  fail,
  text,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');
const {
  validateProposal,
} = require('../../../packages/contracts/src/scope-proposal.cjs');

// Provider work never holds a database transaction. A durable claim and task
// version bind the response to exactly the conversation the model read.
function createScoping(context, provider) {
  const { repository, command, taskFor, expected, now, touch, event } = context;
  const running = new Set();
  function editable(task) {
    require('./orchestration.cjs').fixedScope(task);
    assertUnfunded(task);
    if (task.assignment || !['draft', 'posted'].includes(task.status)) {
      fail(
        409,
        'SCOPING_CLOSED',
        'Scoping is available before work is assigned.',
      );
    }
  }
  async function assist(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'message', 'useContext']);
    if (!provider)
      fail(
        503,
        'MODEL_UNAVAILABLE',
        'The local model is not configured. You can still review the brief manually.',
      );
    if (body.useContext !== undefined && typeof body.useContext !== 'boolean')
      fail(400, 'INVALID_CONTEXT', 'Context permission must be a boolean.');
    const message =
      body.message === undefined
        ? null
        : text(body.message, 'Message', 1, 10000);
    const job = await command(
      actor.user.id,
      key,
      ['assist', id, body],
      (repo) => taskFor(repo, actor, id, true),
      async (repo) => {
        const task = await taskFor(repo, actor, id, true);
        expected(task, body.expectedVersion);
        editable(task);
        if (
          task.scoping?.status === 'pending' &&
          task.scoping.expiresAt > now()
        ) {
          fail(
            409,
            'SCOPING_BUSY',
            'Relay is still reading this brief. Your message has not been sent yet.',
          );
        }
        if (task.scoping?.id && task.scoping.status === 'pending') {
          const interrupted = await repo.get(
            'scoping-job',
            task.scoping.id,
            true,
          );
          if (interrupted) {
            interrupted.status = 'stale';
            delete interrupted.snapshot;
            await repo.save('scoping-job', interrupted);
          }
        }
        if (task.messages.length >= 30)
          fail(
            409,
            'CONVERSATION_LIMIT',
            'This conversation has reached its message limit.',
          );
        await context.modelBudget(repo, task.tenantId, now());
        if (message)
          task.messages.push({
            id: randomUUID(),
            role: 'user',
            body: message,
            authorId: actor.user.id,
            authorName: actor.user.name,
            createdAt: now(),
          });
        const messages = task.messages.map((item) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: item.body,
        }));
        const contextReads = [];
        const documents = [];
        if (body.useContext) {
          const current = context.resolveActor
            ? await context.resolveActor(actor.user.id)
            : actor;
          const membership = current?.memberships.find(
            (item) => item.id === task.tenantId,
          );
          if (membership?.role !== 'owner')
            fail(
              403,
              'CONTEXT_FORBIDDEN',
              'Only the workspace owner can allow source reading.',
            );
          for (const ref of task.contextReferences || []) {
            const source = await repo.get('tool-source', ref.sourceId, true);
            if (
              !source ||
              source.tenantId !== task.tenantId ||
              source.status !== 'active'
            )
              fail(
                409,
                'SOURCE_DISABLED',
                'A selected source is unavailable. Update your context before continuing.',
              );
            const content =
              ref.mode === 'snapshot' ? ref.content : source.content;
            if (typeof content !== 'string')
              fail(
                409,
                'SOURCE_UNAVAILABLE',
                'This source has no saved content to read.',
              );
            const version =
              ref.mode === 'snapshot' ? ref.version : source.version;
            documents.push({
              name: source.name,
              version,
              content,
              untrusted: true,
            });
            contextReads.push({
              sourceId: source.id,
              name: source.name,
              version,
              sourceEpoch: source.accessEpoch || 0,
              accessEpoch: membership.accessEpoch ?? null,
              readAt: now(),
            });
          }
        }
        const snapshot = {
          documents,
          contextReferences: (task.contextReferences || []).map(
            ({ content, ...ref }) => ref,
          ),
          title: task.title,
          brief: task.brief,
          messages,
          plan: task.workPlan || null,
          input: task.input
            ? {
                filename: task.input.filename,
                notes: task.input.notes,
                sha256: task.input.sha256,
              }
            : null,
        };
        if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > 10000)
          fail(
            422,
            'CONTEXT_LIMIT',
            'This brief is too long for the local model. Review the brief manually.',
          );
        touch(task, now());
        const jobId = randomUUID();
        task.scoping = {
          id: jobId,
          status: 'pending',
          version: task.version,
          expiresAt: now() + 180000,
          contextReads,
        };
        event(task, actor.user.id, 'scoping.requested', now());
        await saveTask(repo, task);
        await repo.save('scoping-job', {
          id: jobId,
          ownerId: actor.user.id,
          tenantId: task.tenantId,
          createdAt: now(),
          taskId: id,
          status: 'pending',
          version: task.version,
          snapshot,
          contextReads,
          source: provider.metadata || null,
          expiresAt: task.scoping.expiresAt,
        });
        return { jobId, taskId: id, version: task.version };
      },
    );
    // Retries reuse the durable job. Expired jobs are never silently restarted.
    launch(actor, job);
    return job;
  }
  const pending = new Set();
  function launch(actor, job) {
    if (running.has(job.jobId)) return;
    running.add(job.jobId);
    const promise = processJob(actor, job)
      .catch(() => {})
      .finally(() => running.delete(job.jobId));
    pending.add(promise);
    promise.finally(() => pending.delete(promise));
  }
  async function reconcileScoping(after = '') {
    if (!provider || !context.resolveActor) return { next: '' };
    const page = await repository.read((repo) =>
      repo.activeScopingJobs({ after, limit: 20 }),
    );
    const candidate = await repository.read((repo) =>
      repo.nextScopingJob(now()),
    );
    const work = candidate
      ? [candidate, ...page.filter((item) => item.id !== candidate.id)]
      : page;
    for (const item of work) {
      if (!['pending', 'running'].includes(item.status)) continue;
      // Never wait for inference in the recovery worker or its access boundary.
      // Keep each worker's recovery batch bounded while other work is active.
      if (pending.size >= 2 && item.expiresAt > now()) continue;
      const actor = await context.resolveActor(item.ownerId);
      let allowed = false;
      if (actor?.user?.id) {
        try {
          await repository.read((repo) =>
            taskFor(repo, actor, item.taskId, true),
          );
          allowed = true;
        } catch (error) {
          if (![403, 404].includes(error.status)) throw error;
        }
      }
      if (!allowed || item.expiresAt <= now()) {
        await repository.transaction(`scope-job:${item.id}`, async (repo) => {
          const job = await repo.get('scoping-job', item.id, true);
          if (!job || !['pending', 'running'].includes(job.status)) return;
          if (allowed && job.expiresAt > now()) return;
          job.status = 'stale';
          delete job.snapshot;
          await repo.save('scoping-job', job);
          const task = await repo.get('task', job.taskId, true);
          if (
            task?.scoping?.id === job.id &&
            task.scoping.status === 'pending'
          ) {
            task.scoping = {
              ...task.scoping,
              status: 'failed',
              error:
                'This reply was interrupted or access changed. Your message is saved. Review access and try again.',
            };
            await saveTask(repo, task);
          }
        });
        continue;
      }
      if (item.status === 'pending')
        launch(actor, { jobId: item.id, taskId: item.taskId });
    }
    return { next: page.length === 20 ? page.at(-1).id : '' };
  }
  async function processJob(actor, ref) {
    const claim = await repository.transaction(
      `scope-job:${ref.jobId}`,
      async (repo) => {
        const task = await taskFor(repo, actor, ref.taskId, true);
        const job = await repo.get('scoping-job', ref.jobId, true);
        if (!job || job.status !== 'pending') return null;
        if (
          task.version !== job.version ||
          task.scoping?.id !== job.id ||
          job.expiresAt <= now()
        ) {
          job.status = 'stale';
          delete job.snapshot;
          await repo.save('scoping-job', job);
          return null;
        }
        const capacity = await claimCapacity(
          repo,
          job.id,
          now(),
          task.tenantId,
        );
        if (!capacity) return null;
        job.status = 'running';
        job.startedAt = now();
        await repo.save('scoping-job', job);
        return { ...job, tenantId: task.tenantId, capacity };
      },
    );
    if (!claim) return;
    try {
      let proposal, error;
      try {
        proposal = validateProposal(
          await provider.propose(claim.snapshot, {
            tenantId: claim.tenantId,
            beforeStart: () =>
              repository.read(async (repo) => {
                if (!(await ownsCapacity(repo, claim.capacity, now())))
                  fail(
                    409,
                    'MODEL_LEASE_EXPIRED',
                    'The model reservation expired. Retry this conversation.',
                  );
                const task = await taskFor(repo, actor, ref.taskId, true);
                if (
                  task.version !== claim.version ||
                  task.scoping?.id !== claim.id ||
                  claim.expiresAt <= now()
                )
                  fail(
                    409,
                    'SCOPING_STALE',
                    'This conversation changed while waiting.',
                  );
                const current = context.resolveActor
                  ? await context.resolveActor(actor.user.id)
                  : actor;
                const membership = current?.memberships.find(
                  (item) => item.id === task.tenantId,
                );
                for (const read of claim.contextReads || []) {
                  const source = await repo.get('tool-source', read.sourceId);
                  if (
                    membership?.role !== 'owner' ||
                    (membership.accessEpoch ?? null) !== read.accessEpoch ||
                    !source ||
                    source.status !== 'active' ||
                    source.tenantId !== task.tenantId ||
                    (source.accessEpoch || 0) !== read.sourceEpoch
                  )
                    fail(
                      403,
                      'SOURCE_DISABLED',
                      'Source access changed while waiting.',
                    );
                }
              }),
          }),
        );
        if (['question', 'hypothetical'].includes(proposal.intent)) {
          proposal.title = claim.snapshot.title;
          proposal.brief = claim.snapshot.brief;
        }
        const buyerText = claim.snapshot.messages
          .filter((message) => message.role === 'user')
          .map((message) => message.content)
          .join('\n');
        if (
          proposal.timezone &&
          !buyerText.toLowerCase().includes(proposal.timezone.toLowerCase())
        )
          proposal.timezone = null;
      } catch (cause) {
        error = ['MODEL_QUEUE_FULL', 'MODEL_QUEUE_EXPIRED'].includes(cause.code)
          ? 'Relay is busy helping other workspaces. Your message is saved. Try again shortly or edit the brief manually.'
          : 'The local model could not finish. Your message is saved and the agreed brief is unchanged. Try again or edit the brief manually.';
      }
      await repository.transaction(`scope-job:${ref.jobId}`, async (repo) => {
        const task = await taskFor(repo, actor, ref.taskId, true);
        const job = await repo.get('scoping-job', ref.jobId, true);
        if (!job || job.status !== 'running') return;
        if (!(await ownsCapacity(repo, claim.capacity, now(), true))) return;
        delete job.snapshot;
        if (
          task.version !== claim.version ||
          task.scoping?.id !== job.id ||
          job.expiresAt <= now()
        ) {
          job.status = 'stale';
          await repo.save('scoping-job', job);
          return;
        }
        if (claim.contextReads?.length) {
          const current = context.resolveActor
            ? await context.resolveActor(actor.user.id)
            : actor;
          const membership = current?.memberships.find(
            (item) => item.id === task.tenantId,
          );
          for (const read of claim.contextReads) {
            const source = await repo.get('tool-source', read.sourceId, true);
            if (
              membership?.role !== 'owner' ||
              (membership.accessEpoch ?? null) !== read.accessEpoch ||
              !source ||
              source.status !== 'active' ||
              source.tenantId !== task.tenantId ||
              (source.accessEpoch || 0) !== read.sourceEpoch
            ) {
              error =
                'Source access changed while preparing this response. No reply was saved. Review context and try again.';
            }
          }
        }
        job.status = error ? 'failed' : 'completed';
        task.scoping = {
          id: job.id,
          status: job.status,
          version: task.version + 1,
          source: job.source,
          contextReads: error ? [] : job.contextReads || [],
          ...(error ? { error } : { proposal }),
        };
        if (!error) {
          // Only application commands can report that an agreement changed.
          const questions = proposal.questions.join('\n');
          const reply =
            proposal.intent === 'change'
              ? 'I’ve drafted the change below. Your agreed scope has not changed. Review the suggestion before confirming.' +
                (questions ? '\n\n' + questions : '')
              : proposal.intent === 'request' && questions
                ? questions
                : proposal.intent === 'request' && proposal.cadence !== 'once'
                  ? 'I’ve drafted a recurring plan below. It is not scheduled. Calendar rules, including shorter months, daylight-saving changes and missed runs, need review before activation.'
                  : proposal.reply;
          task.messages.push({
            id: randomUUID(),
            role: 'assistant',
            body: reply,
            authorName: 'Relay',
            source: job.source,
            createdAt: now(),
          });
        }
        touch(task, now());
        event(
          task,
          actor.user.id,
          error ? 'scoping.failed' : 'scoping.completed',
          now(),
        );
        await saveTask(repo, task);
        await repo.save('scoping-job', job);
      });
    } finally {
      await releaseCapacity(repository, claim.capacity);
    }
  }
  async function cancelScoping(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'jobId']);
    const jobId = text(body.jobId, 'Reply', 1, 100);
    return command(
      actor.user.id,
      key,
      ['cancel-scoping', id, body],
      (repo) => taskFor(repo, actor, id, true),
      async (repo) => {
        const task = await taskFor(repo, actor, id, true);
        expected(task, body.expectedVersion);
        if (task.scoping?.id !== jobId || task.scoping.status !== 'pending')
          fail(
            409,
            'REPLY_CHANGED',
            'This reply has changed. Refresh the conversation.',
          );
        const job = await repo.get('scoping-job', jobId, true);
        if (!job || !['pending', 'running'].includes(job.status))
          fail(409, 'REPLY_CHANGED', 'This reply has already finished.');
        job.status = 'cancelled';
        delete job.snapshot;
        await repo.save('scoping-job', job);
        touch(task, now());
        task.scoping = {
          id: jobId,
          version: task.version,
          status: 'cancelled',
          error:
            'Reply stopped. Your message is saved and your brief is unchanged.',
        };
        event(task, actor.user.id, 'scoping.cancelled', now());
        await saveTask(repo, task);
        return { taskId: id, version: task.version };
      },
      `scope-job:${jobId}`,
    );
  }
  async function confirmScope(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'proposalId']);
    return command(
      actor.user.id,
      key,
      ['confirm-scope', id, body],
      (repo) => taskFor(repo, actor, id, true),
      async (repo) => {
        const task = await taskFor(repo, actor, id, true);
        expected(task, body.expectedVersion);
        editable(task);
        const result = task.scoping;
        if (
          !result ||
          result.id !== body.proposalId ||
          result.status !== 'completed' ||
          result.version !== task.version
        ) {
          fail(
            409,
            'STALE_PROPOSAL',
            'This suggestion no longer matches the conversation. Ask Relay to review it again.',
          );
        }
        const proposal = validateProposal(result.proposal);
        if (['question', 'hypothetical'].includes(proposal.intent))
          fail(
            409,
            'NOT_A_SCOPE_CHANGE',
            'This was a question, not a scope change.',
          );
        if (proposal.cadence === 'once' && proposal.questions.length)
          fail(
            409,
            'SCOPING_INCOMPLETE',
            'Answer the missing questions or review the brief manually before confirming it.',
          );
        const agreedBrief = text(
          proposal.brief +
            (proposal.assumptions.length
              ? '\n\nAgreed assumptions:\n' +
                proposal.assumptions.map((item) => '- ' + item).join('\n')
              : ''),
          'Reviewed brief',
          1,
          10000,
        );
        const emptyPlan = (plan) =>
          !plan ||
          (plan.cadence === 'once' &&
            !plan.schedule &&
            !plan.timezone &&
            !plan.perRunBudget &&
            !plan.monthlyCap &&
            !plan.assumptions?.length);
        if (
          task.title === proposal.title &&
          task.brief === agreedBrief &&
          emptyPlan(task.workPlan) &&
          emptyPlan(proposal)
        ) {
          task.scoping = null;
          touch(task, now());
          event(task, actor.user.id, 'scope.reviewed', now());
          task.events.at(-1).proposalId = result.id;
          await saveTask(repo, task);
          return { taskId: id, version: task.version, unchanged: true };
        }
        task.title = proposal.title;
        task.brief = agreedBrief;
        task.workPlan = {
          cadence: proposal.cadence,
          schedule: proposal.schedule,
          timezone: proposal.timezone,
          perRunBudget: proposal.perRunBudget,
          monthlyCap: proposal.monthlyCap,
          assumptions: proposal.assumptions,
          openQuestions: proposal.questions,
          status: 'proposed_not_active',
        };
        task.scopeVersion++;
        task.scopes.push({
          version: task.scopeVersion,
          title: task.title,
          brief: task.brief,
          workPlan: task.workPlan,
          source: result.source,
          createdAt: now(),
          inputHash: task.input?.sha256 || null,
        });
        task.selectedOfferId = null;
        task.scoping = null;
        touch(task, now());
        event(task, actor.user.id, 'scope.updated', now());
        await saveTask(repo, task);
        return { taskId: id, version: task.version };
      },
    );
  }
  return {
    assist,
    confirmScope,
    cancelScoping,
    reconcileScoping,
    waitForScoping: () => Promise.allSettled([...pending]),
  };
}
module.exports = { createScoping };
