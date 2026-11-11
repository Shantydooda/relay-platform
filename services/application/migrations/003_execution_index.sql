-- Backfill durable recovery indexing for pre-existing assignments. Normal writes
-- maintain the same index in the application transaction from this version on.
INSERT INTO relay_private.relay_v1_documents (kind, id, owner_id, tenant_id, status, version, payload)
SELECT 'execution-index', id, owner_id, tenant_id,
       payload::jsonb #>> '{assignment,status}', 1,
       jsonb_build_object('id', id, 'ownerId', owner_id, 'tenantId', tenant_id,
                          'status', payload::jsonb #>> '{assignment,status}')::text
FROM relay_private.relay_v1_documents
WHERE kind = 'task' AND jsonb_typeof(payload::jsonb -> 'assignment') = 'object'
ON CONFLICT (kind, id) DO NOTHING;

INSERT INTO relay_private.relay_v1_documents (kind, id, owner_id, tenant_id, status, version, payload)
SELECT 'agent-grant', payload::jsonb #>> '{assignment,id}',
       payload::jsonb #>> '{assignment,operatorId}', payload::jsonb #>> '{assignment,agentId}',
       payload::jsonb #>> '{assignment,status}', 1,
       jsonb_build_object('id', payload::jsonb #>> '{assignment,id}',
                          'ownerId', payload::jsonb #>> '{assignment,operatorId}',
                          'tenantId', payload::jsonb #>> '{assignment,agentId}',
                          'agentId', payload::jsonb #>> '{assignment,agentId}',
                          'taskId', id, 'status', payload::jsonb #>> '{assignment,status}')::text
FROM relay_private.relay_v1_documents
WHERE kind = 'task' AND jsonb_typeof(payload::jsonb -> 'assignment') = 'object'
  AND payload::jsonb #>> '{assignment,operatorId}' IS NOT NULL
  AND payload::jsonb #>> '{assignment,agentId}' IS NOT NULL
ON CONFLICT (kind, id) DO NOTHING;
