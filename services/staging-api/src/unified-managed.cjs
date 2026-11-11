'use strict';
const { createApplication } = require('../../application/src/service.cjs');
const {
  createAccessBoundary,
  createApprovalAccessReconciler,
} = require('../../application/src/access-boundary.cjs');
const { createMembershipAuthority } = require('./membership-authority.cjs');
const { createManagedStore } = require('./store.cjs');

// Opt-in composition used by the separate private-pilot launcher.
function createUnifiedManagedStore({
  provider,
  sessionKey,
  repository,
  now = Date.now,
  applicationOptions = {},
  membershipFeed,
}) {
  if (!repository?.accessGuard)
    throw new TypeError('Managed application requires a database access guard');
  const boundary = createAccessBoundary(repository);
  let reconcile = async () => {};
  const authority = createMembershipAuthority({
    repository: boundary.repository,
    boundary,
    now,
    reconcile: () => reconcile(),
  });
  reconcile = createApprovalAccessReconciler({
    repository: boundary.repository,
    resolveOperator: authority.resolve,
    now,
  });
  const application = createApplication({
    ...applicationOptions,
    repository: boundary.repository,
    now,
    resolveOperator: authority.resolve,
    resolveActor: authority.resolve,
  });
  const accessBoundary = {
    run: (work) =>
      boundary.run(async () => {
        await reconcile();
        return work();
      }),
  };
  const store = createManagedStore({
    provider,
    sessionKey,
    now,
    application,
    accessBoundary,
    resolveMemberships: async (id) => (await authority.resolve(id)).memberships,
  });
  // Keep trusted ingestion separate from the HTTP store: request bodies cannot
  // set membership generations or use this as a workspace-administration API.
  const feed = membershipFeed
    ? require('./membership-feed.cjs').createMembershipFeed({
        ...membershipFeed,
        repository: boundary.repository,
        boundary,
        authority,
        now,
      })
    : null;
  return { store, access: authority, feed };
}
module.exports = { createUnifiedManagedStore };
