'use strict';
const { randomUUID } = require('node:crypto');
const { fail, exactKeys } = require('../../../packages/contracts/src/input.cjs');
const { saveTask } = require('./supplier-feed.cjs');
const { capabilityView } = require('./qualification.cjs');
const { validateCalendar, nextOccurrence, monthKey } = require('./calendar.cjs');

function createRecurring(context, execution) {
  const { repository, command, taskFor, expected, now, localExecution, resolveActor, touch, event } = context;
  function localOnly() {
    if (!localExecution || !resolveActor) fail(403, 'SCHEDULING_DISABLED', 'Scheduled execution requires the local identity authority.');
  }
  async function access(actor, schedule) {
    if (!schedule || actor.recoveryRequired) fail(404, 'NOT_FOUND', 'Schedule not found.');
    const current = await resolveActor(actor.user.id);
    const member = current.memberships.find(m => m.id === schedule.tenantId);
    if (!member || (schedule.ownerId !== actor.user.id && member.role !== 'owner')) fail(404, 'NOT_FOUND', 'Schedule not found.');
    if (!['owner', 'employee'].includes(member.role)) fail(403, 'FORBIDDEN', 'Your role cannot manage recurring work.');
    return current;
  }
  async function currentOwner(schedule) {
    const actor = await resolveActor(schedule.ownerId);
    const member = actor.memberships.find(m => m.id === schedule.tenantId);
    if (!member || !['owner', 'employee'].includes(member.role) || (member.accessEpoch ?? null) !== schedule.accessEpoch) fail(403, 'SCHEDULE_ACCESS_CHANGED', 'Owner access changed. Create a new schedule after reviewing permissions.');
    return actor;
  }
  async function create(actor, taskId, body, key) {
    localOnly();
    exactKeys(body, ['expectedVersion', 'calendar', 'perRunLimitMinor', 'monthlyLimitMinor', 'consent']);
    const calendar = validateCalendar(body.calendar);
    for (const value of [body.perRunLimitMinor, body.monthlyLimitMinor]) if (!Number.isSafeInteger(value) || value < 1 || value > 10000000) fail(400, 'INVALID_LIMIT', 'Use a positive quote limit, up to 100,000 USD.');
    if (body.monthlyLimitMinor < body.perRunLimitMinor || body.consent !== 'local-unpaid-recurring') fail(400, 'CONSENT_REQUIRED', 'Confirm unpaid recurring execution and a monthly limit at least as large as one run.');
    return command(actor.user.id, key, ['schedule', taskId, body], repo => taskFor(repo, actor, taskId, true), async repo => {
      const task = await taskFor(repo, actor, taskId, true);
      expected(task, body.expectedVersion);
      if (task.recurringScheduleId) fail(409, 'SCHEDULE_EXISTS', 'This request already has a schedule. Manage it in Scheduled work.');
      if (!task.workPlan || task.workPlan.cadence === 'once' || task.assignment) fail(409, 'RECURRING_REQUEST_REQUIRED', 'Start a recurring request and confirm its scope before enabling a schedule. Deliveries cannot be converted into recurring work.');
      if (task.workPlan.openQuestions?.length) fail(409, 'SCOPING_INCOMPLETE', 'Resolve the open questions before scheduling.');
      if (calendar.cadence !== task.workPlan.cadence) fail(409, 'CADENCE_CHANGED', 'The calendar must match the confirmed recurring request.');
      const offer = task.offers.find(o => o.id === task.selectedOfferId);
      if (task.status !== 'posted' || !offer || offer.scopeVersion !== task.scopeVersion || offer.expiresAt <= now() || !offer.runtimeBid) fail(409, 'OFFER_UNAVAILABLE', 'Select a current runtime offer for this recurring request.');
      if (offer.amountMinor > body.perRunLimitMinor) fail(400, 'INVALID_LIMIT', 'The run limit must cover the selected quote.');
      const agent = await repo.get('agent', offer.agentId);
      const capability = agent?.capabilities.find(c => c.id === offer.capabilityId);
      if (!capability || capabilityView(agent, capability, now()).qualification !== 'qualified') fail(409, 'QUALIFICATION_REQUIRED', 'The selected capability needs a current qualification.');
      const actorNow = await resolveActor(actor.user.id), member = actorNow.memberships.find(m => m.id === task.tenantId);
      const id = randomUUID();
      const schedule = { id, ownerId: actor.user.id, tenantId: task.tenantId, status: 'active', version: 1, createdAt: now(), updatedAt: now(),
        sourceTaskId: task.id, title: task.title, calendar, nextAt: nextOccurrence(calendar, now()),
        agentId: offer.agentId, agentName: offer.agentName, capabilityId: offer.capabilityId, accessEpoch: member.accessEpoch ?? null,
        perRunLimitMinor: body.perRunLimitMinor, monthlyLimitMinor: body.monthlyLimitMinor,
        context: { contextReferences: structuredClone(task.contextReferences || []), brief: task.brief, input: task.input ? structuredClone(task.input) : null, sourceScopeVersion: task.scopeVersion },
        companyApprovalRequired: !!member.company, runCount: 0, latestTaskId: null, reservedMinor: 0, month: monthKey(calendar, now()), history: [] };
      await repo.save('schedule', schedule);
      task.recurringScheduleId = id; task.status = 'scheduled'; task.workPlan.status = 'active'; touch(task, now()); event(task, actor.user.id, 'schedule.enabled', now()); await saveTask(repo, task);
      return { scheduleId: id };
    });
  }
  async function list(actor, tenantId) {
    localOnly();
    const current = await resolveActor(actor.user.id), member = current.memberships.find(m => m.id === tenantId);
    if (!member) fail(404, 'NOT_FOUND', 'Workspace not found.');
    return repository.read(async repo => {
      const schedules = await repo.list('schedule', 'tenant_id', tenantId);
      const result = [];
      for (const schedule of schedules.filter(s => s.ownerId === actor.user.id || member.role === 'owner')) {
        const runs = await repo.recent('scheduled-run', 'tenant_id', schedule.id, 20);
        const history = [];
        for (const run of runs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 20)) {
          const task = await repo.get('task', run.taskId);
          history.push({ ...run, status: task?.assignment?.status || (task?.status === 'cancelled' ? 'cancelled' : task?.selectedOfferId ? 'awaiting_start' : 'finding_offer') });
        }
        const { input, ...knowledge } = schedule.context;
        result.push({ ...schedule, context: { ...knowledge, contextReferences: (knowledge.contextReferences || []).map(({content,...ref}) => ref), input: input ? { filename: input.filename, notes: input.notes, sha256: input.sha256 } : null }, runs: history });
      }
      return { schedules: result };
    });
  }
  async function update(actor, id, body, key) {
    localOnly(); exactKeys(body, ['expectedVersion', 'action']);
    if (!['pause', 'resume'].includes(body.action)) fail(400, 'INVALID_ACTION', 'Choose pause or resume.');
    return command(actor.user.id, key, ['schedule-control', id, body], async repo => access(actor, await repo.get('schedule', id)), async repo => {
      const schedule = await repo.get('schedule', id, true); expected(schedule, body.expectedVersion);
      if (body.action === 'resume') await currentOwner(schedule);
      schedule.status = body.action === 'pause' ? 'paused' : 'active';
      schedule.reason = body.action === 'pause' ? 'Paused by a workspace member. Existing work can be reviewed or cancelled in its conversation.' : null;
      if (body.action === 'resume') {
        schedule.nextAt = nextOccurrence(schedule.calendar, now());
        const previous = schedule.latestTaskId ? await repo.get('task', schedule.latestTaskId, true) : null;
        if (previous && (!previous.assignment || ['failed', 'cancelled', 'accepted'].includes(previous.assignment.status))) {
          if (!previous.assignment && previous.status !== 'cancelled') {
            previous.status = 'cancelled'; previous.selectedOfferId = null;
            touch(previous, now()); event(previous, actor.user.id, 'schedule.pending_run_closed', now()); await saveTask(repo, previous);
          }
          schedule.latestTaskId = null;
        }
      }
      schedule.version++; schedule.updatedAt = now();
      schedule.history = [...schedule.history, { at: now(), actorId: actor.user.id, action: body.action }].slice(-100);
      await repo.save('schedule', schedule);
      return { scheduleId: id, status: schedule.status };
    }, `schedule:${id}`);
  }
  async function tick(after = '') {
    localOnly();
    const rows = await repository.read(repo => repo.page('schedule', 'status', 'active', { after, limit: 25 }));
    for (const row of rows) {
      await repository.transaction(`schedule:${row.id}`, async repo => {
        const schedule = await repo.get('schedule', row.id, true);
        if (schedule?.status !== 'active') return;
        const pause = async reason => { schedule.status = 'paused'; schedule.reason = reason; schedule.version++; schedule.updatedAt = now(); await repo.save('schedule', schedule); };
        let actor;
        try { actor = await currentOwner(schedule); }
        catch (error) { if (['SCHEDULE_ACCESS_CHANGED', 'OPERATOR_UNAVAILABLE'].includes(error.code)) return pause('Owner access changed. Review permissions and create a new schedule.'); throw error; }
        const task = schedule.latestTaskId ? await repo.get('task', schedule.latestTaskId, true) : null;
        if (task && !['accepted', 'cancelled', 'failed'].includes(task.assignment?.status)) {
          if (task.assignment) return; // One run at a time, including buyer review.
          if (task.status === 'cancelled') return pause('A scheduled request was cancelled.');
          if (now() - task.createdAt > 86400000) return pause('No authorized start within 24 hours. Review the latest run before resuming.');
          const agent = await repo.get('agent', schedule.agentId, true);
          const capability = agent?.capabilities.find(c => c.id === schedule.capabilityId);
          if (!capability || capabilityView(agent, capability, now()).qualification !== 'qualified') return pause('The selected capability needs renewed qualification.');
          if (!agent.credentialHash || agent.credentialExpiresAt <= now() || agent.connectedAt <= now() - 120000 || !agent.rules.automaticRequested) return;
          const offer = task.offers.find(o => o.agentId === schedule.agentId && o.capabilityId === schedule.capabilityId && o.scopeVersion === task.scopeVersion && o.expiresAt > now() && o.runtimeBid && o.amountMinor <= schedule.perRunLimitMinor);
          if (!offer) return;
          const month = monthKey(schedule.calendar, now());
          const reserved = schedule.month === month ? schedule.reservedMinor : 0;
          if (reserved + offer.amountMinor > schedule.monthlyLimitMinor) return pause('Monthly quote limit reached. No additional run was authorized.');
          if (task.selectedOfferId !== offer.id) {
            task.selectedOfferId = offer.id; touch(task, now()); event(task, 'system', 'schedule.offer_selected', now()); await saveTask(repo, task);
          }
          if (schedule.companyApprovalRequired && task.approval?.status !== 'approved') return;
          // Same execution authorization as an interactive buyer, inside this
          // transaction. Approval/input/runtime checks cannot be bypassed.
          try { await execution.authorizeWithin(repo, actor, task, 'local-unpaid'); }
          catch (error) {
            if (['APPROVAL_REQUIRED', 'APPROVAL_STALE', 'RUNTIME_REQUIRED'].includes(error.code)) return;
            throw error; // Roll back partial selection/authorization on other errors.
          }
          schedule.month = month; schedule.reservedMinor = reserved + offer.amountMinor;
          schedule.version++; schedule.updatedAt = now();
          await repo.save('schedule', schedule);
          return;
        }
        if (task && ['failed', 'cancelled'].includes(task.assignment?.status)) return pause('The latest run needs attention. Review it before resuming.');
        if (schedule.nextAt > now()) return;
        // Skip missed slots after downtime; never create a catch-up burst.
        if (now() - schedule.nextAt > 3600000) {
          schedule.nextAt = nextOccurrence(schedule.calendar, now()); schedule.version++;
          schedule.history = [...schedule.history, { at: now(), action: 'missed_slot_skipped' }].slice(-100);
          await repo.save('schedule', schedule); return;
        }
        const id = randomUUID(), runId = `${schedule.id}:${schedule.nextAt}`;
        const input = schedule.context.input ? structuredClone(schedule.context.input) : null;
        if (input) {
          const artifact = await repo.get('artifact', input.artifactId);
          if (!artifact || artifact.sha256 !== input.sha256) return pause('Saved input is unavailable. Create a new trial with a valid file.');
          try {
            await context.storageAdmission(repo, schedule.tenantId, artifact.size);
          } catch (error) {
            if (error.code !== 'WORKSPACE_STORAGE_LIMIT') throw error;
            return pause('Workspace storage is full. Review storage capacity before resuming.');
          }
          input.artifactId = randomUUID();
          await repo.save('artifact', { ...artifact, id: input.artifactId, taskId: id });
        }
        const created = { id, ownerId: schedule.ownerId, tenantId: schedule.tenantId, title: schedule.title, brief: schedule.context.brief,
          contextReferences: structuredClone(schedule.context.contextReferences || []), status: 'posted', version: 1, scopeVersion: 1, companyApprovalRequired: schedule.companyApprovalRequired, createdAt: now(), updatedAt: now(), input,
          scheduleId: schedule.id, scheduledFor: schedule.nextAt, messages: [], scopes: [{ version: 1, title: schedule.title, brief: schedule.context.brief, createdAt: now() }],
          events: [], offers: [], selectedOfferId: null, assignment: null, submissions: [], preferredAgentId: schedule.agentId };
        event(created, schedule.ownerId, 'schedule.run_created', now()); await saveTask(repo, created);
        await repo.save('scheduled-run', { id: runId, ownerId: schedule.ownerId, tenantId: schedule.id, taskId: id, scheduledFor: schedule.nextAt, createdAt: now() });
        schedule.latestTaskId = id; schedule.runCount++; schedule.nextAt = nextOccurrence(schedule.calendar, now()); schedule.version++;
        await repo.save('schedule', schedule);
      }).catch(async error => {
        if (!error.code || !Number.isInteger(error.status) || error.status >= 500) throw error;
        await repository.transaction(`schedule:${row.id}`, async repo => {
          const schedule = await repo.get('schedule', row.id, true);
          if (schedule?.status !== 'active') return;
          schedule.status = 'paused'; schedule.version++;
          schedule.reason = `A run check needs attention (${error.code}). Review the latest task before resuming.`;
          await repo.save('schedule', schedule);
        });
      });
    }
    return { next: rows.length === 25 ? rows.at(-1).id : '' };
  }
  return { createSchedule: create, listSchedules: list, updateSchedule: update, reconcileSchedules: tick };
}
module.exports = { createRecurring };
