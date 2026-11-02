'use strict';

const { createStore } = require('./store.cjs');
const { createSqliteRepository } = require('../../application/src/repository.cjs');
const { createApplication } = require('../../application/src/service.cjs');
const { fail } = require('../../../packages/contracts/src/input.cjs');

async function createUnifiedLocalStore({ authDb, applicationDb, repository: suppliedRepository, storage = 'sqlite', now = Date.now, localExecution = false, objectStore, fileScanner, scopingProvider, paymentProvider, driveProvider, paymentRecoveryUserIds = [] }) {
  const identity = createStore(authDb, now, { identityOnly: true });
  const repository = suppliedRepository || createSqliteRepository(applicationDb);
  await importLegacyLocalData(authDb, repository);
  async function resolveOperator(id) {
    const user = authDb.prepare('SELECT id,name FROM users WHERE id=?').get(id);
    if (!user) fail(403, 'OPERATOR_UNAVAILABLE', 'Operator is unavailable.');
    const memberships = authDb.prepare(`SELECT m.tenant_id AS id,m.role,e.epoch AS accessEpoch,
      EXISTS(SELECT 1 FROM company_workspaces c WHERE c.tenant_id=m.tenant_id) AS company
      FROM memberships m JOIN membership_epochs e ON e.user_id=m.user_id AND e.tenant_id=m.tenant_id
      WHERE m.user_id=?`).all(id);
    return { user, memberships };
  }
  const { guardLocalAccess, createAccessBoundary } = require('./access-guard.cjs');
  const boundary = createAccessBoundary(repository);
  const application = createApplication({ repository: boundary.repository, objectStore, fileScanner, now, localExecution, scopingProvider, paymentProvider, driveProvider, paymentRecoveryUserIds, resolveOperator, resolveActor: resolveOperator });
  const guarded = guardLocalAccess({ identity, application, repository, resolveOperator, now, boundary });
  return {
    ...guarded, features: application.features, repository, storage,
    async health() {
      authDb.prepare('SELECT 1').get();
      await repository.read(repo => repo.hasRecords());
    }
  };
}

async function importLegacyLocalData(db, repository) {
  await repository.transaction('legacy-import', async repo => {
    if (await repo.get('migration', 'legacy-local-v1')) return;
    for (const row of db.prepare('SELECT * FROM agents').all()) {
      const rules = db.prepare('SELECT * FROM agent_rules WHERE agent_id=?').get(row.id);
      const user = db.prepare('SELECT name FROM users WHERE id=?').get(row.owner_id);
      await repo.save('agent', { id: row.id, ownerId: row.owner_id, operatorName: user.name,
        name: row.name, kind: row.kind, integration: row.integration, purpose: row.purpose, domain: row.domain,
        setupStage: row.setup_stage, createdAt: row.created_at, version: rules.version,
        capabilities: db.prepare('SELECT id,category,task,qualification FROM capabilities WHERE agent_id=? ORDER BY rowid').all(row.id),
        rules: { automaticRequested: !!rules.automatic_requested, minimumPayout: rules.minimum_payout, concurrency: rules.concurrency } });
    }
    for (const row of db.prepare('SELECT * FROM tasks').all()) {
      const offers = db.prepare(`SELECT o.*,a.name,a.kind,a.owner_id,u.name AS operator_name,c.category,c.task AS capability,c.qualification
        FROM offers o JOIN agents a ON a.id=o.agent_id JOIN users u ON u.id=a.owner_id JOIN capabilities c ON c.id=o.capability_id WHERE o.task_id=?`).all(row.id).map(offer => ({
        id: offer.id, agentId: offer.agent_id, operatorId: offer.owner_id, agentName: offer.name, agentType: offer.kind,
        operatorName: offer.operator_name, category: offer.category, capability: offer.capability, capabilityId: offer.capability_id,
        qualification: offer.qualification, taskVersion: offer.task_version, scopeVersion: offer.scope_version,
        amountMinor: offer.amount_minor, deliveryMinutes: offer.delivery_minutes, proposal: offer.proposal,
        currency: 'USD', createdAt: offer.created_at, expiresAt: offer.expires_at, runtimeBid: false }));
      const selection = db.prepare('SELECT * FROM offer_selections WHERE task_id=?').get(row.id);
      const assigned = db.prepare('SELECT * FROM assignments WHERE task_id=?').get(row.id);
      const assignedOffer = offers.find(offer => offer.id === assigned?.offer_id);
      await repo.save('task', { id: row.id, tenantId: row.tenant_id, ownerId: row.created_by,
        title: row.title, brief: row.brief, status: row.status, version: row.version, scopeVersion: row.scope_version,
        createdAt: row.created_at, updatedAt: row.updated_at, offers, selectedOfferId: selection?.offer_id || null,
        messages: db.prepare('SELECT m.id,m.body,m.author_id AS authorId,u.name AS authorName,m.created_at AS createdAt FROM messages m JOIN users u ON u.id=m.author_id WHERE m.task_id=? ORDER BY m.created_at,m.rowid').all(row.id),
        events: db.prepare('SELECT sequence,type,version,created_at AS createdAt FROM events WHERE task_id=? ORDER BY sequence').all(row.id),
        scopes: db.prepare('SELECT version,title,brief,created_at AS createdAt FROM scope_versions WHERE task_id=? ORDER BY version').all(row.id),
        submissions: [], assignment: assigned ? { id: `legacy-${row.id}`, status: 'blocked', offerId: assigned.offer_id,
          operatorId: assignedOffer?.operatorId, agentId: assignedOffer?.agentId, authorizedAt: assigned.accepted_at,
          progress: 'Legacy assignment has no execution authorization' } : null });
      for (const offer of offers) await repo.save('offer-index', { id: offer.id, ownerId: offer.operatorId, taskId: row.id, offerId: offer.id });
      if (assignedOffer) await repo.save('grant', { id: `legacy-${row.id}`, ownerId: assignedOffer.operatorId, taskId: row.id, agentId: assignedOffer.agentId });
    }
    // Old receipts cannot be reinterpreted under a new command fingerprint.
    // Preserve their keys as conflicts rather than risking duplicate mutations.
    for (const row of [...db.prepare('SELECT user_id,key,fingerprint,response FROM idempotency').all(), ...db.prepare('SELECT user_id,key,fingerprint,response FROM marketplace_receipts').all()]) {
      if (!await repo.receipt(row.user_id, row.key)) await repo.saveReceipt(row.user_id, row.key, `legacy:${row.fingerprint}`, JSON.parse(row.response));
    }
    await repo.save('migration', { id: 'legacy-local-v1', ownerId: 'system', importedAt: Date.now() });
  });
}
module.exports = { createUnifiedLocalStore, importLegacyLocalData };
