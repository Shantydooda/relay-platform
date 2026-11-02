'use strict';

// Health belongs to the process; job state and retry/lease policy stay in storage.
function startWorker({
  name,
  run,
  intervalMs = 5000,
  staleAfterMs = 60000,
  now = Date.now,
  logger = console,
  schedule = setInterval,
  unschedule = clearInterval,
}) {
  if (
    !/^[a-z][a-z-]{1,40}$/.test(name) ||
    typeof run !== 'function' ||
    !Number.isFinite(intervalMs) ||
    intervalMs < 1 ||
    !Number.isFinite(staleAfterMs) ||
    staleAfterMs < intervalMs
  ) {
    throw new Error('Invalid worker configuration');
  }
  const createdAt = now();
  let stopped = false,
    pending = null,
    startedAt = null,
    completedAt = null;
  let succeededAt = null,
    failedAt = null,
    failures = 0,
    runs = 0,
    durationMs = null;
  function tick() {
    if (stopped || pending) return pending || Promise.resolve();
    startedAt = now();
    // Defer invocation so synchronous throws also release the single-flight lock.
    pending = Promise.resolve()
      .then(run)
      .then(
        () => {
          succeededAt = now();
          if (failures) logger.info?.(`Worker ${name} recovered.`);
          failures = 0;
        },
        () => {
          failedAt = now();
          failures += 1;
          if (failures === 1)
            logger.error?.(
              `Worker ${name} failed; automatic retry remains enabled.`,
            );
        },
      )
      .finally(() => {
        completedAt = now();
        durationMs = Math.max(0, completedAt - startedAt);
        runs += 1;
        pending = null;
      });
    return pending;
  }
  const timer = schedule(tick, intervalMs);
  timer.unref?.();
  tick();
  return {
    tick,
    stop() {
      stopped = true;
      unschedule(timer);
    },
    done: () => pending || Promise.resolve(),
    health() {
      const age = now() - (pending ? startedAt : (completedAt ?? createdAt));
      const status = stopped
        ? 'stopped'
        : age > staleAfterMs
          ? 'stalled'
          : failures
            ? 'degraded'
            : succeededAt === null
              ? 'starting'
              : 'healthy';
      return {
        name,
        status,
        running: !!pending,
        runs,
        consecutiveFailures: failures,
        startedAt,
        completedAt,
        succeededAt,
        failedAt,
        durationMs,
        staleAfterMs,
      };
    },
  };
}
function workerHealth(workers) {
  const items = workers.map((worker) => worker.health());
  return {
    status:
      items.length && items.every((item) => item.status === 'healthy')
        ? 'healthy'
        : 'degraded',
    workers: items,
  };
}
module.exports = { startWorker, workerHealth };
