(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RelayRefresh = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';

  function context(state, revision) {
    return JSON.stringify([
      revision, state.account?.user?.id, state.account?.user?.workspace,
      state.authMode, state.auth, state.tenantId, state.buyerTab,
      state.builderTab, state.detail?.task?.id, state.renderedViewKey
    ]);
  }

  // One pending read at a time. A token belongs to its original UI context;
  // completing it never grants authority or retries a command.
  function create() {
    let pending = null;
    return Object.freeze({
      get pending() { return pending !== null; },
      begin(state, revision) {
        if (pending) return null;
        pending = Object.freeze({ context: context(state, revision), account: state.account });
        return pending;
      },
      current(token, state, revision) {
        return token !== null && pending === token && token.account === state.account &&
          token.context === context(state, revision);
      },
      finish(token) {
        if (pending === token) pending = null;
      }
    });
  }
  return Object.freeze({ create });
});
