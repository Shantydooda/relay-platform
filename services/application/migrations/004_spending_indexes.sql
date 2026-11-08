-- Bounded report batches: scope task selection and seek archived settlements by task.
CREATE INDEX IF NOT EXISTS relay_v1_tenant_owner
ON relay_private.relay_v1_documents(kind,tenant_id,owner_id,id);
CREATE INDEX IF NOT EXISTS relay_v1_settlement_task
ON relay_private.relay_v1_documents ((payload::jsonb->>'taskId'),id)
WHERE kind='sandbox-settlement-history';
