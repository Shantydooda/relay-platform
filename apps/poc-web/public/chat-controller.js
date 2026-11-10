(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RelayChat = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function create({state, command, refresh, render, location, revision, refreshedFields}) {
    function operation(field, value, redraw = true) {
      const token = {};
      const key = `${field}Token`;
      state[key] = token;
      state[field] = value;
      if (redraw) render();
      let account, context;
      const identity = () => JSON.stringify([
        revision(), location.hash, state.auth, state.authMode, state.tenantId,
        state.account?.user?.id, state.account?.user?.workspace,
        state.detail?.task?.id, state.buyerTab, state.builderTab, state.editing
      ]);
      function checkpoint() { account = state.account; context = identity(); }
      checkpoint();
      const current = () => state[key] === token && state.account === account && identity() === context;
      return {
        current, checkpoint,
        async read(taskId, valid = () => true) {
          const candidate = {...state};
          await refresh(taskId, candidate);
          if (!current() || !valid()) return false;
          for (const field of refreshedFields) state[field] = candidate[field];
          checkpoint();
          return true;
        },
        finish() {
          if (state[key] !== token) return;
          state[key] = null;
          state[field] = null;
          if (redraw) render();
        }
      };
    }

    async function request() {
      const original = state.prompt;
      const brief = original.trim();
      if (!brief) return;
      const preferred = state.preferredAgent;
      const op = operation('sendingRequest', brief);
      try {
        const result = await command('/api/tasks', 'POST', {
          tenantId: state.tenantId || state.account.memberships[0].id,
          title: brief.slice(0,120), brief,
          ...(preferred?.repeatFromTaskId ? {repeatFromTaskId:preferred.repeatFromTaskId, expectedSourceVersion:preferred.expectedSourceVersion} : {}),
          ...(preferred ? {preferredAgentId:preferred.id, preferenceMode:preferred.preferenceMode || 'agent', discoverySource:preferred.discoverySource || 'unspecified'} : {})
        });
        // A successful server write survives navigation, but must not hijack it.
        if (!op.current() || state.prompt !== original || state.preferredAgent !== preferred) return;
        if (!await op.read(result.taskId, () => state.prompt === original && state.preferredAgent === preferred)) return;
        if (state.prompt !== original || state.preferredAgent !== preferred) return;
        state.prompt = '';
        state.preferredAgent = null;
        location.hash = `chat=${result.taskId}`;
        state.sendingRequest = null;
        render();
        op.checkpoint();
        if (state.features?.scoping) {
          await command(`/api/tasks/${result.taskId}/assist`, 'POST', {expectedVersion:state.detail.task.version});
          if (op.current()) await op.read(result.taskId);
        }
      } catch (error) {
        // Unknown write outcomes retain the existing command retry key and draft.
        if (op.current()) throw error;
      } finally { op.finish(); }
    }

    async function message(body) {
      const task = state.detail.task;
      const scoping = state.features?.scoping && !task.orchestrationStep && !task.orchestrationPlan && ['draft','posted','selected'].includes(task.status);
      state.messageDrafts[task.id] = body;
      state.scrollToLatest = true;
      const op = operation('sendingMessage', body);
      try {
        await command(`/api/tasks/${task.id}/${scoping ? 'assist' : 'messages'}`, 'POST', {
          expectedVersion:task.version, ...(scoping ? {message:body} : {body})
        });
        if (!op.current()) return;
        if (state.messageDrafts[task.id] === body) delete state.messageDrafts[task.id];
        await op.read(task.id);
      } catch (error) {
        if (op.current()) throw error;
      } finally { op.finish(); }
    }
    async function scope(action) {
      const task = state.detail.task;
      const commands = {
        'analyze-brief': ['assist', {}],
        'read-chat-context': ['assist', {useContext:true}],
        'confirm-scope': ['confirm-scope', {proposalId:task.scoping?.id}],
        'cancel-reply': ['cancel-reply', {jobId:task.scoping?.id}]
      };
      if (!Object.hasOwn(commands, action)) throw new Error('Unknown scope action.');
      const [path, body] = commands[action];
      const op = operation('sendingScope', action);
      try {
        await command(`/api/tasks/${task.id}/${path}`, 'POST', {expectedVersion:task.version, ...body});
        if (op.current()) await op.read(task.id);
      } catch (error) {
        if (op.current()) throw error;
      } finally { op.finish(); }
    }
    // Keep native forms mounted while pending: rerendering loses File objects,
    // unsaved text and the error target. Commands retain their original versions.
    async function edit(values, unchanged = () => true) {
      const {id, version} = state.detail.task;
      const body = {expectedVersion:version, title:values.title, brief:values.brief};
      const op = operation('savingBrief', true, false);
      try {
        await command(`/api/tasks/${id}/scope`, 'POST', body);
        if (!op.current() || !unchanged()) return false;
        if (!await op.read(id, unchanged)) return false;
        state.editing = false;
        state.reviewStart = false;
        render();
        return true;
      } catch (error) {
        if (op.current()) throw error;
        return false;
      } finally { op.finish(); }
    }

    async function upload(file, notes, readFile, unchanged = () => true) {
      const {id, version} = state.detail.task;
      const filename = file.name;
      const op = operation('uploadingInput', true, false);
      try {
        const base64 = await readFile(file);
        // File reading may outlive the account, task or file selection.
        if (!op.current() || !unchanged()) return false;
        await command(`/api/tasks/${id}/input`, 'POST', {expectedVersion:version, filename, base64, notes});
        if (!op.current() || !unchanged()) return false;
        if (!await op.read(id, unchanged)) return false;
        render();
        return true;
      } catch (error) {
        if (op.current()) throw error;
        return false;
      } finally { op.finish(); }
    }
    return Object.freeze({request, message, scope, edit, upload});
  }
  return Object.freeze({create});
});
