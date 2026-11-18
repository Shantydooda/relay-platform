'use strict';

// One local model slot. Waiting work is bounded and rotates across workspaces.
// This is process-local: durable scoping jobs retain the existing restart policy.
function createFairQueue({
  maxPending = 16,
  perWorkspace = 2,
  waitMs = 25000,
} = {}) {
  const queues = new Map();
  let active = false,
    lastWorkspace = null,
    pending = 0;
  function drain() {
    if (active || !pending) return;
    const keys = [...queues.keys()];
    const workspace = keys.find((key) => key !== lastWorkspace) || keys[0];
    const list = queues.get(workspace),
      item = list.shift();
    queues.delete(workspace);
    if (list.length) queues.set(workspace, list);
    pending--;
    clearTimeout(item.timer);
    active = true;
    lastWorkspace = workspace;
    Promise.resolve()
      .then(item.work)
      .then(item.resolve, item.reject)
      .finally(() => {
        active = false;
        drain();
      });
  }
  return {
    run(workspace, work) {
      if (typeof workspace !== 'string' || !workspace)
        return Promise.reject(new Error('Model workspace required'));
      if (
        pending >= maxPending ||
        (queues.get(workspace)?.length || 0) >= perWorkspace
      )
        return Promise.reject(
          Object.assign(new Error('Local model queue full'), {
            code: 'MODEL_QUEUE_FULL',
          }),
        );
      return new Promise((resolve, reject) => {
        const item = { work, resolve, reject };
        const list = queues.get(workspace) || [];
        list.push(item);
        queues.set(workspace, list);
        pending++;
        item.timer = setTimeout(() => {
          const current = queues.get(workspace),
            index = current?.indexOf(item) ?? -1;
          if (index < 0) return;
          current.splice(index, 1);
          pending--;
          if (!current.length) queues.delete(workspace);
          reject(
            Object.assign(new Error('Local model queue wait expired'), {
              code: 'MODEL_QUEUE_EXPIRED',
            }),
          );
        }, waitMs);
        drain();
      });
    },
  };
}
module.exports = { createFairQueue };
