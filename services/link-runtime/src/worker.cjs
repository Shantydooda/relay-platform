'use strict';
const { createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const {
  createSupplierClient,
} = require('../../../packages/supplier-sdk/src/index.cjs');
const { inventory, supportedBrief, sourceText } = require('./inventory.cjs');

function createLinkRuntime({
  origin,
  token,
  expectedAgentId,
  fetchImpl,
  pollMs = 2000,
  onEvent = () => {},
  processor = inventory,
  profile = null,
}) {
  const controller = new AbortController();
  const client = createSupplierClient({
    origin,
    token,
    fetchImpl,
    signal: controller.signal,
  });
  // Stable command identity survives a lost response/restart without persisting file bytes.
  const key = (...parts) =>
    createHash('sha256')
      .update(token)
      .update(JSON.stringify([expectedAgentId, ...parts]))
      .digest('hex');
  async function pages(method, field) {
    const result = [];
    let after = '';
    for (let count = 0; count < 50; count++) {
      const page = await client[method]({ after, limit: 100 });
      result.push(...page[field]);
      if (!page.hasMore) return result;
      if (!page.nextCursor || page.nextCursor === after)
        throw new Error('INVALID_PAGE');
      after = page.nextCursor;
    }
    return result;
  }
  async function execute(assignment) {
    const current = await client.task(assignment.taskId);
    if (
      current.assignmentId !== assignment.assignmentId ||
      !['queued', 'running'].includes(current.status)
    )
      return;
    for (const reference of current.contextReferences || []) {
      const grant = current.toolGrants?.find(
        (item) =>
          item.sourceId === reference.sourceId && item.expiresAt > Date.now(),
      );
      if (grant) continue;
      const previous = current.permissionRequests
        ?.filter((item) => item.sourceId === reference.sourceId)
        .at(-1);
      if (previous?.status === 'declined' || previous?.status === 'pending')
        return;
      await client.requestPermission(
        assignment.taskId,
        {
          sourceId: reference.sourceId,
          operation: 'read',
          reason:
            'Extract links from this selected source for your requested link inventory.',
        },
        key(
          'permission',
          assignment.assignmentId,
          reference.sourceId,
          previous?.id || 'initial',
        ),
      );
      return;
    }
    const job = await client.claim(
      assignment.taskId,
      { assignmentId: assignment.assignmentId },
      key(
        'claim',
        assignment.assignmentId,
        current.submissions.length,
        current.attempt,
      ),
    );
    if (job.exhausted) return;
    const supportingText = [];
    for (const reference of current.contextReferences || []) {
      const grant = current.toolGrants.find(
        (item) =>
          item.sourceId === reference.sourceId && item.expiresAt > Date.now(),
      );
      try {
        const data = await client.readTool(
          assignment.taskId,
          { grantId: grant.id, leaseToken: job.leaseToken },
          key('read', job.leaseToken, grant.id),
        );
        supportingText.push(data.content);
      } catch (error) {
        if (
          ![
            'GRANT_REQUIRED',
            'GRANT_STALE',
            'DRIVE_RECONNECT',
            'DRIVE_REJECTED',
            'FILE_UNAVAILABLE',
          ].includes(error.code)
        )
          throw error;
        await client.requestPermission(
          assignment.taskId,
          {
            sourceId: reference.sourceId,
            operation: 'read',
            reason:
              error.code.startsWith('DRIVE_') ||
              error.code === 'FILE_UNAVAILABLE'
                ? 'Drive access changed. Reconnect Drive and select this file again in Connected tools, then approve read access here.'
                : 'Read access changed. Please review permission before this source is used again.',
          },
          key('permission-renewal', assignment.assignmentId, grant.id),
        );
        return;
      }
    }
    let result;
    try {
      if (job.input) throw new Error('INPUT_UNSUPPORTED');
      const abort = new AbortController();
      let renewing = null,
        renewalError = null,
        sequence = 0;
      const timer = profile
        ? setInterval(() => {
            if (renewing) return;
            renewing = client
              .progress(
                assignment.taskId,
                { leaseToken: job.leaseToken, message: profile.progress },
                key('model-progress', job.leaseToken, ++sequence),
              )
              .catch((error) => {
                renewalError = error;
                abort.abort();
              })
              .finally(() => {
                renewing = null;
              });
          }, 10000)
        : null;
      try {
        result = await processor(
          [sourceText(job.brief), ...supportingText].join('\n'),
          job.revisionNotes,
          { signal: AbortSignal.any([controller.signal, abort.signal]) },
        );
      } finally {
        if (timer) clearInterval(timer);
        if (renewing) await renewing;
      }
      if (renewalError) throw renewalError;
    } catch {
      await client.fail(
        assignment.taskId,
        {
          leaseToken: job.leaseToken,
          code: profile ? 'AGENT_ERROR' : 'INPUT_UNSUPPORTED',
        },
        key('fail', job.leaseToken),
      );
      onEvent(profile ? 'execution.failed' : 'execution.unsupported');
      return;
    }
    await client.progress(
      assignment.taskId,
      {
        leaseToken: job.leaseToken,
        message:
          profile?.progress ||
          'Extracted supplied links offline; preparing JSON and text report.',
      },
      key('progress', job.leaseToken),
    );
    const report = `Offline link inventory\n${result.links.join('\n')}\n\n${JSON.stringify(result.report, null, 2)}\n${profile?.description || 'No URLs were visited. This is deterministic text processing, not research.'}\n`;
    await client.submit(
      assignment.taskId,
      {
        leaseToken: job.leaseToken,
        evidence: `Extracted ${result.report.uniqueLinks} unique links from supplied text; removed ${result.report.duplicatesRemoved} duplicates and rejected ${result.report.rejected} credential-bearing or malformed candidates. ${result.report.sort} order. ${profile?.description || 'No web requests or AI model.'}`,
        files: [
          {
            filename: 'links.json',
            mime: 'application/json',
            base64: Buffer.from(JSON.stringify(result, null, 2)).toString(
              'base64',
            ),
          },
          {
            filename: 'link-report.txt',
            mime: 'text/plain',
            base64: Buffer.from(report).toString('base64'),
          },
        ],
      },
      key('submit', job.leaseToken, result),
    );
    onEvent('delivery.submitted');
  }
  async function tick() {
    const agent = await client.heartbeat({
      runtimeName: profile?.name || 'Relay offline link inventory',
      runtimeVersion: profile?.version || '1',
    });
    if (agent.agentId !== expectedAgentId) {
      const error = new Error('AGENT_MISMATCH');
      error.status = 403;
      throw error;
    }
    for (const job of (await client.qualifications()).jobs) {
      if (job.rubric !== 'link-inventory-v1') continue;
      const result = await processor(job.input, job.revision, {
        signal: controller.signal,
      });
      await client.submitQualification(
        job.id,
        { round: job.round, ...result },
        key('qualification', job.id, job.round),
      );
      onEvent('qualification.submitted');
    }
    const capability = agent.capabilities.find((item) =>
      /link|url/i.test(item.task),
    );
    if (agent.automaticRequested && capability) {
      for (const task of await pages('opportunities', 'tasks')) {
        if (
          task.input ||
          !supportedBrief(task.brief) ||
          (profile?.maxInputBytes &&
            Buffer.byteLength(sourceText(task.brief)) >
              profile.maxInputBytes) ||
          task.myOffers.some(
            (offer) =>
              offer.expiresAt > Date.now() &&
              offer.scopeVersion === task.scopeVersion,
          )
        )
          continue;
        try {
          inventory(sourceText(task.brief));
          const body = {
            agentId: agent.agentId,
            capabilityId: capability.id,
            expectedVersion: task.version,
            amountMinor: agent.minimumPayout,
            deliveryMinutes: profile ? 3 : 1,
            proposal:
              profile?.proposal ||
              'Extract and deduplicate HTTP(S) links from the supplied text, sort ascending, and deliver JSON plus a text report. Offline deterministic automation; no browsing or link verification. Unpaid local integration test.',
          };
          await client.quote(task.id, body, key('quote', task.id, body));
          onEvent('offer.submitted');
        } catch (error) {
          if (error.status && ![404, 409].includes(error.status)) throw error;
        }
      }
    }
    for (const assignment of await pages('assignments', 'assignments')) {
      if (assignment.status === 'running' && assignment.leaseUntil > Date.now())
        continue;
      try {
        await execute(assignment);
      } catch (error) {
        if ([401, 403].includes(error.status)) throw error;
        onEvent('execution.retry_wait');
      }
    }
  }
  return {
    tick,
    stop() {
      controller.abort();
    },
    async run() {
      while (!controller.signal.aborted) {
        let retryDelay = pollMs;
        try {
          await tick();
        } catch (error) {
          if ([401, 403].includes(error.status)) {
            onEvent('runtime.revoked');
            break;
          }
          retryDelay = profile ? 30000 : pollMs;
          if (!controller.signal.aborted) {
            const reason = error.code || error.message;
            onEvent(
              'runtime.retry_wait',
              /^[A-Z_]{1,60}$/.test(reason) ? reason : 'UNAVAILABLE',
            );
          }
        }
        try {
          await delay(retryDelay, undefined, { signal: controller.signal });
        } catch {
          break;
        }
      }
    },
  };
}
module.exports = { createLinkRuntime };
