'use strict';
const { randomUUID } = require('node:crypto');
const {
  fail,
  exactKeys,
  text,
} = require('../../../packages/contracts/src/input.cjs');
const { parseCsv } = require('../../agent-runtime/src/csv.cjs');

function companyRows(bytes) {
  if (bytes.length > 256 * 1024)
    fail(413, 'ATTIO_FILE_LIMIT', 'Choose a CSV smaller than 256 KB.');
  let rows;
  try {
    rows = parseCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(400, 'ATTIO_CSV', 'Choose a valid UTF-8 company CSV.');
  }
  if (!rows.length)
    fail(400, 'ATTIO_CSV', 'Choose a company CSV with headers and rows.');
  const headers = rows.shift().map((value) => value.trim().toLowerCase());
  if (
    new Set(headers).size !== headers.length ||
    rows.some((row) => row.length !== headers.length)
  )
    fail(400, 'ATTIO_CSV', 'Use unique headers and consistent columns.');
  const domainIndex = headers.findIndex((value) =>
    ['domain', 'website', 'url'].includes(value),
  );
  const nameIndex = headers.findIndex((value) =>
    ['company', 'company_name', 'name'].includes(value),
  );
  if (domainIndex < 0 || !rows.length || rows.length > 50)
    fail(
      400,
      'ATTIO_CSV',
      'Use a domain or website column and 1–50 company rows.',
    );
  const seen = new Set();
  return rows.map((row) => {
    let url;
    try {
      url = new URL(
        row[domainIndex].includes('://')
          ? row[domainIndex]
          : `https://${row[domainIndex]}`,
      );
    } catch {
      fail(
        400,
        'ATTIO_DOMAIN',
        'Every company needs a valid website or domain.',
      );
    }
    const domain = url.hostname.toLowerCase().replace(/^www\./, '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(
        domain,
      ) ||
      seen.has(domain)
    )
      fail(
        400,
        'ATTIO_DOMAIN',
        'Use unique public company domains, without credentials or ports.',
      );
    seen.add(domain);
    const name = nameIndex < 0 ? '' : row[nameIndex].trim();
    if (name.length > 200)
      fail(400, 'ATTIO_NAME', 'Company names must be at most 200 characters.');
    return { domain, name };
  });
}

function createAttioDelivery({
  repository,
  resolveActor,
  localExecution,
  attioProvider: provider,
  taskFor,
  verifiedBytes,
  now,
  hash,
}) {
  async function owner(actor, tenantId) {
    if (!localExecution || !actor?.user?.id || actor.recoveryRequired)
      fail(403, 'FORBIDDEN', 'An active local account is required.');
    text(tenantId, 'Workspace', 1, 100);
    const current = await resolveActor(actor.user.id);
    const member = current?.memberships.find((item) => item.id === tenantId);
    if (member?.role !== 'owner')
      fail(
        403,
        'ADMIN_REQUIRED',
        'The workspace owner must approve CRM delivery.',
      );
    return member;
  }
  const configured = (tenantId) => !!provider && provider.tenantId === tenantId;
  const connectionId = (tenantId) => `attio:${tenantId}`;
  async function connection(repo, actor, tenantId) {
    const member = await owner(actor, tenantId);
    const record = await repo.get(
      'attio-connection',
      connectionId(tenantId),
      true,
    );
    if (
      !configured(tenantId) ||
      record?.status !== 'active' ||
      record.connectionKey !== (provider?.connectionKey || null) ||
      record.ownerId !== actor.user.id ||
      record.accessEpoch !== (member.accessEpoch ?? null)
    )
      fail(409, 'ATTIO_CONNECT', 'Connect Attio for this workspace first.');
    return record;
  }
  const view = (job) => ({
    id: job.id,
    taskId: job.taskId,
    fileId: job.fileId,
    filename: job.filename || 'Company CSV',
    updatedAt: job.updatedAt || job.createdAt,
    retryAfter: job.retryAfter || null,
    canContinue:
      job.status !== 'sent' &&
      (job.rowAttempts || 0) < 5 &&
      (!job.retryAfter || job.retryAfter <= now()),
    status: job.status,
    destination: job.destination,
    rows: job.rows,
    completed: job.results.length,
    total: job.rows.length,
    error: job.error || null,
    results: job.results,
  });
  const receiptId = (taskId, fileId) =>
    hash(`attio-receipt:${taskId}:${fileId}`);
  async function saveReceipt(repo, job) {
    await repo.save('attio-receipt', {
      id: receiptId(job.taskId, job.fileId),
      ownerId: job.ownerId,
      tenantId: job.tenantId,
      jobId: job.id,
    });
  }
  async function attioDeliveries(actor, taskId) {
    text(taskId, 'Task', 1, 100);
    return repository.read(async (repo) => {
      const task = await taskFor(repo, actor, taskId);
      const member = await owner(actor, task.tenantId);
      const conn = await repo.get(
        'attio-connection',
        connectionId(task.tenantId),
      );
      const receipts = [];
      const submission = task.submissions.at(-1);
      if (submission?.status !== 'accepted') return { receipts };
      for (const file of submission.files) {
        const pointer = await repo.get(
          'attio-receipt',
          receiptId(task.id, file.id),
        );
        // Existing pre-index reviews are readable without a write or provider call.
        const legacyId =
          conn &&
          hash(`${task.id}:${submission.id}:${file.sha256}:${conn.version}`);
        const job = await repo.get(
          'attio-delivery',
          pointer?.jobId || legacyId || 'none',
        );
        if (
          !job ||
          job.taskId !== task.id ||
          job.submissionId !== submission.id ||
          job.fileId !== file.id ||
          job.ownerId !== actor.user.id
        )
          continue;
        const currentConnection =
          configured(task.tenantId) &&
          conn?.status === 'active' &&
          conn.ownerId === actor.user.id &&
          conn.accessEpoch === (member.accessEpoch ?? null) &&
          conn.connectionKey === (provider?.connectionKey || null) &&
          conn.version === job.connectionVersion;
        const receipt = view(job);
        receipt.canContinue = receipt.canContinue && !!currentConnection;
        receipt.blockedReason =
          job.status === 'sent'
            ? null
            : !currentConnection
              ? 'Connection changed. Reconnect if needed, then review this file again.'
              : (job.rowAttempts || 0) >= 5
                ? 'Retry limit reached. Resolve the connection issue before preparing a fresh review.'
                : job.retryAfter > now()
                  ? 'Retry available in a minute. Refresh to check.'
                  : null;
        receipts.push(receipt);
      }
      return { receipts };
    });
  }
  async function attioStatus(actor, tenantId) {
    const member = await owner(actor, tenantId);
    const record = await repository.read((repo) =>
      repo.get('attio-connection', connectionId(tenantId)),
    );
    return {
      configured: configured(tenantId),
      connected:
        configured(tenantId) &&
        record?.status === 'active' &&
        record.connectionKey === (provider?.connectionKey || null) &&
        record.ownerId === actor.user.id &&
        record.accessEpoch === (member.accessEpoch ?? null),
      destination: configured(tenantId) ? provider.workspaceLabel : null,
    };
  }
  async function controlAttio(actor, body) {
    exactKeys(body, ['tenantId', 'action']);
    if (!['connect', 'disconnect'].includes(body.action))
      fail(400, 'INVALID_INPUT', 'Choose connect or disconnect.');
    return repository.transaction(connectionId(body.tenantId), async (repo) => {
      const member = await owner(actor, body.tenantId);
      if (!configured(body.tenantId))
        fail(
          503,
          'ATTIO_SETUP',
          'Configure a local Attio private integration first.',
        );
      const old = await repo.get(
        'attio-connection',
        connectionId(body.tenantId),
        true,
      );
      await repo.save('attio-connection', {
        id: connectionId(body.tenantId),
        tenantId: body.tenantId,
        ownerId: actor.user.id,
        accessEpoch: member.accessEpoch ?? null,
        connectionKey: provider.connectionKey || null,
        version: (old?.version || 0) + 1,
        status: body.action === 'connect' ? 'active' : 'disconnected',
      });
      await repo.save('tool-audit', {
        id: randomUUID(),
        tenantId: body.tenantId,
        ownerId: actor.user.id,
        subjectId: connectionId(body.tenantId),
        action: `attio.${body.action}`,
        createdAt: now(),
      });
      return { connected: body.action === 'connect' };
    });
  }
  async function prepareAttio(actor, body) {
    exactKeys(body, ['taskId', 'submissionId', 'fileId']);
    for (const field of ['taskId', 'submissionId', 'fileId'])
      text(body[field], field, 1, 100);
    return repository.transaction(body.taskId, async (repo) => {
      const task = await taskFor(repo, actor, body.taskId, true);
      const conn = await connection(repo, actor, task.tenantId);
      const submission = task.submissions.at(-1);
      const file = submission?.files.find((item) => item.id === body.fileId);
      if (
        submission?.id !== body.submissionId ||
        submission.status !== 'accepted' ||
        !file ||
        !file.filename.toLowerCase().endsWith('.csv')
      )
        fail(
          409,
          'ATTIO_DELIVERY',
          'Accept the current CSV delivery before sending it to Attio.',
        );
      const artifact = await repo.get('artifact', file.id);
      if (artifact?.submissionId !== submission.id)
        fail(409, 'FILE_UNAVAILABLE', 'Delivery file is unavailable.');
      const rows = companyRows(verifiedBytes(file, artifact, task.id));
      const id = hash(
        `${task.id}:${submission.id}:${file.sha256}:${conn.version}`,
      );
      const previous = await repo.get('attio-delivery', id, true);
      if (previous) {
        await saveReceipt(repo, previous);
        return view(previous);
      }
      const job = {
        id,
        tenantId: task.tenantId,
        ownerId: actor.user.id,
        taskId: task.id,
        submissionId: submission.id,
        fileId: file.id,
        filename: file.filename,
        digest: file.sha256,
        connectionVersion: conn.version,
        destination: provider.workspaceLabel,
        rows,
        results: [],
        status: 'review',
        version: 1,
        createdAt: now(),
      };
      await repo.save('attio-delivery', job);
      await saveReceipt(repo, job);
      return view(job);
    });
  }
  async function sendAttio(actor, body) {
    exactKeys(body, ['id', 'consent']);
    text(body.id, 'Delivery', 1, 100);
    if (body.consent !== 'upsert-reviewed-companies')
      fail(
        400,
        'CONSENT_REQUIRED',
        'Approve the exact companies and existing-record updates.',
      );
    // Each row commits independently. A crash repeats only the unconfirmed row;
    // provider-side domain matching prevents duplicate company creation.
    return repository.transaction(`attio-delivery:${body.id}`, async (repo) => {
      const job = await repo.get('attio-delivery', body.id, true);
      if (!job) fail(404, 'NOT_FOUND', 'Delivery not found.');
      const task = await taskFor(repo, actor, job.taskId, true);
      const conn = await connection(repo, actor, job.tenantId);
      if (
        job.ownerId !== actor.user.id ||
        conn.version !== job.connectionVersion ||
        task.submissions.at(-1)?.id !== job.submissionId ||
        task.submissions.at(-1)?.status !== 'accepted'
      )
        fail(
          409,
          'ATTIO_REVIEW_REQUIRED',
          'Access or delivery changed. Prepare a fresh review.',
        );
      const file = task.submissions
        .at(-1)
        .files.find((item) => item.id === job.fileId);
      const artifact = await repo.get('artifact', job.fileId);
      if (
        !file ||
        file.sha256 !== job.digest ||
        artifact?.submissionId !== job.submissionId
      )
        fail(
          409,
          'FILE_UNAVAILABLE',
          'The reviewed file changed. Prepare a fresh review.',
        );
      verifiedBytes(file, artifact, task.id);
      if (job.status === 'sent') return view(job);
      if (job.retryAfter && job.retryAfter > now())
        fail(
          429,
          'ATTIO_RETRY_WAIT',
          'Wait a minute before retrying this delivery.',
        );
      if ((job.rowAttempts || 0) >= 5)
        fail(
          409,
          'ATTIO_RETRY_LIMIT',
          'This row has failed five times. Resolve the provider issue and reconnect before preparing a new review.',
        );
      job.rowAttempts = (job.rowAttempts || 0) + 1;
      const position = job.results.length;
      try {
        const result = await provider.assertCompany(job.rows[position]);
        job.results.push({
          domain: job.rows[position].domain,
          recordId: result.recordId,
        });
        job.status =
          job.results.length === job.rows.length ? 'sent' : 'sending';
        job.rowAttempts = 0;
        delete job.error;
        delete job.retryAfter;
      } catch (error) {
        job.status = 'failed';
        job.retryAfter = now() + 60000;
        job.error =
          'Attio did not confirm this row. Check the connection and retry the remaining rows.';
      }
      job.version++;
      job.updatedAt = now();
      await repo.save('attio-delivery', job);
      await saveReceipt(repo, job);
      await repo.save('tool-audit', {
        id: randomUUID(),
        tenantId: job.tenantId,
        ownerId: actor.user.id,
        subjectId: job.id,
        action: `attio.${job.status}`,
        createdAt: now(),
      });
      return view(job);
    });
  }
  return {
    attioDeliveries,
    attioStatus,
    controlAttio,
    prepareAttio,
    sendAttio,
  };
}
module.exports = { createAttioDelivery, companyRows };
