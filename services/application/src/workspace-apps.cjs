'use strict';
const {
  pauseForPermission,
  resumeAfterPermission,
} = require('./permission-wait.cjs');

const { randomUUID, timingSafeEqual } = require('node:crypto');
const {
  fail,
  text,
  exactKeys,
} = require('../../../packages/contracts/src/input.cjs');
const { validateCalendar, nextOccurrence } = require('./calendar.cjs');
const { normalizeCsv } = require('../../agent-runtime/src/csv.cjs');
const { saveTask } = require('./supplier-feed.cjs');
const { inventory } = require('../../link-runtime/src/inventory.cjs');

const {
  parsePackage,
  runPackage,
} = require('../../app-runtime/src/data-app.cjs');

const RECIPES = Object.freeze({
  'csv-normalize-v1': { title: 'Clean CSV data', filename: 'clean.csv' },
  'link-inventory-v1': { title: 'Organize links', filename: 'links.json' },
  'builder-data-app-v1': { title: 'Custom data app', filename: 'result.json' },
});

// Only reviewed, bounded operations run here. No eval, uploaded code, URLs,
// OAuth secrets, filesystem paths or arbitrary network operations are accepted.
function createWorkspaceApps(context) {
  const {
    repository,
    command,
    now,
    resolveActor,
    localExecution,
    expected,
    taskFor,
    hash,
  } = context;
  const record = (actor, tenantId, fields) => ({
    id: randomUUID(),
    ownerId: actor.user.id,
    tenantId,
    version: 1,
    createdAt: now(),
    status: 'active',
    ...fields,
  });
  function enabled() {
    if (!localExecution || !resolveActor)
      fail(
        403,
        'APPS_DISABLED',
        'Workspace apps are available only on localhost.',
      );
  }
  async function member(actor, tenantId, write = false) {
    enabled();
    if (!actor?.user?.id || actor.recoveryRequired)
      fail(403, 'FORBIDDEN', 'An active account is required.');
    const current = await resolveActor(actor.user.id);
    const membership = current?.memberships.find((m) => m.id === tenantId);
    if (!membership) fail(404, 'NOT_FOUND', 'Workspace not found.');
    if (write && membership.role !== 'owner')
      fail(
        403,
        'ADMIN_REQUIRED',
        'Only the workspace owner can install apps or grant tool access.',
      );
    return membership;
  }
  async function owned(repo, actor, kind, id, write = false) {
    const item = await repo.get(kind, id, true);
    if (!item) fail(404, 'NOT_FOUND', 'Item not found.');
    const membership = await member(actor, item.tenantId, true);
    if (item.ownerId !== actor.user.id && membership.role !== 'owner')
      fail(404, 'NOT_FOUND', 'Item not found.');
    return item;
  }
  async function audit(repo, item, action, details = {}) {
    await repo.save(
      'tool-audit',
      record({ user: { id: item.ownerId } }, item.tenantId, {
        id: `${String(now()).padStart(16, '0')}:${randomUUID()}`,
        action,
        subjectId: item.id,
        ...details,
      }),
    );
  }
  async function source(repo, actor, id) {
    const item = await owned(repo, actor, 'tool-source', id);
    if (item.status !== 'active')
      fail(409, 'SOURCE_DISABLED', 'This local source is disconnected.');
    return item;
  }
  async function checkGrant(repo, grant, subject) {
    if (
      !grant ||
      grant.status !== 'active' ||
      grant.expiresAt <= now() ||
      grant.subjectId !== subject.id ||
      grant.tenantId !== subject.tenantId
    )
      fail(
        403,
        'GRANT_REQUIRED',
        'Tool permission is missing, revoked or expired.',
      );
    const actor = await resolveActor(grant.ownerId);
    const membership = actor?.memberships.find((m) => m.id === grant.tenantId);
    if (
      !membership ||
      membership.role !== 'owner' ||
      (membership.accessEpoch ?? null) !== grant.accessEpoch
    )
      fail(
        403,
        'GRANT_STALE',
        'The person who granted access no longer has the same workspace authority.',
      );
    const input = await source(repo, actor, grant.sourceId);
    if ((input.accessEpoch || 0) !== (grant.sourceEpoch || 0))
      fail(
        403,
        'GRANT_STALE',
        'The source was disconnected. Grant access again before use.',
      );
    return input;
  }
  async function allGrants(repo, tenantId) {
    let after = '',
      records = [];
    for (;;) {
      const rows = await repo.page('tool-grant', 'tenant_id', tenantId, {
        after,
        limit: 100,
      });
      records.push(...rows);
      if (rows.length < 100) return records;
      after = rows.at(-1).id;
    }
  }
  async function hostingEntitlement(repo, tenantId) {
    const subscription = await repo.get('workspace-subscription', tenantId);
    const active = subscription?.status === 'active' && ['pro', 'business'].includes(subscription.plan);
    return {
      plan: subscription?.plan || 'free',
      status: subscription?.status || 'none',
      canHost: active,
      includedHosts: subscription?.plan === 'business' ? 10 : active ? 2 : 0,
      provider: subscription?.provider || null,
    };
  }
  async function view(actor, tenantId) {
    const access = await member(actor, tenantId);
    if (access.role !== 'owner')
      return {
        sources: [],
        apps: [],
        grants: [],
        runs: [],
        audit: [],
        recipes: RECIPES,
        hosting: { entitlement: { plan: 'free', status: 'none', canHost: false, includedHosts: 0, provider: null }, hosts: [] },
      };
    return repository.read(async (repo) => {
      const visible = (rows) =>
        rows.filter((row) => row.ownerId === actor.user.id);
      // Company app management is currently owner-only. Employees do not gain
      // access to connected data merely by belonging to the same workspace.
      const sources = visible(
        await repo.list('tool-source', 'tenant_id', tenantId),
      );
      const apps = visible(
        await repo.list('workspace-app', 'tenant_id', tenantId),
      );
      const grants = visible(await allGrants(repo, tenantId));
      const runs = (
        await repo.recent('app-run', 'tenant_id', tenantId, 30)
      ).filter((run) => run.requestedBy === actor.user.id);
      for (const app of apps) {
        if (
          app.latestRunId &&
          !runs.some((run) => run.id === app.latestRunId)
        ) {
          const latest = await repo.get('app-run', app.latestRunId);
          if (latest) runs.push(latest);
        }
      }
      const auditLog = visible(
        await repo.recent('tool-audit', 'tenant_id', tenantId, 50),
      );
      const entitlement = await hostingEntitlement(repo, tenantId);
      const hosts = visible(await repo.list('app-host', 'tenant_id', tenantId))
        .filter(host => host.status !== 'deleted')
        .map(host => ({
          ...host,
          status: !entitlement.canHost && host.status === 'running' ? 'subscription_hold' : host.status,
          subscriptionActive: entitlement.canHost,
        }));
      return { sources, apps, grants, runs, audit: auditLog, recipes: RECIPES, hosting: { entitlement, hosts } };
    });
  }
  async function saveSource(actor, body, key) {
    exactKeys(body, [
      'tenantId',
      'id',
      'expectedVersion',
      'name',
      'content',
      'action',
    ]);
    const name = text(body.name, 'Source name', 1, 80),
      content = text(body.content, 'Source content', 1, 16000);
    if (body.action && !['save', 'disconnect'].includes(body.action))
      fail(400, 'INVALID_ACTION', 'Choose save or disconnect.');
    return command(
      actor.user.id,
      key,
      ['source', body],
      () => member(actor, body.tenantId, true),
      async (repo) => {
        if (
          !body.id &&
          (await repo.list('tool-source', 'tenant_id', body.tenantId)).length >=
            100
        )
          fail(
            409,
            'SOURCE_LIMIT',
            'This local workspace supports up to 100 sources.',
          );
        const item = body.id
          ? await owned(repo, actor, 'tool-source', body.id, true)
          : record(actor, body.tenantId, {});
        if (item.tenantId !== body.tenantId)
          fail(404, 'NOT_FOUND', 'Source not found.');
        if (body.id) expected(item, body.expectedVersion);
        if (
          item.provenance?.provider === 'google-drive' &&
          body.action !== 'disconnect'
        )
          fail(
            409,
            'SNAPSHOT_IMMUTABLE',
            'Import the file again to create a new Drive snapshot.',
          );
        if (body.action === 'disconnect')
          item.accessEpoch = (item.accessEpoch || 0) + 1;
        Object.assign(item, {
          name,
          content,
          status: body.action === 'disconnect' ? 'disconnected' : 'active',
          updatedAt: now(),
          version: body.id ? item.version + 1 : 1,
        });
        await repo.save('tool-source', item);
        await audit(
          repo,
          item,
          body.action === 'disconnect' ? 'source.disconnected' : 'source.saved',
          { sourceVersion: item.version },
        );
        return { sourceId: item.id };
      },
      `tools:${body.tenantId}`,
    );
  }
  async function install(actor, taskId, body, key) {
    exactKeys(body, [
      'expectedVersion',
      'sourceId',
      'expiresDays',
      'consent',
      'requestId',
    ]);
    if (
      body.consent !== 'local-source-read' ||
      !Number.isInteger(body.expiresDays) ||
      body.expiresDays < 1 ||
      body.expiresDays > 30
    )
      fail(400, 'CONSENT_REQUIRED', 'Approve read access for 1–30 days.');
    return command(
      actor.user.id,
      key,
      ['install', taskId, body],
      async (repo) => {
        const task = await taskFor(repo, actor, taskId, true);
        await member(actor, task.tenantId, true);
      },
      async (repo) => {
        const task = await taskFor(repo, actor, taskId, true);
        expected(task, body.expectedVersion);
        const membership = await member(actor, task.tenantId, true);
        if (
          task.assignment?.status !== 'accepted' ||
          task.assignment.mode !== 'local-unpaid'
        )
          fail(
            409,
            'TRIAL_REQUIRED',
            'Accept an unpaid local delivery before installing an app.',
          );
        const offer = task.offers.find((o) => o.id === task.assignment.offerId);
        let recipe = offer?.qualificationEvidence?.rubric;
        let appPackage = null,
          packageHash = null;
        const submission = task.submissions?.at(-1);
        const packageFiles =
          submission?.files.filter(
            (file) => file.filename === 'relay-app.json',
          ) || [];
        if (packageFiles.length) {
          if (submission.status !== 'accepted' || packageFiles.length !== 1)
            fail(
              409,
              'APP_INVALID',
              'Accept the exact app delivery before installing.',
            );
          const file = packageFiles[0];
          const artifact = await repo.get('artifact', file.id, true);
          if (
            !artifact ||
            artifact.taskId !== task.id ||
            artifact.submissionId !== submission.id ||
            artifact.filename !== file.filename ||
            artifact.mime !== 'application/json' ||
            artifact.scan?.status !== 'clean'
          )
            fail(
              409,
              'APP_QUARANTINED',
              'The app package must pass file scanning before installation.',
            );
          let bytes;
          try {
            bytes = artifact.objectKey
              ? context.objectStore.read(artifact.objectKey)
              : Buffer.from(artifact.base64, 'base64');
          } catch {
            fail(409, 'FILE_UNAVAILABLE', 'App package bytes are unavailable.');
          }
          if (bytes.length !== file.size || hash(bytes) !== file.sha256)
            fail(
              409,
              'FILE_UNAVAILABLE',
              'App package integrity check failed.',
            );
          appPackage = parsePackage(bytes);
          packageHash = file.sha256;
          recipe = 'builder-data-app-v1';
        }
        if (!appPackage && task.assignment.revisionNotes)
          fail(
            409,
            'TRIAL_REQUIRED',
            'Revised deliveries need an explicit app package to install.',
          );
        if (
          !RECIPES[recipe] ||
          (recipe === 'builder-data-app-v1' && !appPackage)
        )
          fail(
            409,
            'RECIPE_UNSUPPORTED',
            'This delivery cannot be installed as a supported local automation.',
          );
        let input = await source(repo, actor, body.sourceId);
        if (input.tenantId !== task.tenantId)
          fail(403, 'SOURCE_SCOPE', 'Choose a source from this workspace.');
        const existing = await repo.list(
          'workspace-app',
          'tenant_id',
          task.tenantId,
        );
        if (existing.length >= 100)
          fail(
            409,
            'APP_LIMIT',
            'This local workspace supports up to 100 installed apps.',
          );
        if (existing.some((app) => app.sourceTaskId === taskId))
          fail(
            409,
            'ALREADY_INSTALLED',
            'This delivery is already installed. Open Apps.',
          );
        const app = record(actor, task.tenantId, {
          title: appPackage?.name || task.title,
          recipe,
          recipeVersion: 1,
          ...(appPackage
            ? { appPackage, packageHash, submissionId: submission.id }
            : {}),
          sourceTaskId: taskId,
          agentId: offer.agentId,
          agentName: offer.agentName,
          sourceId: input.id,
          calendar: null,
          nextAt: null,
        });
        const grant = record(actor, task.tenantId, {
          subjectKind: 'app',
          subjectId: app.id,
          sourceId: input.id,
          sourceEpoch: input.accessEpoch || 0,
          operation: 'read',
          accessEpoch: membership.accessEpoch ?? null,
          expiresAt: now() + body.expiresDays * 86400000,
        });
        app.grantId = grant.id;
        await repo.save('tool-grant', grant);
        await repo.save('workspace-app', app);
        await audit(repo, app, 'app.installed', {
          grantId: grant.id,
          sourceId: input.id,
          recipe,
          ...(appPackage ? { packageHash, submissionId: submission.id } : {}),
        });
        return { appId: app.id };
      },
      `install:${taskId}`,
    );
  }
  // Reserve the provider's maximum document payload before I/O. Failed reads
  // retain reservations; this bounds retries without trusting stale file sizes.
  async function reserveContext(
    repo,
    task,
    input,
    runId = 'draft',
    snapshot = false,
  ) {
    const bytes =
      !snapshot && input.provenance?.mode === 'live-file'
        ? 16000
        : Buffer.byteLength(input.content || '', 'utf8');
    const limit = runId === 'draft' ? 160000 : 1024000;
    const usage =
      task.contextBudget?.runId === runId
        ? task.contextBudget
        : { runId, reservedBytes: 0 };
    if (usage.reservedBytes + bytes > limit)
      fail(
        429,
        'CONTEXT_DATA_LIMIT',
        'This task reached its supporting-data allowance. Start a new request with fewer sources, or agree a new execution scope before trying again. Existing saved results remain available.',
      );
    task.contextBudget = { runId, reservedBytes: usage.reservedBytes + bytes };
    await repo.save('task', task);
  }
  async function admitSource(repo, input, grant = null) {
    if (input.provenance?.mode !== 'live-file') return null;
    await context.driveBudget(repo, input.tenantId, now());
    return {
      sourceId: input.id,
      sourceVersion: input.version,
      grantVersion: grant?.version,
    };
  }
  function requireSourceAdmission(input, admission) {
    if (
      input.provenance?.mode === 'live-file' &&
      (!admission ||
        admission.sourceId !== input.id ||
        admission.sourceVersion !== input.version)
    )
      fail(
        409,
        'SOURCE_CHANGED',
        'The source changed. Retry to use the current version.',
      );
  }
  async function attachContext(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'sourceId', 'mode', 'remove']);
    if (body.remove !== undefined && typeof body.remove !== 'boolean')
      fail(400, 'INVALID_CONTEXT', 'Remove must be a boolean.');
    if (!['latest', 'snapshot'].includes(body.mode))
      fail(400, 'INVALID_CONTEXT', 'Choose latest data or a saved version.');
    return command(
      actor.user.id,
      key,
      ['task-context', taskId, body],
      (repo) => taskFor(repo, actor, taskId, true),
      async (repo, admission) => {
        const task = await taskFor(repo, actor, taskId, true);
        expected(task, body.expectedVersion);
        if (
          task.status !== 'draft' ||
          task.assignment ||
          task.scheduleId ||
          task.recurringScheduleId
        )
          fail(
            409,
            'SCOPE_LOCKED',
            'Choose supporting context while reviewing the draft, before requesting offers.',
          );
        let input = await source(repo, actor, body.sourceId);
        if (input.tenantId !== task.tenantId)
          fail(403, 'SOURCE_SCOPE', 'Choose a source from this workspace.');
        if (body.mode === 'snapshot' && !body.remove) {
          requireSourceAdmission(input, admission);
          input = await context.refreshSourceWithin(repo, input);
        }
        const refs = (task.contextReferences || []).filter(
          (ref) => ref.sourceId !== input.id,
        );
        if (!body.remove)
          refs.push({
            sourceId: input.id,
            name: input.name,
            mode: body.mode,
            version: input.version,
            ...(input.provenance ? { provenance: input.provenance } : {}),
            ...(body.mode === 'snapshot' ? { content: input.content } : {}),
          });
        if (refs.length > 10)
          fail(400, 'CONTEXT_LIMIT', 'Choose up to ten supporting sources.');
        task.contextReferences = refs;
        task.scopeVersion++;
        task.version++;
        task.updatedAt = now();
        task.scoping = null;
        task.scopes.push({
          version: task.scopeVersion,
          title: task.title,
          brief: task.brief,
          createdAt: now(),
          contextReferences: refs.map(({ content, ...ref }) => ref),
        });
        context.event(task, actor.user.id, 'context.updated', now());
        await saveTask(repo, task);
        await audit(repo, task, 'context.updated');
        return { taskId, version: task.version };
      },
      `task:${taskId}`,
      body.mode === 'snapshot' && !body.remove
        ? async (repo) => {
            const task = await taskFor(repo, actor, taskId, true);
            expected(task, body.expectedVersion);
            if (
              task.status !== 'draft' ||
              task.assignment ||
              task.scheduleId ||
              task.recurringScheduleId
            )
              fail(
                409,
                'SCOPE_LOCKED',
                'Choose context before requesting offers.',
              );
            const input = await source(repo, actor, body.sourceId);
            if (input.tenantId !== task.tenantId)
              fail(403, 'SOURCE_SCOPE', 'Choose a source from this workspace.');
            if (
              (task.contextReferences || []).filter(
                (ref) => ref.sourceId !== input.id,
              ).length >= 10
            )
              fail(
                400,
                'CONTEXT_LIMIT',
                'Choose up to ten supporting sources.',
              );
            await reserveContext(repo, task, input);
            return admitSource(repo, input);
          }
        : null,
    );
  }
  async function requestPermission(principal, taskId, body, key) {
    exactKeys(body, ['sourceId', 'operation', 'reason']);
    if (body.operation !== 'read')
      fail(
        400,
        'OPERATION_UNSUPPORTED',
        'Only read access to selected local sources is supported. External writes and sends cannot be authorized here.',
      );
    const reason = text(body.reason, 'Purpose of access', 10, 1000);
    const authorize = async (repo) => {
      enabled();
      await context.credentials.runtimeAgent(
        repo,
        principal,
        'execution:write',
      );
      const task = await repo.get('task', taskId, true);
      if (
        !task?.assignment ||
        task.assignment.agentId !== principal.agentId ||
        task.assignment.operatorId !== principal.actor.user.id
      )
        fail(404, 'NOT_FOUND', 'Assignment not found.');
      if (!['queued', 'running'].includes(task.assignment.status))
        fail(409, 'TASK_CLOSED', 'This assignment is no longer active.');
      const owner = await resolveActor(task.ownerId);
      await taskFor(repo, owner, taskId, true);
      if (
        !task.contextReferences?.some((ref) => ref.sourceId === body.sourceId)
      )
        fail(
          403,
          'CONTEXT_REQUIRED',
          'Request access only to a source the user selected for this task.',
        );
      return task;
    };
    return command(
      principal.actor.user.id,
      key,
      ['permission-request', taskId, body],
      authorize,
      async (repo) => {
        const task = await authorize(repo);
        task.permissionRequests ||= [];
        const existing = task.permissionRequests.find(
          (item) =>
            item.sourceId === body.sourceId &&
            item.assignmentId === task.assignment.id &&
            ['pending', 'declined'].includes(item.status),
        );
        if (existing)
          return { requestId: existing.id, status: existing.status };
        if (task.permissionRequests.length >= 20)
          fail(409, 'REQUEST_LIMIT', 'Permission request limit reached.');
        const request = {
          id: randomUUID(),
          sourceId: body.sourceId,
          operation: 'read',
          reason,
          agentId: principal.agentId,
          assignmentId: task.assignment.id,
          scopeVersion: task.scopeVersion,
          status: 'pending',
          createdAt: now(),
        };
        task.permissionRequests.push(request);
        pauseForPermission(task, now());
        task.version++;
        task.updatedAt = now();
        context.event(
          task,
          principal.actor.user.id,
          'permission.requested',
          now(),
        );
        await saveTask(repo, task);
        await audit(repo, task, 'permission.requested', {
          requestId: request.id,
        });
        return { requestId: request.id, status: 'pending' };
      },
      `task:${taskId}`,
    );
  }
  async function declinePermission(actor, taskId, body, key) {
    exactKeys(body, ['expectedVersion', 'requestId']);
    return command(
      actor.user.id,
      key,
      ['permission-decline', taskId, body],
      (repo) => taskFor(repo, actor, taskId, true),
      async (repo) => {
        const task = await taskFor(repo, actor, taskId, true);
        expected(task, body.expectedVersion);
        await member(actor, task.tenantId, true);
        const request = task.permissionRequests?.find(
          (item) => item.id === body.requestId,
        );
        if (
          !request ||
          request.status !== 'pending' ||
          request.assignmentId !== task.assignment?.id ||
          !['queued', 'running'].includes(task.assignment.status)
        )
          fail(409, 'REQUEST_STALE', 'This request is no longer pending.');
        request.status = 'declined';
        request.decidedAt = now();
        task.version++;
        task.updatedAt = now();
        context.event(task, actor.user.id, 'permission.declined', now());
        await saveTask(repo, task);
        await audit(repo, task, 'permission.declined', {
          requestId: request.id,
        });
        return { requestId: request.id, status: request.status };
      },
      `task:${taskId}`,
    );
  }
  async function grantTask(actor, taskId, body, key) {
    exactKeys(body, [
      'expectedVersion',
      'sourceId',
      'expiresDays',
      'consent',
      'requestId',
    ]);
    if (
      body.consent !== 'local-source-read' ||
      !Number.isInteger(body.expiresDays) ||
      body.expiresDays < 1 ||
      body.expiresDays > 30
    )
      fail(400, 'CONSENT_REQUIRED', 'Approve read access for 1–30 days.');
    const prepareGrant = async (repo) => {
      const task = await taskFor(repo, actor, taskId, true);
      expected(task, body.expectedVersion);
      if (
        !task.assignment ||
        !['queued', 'running'].includes(task.assignment.status)
      )
        fail(
          409,
          'ASSIGNMENT_REQUIRED',
          'Tool access can only be granted to an authorized active assignment.',
        );
      const membership = await member(actor, task.tenantId, true),
        input = await source(repo, actor, body.sourceId);
      if (input.tenantId !== task.tenantId)
        fail(403, 'SOURCE_SCOPE', 'Choose a source from this workspace.');
      const requester = await resolveActor(task.ownerId);
      const requesterMember = requester?.memberships.find(
        (m) => m.id === task.tenantId,
      );
      if (
        !requesterMember ||
        !['owner', 'employee'].includes(requesterMember.role)
      )
        fail(
          403,
          'TASK_ACCESS_CHANGED',
          'The task requester no longer has execution access.',
        );
      const request = body.requestId
        ? task.permissionRequests?.find((item) => item.id === body.requestId)
        : task.permissionRequests?.find(
            (item) =>
              ['pending', 'declined'].includes(item.status) &&
              item.sourceId === input.id &&
              item.assignmentId === task.assignment.id &&
              item.scopeVersion === task.scopeVersion,
          );
      if (
        body.requestId &&
        (!request ||
          !['pending', 'declined'].includes(request.status) ||
          request.sourceId !== input.id ||
          request.assignmentId !== task.assignment.id ||
          request.scopeVersion !== task.scopeVersion)
      )
        fail(409, 'REQUEST_STALE', 'Review the current permission request.');
      const reference = task.contextReferences?.find(
        (ref) => ref.sourceId === input.id,
      );
      return { task, membership, input, requesterMember, request, reference };
    };
    return command(
      actor.user.id,
      key,
      ['task-tool-grant', taskId, body],
      async (repo) => {
        const task = await taskFor(repo, actor, taskId, true);
        await member(actor, task.tenantId, true);
      },
      async (repo, admission) => {
        const { task, membership, input, requesterMember, request, reference } =
          await prepareGrant(repo);
        if (reference?.mode !== 'snapshot') {
          requireSourceAdmission(input, admission);
          await context.refreshSourceWithin(repo, input);
        }
        const grant = record(actor, task.tenantId, {
          ...(reference?.mode === 'snapshot'
            ? {
                snapshot: {
                  content: reference.content,
                  version: reference.version,
                },
              }
            : {}),
          requesterEpoch: requesterMember.accessEpoch ?? null,
          subjectKind: 'task',
          subjectId: task.id,
          sourceId: input.id,
          sourceEpoch: input.accessEpoch || 0,
          operation: 'read',
          agentId: task.assignment.agentId,
          assignmentId: task.assignment.id,
          scopeVersion: task.scopeVersion,
          accessEpoch: membership.accessEpoch ?? null,
          expiresAt: now() + body.expiresDays * 86400000,
        });
        for (const previous of await allGrants(repo, task.tenantId)) {
          if (
            previous.status === 'active' &&
            previous.subjectKind === 'task' &&
            previous.subjectId === task.id &&
            previous.assignmentId === task.assignment.id &&
            previous.sourceId === input.id
          ) {
            previous.status = 'revoked';
            previous.version++;
            await repo.save('tool-grant', previous);
            await audit(repo, previous, 'grant.replaced');
          }
        }
        await repo.save('tool-grant', grant);
        await audit(repo, grant, 'grant.created');
        if (request) {
          request.status = 'approved';
          request.grantId = grant.id;
          request.decidedAt = now();
          resumeAfterPermission(task, now());
          task.version++;
          task.updatedAt = now();
          context.event(task, actor.user.id, 'permission.approved', now());
          await saveTask(repo, task);
          await audit(repo, task, 'permission.approved', {
            requestId: request.id,
            grantId: grant.id,
          });
        }
        return { grantId: grant.id };
      },
      `task:${taskId}`,
      async (repo) => {
        const { task, input, reference } = await prepareGrant(repo);
        if (reference?.mode === 'snapshot') return null;
        await reserveContext(repo, task, input, task.assignment.id);
        return admitSource(repo, input);
      },
    );
  }
  async function revoke(actor, id, body, key) {
    exactKeys(body, ['expectedVersion']);
    return command(
      actor.user.id,
      key,
      ['revoke-tool', id, body],
      (repo) => owned(repo, actor, 'tool-grant', id, true),
      async (repo) => {
        const grant = await owned(repo, actor, 'tool-grant', id, true);
        expected(grant, body.expectedVersion);
        grant.status = 'revoked';
        grant.version++;
        await repo.save('tool-grant', grant);
        await audit(repo, grant, 'grant.revoked');
        return { grantId: id };
      },
      `grant:${id}`,
    );
  }
  async function readForAgent(principal, taskId, body, key) {
    exactKeys(body, ['grantId', 'leaseToken']);
    const authorize = async (repo) => {
      enabled();
      await context.credentials.runtimeAgent(
        repo,
        principal,
        'execution:write',
      );
      const task = await repo.get('task', taskId, true),
        assignment = task?.assignment;
      if (
        !assignment ||
        assignment.agentId !== principal.agentId ||
        assignment.operatorId !== principal.actor.user.id
      )
        fail(404, 'NOT_FOUND', 'Assignment not found.');
      if (
        assignment.status !== 'running' ||
        assignment.leaseUntil <= now() ||
        typeof body.leaseToken !== 'string' ||
        body.leaseToken.length !== 43 ||
        !assignment.leaseHash ||
        !timingSafeEqual(
          Buffer.from(hash(body.leaseToken)),
          Buffer.from(assignment.leaseHash),
        )
      )
        fail(
          409,
          'LEASE_EXPIRED',
          'Claim the current assignment before using tools.',
        );
      const grant = await repo.get('tool-grant', body.grantId, true);
      if (
        grant?.subjectKind !== 'task' ||
        grant.assignmentId !== assignment.id ||
        grant.agentId !== principal.agentId ||
        grant.scopeVersion !== task.scopeVersion
      )
        fail(
          403,
          'GRANT_REQUIRED',
          'Permission does not cover this assignment.',
        );
      const requester = await resolveActor(task.ownerId);
      const requesterMember = requester?.memberships.find(
        (m) => m.id === task.tenantId,
      );
      if (
        !requesterMember ||
        !['owner', 'employee'].includes(requesterMember.role) ||
        (requesterMember.accessEpoch ?? null) !== grant.requesterEpoch
      )
        fail(
          403,
          'TASK_ACCESS_CHANGED',
          'The task requester’s access changed. Review permissions again.',
        );
      const input = await checkGrant(repo, grant, task);
      return {
        task,
        input: grant.snapshot ? { ...input, ...grant.snapshot } : input,
        grant,
      };
    };
    // Commit admission before provider I/O so failed attempts also consume the
    // shared allowance. Never open a nested transaction while holding task locks.
    const admission = await repository.transaction(
      `task:${taskId}`,
      async (repo) => {
        const { task, input, grant } = await authorize(repo);
        await reserveContext(
          repo,
          task,
          input,
          task.assignment.id,
          Boolean(grant.snapshot),
        );
        if (grant.snapshot || input.provenance?.mode !== 'live-file')
          return null;
        await context.driveBudget(repo, task.tenantId, now());
        return {
          sourceId: input.id,
          version: input.version,
          grantVersion: grant.version,
        };
      },
    );
    // Replays recheck live permission. Tool contents are not cached in receipts.
    return repository.transaction(`task:${taskId}`, async (repo) => {
      let { task, input, grant } = await authorize(repo);
      if (!grant.snapshot) {
        if (
          input.provenance?.mode === 'live-file' &&
          (!admission ||
            admission.sourceId !== input.id ||
            admission.version !== input.version ||
            admission.grantVersion !== grant.version)
        )
          fail(
            409,
            'SOURCE_CHANGED',
            'The source or permission changed. Retry the read.',
          );
        input = await context.refreshSourceWithin(repo, input);
      }
      // A slow read may outlive a lease or grant. Recheck before releasing bytes.
      await authorize(repo);
      task.contextReads ||= [];
      if (
        !task.contextReads.some(
          (read) =>
            read.sourceId === input.id &&
            read.version === input.version &&
            read.assignmentId === task.assignment.id,
        )
      ) {
        if (task.contextReads.length >= 100)
          fail(
            409,
            'READ_HISTORY_LIMIT',
            'This task reached its source history limit.',
          );
        task.contextReads.push({
          sourceId: input.id,
          name: input.name,
          version: input.version,
          assignmentId: task.assignment.id,
          contentHash: hash(input.content),
          readAt: now(),
          mode: grant.snapshot ? 'snapshot' : input.provenance?.mode || 'local',
        });
        task.version++;
        task.updatedAt = now();
        context.event(
          task,
          principal.actor.user.id,
          'context.source_read',
          now(),
        );
        await saveTask(repo, task);
      }
      await audit(repo, grant, 'tool.read', {
        agentId: principal.agentId,
        taskId,
        sourceVersion: input.version,
      });
      return {
        sourceId: input.id,
        version: input.version,
        content: input.content,
        untrusted: true,
      };
    });
  }
  async function execute(repo, app, slot, admission = null) {
    if (app.status !== 'active')
      fail(409, 'APP_PAUSED', 'Resume this app before running it.');
    const pending = app.latestRunId
      ? await repo.get('app-run', app.latestRunId)
      : null;
    if (pending?.status === 'needs_review')
      fail(
        409,
        'RUN_NEEDS_REVIEW',
        'Review or discard the previous result before another run.',
      );
    const grant = await repo.get('tool-grant', app.grantId, true);
    let input = await checkGrant(repo, grant, app);
    if (
      input.provenance?.mode === 'live-file' &&
      (!admission ||
        admission.sourceId !== input.id ||
        admission.sourceVersion !== input.version ||
        admission.grantVersion !== grant.version)
    )
      fail(
        409,
        'SOURCE_CHANGED',
        'The source or permission changed. Review this app before resuming.',
      );
    input = await context.refreshSourceWithin(repo, input);
    await checkGrant(repo, grant, app);
    const id = `${String(now()).padStart(16, '0')}:${randomUUID()}`;
    let output, stepEvidence;
    try {
      if (app.recipe === 'csv-normalize-v1')
        output = normalizeCsv(Buffer.from(input.content)).csv.toString();
      else if (app.recipe === 'link-inventory-v1')
        output = JSON.stringify(inventory(input.content), null, 2);
      else if (app.recipe === 'builder-data-app-v1') {
        const result = runPackage(app.appPackage, input.content);
        output = result.output;
        stepEvidence = result.steps;
      } else fail(409, 'RECIPE_UNSUPPORTED', 'This app version cannot run.');
    } catch (error) {
      if (error.code) throw error;
      fail(
        400,
        'SOURCE_INVALID',
        'The source does not fit this recipe. Check CSV formatting or link limits.',
      );
    }
    const run = record({ user: { id: app.id } }, app.tenantId, {
      id,
      requestedBy: app.ownerId,
      appId: app.id,
      status: 'needs_review',
      recipe: app.recipe,
      recipeVersion: app.recipeVersion,
      ...(app.packageHash
        ? { packageHash: app.packageHash, stepEvidence }
        : {}),
      sourceId: input.id,
      sourceVersion: input.version,
      inputHash: hash(input.content),
      inputSnapshot: input.content,
      output,
      outputHash: hash(output),
      filename: RECIPES[app.recipe].filename,
      grantId: grant.id,
      slot,
    });
    await repo.save('app-run', run);
    app.latestRunId = id;
    app.version++;
    await repo.save('workspace-app', app);
    await audit(repo, app, 'app.ran', {
      runId: id,
      sourceVersion: input.version,
      grantId: grant.id,
    });
    return { runId: id };
  }
  async function control(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'action', 'calendar', 'consent']);
    if (
      !['run', 'pause', 'resume', 'schedule', 'unschedule', 'renew'].includes(
        body.action,
      )
    )
      fail(400, 'INVALID_ACTION', 'Choose a supported app action.');
    const calendar =
      body.action === 'schedule' ? validateCalendar(body.calendar) : null;
    return command(
      actor.user.id,
      key,
      ['app-control', id, body],
      (repo) => owned(repo, actor, 'workspace-app', id, true),
      async (repo, admission) => {
        const app = await owned(repo, actor, 'workspace-app', id, true);
        expected(app, body.expectedVersion);
        if (body.action === 'renew') {
          if (body.consent !== 'local-source-read')
            fail(
              400,
              'CONSENT_REQUIRED',
              'Confirm renewed read access for 30 days.',
            );
          const membership = await member(actor, app.tenantId, true);
          const input = await source(repo, actor, app.sourceId);
          const previous = await repo.get('tool-grant', app.grantId, true);
          previous.status = 'revoked';
          previous.version++;
          await repo.save('tool-grant', previous);
          const grant = record(actor, app.tenantId, {
            subjectKind: 'app',
            subjectId: app.id,
            sourceId: input.id,
            sourceEpoch: input.accessEpoch || 0,
            operation: 'read',
            accessEpoch: membership.accessEpoch ?? null,
            expiresAt: now() + 30 * 86400000,
          });
          app.grantId = grant.id;
          await repo.save('tool-grant', grant);
        }
        if (body.action === 'run') return execute(repo, app, null, admission);
        if (['schedule', 'resume'].includes(body.action))
          await checkGrant(
            repo,
            await repo.get('tool-grant', app.grantId),
            app,
          );
        if (body.action === 'pause') app.status = 'paused';
        if (body.action === 'resume') {
          app.status = 'active';
          app.reason = null;
        }
        if (body.action === 'schedule') {
          app.calendar = calendar;
          app.status = 'active';
          app.reason = null;
        }
        if (body.action === 'unschedule') app.calendar = null;
        app.nextAt =
          app.calendar && app.status === 'active'
            ? nextOccurrence(app.calendar, now())
            : null;
        app.version++;
        await repo.save('workspace-app', app);
        await audit(repo, app, `app.${body.action}`);
        return { appId: id };
      },
      `app:${id}`,
      body.action === 'run'
        ? async (repo) => {
            const app = await owned(repo, actor, 'workspace-app', id, true);
            expected(app, body.expectedVersion);
            if (app.status !== 'active')
              fail(409, 'APP_PAUSED', 'Resume this app before running it.');
            const pending = app.latestRunId
              ? await repo.get('app-run', app.latestRunId)
              : null;
            if (pending?.status === 'needs_review')
              fail(
                409,
                'RUN_NEEDS_REVIEW',
                'Review the previous result before another run.',
              );
            const grant = await repo.get('tool-grant', app.grantId, true);
            const input = await checkGrant(repo, grant, app);
            return admitSource(repo, input, grant);
          }
        : null,
    );
  }
  async function controlHost(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'action']);
    if (!['provision', 'start', 'stop', 'redeploy', 'deprovision'].includes(body.action))
      fail(400, 'INVALID_ACTION', 'Choose a supported host action.');
    return command(
      actor.user.id,
      key,
      ['app-host', id, body],
      (repo) => owned(repo, actor, 'workspace-app', id, true),
      async (repo) => {
        const app = await owned(repo, actor, 'workspace-app', id, true);
        const entitlement = await hostingEntitlement(repo, app.tenantId);
        const requiresSubscription = ['provision', 'start', 'redeploy'].includes(body.action);
        if (requiresSubscription && !entitlement.canHost)
          fail(402, 'SUBSCRIPTION_REQUIRED', 'Relay hosting requires an active Pro or Business subscription.');
        let host = await repo.get('app-host', id, true);
        if (body.action === 'provision') {
          if (host && host.status !== 'deleted') fail(409, 'HOST_EXISTS', 'This app already has a Relay host.');
          expected(app, body.expectedVersion);
          if (app.status !== 'active') fail(409, 'APP_PAUSED', 'Resume this app before hosting it.');
          await checkGrant(repo, await repo.get('tool-grant', app.grantId), app);
          const hosts = await repo.list('app-host', 'tenant_id', app.tenantId);
          if (hosts.filter(item => item.status !== 'deleted').length >= entitlement.includedHosts)
            fail(409, 'HOST_LIMIT', 'This subscription has reached its included host limit.');
          host = record(actor, app.tenantId, {
            id: app.id,
            appId: app.id,
            status: 'running',
            runtime: 'relay-bounded-v1',
            release: 1,
            deployedAppVersion: app.version,
            packageHash: app.packageHash || null,
            resources: { cpu: 'shared', memoryMb: 256, storageMb: 512 },
            startedAt: now(),
            lastDeployAt: now(),
          });
        } else {
          if (!host || host.status === 'deleted') fail(404, 'NOT_FOUND', 'Provision this app before managing its host.');
          expected(host, body.expectedVersion);
          if (['start', 'redeploy'].includes(body.action)) {
            if (app.status !== 'active') fail(409, 'APP_PAUSED', 'Resume this app before starting its host.');
            await checkGrant(repo, await repo.get('tool-grant', app.grantId), app);
          }
          if (body.action === 'start') {
            if (host.status === 'running') fail(409, 'HOST_RUNNING', 'This host is already running.');
            host.status = 'running'; host.startedAt = now();
          }
          if (body.action === 'stop') {
            if (host.status === 'stopped') fail(409, 'HOST_STOPPED', 'This host is already stopped.');
            host.status = 'stopped'; host.stoppedAt = now();
          }
          if (body.action === 'redeploy') {
            host.status = 'running'; host.release++; host.lastDeployAt = now();
            host.deployedAppVersion = app.version; host.packageHash = app.packageHash || null;
          }
          if (body.action === 'deprovision') {
            host.status = 'deleted'; host.deletedAt = now();
          }
          host.version++;
        }
        await repo.save('app-host', host);
        await audit(repo, app, `host.${body.action}`, { hostId: host.id, release: host.release });
        return { hostId: host.id, version: host.version, status: host.status };
      },
      `app-host:${id}`,
    );
  }
  async function review(actor, id, body, key) {
    exactKeys(body, ['expectedVersion', 'action', 'outputHash']);
    if (!['save', 'discard'].includes(body.action))
      fail(400, 'INVALID_ACTION', 'Choose save or discard.');
    const authorize = async (repo) => {
      const run = await repo.get('app-run', id, true);
      if (!run) fail(404, 'NOT_FOUND', 'Run not found.');
      const app = await owned(repo, actor, 'workspace-app', run.appId, true);
      if (body.action === 'save') {
        if (run.grantId !== app.grantId)
          fail(
            409,
            'REVIEW_STALE',
            'Permissions changed. Discard this result and run again.',
          );
        await checkGrant(repo, await repo.get('tool-grant', app.grantId), app);
      }
      return { run, app };
    };
    return command(
      actor.user.id,
      key,
      ['app-review', id, body],
      authorize,
      async (repo) => {
        const { run, app } = await authorize(repo);
        expected(run, body.expectedVersion);
        if (run.status !== 'needs_review' || run.outputHash !== body.outputHash)
          fail(409, 'REVIEW_STALE', 'Review the exact current output.');
        run.status = body.action === 'save' ? 'saved' : 'discarded';
        run.version++;
        if (body.action === 'save')
          await repo.save('app-output', {
            ...run,
            id: run.id,
            ownerId: app.ownerId,
          });
        await repo.save('app-run', run);
        await audit(repo, app, `output.${body.action}`, {
          runId: id,
          outputHash: run.outputHash,
        });
        return { runId: id, status: run.status };
      },
      `run:${id}`,
    );
  }
  async function download(actor, id) {
    const result = await repository.read(async (repo) => {
      const output = await repo.get('app-output', id);
      if (!output) fail(404, 'NOT_FOUND', 'Saved output not found.');
      await owned(repo, actor, 'workspace-app', output.appId);
      if (hash(output.output) !== output.outputHash)
        fail(
          409,
          'OUTPUT_CORRUPT',
          'The saved output failed its integrity check.',
        );
      return {
        filename: output.filename,
        bytes: Buffer.from(output.output),
        appId: output.appId,
      };
    });
    if (context.objectStore && !context.fileScanner)
      fail(409, 'FILE_QUARANTINED', 'The file safety checker is unavailable.');
    if (context.fileScanner) {
      let verdict;
      try {
        verdict = await context.fileScanner.scan(result.bytes);
      } catch {
        verdict = null;
      }
      if (verdict?.status !== 'clean')
        fail(
          409,
          'FILE_QUARANTINED',
          'This output could not pass its file safety check.',
        );
    }
    await repository.read((repo) =>
      owned(repo, actor, 'workspace-app', result.appId),
    );
    return { filename: result.filename, bytes: result.bytes };
  }
  async function tick(after = '') {
    enabled();
    const rows = await repository.read((repo) =>
      repo.page('workspace-app', 'status', 'active', { after, limit: 25 }),
    );
    for (const row of rows) {
      // Admission commits before provider I/O. Failed reads retain their charge.
      // Bind the second phase to this exact app version/slot, source and grant.
      const prepared = await repository.transaction(
        `app:${row.id}`,
        async (repo) => {
          const app = await repo.get('workspace-app', row.id, true);
          if (
            !app ||
            app.status !== 'active' ||
            !app.calendar ||
            app.nextAt > now()
          )
            return null;
          const result = {
            version: app.version,
            slot: app.nextAt,
            admission: null,
          };
          if (now() - app.nextAt > 3600000) return result;
          try {
            const pending = app.latestRunId
              ? await repo.get('app-run', app.latestRunId)
              : null;
            if (pending?.status === 'needs_review')
              fail(
                409,
                'RUN_NEEDS_REVIEW',
                'Review or discard the previous result before another run.',
              );
            const grant = await repo.get('tool-grant', app.grantId, true);
            const input = await checkGrant(repo, grant, app);
            if (input.provenance?.mode === 'live-file') {
              await context.driveBudget(repo, app.tenantId, now());
              result.admission = {
                sourceId: input.id,
                sourceVersion: input.version,
                grantVersion: grant.version,
              };
            }
          } catch (error) {
            if (!error.code) throw error;
            result.error = { code: error.code, message: error.message };
          }
          return result;
        },
      );
      if (!prepared) continue;
      await repository.transaction(`app:${row.id}`, async (repo) => {
        const app = await repo.get('workspace-app', row.id, true);
        if (
          !app ||
          app.status !== 'active' ||
          app.version !== prepared.version ||
          app.nextAt !== prepared.slot
        )
          return;
        const slot = app.nextAt;
        // One slot, one output. Restarts never catch up in bursts. Concurrent
        // preflights can consume attempt allowance, but cannot duplicate output.
        if (now() - slot <= 3600000) {
          try {
            if (prepared.error)
              fail(409, prepared.error.code, prepared.error.message);
            await execute(repo, app, slot, prepared.admission);
          } catch (error) {
            if (!error.code && error.message !== 'INPUT_UNSUPPORTED')
              throw error;
            app.status = 'paused';
            app.reason =
              error.code === 'DRIVE_WORKSPACE_LIMIT'
                ? `${error.message} Resume this app after the allowance resets.`
                : 'Review the latest result, source or permissions before resuming.';
            await audit(repo, app, 'app.blocked', {
              code: error.code || 'INPUT_UNSUPPORTED',
            });
          }
        } else await audit(repo, app, 'app.missed_slot_skipped');
        app.nextAt = nextOccurrence(app.calendar, now());
        app.version++;
        await repo.save('workspace-app', app);
      });
    }
    return { next: rows.length === 25 ? rows.at(-1).id : '' };
  }
  return {
    attachTaskContext: attachContext,
    requestToolPermission: requestPermission,
    declineToolPermission: declinePermission,
    downloadAppOutput: download,
    workspaceApps: view,
    saveToolSource: saveSource,
    installApp: install,
    controlApp: control,
    controlAppHost: controlHost,
    reviewAppRun: review,
    grantTaskTool: grantTask,
    revokeToolGrant: revoke,
    readAgentTool: readForAgent,
    reconcileApps: tick,
  };
}
module.exports = { createWorkspaceApps, RECIPES };
